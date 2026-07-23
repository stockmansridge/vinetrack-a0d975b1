// System-admin email diagnostic helper. Invokes the Lovable Cloud edge
// function with the VineTrack (iOS Supabase) access token so the function's
// admin gate can verify identity.
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export interface TestEmailResult {
  success: boolean;
  email_sent: boolean;
  recipient_email?: string;
  provider?: string;
  provider_message_id?: string | null;
  submitted_at?: string;
  error_code?: string;
  message?: string;
}

async function readErrorContext(error: unknown): Promise<TestEmailResult | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!ctx) return null;
  try {
    if (ctx instanceof Response) {
      const text = await ctx.clone().text();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text) as TestEmailResult;
        if (parsed && typeof parsed === "object") {
          return { email_sent: false, success: false, ...parsed };
        }
      } catch {
        return { success: false, email_sent: false, message: text.slice(0, 500) };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function sendTestInvitationEmail(recipientEmail: string): Promise<TestEmailResult> {
  try {
    const { data: sess } = await iosSupabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      return { success: false, email_sent: false, error_code: "not_authenticated", message: "Your session has expired. Please sign in again." };
    }

    const { data, error } = await cloudSupabase.functions.invoke<TestEmailResult>(
      "send-test-invitation-email",
      {
        body: { recipient_email: recipientEmail.trim() },
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (error) {
      const fromCtx = await readErrorContext(error);
      if (fromCtx) return fromCtx;
      return {
        success: false,
        email_sent: false,
        error_code: "edge_function_unavailable",
        message: (error as Error).message || "The email diagnostic service is unavailable.",
      };
    }

    return data ?? { success: false, email_sent: false, error_code: "empty_response", message: "No response from the email diagnostic service." };
  } catch (err) {
    return {
      success: false,
      email_sent: false,
      error_code: "unexpected_error",
      message: err instanceof Error ? err.message : "Unexpected error contacting the email diagnostic service.",
    };
  }
}
