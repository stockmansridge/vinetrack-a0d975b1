// Submit Support Request edge function.
// - Validates input
// - Uploads attachments (base64) to the private support-request-attachments bucket
// - Inserts a row into public.support_requests using the service role
// - Generates signed URLs for attachments (7 days)
// - Sends a notification email if a sender domain is configured (otherwise logs)
//
// CORS: open. Auth: not required (route is intentionally public; the function
// captures whatever identity metadata the client supplies, which is best-effort).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_TYPES = new Set(["support", "bug", "feature", "other"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const RECIPIENT = "jonathan@stockmansridge.com.au";
const BUCKET = "support-request-attachments";

interface Attachment {
  name?: string;
  mime: string;
  base64: string;
}

interface Body {
  request_type: string;
  subject: string;
  message: string;
  page_path?: string | null;
  browser_info?: string | null;
  vineyard_id?: string | null;
  vineyard_name?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
  user_role?: string | null;
  attachments?: Attachment[];
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: Body = await req.json();

    // Validation
    if (!body.request_type || !ALLOWED_TYPES.has(body.request_type)) {
      return json({ error: "Invalid request_type" }, 400);
    }
    if (!body.subject?.trim() || body.subject.length > 200) {
      return json({ error: "Subject required (max 200 chars)" }, 400);
    }
    if (!body.message?.trim() || body.message.length > 5000) {
      return json({ error: "Message required (max 5000 chars)" }, 400);
    }
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > MAX_ATTACHMENTS) {
      return json({ error: `Max ${MAX_ATTACHMENTS} attachments` }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, serviceKey);

    const requestId = crypto.randomUUID();
    const folder = body.vineyard_id || "global";
    const uploadedPaths: string[] = [];
    const signedUrls: { path: string; url: string }[] = [];

    // Upload attachments
    for (const att of attachments) {
      if (!ALLOWED_MIME.has(att.mime)) {
        return json({ error: `Unsupported file type: ${att.mime}` }, 400);
      }
      const bytes = decodeBase64(att.base64);
      if (bytes.byteLength > MAX_BYTES) {
        return json({ error: `Attachment exceeds 10 MB` }, 400);
      }
      const path = `${folder}/${requestId}/${crypto.randomUUID()}.${extFromMime(att.mime)}`;
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: att.mime, upsert: false });
      if (upErr) {
        console.error("upload error", upErr);
        return json({ error: `Upload failed: ${upErr.message}` }, 500);
      }
      uploadedPaths.push(path);
      const { data: signed } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
      if (signed?.signedUrl) signedUrls.push({ path, url: signed.signedUrl });
    }

    // Insert row
    const { error: insErr } = await sb.from("support_requests").insert({
      id: requestId,
      vineyard_id: body.vineyard_id ?? null,
      vineyard_name: body.vineyard_name ?? null,
      user_id: body.user_id ?? null,
      user_email: body.user_email ?? null,
      user_name: body.user_name ?? null,
      user_role: body.user_role ?? null,
      request_type: body.request_type,
      subject: body.subject.trim(),
      message: body.message.trim(),
      page_path: body.page_path ?? null,
      browser_info: body.browser_info ?? null,
      attachment_paths: uploadedPaths,
    });
    if (insErr) {
      console.error("insert error", insErr);
      return json({ error: `Save failed: ${insErr.message}` }, 500);
    }

    // Email (best-effort)
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const result = await sendNotificationEmail({
        recipient: RECIPIENT,
        body,
        requestId,
        signedUrls,
      });
      emailSent = result.sent;
      emailError = result.error;
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      console.error("email send error", e);
    }

    return json({
      ok: true,
      id: requestId,
      attachment_paths: uploadedPaths,
      email_sent: emailSent,
      email_error: emailError,
    }, 200);
  } catch (e) {
    console.error("submit-support-request fatal", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }

  function json(payload: unknown, status: number) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Email sending
//
// Uses the Lovable Email API (https://api.lovable.app/v1/email/send) when a
// sender domain has been configured for this project AND `LOVABLE_API_KEY` is
// available. Otherwise logs a structured payload so the request is auditable.
//
// Set `SUPPORT_EMAIL_FROM` to override the From address (default: jumps to a
// no-reply on the verified sender subdomain).
// ─────────────────────────────────────────────────────────────────────────────

async function sendNotificationEmail(opts: {
  recipient: string;
  body: Body;
  requestId: string;
  signedUrls: { path: string; url: string }[];
}): Promise<{ sent: boolean; error: string | null }> {
  const { recipient, body, requestId, signedUrls } = opts;
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const fromOverride = Deno.env.get("SUPPORT_EMAIL_FROM");

  const subjectLine = `[VineTrack ${body.request_type}] ${body.subject}`;
  const html = renderHtml({ body, requestId, signedUrls });
  const text = renderText({ body, requestId, signedUrls });

  if (!apiKey || !fromOverride) {
    console.log("[support-request] Email NOT sent — sender domain or LOVABLE_API_KEY not configured.", {
      to: recipient,
      requestId,
      subject: subjectLine,
    });
    return {
      sent: false,
      error: "Email provider not yet configured (sender domain pending).",
    };
  }

  // Lovable Email API — minimal direct call.
  const res = await fetch("https://api.lovable.app/v1/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromOverride,
      to: [recipient],
      subject: subjectLine,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    return { sent: false, error: `Email API ${res.status}: ${errText}` };
  }
  return { sent: true, error: null };
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function renderHtml(opts: {
  body: Body;
  requestId: string;
  signedUrls: { path: string; url: string }[];
}): string {
  const { body, requestId, signedUrls } = opts;
  const rows: [string, string][] = [
    ["Type", body.request_type],
    ["Subject", body.subject],
    ["From", `${body.user_name ?? "—"} <${body.user_email ?? "unknown"}>`],
    ["Role", body.user_role ?? "—"],
    ["Vineyard", `${body.vineyard_name ?? "—"} (${body.vineyard_id ?? "no id"})`],
    ["Page", body.page_path ?? "—"],
    ["Browser", body.browser_info ?? "—"],
    ["Request ID", requestId],
  ];
  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;font-size:13px">${esc(v)}</td></tr>`,
    )
    .join("");
  const attachHtml = signedUrls.length
    ? `<h3 style="margin:20px 0 8px;font-size:14px">Attachments</h3><ul style="margin:0;padding-left:18px;font-size:13px">${signedUrls
        .map(
          (s) =>
            `<li><a href="${esc(s.url)}" style="color:#1a73e8">${esc(s.path.split("/").pop() ?? s.path)}</a> <span style="color:#999">(link valid 7 days)</span></li>`,
        )
        .join("")}</ul>`
    : "";
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;background:#fff;padding:24px;max-width:640px">
<h2 style="margin:0 0 16px;font-size:18px">New VineTrack support request</h2>
<table style="border-collapse:collapse;width:100%">${tableRows}</table>
<h3 style="margin:20px 0 8px;font-size:14px">Message</h3>
<div style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #eee;border-radius:6px;padding:12px;font-size:13px;line-height:1.5">${esc(body.message)}</div>
${attachHtml}
</body></html>`;
}

function renderText(opts: {
  body: Body;
  requestId: string;
  signedUrls: { path: string; url: string }[];
}): string {
  const { body, requestId, signedUrls } = opts;
  const lines = [
    `New VineTrack support request`,
    ``,
    `Type: ${body.request_type}`,
    `Subject: ${body.subject}`,
    `From: ${body.user_name ?? "—"} <${body.user_email ?? "unknown"}>`,
    `Role: ${body.user_role ?? "—"}`,
    `Vineyard: ${body.vineyard_name ?? "—"} (${body.vineyard_id ?? "no id"})`,
    `Page: ${body.page_path ?? "—"}`,
    `Browser: ${body.browser_info ?? "—"}`,
    `Request ID: ${requestId}`,
    ``,
    `Message:`,
    body.message,
  ];
  if (signedUrls.length) {
    lines.push("", "Attachments (links valid 7 days):");
    for (const s of signedUrls) lines.push(`- ${s.url}`);
  }
  return lines.join("\n");
}
