// Access & Entitlements admin centre — SQL 139/140/141 RPC layer.
//
// Every read and mutation goes through System-Admin-gated RPCs on the shared
// VineTrack Supabase project. The portal never computes entitlement, never
// writes to billing / subscription / licence / entitlement tables, and never
// touches raw provider payloads.
//
// Contracts below were verified live (System Admin session, July 2026) against
// the real payloads — field names are strict, no tolerant guessing:
//
//   admin_store_billing_monitor()                       -> jsonb object
//   admin_billing_alerts(p_limit, p_include_acknowledged)-> jsonb array
//   admin_acknowledge_billing_alert(p_alert_id)          -> boolean
//   admin_access_users(p_search, p_limit, p_offset, p_vineyard_id, p_role,
//                      p_plan_code, p_billing_source, p_has_access,
//                      p_status_filter)                  -> jsonb array
//   admin_user_access_detail(p_user_id)                  -> jsonb object
//   admin_user_access_history(p_user_id, p_limit)        -> jsonb array
//   admin_list_billing_grants()                          -> jsonb array
//   admin_create_billing_grant(p_owner_user_id, p_grant_type, p_reason,
//                              p_vineyard_id, p_starts_at, p_expires_at) -> uuid
//   admin_extend_billing_grant(p_subscription_id, p_reason, p_new_expires_at) -> uuid
//   admin_revoke_billing_grant(p_subscription_id, p_reason, p_revoke_licences) -> uuid
//   admin_assign_licence(p_subscription_id, p_user_id, p_reason, p_vineyard_id) -> uuid
//   admin_remove_licence(p_licence_id, p_reason)         -> uuid
//   admin_refresh_user_entitlement(p_user_id)            -> jsonb object

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";

/* ------------------------------------------------------------------ */
/* Transport + strict payload guards                                   */
/* ------------------------------------------------------------------ */

export async function adminRpc<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (iosSupabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(name, args ?? {});
  if (error) throw error;
  return data as T;
}

class ContractError extends Error {
  constructor(rpc: string, detail: string) {
    super(`${rpc} returned an unexpected payload (${detail}). The backend contract has changed.`);
    this.name = "ContractError";
  }
}

function requireObject(rpc: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError(rpc, "expected an object");
  return value as Record<string, unknown>;
}

function requireArray(rpc: string, value: unknown): Record<string, unknown>[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ContractError(rpc, "expected an array");
  return value as Record<string, unknown>[];
}

function requireKeys(rpc: string, obj: Record<string, unknown>, keys: string[]) {
  const missing = keys.filter((k) => !(k in obj));
  if (missing.length) throw new ContractError(rpc, `missing ${missing.join(", ")}`);
}

function requireBoolean(rpc: string, obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") throw new ContractError(rpc, `${key} must be a boolean`);
  return v;
}

export function isPermissionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const msg = (e?.message ?? "").toLowerCase();
  return e?.code === "42501" || msg.includes("system admin") || msg.includes("permission");
}

export function friendlyError(err: unknown): string {
  if (!err) return "";
  if (isPermissionError(err))
    return "You do not have permission to view global access and entitlement information.";
  const e = err as { message?: string };
  return e?.message ?? "Something went wrong loading this data.";
}

/* ------------------------------------------------------------------ */
/* Labels — verified reason codes, plus a readable fallback            */
/* ------------------------------------------------------------------ */

/** Reason codes observed live: internal_unlimited, enterprise_subscription,
 *  assigned_licence, revoked, no_entitlement. Remaining entries mirror the
 *  plan / provider vocabulary used by the same backend. */
export const ACCESS_REASON_LABEL: Record<string, string> = {
  internal_unlimited: "Internal Unlimited",
  enterprise_subscription: "Enterprise Subscription",
  team_subscription: "Team Subscription",
  solo_subscription: "Solo Subscription",
  assigned_licence: "Assigned Licence",
  portal_subscription: "Portal Subscription",
  app_store_subscription: "App Store Subscription",
  play_store_subscription: "Google Play Subscription",
  active_trial: "Active Trial",
  trial: "Active Trial",
  trial_expired: "Trial Expired",
  grace_period: "Grace Period",
  expired: "Expired",
  revoked: "Revoked",
  no_entitlement: "No Entitlement",
};

/** access_source / billing_provider values observed live: internal, manual,
 *  enterprise, team, trial, none. */
export const BILLING_SOURCE_LABEL: Record<string, string> = {
  internal: "Internal",
  manual: "Manual Grant",
  stripe: "Portal Billing (Stripe)",
  apple: "Apple App Store",
  app_store: "Apple App Store",
  google: "Google Play",
  play_store: "Google Play",
  revenuecat: "RevenueCat",
  enterprise: "Enterprise Plan",
  team: "Team Plan",
  solo: "Solo Plan",
  trial: "Trial",
  none: "None",
};

/** Where a paid subscription was originally purchased. Never inferred from the
 *  device or role — the backend returns null whenever no paid purchase exists
 *  (trial, Internal Unlimited, manual grant, support/beta access). */
export const PURCHASE_PLATFORM_LABEL: Record<string, string> = {
  ios: "Apple App Store",
  apple: "Apple App Store",
  app_store: "Apple App Store",
  android: "Google Play",
  google: "Google Play",
  play_store: "Google Play",
  portal: "Portal Billing",
  stripe: "Portal Billing",
  web: "Portal Billing",
};

export const NOT_APPLICABLE = "Not applicable";


export const GRANT_TYPES = [
  { value: "internal_unlimited", label: "Internal Unlimited" },
  { value: "complimentary_solo", label: "Complimentary Solo" },
  { value: "complimentary_team", label: "Complimentary Team" },
  { value: "beta_tester", label: "Beta Tester" },
  { value: "temporary_access", label: "Temporary Access" },
  { value: "support_access", label: "Support Access" },
  { value: "enterprise_contract", label: "Enterprise Contract" },
] as const;

export type GrantType = (typeof GRANT_TYPES)[number]["value"];

/** Grant types the backend rejects without an expiry date. */
export const GRANT_TYPES_REQUIRING_EXPIRY: GrantType[] = ["temporary_access", "support_access"];

function humanise(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function labelFor(map: Record<string, string>, raw: string | null | undefined, fallback = "—") {
  if (!raw) return fallback;
  return map[raw] ?? humanise(raw);
}

export const accessReasonLabel = (r: string | null | undefined) => labelFor(ACCESS_REASON_LABEL, r);
export const billingSourceLabel = (s: string | null | undefined) =>
  labelFor(BILLING_SOURCE_LABEL, s, "None");
export const grantTypeLabel = (t: string | null | undefined) =>
  GRANT_TYPES.find((g) => g.value === t)?.label ?? labelFor({}, t);

/** Purchase platform is display-only; a null value means no paid purchase. */
export const purchasePlatformLabel = (p: string | null | undefined) =>
  p ? (PURCHASE_PLATFORM_LABEL[p] ?? humanise(p)) : NOT_APPLICABLE;

/** The resolver reports an ended account trial as reason_code `expired` with
 *  access_source `trial`. Present that as "Trial Expired" — never as
 *  "No Entitlement", which is reserved for reason_code = no_entitlement. */
export function resolvedReasonLabel(a: {
  reason_code: string | null;
  access_source: string | null;
}): string {
  if (a.access_source === "trial" && (a.reason_code === "expired" || a.reason_code === "revoked"))
    return a.reason_code === "revoked" ? "Trial Revoked" : "Trial Expired";
  return accessReasonLabel(a.reason_code);
}

export const isTrialSource = (accessSource: string | null | undefined) => accessSource === "trial";

/** Platforms come from the server-resolved entitlement booleans only. */
export function platformsAllowed(a: {
  portal_access: boolean | null;
  can_use_ios_app: boolean | null;
  can_use_android_app: boolean | null;
}): string {
  const list = [
    a.portal_access ? "Portal" : null,
    a.can_use_ios_app ? "iOS" : null,
    a.can_use_android_app ? "Android" : null,
  ].filter(Boolean);
  return list.length ? list.join(", ") : "No platforms";
}


export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Query keys                                                          */
/* ------------------------------------------------------------------ */

export const AE_KEYS = {
  root: ["admin", "access-entitlements"] as const,
  monitor: ["admin", "access-entitlements", "monitor"] as const,
  alertsAll: ["admin", "access-entitlements", "alerts"] as const,
  alerts: (includeAcknowledged: boolean, limit: number) =>
    ["admin", "access-entitlements", "alerts", includeAcknowledged, limit] as const,
  users: (params: AccessUsersParams) =>
    ["admin", "access-entitlements", "users", params] as const,
  usersAll: ["admin", "access-entitlements", "users"] as const,
  detail: (userId: string) => ["admin", "access-entitlements", "detail", userId] as const,
  history: (userId: string) => ["admin", "access-entitlements", "history", userId] as const,
  grants: ["admin", "access-entitlements", "grants"] as const,
  vineyards: ["admin", "access-entitlements", "vineyards"] as const,
  plans: ["admin", "access-entitlements", "plans"] as const,
  pools: ["admin", "access-entitlements", "licence-pools"] as const,

};

/* ------------------------------------------------------------------ */
/* Billing health monitor (SQL 139)                                    */
/* ------------------------------------------------------------------ */

export interface MonitorSection {
  count: number;
  recent: Record<string, unknown>[];
}

export interface BillingMonitor {
  generated_at: string | null;
  open_alerts: number;
  events_needing_review: MonitorSection;
  failed_events: MonitorSection;
  unresolved_users: MonitorSection;
  ownership_conflicts: MonitorSection;
  unknown_products: Record<string, unknown>[];
  stuck_deliveries: Record<string, unknown>[];
  expiring_within_7_days: Record<string, unknown>[];
  recent_status_changes: Record<string, unknown>[];
  rc_active_supabase_missing: Record<string, unknown>[];
}

function section(rpc: string, obj: Record<string, unknown>, key: string): MonitorSection {
  const raw = requireObject(`${rpc}.${key}`, obj[key]);
  requireKeys(`${rpc}.${key}`, raw, ["count", "recent"]);
  return { count: Number(raw.count ?? 0), recent: requireArray(`${rpc}.${key}.recent`, raw.recent) };
}

export function useBillingMonitor() {
  return useQuery({
    queryKey: AE_KEYS.monitor,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<BillingMonitor> => {
      const rpc = "admin_store_billing_monitor";
      const o = requireObject(rpc, await adminRpc(rpc));
      requireKeys(rpc, o, [
        "open_alerts",
        "events_needing_review",
        "failed_events",
        "unresolved_users",
        "ownership_conflicts",
        "stuck_deliveries",
        "expiring_within_7_days",
        "recent_status_changes",
      ]);
      return {
        generated_at: (o.generated_at as string) ?? null,
        open_alerts: Number(o.open_alerts ?? 0),
        events_needing_review: section(rpc, o, "events_needing_review"),
        failed_events: section(rpc, o, "failed_events"),
        unresolved_users: section(rpc, o, "unresolved_users"),
        ownership_conflicts: section(rpc, o, "ownership_conflicts"),
        unknown_products: requireArray(rpc, o.unknown_products ?? []),
        stuck_deliveries: requireArray(rpc, o.stuck_deliveries),
        expiring_within_7_days: requireArray(rpc, o.expiring_within_7_days),
        recent_status_changes: requireArray(rpc, o.recent_status_changes),
        rc_active_supabase_missing: requireArray(rpc, o.rc_active_supabase_missing ?? []),
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Billing alerts                                                      */
/* ------------------------------------------------------------------ */

export interface BillingAlert {
  id: string;
  alert_type: string;
  severity: "critical" | "warning" | "info";
  provider: string | null;
  provider_event_id: string | null;
  event_type: string | null;
  product_id: string | null;
  resolved_user_id: string | null;
  detail: string | null;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

function toSeverity(v: unknown): BillingAlert["severity"] {
  const s = String(v ?? "").toLowerCase();
  if (s === "critical" || s === "error") return "critical";
  if (s === "warning" || s === "warn") return "warning";
  return "info";
}

export function useBillingAlerts(opts: { includeAcknowledged: boolean; limit?: number }) {
  const limit = opts.limit ?? 50;
  return useQuery({
    queryKey: AE_KEYS.alerts(opts.includeAcknowledged, limit),
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<BillingAlert[]> => {
      const rpc = "admin_billing_alerts";
      const rows = requireArray(
        rpc,
        await adminRpc(rpc, { p_limit: limit, p_include_acknowledged: opts.includeAcknowledged }),
      );
      return rows.map((r) => {
        requireKeys(rpc, r, ["id", "alert_type", "severity", "created_at", "detail"]);
        return {
          id: String(r.id),
          alert_type: String(r.alert_type),
          severity: toSeverity(r.severity),
          provider: (r.provider as string) ?? null,
          provider_event_id: (r.provider_event_id as string) ?? null,
          event_type: (r.event_type as string) ?? null,
          product_id: (r.product_id as string) ?? null,
          resolved_user_id: (r.resolved_user_id as string) ?? null,
          detail: (r.detail as string) ?? null,
          created_at: String(r.created_at),
          acknowledged_at: (r.acknowledged_at as string) ?? null,
          acknowledged_by: (r.acknowledged_by as string) ?? null,
        };
      });
    },
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { alertId: string }) =>
      adminRpc<boolean>("admin_acknowledge_billing_alert", { p_alert_id: args.alertId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: AE_KEYS.alertsAll });
      qc.invalidateQueries({ queryKey: AE_KEYS.monitor });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Users & access directory (server paginated / filtered)              */
/* ------------------------------------------------------------------ */

export interface AccessUsersParams {
  search: string;
  limit: number;
  offset: number;
  vineyardId: string | null;
  role: string | null;
  planCode: string | null;
  billingSource: string | null;
  hasAccess: boolean | null;
}

export interface AccessUserVineyard {
  vineyard_id: string;
  name: string;
  role: string;
}

/** Verified live against admin_access_users (SQL 144, July 2026). */
export interface AccessUserRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  email_confirmed: boolean;
  is_disabled: boolean;
  is_system_admin: boolean;
  account_created_at: string | null;
  last_sign_in_at: string | null;
  vineyards: AccessUserVineyard[];
  has_access: boolean;
  reason_code: string | null;
  access_source: string | null;
  plan_code: string | null;
  plan_name: string | null;
  billing_provider: string | null;
  purchase_platform: string | null;
  product_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  manual_override: boolean | null;
  unlimited_licences: boolean;
  licence_count: number;
  review_status: string | null;
  last_verified_at: string | null;
  /** SQL 146: non-null booleans on every row. */
  portal_access: boolean;
  can_use_ios_app: boolean;
  can_use_android_app: boolean;
  total_count: number;
}

export function useAccessUsers(params: AccessUsersParams) {
  return useQuery({
    queryKey: AE_KEYS.users(params),
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ rows: AccessUserRow[]; total: number }> => {
      const rpc = "admin_access_users";
      const rows = requireArray(
        rpc,
        await adminRpc(rpc, {
          p_search: params.search || null,
          p_limit: params.limit,
          p_offset: params.offset,
          p_vineyard_id: params.vineyardId,
          p_role: params.role,
          p_plan_code: params.planCode,
          p_billing_source: params.billingSource,
          p_has_access: params.hasAccess,
        }),
      );
      const mapped = rows.map((r) => {
        requireKeys(rpc, r, [
          "user_id",
          "email",
          "has_access",
          "reason_code",
          "access_source",
          "plan_code",
          "purchase_platform",
          "subscription_status",
          "review_status",
          "total_count",
        ]);
        return {
          user_id: String(r.user_id),
          email: s(r.email),
          full_name: s(r.full_name),
          email_confirmed: r.email_confirmed === true,
          is_disabled: r.is_disabled === true,
          is_system_admin: r.is_system_admin === true,
          account_created_at: s(r.account_created_at),
          last_sign_in_at: s(r.last_sign_in_at),
          vineyards: requireArray(rpc, r.vineyards ?? []).map((v) => ({
            vineyard_id: String(v.vineyard_id ?? ""),
            name: String(v.name ?? ""),
            role: String(v.role ?? ""),
          })),
          has_access: r.has_access === true,
          reason_code: s(r.reason_code),
          access_source: s(r.access_source),
          plan_code: s(r.plan_code),
          plan_name: s(r.plan_name),
          billing_provider: s(r.billing_provider),
          purchase_platform: s(r.purchase_platform),
          product_id: s(r.product_id),
          subscription_status: s(r.subscription_status),
          current_period_end: s(r.current_period_end),
          cancel_at_period_end: b(r.cancel_at_period_end),
          manual_override: b(r.manual_override),
          unlimited_licences: r.unlimited_licences === true,
          licence_count: n(r.licence_count),
          review_status: s(r.review_status),
          last_verified_at: s(r.last_verified_at),
          portal_access: requireBoolean(rpc, r, "portal_access"),
          can_use_ios_app: requireBoolean(rpc, r, "can_use_ios_app"),
          can_use_android_app: requireBoolean(rpc, r, "can_use_android_app"),
          total_count: n(r.total_count),
        } satisfies AccessUserRow;
      });
      return { rows: mapped, total: mapped[0]?.total_count ?? 0 };
    },
  });
}


/* ------------------------------------------------------------------ */
/* Filter option sources                                               */
/* ------------------------------------------------------------------ */

export interface AdminVineyardOption {
  id: string;
  name: string;
}

export function useAdminVineyardOptions() {
  return useQuery({
    queryKey: AE_KEYS.vineyards,
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<AdminVineyardOption[]> => {
      const rows = requireArray("admin_list_vineyards", await adminRpc("admin_list_vineyards"));
      return rows
        .map((r) => ({ id: String(r.id ?? ""), name: String(r.name ?? "") }))
        .filter((v) => v.id && v.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export interface PlanOption {
  code: string;
  name: string;
}

export function usePlanOptions() {
  return useQuery({
    queryKey: AE_KEYS.plans,
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<PlanOption[]> => {
      const { data, error } = await (iosSupabase as unknown as {
        from: (t: string) => {
          select: (c: string) => Promise<{ data: unknown; error: unknown }>;
        };
      })
        .from("vinetrack_plans")
        .select("code, name");
      if (error) throw error;
      return requireArray("vinetrack_plans", data)
        .map((r) => ({ code: String(r.code ?? ""), name: String(r.name ?? r.code ?? "") }))
        .filter((p) => p.code);
    },
  });
}

/* ------------------------------------------------------------------ */
/* User detail + history                                               */
/* ------------------------------------------------------------------ */

export interface UserIdentity {
  user_id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  is_system_admin: boolean;
}

export interface EffectiveAccess {
  has_access: boolean;
  reason_code: string | null;
  access_source: string | null;
  plan_code: string | null;
  plan_name: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  billing_provider: string | null;
  purchase_platform: string | null;
  licence_id: string | null;
  vineyard_id: string | null;
  portal_access: boolean | null;
  portal_access_level: string | null;
  can_use_ios_app: boolean | null;
  can_use_android_app: boolean | null;
  unlimited_licences: boolean | null;
  trial_end: string | null;
  /** SQL 144 resolver field: when the current entitlement stops being valid. */
  expires_at: string | null;
  grace_period_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  manual_grant_reason: string | null;
  manual_grant_expires_at: string | null;
  last_verified_at: string | null;
}

/** SQL 143 account trial, returned by admin_user_access_detail.account_trial.
 *  Read-only in the portal: no trial dates are ever written from here. */
export interface AccountTrial {
  status: string | null;
  source_type: string | null;
  created_from: string | null;
  is_persisted: boolean;
  is_currently_valid: boolean;
  trial_started_at: string | null;
  trial_ends_at: string | null;
}


export interface BillingSource {
  subscription_id: string;
  plan_code: string | null;
  plan_name: string | null;
  status: string | null;
  provider: string | null;
  purchase_platform: string | null;
  is_owner: boolean;
  is_effective: boolean;
  seats_included: number;
  seats_purchased: number;
  active_licences: number;
  unlimited_licences: boolean;
  manual_grant_reason: string | null;
  manual_grant_expires_at: string | null;
  manual_grant_revoked_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  created_at: string | null;
}

export interface LicenceHeld {
  licence_id: string;
  subscription_id: string | null;
  plan_code: string | null;
  status: string | null;
  vineyard_id: string | null;
  vineyard_name: string | null;
  owner_email: string | null;
  assigned_at: string | null;
  revoked_at: string | null;
}

export interface Membership {
  vineyard_id: string;
  vineyard_name: string | null;
  role: string | null;
  status: string | null;
  joined_at: string | null;
  removed_at: string | null;
}

export interface UserAccessDetail {
  identity: UserIdentity;
  effective_access: EffectiveAccess;
  account_trial: AccountTrial | null;
  billing_sources: BillingSource[];
  licences_held: LicenceHeld[];
  memberships: { active: Membership[]; historical: Membership[] };
  open_alerts: Record<string, unknown>[];
  generated_at: string | null;
}


const s = (v: unknown): string | null => (v == null ? null : String(v));
const b = (v: unknown): boolean | null => (v == null ? null : v === true);
const n = (v: unknown): number => Number(v ?? 0);

function mapMembership(m: Record<string, unknown>): Membership {
  return {
    vineyard_id: String(m.vineyard_id ?? ""),
    vineyard_name: s(m.vineyard_name ?? m.name),
    role: s(m.role),
    status: s(m.status),
    joined_at: s(m.joined_at ?? m.created_at),
    removed_at: s(m.removed_at),
  };
}

export function useUserAccessDetail(userId: string | null) {
  return useQuery({
    queryKey: AE_KEYS.detail(userId ?? "none"),
    enabled: !!userId,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<UserAccessDetail> => {
      const rpc = "admin_user_access_detail";
      const o = requireObject(rpc, await adminRpc(rpc, { p_user_id: userId }));
      requireKeys(rpc, o, [
        "identity",
        "effective_access",
        "account_trial",
        "billing_sources",
        "licences_held",
      ]);
      const id = requireObject(`${rpc}.identity`, o.identity);
      const ea = requireObject(`${rpc}.effective_access`, o.effective_access);
      const mem = (o.memberships ?? {}) as Record<string, unknown>;
      const trialRaw = o.account_trial == null ? null : requireObject(`${rpc}.account_trial`, o.account_trial);

      return {
        identity: {
          user_id: String(id.user_id ?? userId),
          email: s(id.email),
          full_name: s(id.full_name),
          created_at: s(id.created_at),
          email_confirmed_at: s(id.email_confirmed_at),
          last_sign_in_at: s(id.last_sign_in_at),
          is_system_admin: id.is_system_admin === true,
        },
        effective_access: {
          has_access: ea.has_access === true,
          reason_code: s(ea.reason_code),
          access_source: s(ea.access_source),
          plan_code: s(ea.plan_code),
          plan_name: s(ea.plan_name),
          subscription_id: s(ea.subscription_id),
          subscription_status: s(ea.subscription_status),
          billing_provider: s(ea.billing_provider),
          purchase_platform: s(ea.purchase_platform),
          licence_id: s(ea.licence_id),
          vineyard_id: s(ea.vineyard_id),
          portal_access: b(ea.portal_access),
          portal_access_level: s(ea.portal_access_level),
          can_use_ios_app: b(ea.can_use_ios_app),
          can_use_android_app: b(ea.can_use_android_app),
          unlimited_licences: b(ea.unlimited_licences),
          trial_end: s(ea.trial_end),
          expires_at: s(ea.expires_at),
          grace_period_end: s(ea.grace_period_end),
          current_period_end: s(ea.current_period_end),
          cancel_at_period_end: b(ea.cancel_at_period_end),
          manual_grant_reason: s(ea.manual_grant_reason),
          manual_grant_expires_at: s(ea.manual_grant_expires_at),
          last_verified_at: s(ea.last_verified_at),
        },
        account_trial: trialRaw
          ? {
              status: s(trialRaw.status),
              source_type: s(trialRaw.source_type),
              created_from: s(trialRaw.created_from),
              is_persisted: trialRaw.is_persisted === true,
              is_currently_valid: trialRaw.is_currently_valid === true,
              trial_started_at: s(trialRaw.trial_started_at),
              trial_ends_at: s(trialRaw.trial_ends_at),
            }
          : null,

        billing_sources: requireArray(`${rpc}.billing_sources`, o.billing_sources).map((r) => ({
          subscription_id: String(r.subscription_id ?? ""),
          plan_code: s(r.plan_code),
          plan_name: s(r.plan_name),
          status: s(r.status),
          provider: s(r.provider ?? r.billing_provider),
          purchase_platform: s(r.purchase_platform),
          is_owner: r.is_owner === true,
          is_effective: r.is_effective === true,
          seats_included: n(r.seats_included),
          seats_purchased: n(r.seats_purchased),
          active_licences: n(r.active_licences),
          unlimited_licences: r.unlimited_licences === true,
          manual_grant_reason: s(r.manual_grant_reason),
          manual_grant_expires_at: s(r.manual_grant_expires_at),
          manual_grant_revoked_at: s(r.manual_grant_revoked_at),
          current_period_end: s(r.current_period_end),
          cancel_at_period_end: b(r.cancel_at_period_end),
          created_at: s(r.created_at),
        })),
        licences_held: requireArray(`${rpc}.licences_held`, o.licences_held).map((r) => ({
          licence_id: String(r.licence_id ?? ""),
          subscription_id: s(r.subscription_id),
          plan_code: s(r.plan_code),
          status: s(r.status),
          vineyard_id: s(r.vineyard_id),
          vineyard_name: s(r.vineyard_name),
          owner_email: s(r.owner_email),
          assigned_at: s(r.assigned_at),
          revoked_at: s(r.revoked_at),
        })),
        memberships: {
          active: requireArray(`${rpc}.memberships.active`, mem.active ?? []).map(mapMembership),
          historical: requireArray(`${rpc}.memberships.historical`, mem.historical ?? []).map(
            mapMembership,
          ),
        },
        open_alerts: requireArray(`${rpc}.open_alerts`, o.open_alerts ?? []),
        generated_at: s(o.generated_at),
      };
    },
  });
}

export interface AccessHistoryEvent {
  occurred_at: string;
  source: string;
  event_type: string;
  platform: string | null;
  detail: Record<string, unknown> | null;
}

/** SQL 143/144 history event vocabulary, plus the pre-existing billing events. */
export const HISTORY_EVENT_LABEL: Record<string, string> = {
  account_created: "Account created",
  trial_started: "Account trial started",
  trial_migrated: "Trial migrated to shared entitlement system",
  trial_expired: "Account trial expired",
  trial_revoked: "Account trial revoked",
  trial_converted: "Access converted from trial to paid subscription",
  licence_assigned: "Licence assigned",
  licence_removed: "Licence removed",
  grant_created: "Billing grant created",
  grant_extended: "Billing grant extended",
  grant_revoked: "Billing grant revoked",
  entitlement_refreshed: "Entitlement recalculated",
};

export const historyEventLabel = (e: string | null | undefined) =>
  labelFor(HISTORY_EVENT_LABEL, e);

export function useUserAccessHistory(userId: string | null, limit = 50) {
  return useQuery({
    queryKey: [...AE_KEYS.history(userId ?? "none"), limit],
    enabled: !!userId,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<AccessHistoryEvent[]> => {
      const rpc = "admin_user_access_history";
      const rows = requireArray(rpc, await adminRpc(rpc, { p_user_id: userId, p_limit: limit }));
      return rows.map((r) => {
        requireKeys(rpc, r, ["occurred_at", "source", "event_type"]);
        return {
          occurred_at: String(r.occurred_at),
          source: String(r.source),
          event_type: String(r.event_type),
          platform: s(r.platform),
          detail: (r.detail as Record<string, unknown>) ?? null,
        };
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Global licence pools (SQL 145)                                      */
/* ------------------------------------------------------------------ */

/** Verified live against admin_available_licence_pools (July 2026). Seat maths,
 *  assignability and the blocking reason are all server-computed. */
export interface LicencePool {
  subscription_id: string;
  billing_owner_user_id: string;
  billing_owner_name: string | null;
  billing_owner_email: string | null;
  vineyard_id: string | null;
  vineyard_name: string | null;
  plan_code: string | null;
  subscription_status: string | null;
  billing_source: string | null;
  provider: string | null;
  licence_limit: number | null;
  assigned_licences: number;
  available_licences: number | null;
  is_unlimited: boolean;
  starts_at: string | null;
  current_period_end: string | null;
  expires_at: string | null;
  is_assignable: boolean;
  not_assignable_reason: string | null;
  total_count: number;
}

export interface LicencePoolParams {
  search?: string | null;
  vineyardId?: string | null;
  planCode?: string | null;
  billingOwnerUserId?: string | null;
  hasAvailableSeats?: boolean | null;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

export function useLicencePools(params: LicencePoolParams = {}) {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;
  const args = {
    p_search: params.search?.trim() || null,
    p_vineyard_id: params.vineyardId ?? null,
    p_plan_code: params.planCode ?? null,
    p_billing_owner_user_id: params.billingOwnerUserId ?? null,
    p_has_available_seats: params.hasAvailableSeats ?? null,
    p_limit: limit,
    p_offset: offset,
  };
  return useQuery({
    queryKey: [...AE_KEYS.pools, args],
    enabled: params.enabled !== false,
    staleTime: 15_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ pools: LicencePool[]; total: number }> => {
      const rpc = "admin_available_licence_pools";
      const rows = requireArray(rpc, await adminRpc(rpc, args));
      const pools = rows.map((r) => {
        requireKeys(rpc, r, [
          "subscription_id",
          "billing_owner_user_id",
          "plan_code",
          "licence_limit",
          "assigned_licences",
          "available_licences",
          "is_unlimited",
          "is_assignable",
          "not_assignable_reason",
          "total_count",
        ]);
        return {
          subscription_id: String(r.subscription_id),
          billing_owner_user_id: String(r.billing_owner_user_id),
          billing_owner_name: s(r.billing_owner_name),
          billing_owner_email: s(r.billing_owner_email),
          vineyard_id: s(r.vineyard_id),
          vineyard_name: s(r.vineyard_name),
          plan_code: s(r.plan_code),
          subscription_status: s(r.subscription_status),
          billing_source: s(r.billing_source),
          provider: s(r.provider),
          licence_limit: r.licence_limit == null ? null : n(r.licence_limit),
          assigned_licences: n(r.assigned_licences),
          available_licences: r.available_licences == null ? null : n(r.available_licences),
          is_unlimited: r.is_unlimited === true,
          starts_at: s(r.starts_at),
          current_period_end: s(r.current_period_end),
          expires_at: s(r.expires_at),
          is_assignable: r.is_assignable === true,
          not_assignable_reason: s(r.not_assignable_reason),
          total_count: n(r.total_count),
        } satisfies LicencePool;
      });
      return { pools, total: pools[0]?.total_count ?? 0 };
    },
  });
}

/** Server-provided seat summary — never recalculated in the browser. */
export function poolSeatSummary(p: LicencePool): string {
  if (p.is_unlimited) return `${p.assigned_licences} assigned · Unlimited available`;
  return `${p.assigned_licences} of ${p.licence_limit ?? 0} licences assigned · ${
    p.available_licences ?? 0
  } available`;
}


/* ------------------------------------------------------------------ */
/* Billing grants (SQL 141)                                            */
/* ------------------------------------------------------------------ */

export interface BillingGrantRow {
  subscription_id: string;
  owner_user_id: string;
  owner_email: string | null;
  owner_name: string | null;
  grant_type: string | null;
  plan_code: string | null;
  plan_name: string | null;
  status: string | null;
  is_active: boolean;
  reason: string | null;
  granted_by_email: string | null;
  granted_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
  manual_grant_revoked_at: string | null;
  revoked_reason: string | null;
  vineyard_id: string | null;
  vineyard_name: string | null;
  seats_total: number;
  active_licences: number;
  unlimited_licences: boolean;
  licences_display: string | null;
  platforms_display: string | null;
}

export type GrantState = "active" | "revoked" | "inactive";

/** Grant state is read from server fields only — no client-side date maths. */
export function grantState(g: BillingGrantRow): GrantState {
  if (g.manual_grant_revoked_at) return "revoked";
  return g.is_active ? "active" : "inactive";
}

export function useBillingGrants() {
  return useQuery({
    queryKey: AE_KEYS.grants,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<BillingGrantRow[]> => {
      const rpc = "admin_list_billing_grants";
      const rows = requireArray(rpc, await adminRpc(rpc));
      return rows.map((r) => {
        requireKeys(rpc, r, ["subscription_id", "owner_user_id", "grant_type", "is_active"]);
        return {
          subscription_id: String(r.subscription_id),
          owner_user_id: String(r.owner_user_id),
          owner_email: s(r.owner_email),
          owner_name: s(r.owner_name ?? r.owner_full_name),
          grant_type: s(r.grant_type),
          plan_code: s(r.plan_code),
          plan_name: s(r.plan_name),
          status: s(r.status),
          is_active: r.is_active === true,
          reason: s(r.reason ?? r.manual_grant_reason),
          granted_by_email: s(r.granted_by_email),
          granted_at: s(r.granted_at ?? r.created_at),
          starts_at: s(r.starts_at ?? r.manual_grant_starts_at),
          expires_at: s(r.expires_at ?? r.manual_grant_expires_at),
          manual_grant_revoked_at: s(r.manual_grant_revoked_at),
          revoked_reason: s(r.revoked_reason ?? r.manual_grant_revoked_reason),
          vineyard_id: s(r.vineyard_id),
          vineyard_name: s(r.vineyard_name),
          seats_total: n(r.seats_total),
          active_licences: n(r.active_licences),
          unlimited_licences: r.unlimited_licences === true,
          licences_display: s(r.licences_display),
          platforms_display: s(r.platforms_display),
        };
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function useAfterMutation() {
  const qc = useQueryClient();
  return (userId?: string | null) => {
    qc.invalidateQueries({ queryKey: AE_KEYS.usersAll });
    qc.invalidateQueries({ queryKey: AE_KEYS.grants });
    qc.invalidateQueries({ queryKey: AE_KEYS.monitor });
    qc.invalidateQueries({ queryKey: AE_KEYS.alertsAll });
    if (userId) {
      qc.invalidateQueries({ queryKey: AE_KEYS.detail(userId) });
      qc.invalidateQueries({ queryKey: AE_KEYS.history(userId) });
    }
  };
}

export function useCreateBillingGrant() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      userId: string;
      grantType: GrantType;
      reason: string;
      vineyardId?: string | null;
      startsAt?: string | null;
      expiresAt?: string | null;
    }) =>
      adminRpc<string>("admin_create_billing_grant", {
        p_owner_user_id: args.userId,
        p_grant_type: args.grantType,
        p_reason: args.reason,
        p_vineyard_id: args.vineyardId ?? null,
        p_starts_at: args.startsAt ?? null,
        p_expires_at: args.expiresAt ?? null,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export function useExtendBillingGrant() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      subscriptionId: string;
      reason: string;
      newExpiresAt: string;
      userId?: string | null;
    }) =>
      adminRpc<string>("admin_extend_billing_grant", {
        p_subscription_id: args.subscriptionId,
        p_reason: args.reason,
        p_new_expires_at: args.newExpiresAt,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export function useRevokeBillingGrant() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      subscriptionId: string;
      reason: string;
      revokeLicences?: boolean;
      userId?: string | null;
    }) =>
      adminRpc<string>("admin_revoke_billing_grant", {
        p_subscription_id: args.subscriptionId,
        p_reason: args.reason,
        p_revoke_licences: args.revokeLicences ?? true,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export function useAssignLicence() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      subscriptionId: string;
      userId: string;
      reason: string;
      vineyardId?: string | null;
    }) =>
      adminRpc<string>("admin_assign_licence", {
        p_subscription_id: args.subscriptionId,
        p_user_id: args.userId,
        p_reason: args.reason,
        p_vineyard_id: args.vineyardId ?? null,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export function useRemoveLicence() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: { licenceId: string; reason: string; userId?: string | null }) =>
      adminRpc<string>("admin_remove_licence", {
        p_licence_id: args.licenceId,
        p_reason: args.reason,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export interface EntitlementRefreshResult {
  user_id: string;
  changed: boolean;
  has_access: boolean;
  plan_code: string | null;
  reason_code: string | null;
  access_source: string | null;
  refreshed_at: string | null;
}

export function useRefreshUserEntitlement() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: async (args: { userId: string }): Promise<EntitlementRefreshResult> => {
      const rpc = "admin_refresh_user_entitlement";
      const o = requireObject(rpc, await adminRpc(rpc, { p_user_id: args.userId }));
      requireKeys(rpc, o, ["user_id", "changed", "has_access", "reason_code"]);
      return {
        user_id: String(o.user_id),
        changed: o.changed === true,
        has_access: o.has_access === true,
        plan_code: s(o.plan_code),
        reason_code: s(o.reason_code),
        access_source: s(o.access_source),
        refreshed_at: s(o.refreshed_at),
      };
    },
    onSuccess: (_d, v) => after(v.userId),
  });
}
