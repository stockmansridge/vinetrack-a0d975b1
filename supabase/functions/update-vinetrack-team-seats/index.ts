// Update the quantity of the extra-user Stripe subscription item for the
// caller's active VineTrack Team subscription. Stripe webhook is the
// authoritative writer of vinetrack_subscriptions.seats_purchased — this
// function only changes Stripe; it does NOT trust client-side counts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

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

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_PRICE_TEAM_EXTRA_USER = Deno.env.get("STRIPE_PRICE_TEAM_EXTRA_USER");
  const VINETRACK_SUPABASE_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VINETRACK_SERVICE_ROLE_KEY = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const VINETRACK_ANON_KEY = Deno.env.get("VINETRACK_ANON_KEY");

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_TEAM_EXTRA_USER)
    return jsonError(503, "Stripe not configured (missing STRIPE_SECRET_KEY or STRIPE_PRICE_TEAM_EXTRA_USER).");
  if (!VINETRACK_SUPABASE_URL || !VINETRACK_SERVICE_ROLE_KEY || !VINETRACK_ANON_KEY)
    return jsonError(503, "VineTrack backend not configured.");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError(401, "Unauthorized");

  const userClient = createClient(VINETRACK_SUPABASE_URL, VINETRACK_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, "Unauthorized");
  const caller = userData.user;

  let body: { extra_seats?: number } = {};
  try { body = await req.json(); } catch { /* */ }
  const extraSeats = Math.max(0, Math.floor(body.extra_seats ?? 0));

  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: sub } = await admin
    .from("vinetrack_subscriptions")
    .select("stripe_subscription_id")
    .eq("owner_user_id", caller.id)
    .eq("billing_provider", "stripe")
    .is("deleted_at", null)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub?.stripe_subscription_id)
    return jsonError(403, "No active Team subscription for this user.");

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
  try {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const existingItem = stripeSub.items.data.find(
      (it) => it.price?.id === STRIPE_PRICE_TEAM_EXTRA_USER,
    );

    if (existingItem) {
      if (extraSeats === 0) {
        await stripe.subscriptionItems.del(existingItem.id, { proration_behavior: "create_prorations" });
      } else {
        await stripe.subscriptionItems.update(existingItem.id, {
          quantity: extraSeats,
          proration_behavior: "create_prorations",
        });
      }
    } else if (extraSeats > 0) {
      await stripe.subscriptionItems.create({
        subscription: sub.stripe_subscription_id,
        price: STRIPE_PRICE_TEAM_EXTRA_USER,
        quantity: extraSeats,
        proration_behavior: "create_prorations",
      });
    }
    return new Response(JSON.stringify({ ok: true, extra_seats: extraSeats }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return jsonError(500, e?.message ?? "Stripe error");
  }
});
