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
  metadata: Record<string, unknown> | null;
}

export interface DeliveryHistoryFilters {
  emailType?: string | null;
  status?: string | null;
  limit?: number;
}

export async function fetchEmailDeliveryEvents(
  filters: DeliveryHistoryFilters = {},
): Promise<EmailDeliveryEvent[]> {
  let q = supabase
    .from("email_delivery_events")
    .select(
      "id, created_at, email_type, recipient_email, source_platform, status, provider, provider_message_id, error_code, metadata",
    )
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);
  if (filters.emailType) q = q.eq("email_type", filters.emailType);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EmailDeliveryEvent[];
}
