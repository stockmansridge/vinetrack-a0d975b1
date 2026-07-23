// System-admin diagnostic: send a Resend-backed test invitation email.
// Does NOT touch the vineyard invitation tables. Admin identity is verified
// against the VineTrack iOS Supabase project (same pattern as satellite fns).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Payload { recipient_email?: unknown }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifySystemAdmin(req: Request) {
  const url = Deno.env.get("VINETRACK_SUPABASE_URL");
  const anon = Deno.env.get("VINETRACK_ANON_KEY");
  if (!url || !anon) return { ok: false, status: 503, message: "VineTrack backend is not configured." } as const;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { ok: false, status: 401, message: "Unauthorized" } as const;
  const client = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user) return { ok: false, status: 401, message: "Unauthorized" } as const;
  const { data: isAdmin, error: rpcErr } = await (client as any).rpc("is_system_admin");
  if (rpcErr) return { ok: false, status: 403, message: "Admin verification failed" } as const;
  if (!isAdmin) return { ok: false, status: 403, message: "System admin access required" } as const;
  return { ok: true, userId: userData.user.id, email: userData.user.email ?? null } as const;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, message: "Method not allowed" });

  const gate = await verifySystemAdmin(req);
  if (!gate.ok) return json(gate.status, { success: false, email_sent: false, message: gate.message });

  let payload: Payload;
  try { payload = await req.json(); } catch { payload = {}; }

  const raw = typeof payload.recipient_email === "string" ? payload.recipient_email.trim() : "";
  if (!raw) return json(400, { success: false, email_sent: false, error_code: "invalid_recipient", message: "A recipient email is required." });
  if (raw.length > 254 || !EMAIL_RE.test(raw)) {
    return json(400, { success: false, email_sent: false, error_code: "invalid_recipient", message: "That does not look like a valid email address." });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("INVITE_FROM_EMAIL") ?? "VineTrack <onboarding@resend.dev>";
  const replyTo = Deno.env.get("INVITE_REPLY_TO") ?? undefined;
  if (!apiKey) {
    return json(500, { success: false, email_sent: false, error_code: "email_configuration_missing", message: "The email service is not fully configured." });
  }

  const submittedAt = new Date().toISOString();
  const subject = "[VineTrack Test] Invitation email system check";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1917;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 12px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e4;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px 32px;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#78716c;">VineTrack</div>
          <h1 style="font-size:22px;line-height:1.3;margin:8px 0 0 0;color:#1c1917;">VineTrack invitation email test</h1>
        </td></tr>
        <tr><td style="padding:16px 32px 8px 32px;font-size:14px;line-height:1.55;color:#292524;">
          <p>This email confirms that the VineTrack portal, Supabase Edge Functions and Resend email delivery are connected correctly.</p>
          <p style="color:#57534e;">This is a system test only. No vineyard invitation has been created and no access has been granted.</p>
        </td></tr>
        <tr><td style="padding:8px 32px 24px 32px;">
          <table cellpadding="0" cellspacing="0" style="width:100%;background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px;">
            <tr><td style="padding:14px 16px;font-size:13px;color:#44403c;">
              <div><strong style="color:#1c1917;">Recipient:</strong> ${raw}</div>
              <div><strong style="color:#1c1917;">Submitted (UTC):</strong> ${submittedAt}</div>
              <div><strong style="color:#1c1917;">Source:</strong> VineTrack System Admin Portal</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:8px 32px 32px 32px;">
          <a href="https://vinetrack.com.au" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">Visit VineTrack</a>
        </td></tr>
      </table>
      <div style="max-width:560px;font-size:11px;color:#a8a29e;padding:16px 8px;text-align:center;">Sent by the VineTrack System Admin Portal.</div>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    "VineTrack invitation email test",
    "",
    "This email confirms that the VineTrack portal, Supabase Edge Functions and Resend email delivery are connected correctly.",
    "This is a system test only. No vineyard invitation has been created and no access has been granted.",
    "",
    `Recipient: ${raw}`,
    `Submitted (UTC): ${submittedAt}`,
    "Source: VineTrack System Admin Portal",
    "",
    "Visit VineTrack: https://vinetrack.com.au",
  ].join("\n");

  const resendBody: Record<string, unknown> = {
    from: fromAddress,
    to: [raw],
    subject,
    html,
    text,
  };
  if (replyTo) resendBody.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendBody),
  });

  const bodyText = await res.text();
  let parsed: any = null;
  try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { /* keep null */ }

  if (!res.ok) {
    console.error("Resend rejected test email", { status: res.status, body: bodyText.slice(0, 500) });
    return json(res.status >= 400 && res.status < 600 ? res.status : 502, {
      success: false,
      email_sent: false,
      error_code: "email_send_failed",
      message: parsed?.message
        ? `The test email could not be sent: ${String(parsed.message).slice(0, 200)}`
        : "The test email could not be sent.",
    });
  }

  return json(200, {
    success: true,
    email_sent: true,
    recipient_email: raw,
    provider: "resend",
    provider_message_id: parsed?.id ?? null,
    submitted_at: submittedAt,
  });
});
