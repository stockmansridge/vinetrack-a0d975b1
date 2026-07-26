// System-admin diagnostics for the unified VineTrack email backend.
// Every test calls a dedicated Edge Function on the VineTrack Supabase
// project via the authenticated iOS client, and every send is recorded to
// public.email_delivery_events for the history table below.
import { supabase } from "@/integrations/ios-supabase/client";

export type DiagnosticTestName =
  | "test-resend-email"
  | "test-invitation-email"
  | "test-support-staff-email"
  | "test-support-receipt-email"
  | "test-notification-email";

export interface DiagnosticSendResult {
  success: boolean;
  provider?: string;
  provider_message_id?: string | null;
  recipient_email?: string;
  submitted_at?: string;
  error_code?: string;
  message?: string;
}

export interface NotificationTestExtras {
  title?: string;
  summary?: string;
  notification_type?: string;
  action_url?: string;
  action_label?: string;
}

async function parseErrorContext(error: unknown): Promise<DiagnosticSendResult | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!(ctx instanceof Response)) return null;
  try {
    const text = await ctx.clone().text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return {
        success: false,
        error_code: parsed?.error_code || parsed?.code,
        message: parsed?.message || parsed?.error || undefined,
        provider: parsed?.provider,
        provider_message_id: parsed?.provider_message_id ?? null,
        recipient_email: parsed?.recipient_email,
        submitted_at: parsed?.submitted_at,
      };
    } catch {
      return { success: false, message: text.slice(0, 400) };
    }
  } catch {
    return null;
  }
}

export async function runDiagnosticSend(
  fnName: DiagnosticTestName,
  recipientEmail: string,
  extras?: NotificationTestExtras,
): Promise<DiagnosticSendResult> {
  const email = recipientEmail.trim();
  if (!email) {
    return { success: false, error_code: "invalid_recipient", message: "Please enter a recipient email." };
  }
  try {
    const body: Record<string, unknown> = { recipient_email: email };
    if (fnName === "test-notification-email" && extras) {
      for (const [k, v] of Object.entries(extras)) {
        if (v != null && String(v).trim() !== "") body[k] = v;
      }
    }
    const { data, error } = await supabase.functions.invoke<DiagnosticSendResult>(fnName, { body });
    if (error) {
      const fromCtx = await parseErrorContext(error);
      if (fromCtx) return fromCtx;
      return {
        success: false,
        error_code: "edge_function_unavailable",
        message: (error as Error).message || "The diagnostic service is unavailable.",
      };
    }
    return data ?? { success: false, error_code: "empty_response", message: "No response from the diagnostic service." };
  } catch (err) {
    return {
      success: false,
      error_code: "unexpected_error",
      message: err instanceof Error ? err.message : "Unexpected error contacting the diagnostic service.",
    };
  }
}

// ---------------- Email delivery history ----------------

export interface EmailDeliveryEvent {
  id: string;
  created_at: string;
  email_type: string | null;
  recipient_email: string | null;
  source_platform: string | null;
  status: string | null;
  provider: string | null;
  provider_message_id: string | null;
  error_code: string | null;
  submitted_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  last_event_at: string | null;
  last_provider_event: string | null;
  failure_reason: string | null;
  reference_kind: string | null;
  reference_id: string | null;
  template_version: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DeliveryHistoryFilters {
  emailType?: string | null;
  status?: string | null;
  sourcePlatform?: string | null;
  /** ISO date (inclusive lower bound) applied to created_at. */
  from?: string | null;
  /** ISO date (inclusive upper bound) applied to created_at. */
  to?: string | null;
  limit?: number;
}

type RawRow = Record<string, unknown>;

function str(row: RawRow, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    for (const k of keys) {
      const v = (meta as RawRow)[k];
      if (typeof v === "string" && v.trim() !== "") return v;
      if (typeof v === "number") return String(v);
    }
  }
  return null;
}

function normalise(row: RawRow): EmailDeliveryEvent {
  const created = str(row, "created_at") ?? "";
  return {
    id: String(row.id ?? created),
    created_at: created,
    email_type: str(row, "email_type", "template_name"),
    recipient_email: str(row, "recipient_email", "recipient"),
    source_platform: str(row, "source_platform", "platform"),
    status: str(row, "status"),
    provider: str(row, "provider"),
    provider_message_id: str(row, "provider_message_id", "message_id"),
    error_code: str(row, "error_code"),
    submitted_at: str(row, "submitted_at", "created_at"),
    sent_at: str(row, "sent_at"),
    delivered_at: str(row, "delivered_at"),
    last_event_at: str(row, "last_event_at", "updated_at"),
    last_provider_event: str(row, "last_provider_event", "provider_event", "last_event_type"),
    failure_reason: str(row, "failure_reason", "error_message", "bounce_reason"),
    reference_kind: str(row, "reference_kind", "reference_type"),
    reference_id: str(row, "reference_id", "support_request_id", "invitation_id"),
    template_version: str(row, "template_version"),
    metadata: (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null),
  };
}

export async function fetchEmailDeliveryEvents(
  filters: DeliveryHistoryFilters = {},
): Promise<EmailDeliveryEvent[]> {
  let q = supabase
    .from("email_delivery_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);
  if (filters.emailType) q = q.eq("email_type", filters.emailType);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.sourcePlatform) q = q.eq("source_platform", filters.sourcePlatform);
  if (filters.from) q = q.gte("created_at", new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) q = q.lte("created_at", new Date(`${filters.to}T23:59:59.999`).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as RawRow[]).map(normalise);
}
