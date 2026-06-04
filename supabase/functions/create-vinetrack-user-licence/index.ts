// Create a VineTrack Team user licence (active or pending).
// Caller must be authenticated and the owner (or manager) of the active
// Team subscription. Writes go through the VineTrack service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const VINETRACK_SUPABASE_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VINETRACK_SERVICE_ROLE_KEY = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const VINETRACK_ANON_KEY = Deno.env.get("VINETRACK_ANON_KEY");
  if (!VINETRACK_SUPABASE_URL || !VINETRACK_SERVICE_ROLE_KEY || !VINETRACK_ANON_KEY)
    return jsonError(503, "VineTrack backend is not configured.");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError(401, "Unauthorized");

  const userClient = createClient(VINETRACK_SUPABASE_URL, VINETRACK_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, "Unauthorized");
  const caller = userData.user;

  let body: { email?: string; vineyard_id?: string; role?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const email = (body.email ?? "").trim().toLowerCase();
  const vineyardId = body.vineyard_id ?? null;
  if (!email) return jsonError(400, "email is required");

  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Find active Team subscription owned by caller.
  const { data: sub } = await admin
    .from("vinetrack_subscriptions")
    .select("id, owner_user_id, status, seats_included, seats_purchased, primary_vineyard_id")
    .eq("owner_user_id", caller.id)
    .eq("billing_provider", "stripe")
    .is("deleted_at", null)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub?.id) return jsonError(403, "No active Team subscription for this user.");

  // Seat availability.
  const total = (sub.seats_included ?? 0) + (sub.seats_purchased ?? 0);
  const { count: activeCount } = await admin
    .from("vinetrack_user_licences")
    .select("id", { count: "exact", head: true })
    .eq("subscription_id", sub.id)
    .in("status", ["active", "pending"]);
  if ((activeCount ?? 0) >= total) {
    return jsonError(
      409,
      "All seats are used. Purchase an extra seat before adding more users.",
    );
  }

  // Look up existing user by email (best-effort).
  let targetUserId: string | null = null;
  try {
    const { data } = await (admin as any).auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = (data?.users ?? []).find(
      (u: any) => (u.email ?? "").toLowerCase() === email,
    );
    targetUserId = found?.id ?? null;
  } catch (e) {
    console.warn("[create-vinetrack-user-licence] listUsers failed", (e as any)?.message);
  }

  // Refuse duplicates.
  const dupQuery = admin
    .from("vinetrack_user_licences")
    .select("id, status")
    .eq("subscription_id", sub.id)
    .in("status", ["active", "pending"]);
  const { data: dup } = targetUserId
    ? await dupQuery.eq("user_id", targetUserId).maybeSingle()
    : await dupQuery.eq("invited_email", email).maybeSingle();
  if (dup?.id) return jsonError(409, "This user already has a licence.");

  const row = {
    subscription_id: sub.id,
    user_id: targetUserId,
    invited_email: email,
    vineyard_id: vineyardId ?? (sub as any).primary_vineyard_id ?? null,
    status: targetUserId ? "active" : "pending",
    assigned_by: caller.id,
    metadata: { source: "portal", role: body.role ?? null },
  };
  const { data: inserted, error: insErr } = await admin
    .from("vinetrack_user_licences")
    .insert(row)
    .select("id, status, subscription_id, user_id, invited_email, vineyard_id, created_at, metadata")
    .maybeSingle();
  if (insErr) return jsonError(500, insErr.message);

  return new Response(
    JSON.stringify({ ok: true, licence: inserted, subscription_id: sub.id }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
