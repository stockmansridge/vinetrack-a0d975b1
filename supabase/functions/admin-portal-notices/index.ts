// System-admin only: manage portal announcement notices shown at the top of
// the web portal. Caller must be an ACTIVE system admin on the VineTrack
// (iOS-shared) project; the write happens on the Lovable Cloud project via
// the service role.
//
// POST { action: "list" | "upsert" | "set_active" | "delete", ... }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

const TONES = new Set(["info", "success", "warning"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_ANON = Deno.env.get("VINETRACK_ANON_KEY");
  const CLOUD_URL = Deno.env.get("SUPABASE_URL");
  const CLOUD_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!VT_URL || !VT_ANON || !CLOUD_URL || !CLOUD_SERVICE) {
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
  const caller = userData.user;

  const { data: isAdmin, error: adminErr } = await userClient.rpc("is_system_admin");
  if (adminErr) return jsonError(403, "Could not verify system admin access.");
  if (!isAdmin) return jsonError(403, "System admin access required.");

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body.action ?? "list");

  const admin = createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } });

  if (action === "list") {
    const { data, error } = await admin
      .from("portal_notices")
      .select("*")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) return jsonError(500, `Could not load notices: ${error.message}`);
    return json(200, { notices: data ?? [] });
  }

  if (action === "upsert") {
    const title = String(body.title ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!title) return jsonError(400, "A title is required.");
    if (!message) return jsonError(400, "A message is required.");
    if (message.length > 1000) return jsonError(400, "Message is too long (max 1000 characters).");
    const tone = TONES.has(String(body.tone)) ? String(body.tone) : "info";
    const priorityRaw = Number(body.priority);
    const priority = Number.isFinite(priorityRaw) ? Math.trunc(priorityRaw) : 0;
    const payload: Record<string, unknown> = {
      title,
      message,
      tone,
      priority,
      is_active: body.is_active !== false,
      starts_at: body.starts_at ? String(body.starts_at) : null,
      ends_at: body.ends_at ? String(body.ends_at) : null,
    };

    const id = body.id ? String(body.id) : null;
    if (id) {
      const { data, error } = await admin
        .from("portal_notices")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) return jsonError(500, `Could not save notice: ${error.message}`);
      return json(200, { success: true, notice: data });
    }

    const { data, error } = await admin
      .from("portal_notices")
      .insert({ ...payload, created_by: caller.id, created_by_email: caller.email ?? null })
      .select()
      .maybeSingle();
    if (error) return jsonError(500, `Could not save notice: ${error.message}`);
    return json(200, { success: true, notice: data });
  }

  if (action === "set_active") {
    const id = String(body.id ?? "");
    if (!id) return jsonError(400, "A notice id is required.");
    const { error } = await admin
      .from("portal_notices")
      .update({ is_active: body.is_active === true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return jsonError(500, `Could not update notice: ${error.message}`);
    return json(200, { success: true });
  }

  if (action === "delete") {
    const id = String(body.id ?? "");
    if (!id) return jsonError(400, "A notice id is required.");
    const { error } = await admin.from("portal_notices").delete().eq("id", id);
    if (error) return jsonError(500, `Could not delete notice: ${error.message}`);
    return json(200, { success: true });
  }

  return jsonError(400, "Unknown action.");
});
