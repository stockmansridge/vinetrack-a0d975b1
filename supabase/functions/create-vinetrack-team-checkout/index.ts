// Creates a Stripe Checkout Session for the VineTrack Team plan.
// Writes nothing — the Stripe webhook is the only writer of billing rows.
// Requires the caller to be authenticated (JWT verified by Edge runtime).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_PRICE_TEAM = Deno.env.get("STRIPE_PRICE_TEAM");
  const VINETRACK_SUPABASE_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VINETRACK_SERVICE_ROLE_KEY = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const VINETRACK_ANON_KEY = Deno.env.get("VINETRACK_ANON_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";

  console.log("[create-vinetrack-team-checkout] reached", {
    method: req.method,
    hasAuthHeader: authHeader.startsWith("Bearer "),
    hasStripeSecret: !!STRIPE_SECRET_KEY,
    hasStripePrice: !!STRIPE_PRICE_TEAM,
    hasVinetrackUrl: !!VINETRACK_SUPABASE_URL,
    hasVinetrackAnon: !!VINETRACK_ANON_KEY,
    hasVinetrackServiceRole: !!VINETRACK_SERVICE_ROLE_KEY,
  });

  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_TEAM) {
    return jsonError(
      503,
      "Stripe is not configured yet. Missing STRIPE_SECRET_KEY or STRIPE_PRICE_TEAM."
    );
  }
  if (!VINETRACK_SUPABASE_URL || !VINETRACK_SERVICE_ROLE_KEY || !VINETRACK_ANON_KEY) {
    return jsonError(
      503,
      "VineTrack backend is not configured. Missing VINETRACK_SUPABASE_URL / VINETRACK_SERVICE_ROLE_KEY / VINETRACK_ANON_KEY."
    );
  }

  if (!authHeader.startsWith("Bearer ")) return jsonError(401, "Unauthorized");

  // Resolve caller identity against the VineTrack auth project.
  const userClient = createClient(VINETRACK_SUPABASE_URL, VINETRACK_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, "Unauthorized");
  const user = userData.user;

  let body: {
    successUrl?: string;
    cancelUrl?: string;
    quantity?: number;
    primary_vineyard_id?: string;
  } = {};
  try { body = await req.json(); } catch { /* optional body */ }

  const primaryVineyardId = body.primary_vineyard_id ?? null;
  if (!primaryVineyardId) {
    return jsonError(400, "primary_vineyard_id is required. Please select a vineyard before starting checkout.");
  }

  const origin = req.headers.get("origin") ?? "https://portal.vinetrack.com.au";
  const successUrl = body.successUrl ?? `${origin}/billing?checkout=success`;
  const cancelUrl = body.cancelUrl ?? `${origin}/billing?checkout=cancel`;

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

  // Reuse a Stripe customer if one already exists for this owner.
  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let customerId: string | undefined;
  try {
    // Block creating a new checkout when an active Team subscription already exists.
    const { data: activeSub } = await admin
      .from("vinetrack_subscriptions")
      .select("id, stripe_customer_id, stripe_subscription_id, status")
      .eq("owner_user_id", user.id)
      .eq("billing_provider", "stripe")
      .is("deleted_at", null)
      .in("status", ["active", "trialing", "past_due"])
      .neq("stripe_subscription_id", "sub_TEST_SEED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeSub?.id) {
      console.log("[create-vinetrack-team-checkout] active subscription exists, blocking new checkout", {
        userId: user.id,
        stripeSubscriptionId: activeSub.stripe_subscription_id,
        status: activeSub.status,
      });
      return new Response(
        JSON.stringify({
          error: "You already have an active Team subscription. Use Manage billing to make changes.",
          code: "already_subscribed",
          stripe_subscription_id: activeSub.stripe_subscription_id,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: existing } = await admin
      .from("vinetrack_subscriptions")
      .select("stripe_customer_id,stripe_subscription_id")
      .eq("owner_user_id", user.id)
      .eq("billing_provider", "stripe")
      .is("deleted_at", null)
      .not("stripe_customer_id", "is", null)
      .neq("stripe_customer_id", "cus_TEST_SEED")
      .neq("stripe_subscription_id", "sub_TEST_SEED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.stripe_customer_id) customerId = existing.stripe_customer_id as string;
  } catch (e) {
    console.warn("[create-vinetrack-team-checkout] customer lookup failed", (e as any)?.message);
  }

  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if ((customer as any)?.deleted) {
        customerId = undefined;
      }
    } catch {
      customerId = undefined;
    }
  }

  const sharedMeta = {
    owner_user_id: user.id,
    plan_code: "team",
    primary_vineyard_id: primaryVineyardId,
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      customer_email: customerId ? undefined : user.email ?? undefined,
      client_reference_id: user.id,
      line_items: [
        { price: STRIPE_PRICE_TEAM, quantity: Math.max(1, body.quantity ?? 1) },
      ],
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: sharedMeta,
      subscription_data: { metadata: sharedMeta },
    });
    return new Response(JSON.stringify({ url: session.url, id: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return jsonError(500, e?.message ?? "Stripe error");
  }
});

