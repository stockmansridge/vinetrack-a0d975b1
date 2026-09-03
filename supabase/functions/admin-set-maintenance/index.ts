// System-admin only: update the portal maintenance banner shown on the login
// screen. Caller must be an ACTIVE system admin on the VineTrack (iOS-shared)
// project; the write happens on the Lovable Cloud project via service role.
//
// POST { is_enabled: boolean, message: string }
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

  let body: { is_enabled?: boolean; message?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const isEnabled = body.is_enabled === true;
  const message = (body.message ?? "").trim();
  if (!message) return jsonError(400, "A maintenance message is required.");
  if (message.length > 600) return jsonError(400, "Message is too long (max 600 characters).");

  const admin = createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("portal_maintenance")
    .upsert({
      id: 1,
      is_enabled: isEnabled,
      message,
      updated_by: caller.id,
      updated_by_email: caller.email ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .select()
    .maybeSingle();

  if (error) return jsonError(500, `Could not save maintenance settings: ${error.message}`);
  return json(200, { success: true, maintenance: data });
});
