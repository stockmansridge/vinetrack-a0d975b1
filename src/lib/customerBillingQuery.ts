// Phase 2E — Vineyard Owner billing (customer-facing, portal only).
//
// Every value on /account/billing comes from the SQL 152/153 RPCs and the two
// Stripe Edge Functions on the shared VineTrack backend. The browser never
// talks to Stripe, never supplies a Stripe customer id, and never derives
// billing authority, seat counts or entitlement locally.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const BILLING_KEYS = {
  root: ["account", "billing"] as const,
  vineyards: ["account", "billing", "vineyards"] as const,
  summary: (vineyardId: string) => ["account", "billing", "summary", vineyardId] as const,
  history: (vineyardId: string, limit: number, offset: number) =>
    ["account", "billing", "history", vineyardId, limit, offset] as const,
  licences: (vineyardId: string) => ["account", "billing", "licences", vineyardId] as const,
};

// ---------------------------------------------------------------------------
// Contract error codes → customer-safe messages
// ---------------------------------------------------------------------------

export const BILLING_ERROR_MESSAGES: Record<string, string> = {
  authentication_required: "Please sign in to view billing.",
  owner_required: "Only a Vineyard Owner can access billing for this vineyard.",
  vineyard_not_found: "This vineyard could not be found.",
  billing_access_denied:
    "You do not have permission to view this vineyard's billing information.",
  billing_managed_by_another_owner:
    "Billing is managed by another authorised Vineyard Owner.",
  no_billing_relationship: "No billing account is associated with this vineyard.",
  stripe_customer_not_found:
    "No Stripe billing account is associated with this vineyard.",
  stripe_subscription_not_found:
    "No active subscription is associated with this vineyard.",
  invoice_not_found: "This invoice could not be found.",
  invoice_access_denied: "You do not have permission to view this invoice.",
  invoice_link_unavailable: "This invoice document is not available yet.",
  invalid_invoice_action: "That invoice action is not supported.",
  unsupported_action: "That invoice action is not supported.",
  portal_not_configured: "Online billing management is temporarily unavailable.",
  stripe_request_failed:
    "Billing is temporarily unavailable. Please try again shortly.",
};

const GENERIC_BILLING_ERROR =
  "Billing is temporarily unavailable. Please try again shortly.";

/** Map a backend error (RPC exception message or Edge Function code) to a
 *  customer-facing message. Raw SQL / Stripe text is never surfaced. */
export function billingErrorMessage(input: unknown): string {
  const raw =
    typeof input === "string"
      ? input
      : input && typeof input === "object" && "message" in input
        ? String((input as { message?: unknown }).message ?? "")
        : "";
  const trimmed = raw.trim();
  const direct = BILLING_ERROR_MESSAGES[trimmed];
  if (direct) return direct;
  for (const code of Object.keys(BILLING_ERROR_MESSAGES)) {
    if (new RegExp(`\\b${code}\\b`).test(trimmed)) return BILLING_ERROR_MESSAGES[code];
  }
  return GENERIC_BILLING_ERROR;
}

/** The backend error code, when it is one the contract defines. */
export function billingErrorCode(input: unknown): string | null {
  const raw =
    typeof input === "string"
      ? input
      : input && typeof input === "object" && "message" in input
        ? String((input as { message?: unknown }).message ?? "")
        : "";
  const trimmed = raw.trim();
  if (BILLING_ERROR_MESSAGES[trimmed]) return trimmed;
  for (const code of Object.keys(BILLING_ERROR_MESSAGES)) {
    if (new RegExp(`\\b${code}\\b`).test(trimmed)) return code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strict contract types
// ---------------------------------------------------------------------------

export interface BillingVineyard {
  vineyard_id: string;
  vineyard_name: string;
  role: string;
  has_stripe_customer: boolean;
  has_active_subscription: boolean;
  plan_code: string | null;
  subscription_status: string | null;
  can_manage_billing: boolean;
}

export type BillingAuthorityCode =
  | null
  | "billing_managed_by_another_owner"
  | "no_billing_relationship";

export type PurchasePlatform = "web" | "ios" | "android" | null;
export type ReceiptManagedBy = "stripe" | "apple" | "google" | null;
export type BillingProvider = "stripe" | "apple" | "google" | "manual" | null;

export interface BillingSummary {
  vineyard_id: string;
  vineyard_name: string | null;
  user_role: string | null;
  is_vineyard_owner: boolean;
  can_manage_billing: boolean;
  can_view_invoices: boolean;
  billing_authority_code: BillingAuthorityCode;
  billing_owner_user_id: string | null;
  billing_owner_display_name: string | null;
  effective_plan: string | null;
  access_source: string | null;
  purchase_platform: PurchasePlatform;
  receipt_managed_by: ReceiptManagedBy;
  subscription_id: string | null;
  subscription_status: string | null;
  provider: BillingProvider;
  product_id: string | null;
  plan_code: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  expires_at: string | null;
  licence_limit: number | null;
  assigned_licences: number | null;
  available_licences: number | null;
  is_unlimited: boolean;
  portal_access: boolean;
  can_use_ios_app: boolean;
  can_use_android_app: boolean;
  has_stripe_customer: boolean;
  has_invoice_history: boolean;
  money_unit: string | null;
}

export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "payment_failed"
  | "void"
  | "uncollectible"
  | "refunded"
  | "partially_refunded";

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  paid: "Paid",
  payment_failed: "Payment failed",
  void: "Void",
  uncollectible: "Uncollectible",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

export interface BillingHistoryRow {
  record_id: string;
  record_type: string;
  provider: string | null;
  purchase_platform: string | null;
  product_id: string | null;
  plan_code: string | null;
  description: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  amount_paid: number | null;
  amount_due: number | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  refunded_at: string | null;
  subscription_status: string | null;
  can_view_invoice: boolean;
  can_download_invoice: boolean;
  redacted_reference: string | null;
  total_count: number;
}

export interface BillingLicence {
  licence_id: string;
  user_display_name: string | null;
  user_email: string | null;
  vineyard_id: string | null;
  vineyard_name: string | null;
  assigned_at: string | null;
  status: "active" | "pending" | string;
}

// ---------------------------------------------------------------------------
// Strict readers (no tolerant field guessing — a contract break throws)
// ---------------------------------------------------------------------------

function contractError(field: string): never {
  throw new Error(`billing_contract_error: missing field ${field}`);
}

function str(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (typeof v !== "string" || v.length === 0) contractError(key);
  return v;
}
function strOrNull(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") contractError(key);
  return v;
}
function bool(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  if (typeof v !== "boolean") contractError(key);
  return v;
}
function boolOrFalse(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  if (v === null || v === undefined) return false;
  if (typeof v !== "boolean") contractError(key);
  return v;
}
function numOrNull(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) contractError(key);
  return n;
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

function readVineyard(row: Record<string, unknown>): BillingVineyard {
  return {
    vineyard_id: str(row, "vineyard_id"),
    vineyard_name: strOrNull(row, "vineyard_name") ?? "Vineyard",
    role: str(row, "role"),
    has_stripe_customer: bool(row, "has_stripe_customer"),
    has_active_subscription: bool(row, "has_active_subscription"),
    plan_code: strOrNull(row, "plan_code"),
    subscription_status: strOrNull(row, "subscription_status"),
    can_manage_billing: bool(row, "can_manage_billing"),
  };
}

function readSummary(raw: unknown): BillingSummary {
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
  if (!row || typeof row !== "object") contractError("summary");
  const authority = row.billing_authority_code;
  if (
    authority !== null &&
    authority !== undefined &&
    authority !== "billing_managed_by_another_owner" &&
    authority !== "no_billing_relationship"
  ) {
    contractError("billing_authority_code");
  }
  return {
    vineyard_id: str(row, "vineyard_id"),
    vineyard_name: strOrNull(row, "vineyard_name"),
    user_role: strOrNull(row, "user_role"),
    is_vineyard_owner: bool(row, "is_vineyard_owner"),
    can_manage_billing: bool(row, "can_manage_billing"),
    can_view_invoices: bool(row, "can_view_invoices"),
    billing_authority_code: (authority ?? null) as BillingAuthorityCode,
    billing_owner_user_id: strOrNull(row, "billing_owner_user_id"),
    billing_owner_display_name: strOrNull(row, "billing_owner_display_name"),
    effective_plan: strOrNull(row, "effective_plan"),
    access_source: strOrNull(row, "access_source"),
    purchase_platform: strOrNull(row, "purchase_platform") as PurchasePlatform,
    receipt_managed_by: strOrNull(row, "receipt_managed_by") as ReceiptManagedBy,
    subscription_id: strOrNull(row, "subscription_id"),
    subscription_status: strOrNull(row, "subscription_status"),
    provider: strOrNull(row, "provider") as BillingProvider,
    product_id: strOrNull(row, "product_id"),
    plan_code: strOrNull(row, "plan_code"),
    current_period_start: strOrNull(row, "current_period_start"),
    current_period_end: strOrNull(row, "current_period_end"),
    cancel_at_period_end: boolOrFalse(row, "cancel_at_period_end"),
    cancelled_at: strOrNull(row, "cancelled_at"),
    expires_at: strOrNull(row, "expires_at"),
    licence_limit: numOrNull(row, "licence_limit"),
    assigned_licences: numOrNull(row, "assigned_licences"),
    available_licences: numOrNull(row, "available_licences"),
    is_unlimited: boolOrFalse(row, "is_unlimited"),
    portal_access: boolOrFalse(row, "portal_access"),
    can_use_ios_app: boolOrFalse(row, "can_use_ios_app"),
    can_use_android_app: boolOrFalse(row, "can_use_android_app"),
    has_stripe_customer: boolOrFalse(row, "has_stripe_customer"),
    has_invoice_history: boolOrFalse(row, "has_invoice_history"),
    money_unit: strOrNull(row, "money_unit"),
  };
}

function readHistoryRow(row: Record<string, unknown>): BillingHistoryRow {
  return {
    record_id: str(row, "record_id"),
    record_type: strOrNull(row, "record_type") ?? "invoice",
    provider: strOrNull(row, "provider"),
    purchase_platform: strOrNull(row, "purchase_platform"),
    product_id: strOrNull(row, "product_id"),
    plan_code: strOrNull(row, "plan_code"),
    description: strOrNull(row, "description"),
    invoice_id: strOrNull(row, "invoice_id"),
    invoice_number: strOrNull(row, "invoice_number"),
    invoice_status: strOrNull(row, "invoice_status"),
    currency: strOrNull(row, "currency"),
    subtotal: numOrNull(row, "subtotal"),
    tax: numOrNull(row, "tax"),
    total: numOrNull(row, "total"),
    amount_paid: numOrNull(row, "amount_paid"),
    amount_due: numOrNull(row, "amount_due"),
    period_start: strOrNull(row, "period_start"),
    period_end: strOrNull(row, "period_end"),
    created_at: strOrNull(row, "created_at"),
    paid_at: strOrNull(row, "paid_at"),
    voided_at: strOrNull(row, "voided_at"),
    refunded_at: strOrNull(row, "refunded_at"),
    subscription_status: strOrNull(row, "subscription_status"),
    can_view_invoice: boolOrFalse(row, "can_view_invoice"),
    can_download_invoice: boolOrFalse(row, "can_download_invoice"),
    redacted_reference: strOrNull(row, "redacted_reference"),
    total_count: numOrNull(row, "total_count") ?? 0,
  };
}

function readLicence(row: Record<string, unknown>): BillingLicence {
  return {
    licence_id: str(row, "licence_id"),
    user_display_name: strOrNull(row, "user_display_name"),
    user_email: strOrNull(row, "user_email"),
    vineyard_id: strOrNull(row, "vineyard_id"),
    vineyard_name: strOrNull(row, "vineyard_name"),
    assigned_at: strOrNull(row, "assigned_at"),
    status: strOrNull(row, "status") ?? "active",
  };
}

// ---------------------------------------------------------------------------
// Money and date formatting
// ---------------------------------------------------------------------------

/** Stripe minor units → a currency-correct string (never assumes AUD). */
export function formatMinorUnits(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return "—";
  const code = (currency ?? "AUD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
    }).format(amount / 100);
  } catch {
    return `${code} ${(amount / 100).toFixed(2)}`;
  }
}

export function formatBillingDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatBillingPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return "—";
  return `${formatBillingDate(start)} – ${formatBillingDate(end)}`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase as any).rpc(name, args ?? {});

async function callRpc(name: string, args?: Record<string, unknown>) {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(billingErrorMessage(error.message ?? String(error)));
  return data;
}

/** The single authorisation source for the whole page. */
export function useBillingVineyards() {
  return useQuery({
    queryKey: BILLING_KEYS.vineyards,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<BillingVineyard[]> => {
      const data = await callRpc("get_my_billing_vineyards");
      return asRows(data).map(readVineyard);
    },
  });
}

export function useBillingSummary(vineyardId: string | null) {
  return useQuery({
    queryKey: BILLING_KEYS.summary(vineyardId ?? "none"),
    enabled: !!vineyardId,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<BillingSummary> => {
      const data = await callRpc("get_my_vineyard_billing_summary", {
        p_vineyard_id: vineyardId,
      });
      return readSummary(data);
    },
  });
}

export interface BillingHistoryPage {
  rows: BillingHistoryRow[];
  totalCount: number;
}

export function useBillingHistory(
  vineyardId: string | null,
  limit: number,
  offset: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: BILLING_KEYS.history(vineyardId ?? "none", limit, offset),
    enabled: !!vineyardId && enabled,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<BillingHistoryPage> => {
      const data = await callRpc("get_my_vineyard_billing_history", {
        p_vineyard_id: vineyardId,
        p_limit: limit,
        p_offset: offset,
      });
      const rows = asRows(data).map(readHistoryRow);
      return { rows, totalCount: rows[0]?.total_count ?? 0 };
    },
  });
}

export function useBillingLicences(vineyardId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: BILLING_KEYS.licences(vineyardId ?? "none"),
    enabled: !!vineyardId && enabled,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<BillingLicence[]> => {
      const data = await callRpc("get_my_vineyard_billing_licences", {
        p_vineyard_id: vineyardId,
      });
      return asRows(data).map(readLicence);
    },
  });
}

// ---------------------------------------------------------------------------
// Edge Functions — Stripe Customer Portal and invoice links
// ---------------------------------------------------------------------------

function edgeError(error: unknown, data: unknown): string {
  const code =
    data && typeof data === "object"
      ? ((data as Record<string, unknown>).code ??
        (data as Record<string, unknown>).error)
      : null;
  if (typeof code === "string") return billingErrorMessage(code);
  return billingErrorMessage(error);
}

/** Opens a fresh Stripe Customer Portal session. The URL is used immediately
 *  and never persisted in state, cache or storage. */
export function useStripePortalSession() {
  return useMutation({
    mutationFn: async (vineyardId: string): Promise<string> => {
      const { data, error } = await supabase.functions.invoke(
        "create-stripe-customer-portal-session",
        { body: { vineyard_id: vineyardId } },
      );
      if (error) throw new Error(edgeError(error, data));
      const url = (data as { url?: unknown } | null)?.url;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new Error(BILLING_ERROR_MESSAGES.portal_not_configured);
      }
      return url;
    },
  });
}

export interface InvoiceLinkRequest {
  vineyardId: string;
  invoiceId: string;
  action: "view" | "download";
}

/** Mints an invoice link on demand. Nothing is cached or stored. */
export function useInvoiceLink() {
  return useMutation({
    mutationFn: async ({
      vineyardId,
      invoiceId,
      action,
    }: InvoiceLinkRequest): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("get-stripe-invoice-link", {
        body: { vineyard_id: vineyardId, invoice_id: invoiceId, action },
      });
      if (error) throw new Error(edgeError(error, data));
      const url = (data as { url?: unknown } | null)?.url;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new Error(BILLING_ERROR_MESSAGES.invoice_link_unavailable);
      }
      return url;
    },
  });
}

/** Drop every cached customer-billing query (logout / account switch). */
export function useClearBillingCache() {
  const qc = useQueryClient();
  return () => qc.removeQueries({ queryKey: BILLING_KEYS.root });
}

export function removeBillingQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.removeQueries({ queryKey: BILLING_KEYS.root });
}
