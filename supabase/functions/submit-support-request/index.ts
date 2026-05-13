// Submit Support Request edge function.
// - Validates input
// - Uploads attachments (base64) to the private support-request-attachments bucket
// - Inserts a row into public.support_requests using the service role
// - Generates 7-day signed URLs for attachments
// - Enqueues a notification email via the send-transactional-email function
//   (template: "support_request"). The template defines the team recipient.
//
// CORS: open. Auth: not required — captures whatever identity metadata the
// client supplies as best-effort context.

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
const BUCKET = "support-request-attachments";
const EMAIL_TEMPLATE = "support_request";

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
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body: Body = await req.json();

    // Validation
    if (!body.request_type || !ALLOWED_TYPES.has(body.request_type)) {
      return jsonResponse({ error: "Invalid request_type" }, 400);
    }
    if (!body.subject?.trim() || body.subject.length > 200) {
      return jsonResponse({ error: "Subject required (max 200 chars)" }, 400);
    }
    if (!body.message?.trim() || body.message.length > 5000) {
      return jsonResponse({ error: "Message required (max 5000 chars)" }, 400);
    }
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > MAX_ATTACHMENTS) {
      return jsonResponse({ error: `Max ${MAX_ATTACHMENTS} attachments` }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, serviceKey);

    const requestId = crypto.randomUUID();
    const folder = body.vineyard_id || "global";
    const uploadedPaths: string[] = [];
    const signedUrls: { name: string; url: string }[] = [];

    // Upload attachments
    for (const att of attachments) {
      if (!ALLOWED_MIME.has(att.mime)) {
        return jsonResponse({ error: `Unsupported file type: ${att.mime}` }, 400);
      }
      const bytes = decodeBase64(att.base64);
      if (bytes.byteLength > MAX_BYTES) {
        return jsonResponse({ error: `Attachment exceeds 10 MB` }, 400);
      }
      const filename = `${crypto.randomUUID()}.${extFromMime(att.mime)}`;
      const path = `${folder}/${requestId}/${filename}`;
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: att.mime, upsert: false });
      if (upErr) {
        console.error("upload error", upErr);
        return jsonResponse({ error: `Upload failed: ${upErr.message}` }, 500);
      }
      uploadedPaths.push(path);
      const { data: signed } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
      if (signed?.signedUrl) {
        signedUrls.push({ name: att.name ?? filename, url: signed.signedUrl });
      }
    }

    // Insert support request row
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
      return jsonResponse({ error: `Save failed: ${insErr.message}` }, 500);
    }

    // Enqueue notification email via the transactional pipeline.
    // The "support_request" template defines its own recipient (team inbox).
    let emailQueued = false;
    let emailError: string | null = null;
    try {
      const sendUrl = `${url}/functions/v1/send-transactional-email`;
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          templateName: EMAIL_TEMPLATE,
          // Fallback recipient — overridden by the template's fixed `to`.
          recipientEmail: "jonathan@stockmansridge.com.au",
          purpose: "transactional",
          idempotencyKey: `support_request:${requestId}`,
          templateData: {
            request_type: body.request_type,
            subject: body.subject.trim(),
            message: body.message.trim(),
            request_id: requestId,
            user_name: body.user_name ?? null,
            user_email: body.user_email ?? null,
            user_role: body.user_role ?? null,
            vineyard_name: body.vineyard_name ?? null,
            vineyard_id: body.vineyard_id ?? null,
            page_path: body.page_path ?? null,
            browser_info: body.browser_info ?? null,
            attachments: signedUrls,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        emailError = `send-transactional-email ${res.status}: ${text}`;
        console.error(emailError);
      } else {
        emailQueued = true;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      console.error("email enqueue error", e);
    }

    return jsonResponse(
      {
        ok: true,
        id: requestId,
        attachment_paths: uploadedPaths,
        email_queued: emailQueued,
        email_error: emailError,
      },
      200,
    );
  } catch (e) {
    console.error("submit-support-request fatal", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
