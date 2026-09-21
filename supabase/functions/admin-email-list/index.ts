// System-admin only: read and manage public.email_list_subscribers.
// Caller must be an ACTIVE system admin on the canonical VineTrack project;
// the read/write happens on that same canonical VineTrack database via its
// service role, alongside support_requests (see sql/242). The table grants
// nothing to anon/authenticated, so this function is the only way the Portal
// can reach it.
//
// While sql/242 is not yet applied, reads/writes fall back to the legacy copy
// of the table on the Portal's own project so the admin page keeps working
// through the cutover. The legacy table is retired once canonical is live.
//
// POST { action: "list" } -> { subscribers: [...] }
// POST { action: "set_status", id, status: "subscribed" | "unsubscribed" }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isMissingTableError, SUBSCRIBER_COLUMNS } from "../_shared/email-list.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vinetrack-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const jsonError = (status: number, message: string) => json(status, { error: message });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_ANON = Deno.env.get("VINETRACK_ANON_KEY");
  const VT_SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const CLOUD_URL = Deno.env.get("SUPABASE_URL");
  const CLOUD_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!VT_URL || !VT_ANON || !VT_SERVICE || !CLOUD_URL || !CLOUD_SERVICE) {
    return jsonError(503, "Backend is not configured.");
  }

  const vinetrackToken = (req.headers.get("x-vinetrack-token") ?? "").trim();
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = vinetrackToken ||
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "");
  if (!bearer) return jsonError(401, "Unauthorized");

  const userClient = createClient(VT_URL, VT_ANON, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(bearer);
  if (userErr || !userData?.user) return jsonError(401, "Unauthorized");

  const { data: isAdmin, error: adminErr } = await userClient.rpc("is_system_admin");
  if (adminErr) return jsonError(403, "Could not verify system admin access.");
  if (!isAdmin) return jsonError(403, "System admin access required.");

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body.action ?? "list");

  // Canonical VineTrack database owns the subscriber data.
  const admin = createClient(VT_URL, VT_SERVICE, { auth: { persistSession: false } });
  // Legacy copy on the Portal's own project — cutover fallback only.
  const legacy = createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } });

  const listFrom = (client: ReturnType<typeof createClient>) =>
    client
      .from("email_list_subscribers")
      .select(SUBSCRIBER_COLUMNS)
      .order("subscribed_at", { ascending: false })
      .limit(5000);

  if (action === "list") {
    let { data, error } = await listFrom(admin);
    if (error && isMissingTableError(error)) {
      console.error("email_list_subscribers missing on VineTrack — apply sql/242; reading legacy");
      ({ data, error } = await listFrom(legacy));
    }
    if (error) return jsonError(500, `Could not load the email list: ${error.message}`);
    return json(200, { subscribers: data ?? [] });
  }

  if (action === "set_status") {
    const id = String(body.id ?? "");
    const status = String(body.status ?? "");
    if (!id) return jsonError(400, "A subscriber id is required.");
    if (status !== "subscribed" && status !== "unsubscribed") {
      return jsonError(400, "Status must be subscribed or unsubscribed.");
    }
    const now = new Date().toISOString();
    const patch = status === "unsubscribed"
      ? { status, unsubscribed_at: now, updated_at: now }
      : { status, unsubscribed_at: null, subscribed_at: now, updated_at: now };
    const { data, error } = await admin
      .from("email_list_subscribers")
      .update(patch)
      .eq("id", id)
      .select(
        "id, email, first_name, last_name, status, source, source_page, consent_version, subscribed_at, unsubscribed_at, created_at, updated_at",
      )
      .maybeSingle();
    if (error) return jsonError(500, `Could not update the subscriber: ${error.message}`);
    if (!data) return jsonError(404, "Subscriber not found.");
    return json(200, { success: true, subscriber: data });
  }

  return jsonError(400, "Unknown action");
});
