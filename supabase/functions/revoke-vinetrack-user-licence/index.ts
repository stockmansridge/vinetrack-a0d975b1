// Revoke a VineTrack Team user licence. Caller must be the owner of an
// active Stripe Team subscription that owns the licence. Service-role
// write so browser RLS does not block updates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const VINETRACK_SUPABASE_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VINETRACK_SERVICE_ROLE_KEY = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const VINETRACK_ANON_KEY = Deno.env.get("VINETRACK_ANON_KEY");
  if (!VINETRACK_SUPABASE_URL || !VINETRACK_SERVICE_ROLE_KEY || !VINETRACK_ANON_KEY)
    return json(503, { error: "VineTrack backend is not configured." });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const userClient = createClient(VINETRACK_SUPABASE_URL, VINETRACK_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) return json(401, { error: "Unauthorized" });
  const caller = u.user;

  let body: { licence_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const licenceId = (body.licence_id ?? "").trim();
  if (!licenceId) return json(400, { error: "licence_id is required" });

  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Load licence + parent subscription to verify ownership.
  const { data: lic, error: licErr } = await admin
    .from("vinetrack_user_licences")
    .select("id, user_id, subscription_id, status")
    .eq("id", licenceId)
    .maybeSingle();
  if (licErr) return json(500, { error: licErr.message });
  if (!lic?.id) return json(404, { error: "Licence not found" });

  const { data: sub, error: subErr } = await admin
    .from("vinetrack_subscriptions")
    .select("id, owner_user_id")
    .eq("id", lic.subscription_id)
    .maybeSingle();
  if (subErr) return json(500, { error: subErr.message });
  if (!sub?.id || sub.owner_user_id !== caller.id)
    return json(403, { error: "Not authorised to revoke this licence." });

  if (lic.user_id === caller.id)
    return json(400, { error: "Owners cannot revoke their own licence." });

  const { error: updErr } = await admin
    .from("vinetrack_user_licences")
    .update({ status: "revoked" })
    .eq("id", licenceId);
  if (updErr) return json(500, { error: updErr.message });

  return json(200, { ok: true, licence_id: licenceId });
});
