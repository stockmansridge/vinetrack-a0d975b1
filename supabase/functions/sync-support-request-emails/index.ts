import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPPORT_EMAIL = "support@vinetrack.com.au";
const BUCKET = "support-attachments";
const DEFAULT_BATCH_SIZE = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SupportRequestRow {
  id: string;
  created_at: string | null;
  user_id?: string | null;
  submitter_name?: string | null;
  submitter_email?: string | null;
  vineyard_id?: string | null;
  vineyard_name?: string | null;
  category?: string | null;
  subject?: string | null;
  message?: string | null;
  attachment_paths?: string[] | null;
  attachment_count?: number | null;
  app_platform?: string | null;
  app_version?: string | null;
  app_build?: string | null;
  device_model?: string | null;
  os_version?: string | null;
  email_status?: string | null;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function appContext(row: SupportRequestRow): string {
  return [
    row.app_platform,
    row.app_version ? `v${row.app_version}` : null,
    row.app_build ? `build ${row.app_build}` : null,
    row.device_model,
    row.os_version ? `OS ${row.os_version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function signAttachments(
  iosAdmin: ReturnType<typeof createClient>,
  paths: string[] | null | undefined,
) {
  const signedUrls: { name: string; url: string }[] = [];
  for (const path of paths ?? []) {
    const { data, error } = await iosAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      console.error("Failed to sign support attachment", { path, error });
      continue;
    }
    signedUrls.push({ name: path.split("/").pop() || path, url: data.signedUrl });
  }
  return signedUrls;
}

async function markEmailStatus(
  iosAdmin: ReturnType<typeof createClient>,
  id: string,
  patch: Record<string, unknown>,
) {
  const { error } = await iosAdmin.from("support_requests").update(patch).eq("id", id);
  if (error) console.error("Failed to update support request email status", { id, error });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const localUrl = Deno.env.get("SUPABASE_URL");
  const localServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const iosUrl = Deno.env.get("VINETRACK_SUPABASE_URL");
  const iosServiceKey = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  if (!localUrl || !localServiceKey || !iosUrl || !iosServiceKey) {
    return jsonResponse({ error: "Support email sync is not configured" }, 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7).trim();
  const claims = parseJwtClaims(token);
  if (claims?.role !== "service_role" && token !== localServiceKey) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  let body: { batch_size?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Cron sends an empty JSON object; manual calls may omit JSON.
  }
  const batchSize = Math.min(Math.max(Math.floor(body.batch_size ?? DEFAULT_BATCH_SIZE), 1), 50);

  const iosAdmin = createClient(iosUrl, iosServiceKey, { auth: { persistSession: false } });

  const { data: rows, error: fetchError } = await iosAdmin
    .from("support_requests")
    .select(
      "id, created_at, user_id, submitter_name, submitter_email, vineyard_id, vineyard_name, category, subject, message, attachment_paths, attachment_count, app_platform, app_version, app_build, device_model, os_version, email_status",
    )
    .or("email_status.eq.pending,email_status.is.null")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (fetchError) {
    console.error("Failed to fetch pending support requests", fetchError);
    return jsonResponse({ error: fetchError.message }, 500);
  }

  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of (rows ?? []) as SupportRequestRow[]) {
    const claim = await iosAdmin
      .from("support_requests")
      .update({ email_status: "queued", email_error: null })
      .eq("id", row.id)
      .or("email_status.eq.pending,email_status.is.null")
      .select("id")
      .maybeSingle();

    if (claim.error) {
      console.error("Failed to claim support request for email", { id: row.id, error: claim.error });
      results.push({ id: row.id, status: "claim_failed", error: claim.error.message });
      continue;
    }
    if (!claim.data) {
      results.push({ id: row.id, status: "skipped" });
      continue;
    }

    try {
      const attachments = await signAttachments(iosAdmin, row.attachment_paths);
      const adminUrl = `https://portal.vinetrack.com.au/admin/support-requests/${row.id}`;
      const res = await fetch(`${localUrl}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localServiceKey}`,
        },
        body: JSON.stringify({
          templateName: "support_request",
          recipientEmail: SUPPORT_EMAIL,
          purpose: "transactional",
          idempotencyKey: `support_request:${row.id}`,
          templateData: {
            request_type: row.category ?? "support",
            subject: row.subject ?? "(no subject)",
            message: row.message ?? "",
            request_id: row.id,
            user_name: row.submitter_name ?? null,
            user_email: row.submitter_email ?? null,
            user_role: null,
            vineyard_name: row.vineyard_name ?? null,
            vineyard_id: row.vineyard_id ?? null,
            page_path: null,
            browser_info: appContext(row) || null,
            attachments,
            admin_url: adminUrl,
          },
        }),
      });

      const text = await res.text();
      let responseBody: Record<string, unknown> | null = null;
      try {
        responseBody = text ? JSON.parse(text) : null;
      } catch {
        responseBody = null;
      }

      if (!res.ok || responseBody?.success === false) {
        const message = responseBody?.reason || responseBody?.error || text || `HTTP ${res.status}`;
        await markEmailStatus(iosAdmin, row.id, {
          email_status: responseBody?.reason === "email_suppressed" ? "suppressed" : "failed",
          email_error: String(message).slice(0, 1000),
        });
        results.push({ id: row.id, status: "failed", error: String(message) });
        continue;
      }

      results.push({ id: row.id, status: "queued" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await markEmailStatus(iosAdmin, row.id, {
        email_status: "failed",
        email_error: message.slice(0, 1000),
      });
      results.push({ id: row.id, status: "failed", error: message });
    }
  }

  return jsonResponse({ ok: true, processed: results.length, results });
});
