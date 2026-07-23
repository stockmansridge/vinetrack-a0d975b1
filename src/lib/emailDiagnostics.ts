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

export async function sendTestInvitationEmail(recipientEmail: string): Promise<TestEmailResult> {
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
    // supabase-js swallows non-2xx bodies; try to read the real response.
    const ctx = (error as any).context;
    if (ctx instanceof Response) {
      try {
        const parsed = (await ctx.clone().json()) as TestEmailResult;
        if (parsed && typeof parsed === "object") return { email_sent: false, success: false, ...parsed };
      } catch { /* fall through */ }
    }
    return { success: false, email_sent: false, error_code: "edge_function_unavailable", message: error.message || "The email diagnostic service is unavailable." };
  }

  return data ?? { success: false, email_sent: false, error_code: "empty_response", message: "No response from the email diagnostic service." };
}
