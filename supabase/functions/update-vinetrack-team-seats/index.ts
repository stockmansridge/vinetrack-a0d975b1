// Update the quantity of the extra-user Stripe subscription item for the
// caller's active VineTrack Team subscription.
//
// Behaviour:
//  - Increases use proration_behavior=always_invoice + payment_behavior=
//    pending_if_incomplete so Stripe charges immediately. If the charge
//    needs action, the item-quantity change is held as pending_update and
//    the webhook will NOT see a new quantity until the invoice is paid.
//  - Decreases are blocked (mid-cycle credit/refund avoidance) and the
//    user is told to contact support.
//
// The Stripe webhook remains the only writer of
// vinetrack_subscriptions.seats_purchased.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: message, ...(extra ?? {}) }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200,
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
    return jsonError(503, "Stripe not configured.");
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

  let body: { extra_seats?: number; confirm?: boolean } = {};
  try { body = await req.json(); } catch { /* */ }
  const target = Math.max(0, Math.floor(body.extra_seats ?? 0));

  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: sub } = await admin
    .from("vinetrack_subscriptions")
    .select("stripe_subscription_id, seats_purchased")
    .eq("owner_user_id", caller.id)
    .eq("billing_provider", "stripe")
    .is("deleted_at", null)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub?.stripe_subscription_id)
    return jsonError(403, "No active Team subscription for this user.");

  const currentPurchased = (sub.seats_purchased as number | null) ?? 0;
  if (target === currentPurchased) {
    return jsonOk({
      no_change: true,
      extra_seats: currentPurchased,
      message: "No change to extra seats.",
    });
  }

  if (target < currentPurchased) {
    return jsonError(
      400,
      "Reducing paid seats mid-cycle would create a credit or refund. Contact support to reduce paid seats before renewal.",
      { code: "reduction_blocked", current_extra_seats: currentPurchased },
    );
  }

  // ---- Increase path ----
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
  try {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const existingItem = stripeSub.items.data.find(
      (it) => it.price?.id === STRIPE_PRICE_TEAM_EXTRA_USER,
    );

    // Apply the item change with immediate invoicing. pending_if_incomplete
    // means Stripe will hold the quantity change in pending_update until the
    // generated invoice is paid; the webhook therefore won't expose the new
    // quantity as seats_purchased until payment confirms.
    if (existingItem) {
      await stripe.subscriptionItems.update(existingItem.id, {
        quantity: target,
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
      } as any);
    } else {
      await stripe.subscriptionItems.create({
        subscription: sub.stripe_subscription_id,
        price: STRIPE_PRICE_TEAM_EXTRA_USER,
        quantity: target,
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
      } as any);
    }

    // Re-fetch with latest_invoice + payment_intent expanded so we can
    // tell the client whether payment was taken or needs action.
    const refreshed = await stripe.subscriptions.retrieve(
      sub.stripe_subscription_id,
      { expand: ["latest_invoice", "latest_invoice.payment_intent", "pending_update"] },
    );
    const latest = refreshed.latest_invoice as Stripe.Invoice | null;
    const pi: any = latest && typeof latest !== "string" ? (latest as any).payment_intent : null;
    const piStatus: string | null = pi && typeof pi !== "string" ? pi.status : null;
    const nextActionUrl: string | null =
      pi && typeof pi !== "string"
        ? (pi.next_action?.redirect_to_url?.url as string | undefined) ?? null
        : null;

    const invoicePaid = latest?.status === "paid" || (latest?.amount_due ?? 0) === 0;
    const paymentRequiresAction =
      piStatus === "requires_action" ||
      piStatus === "requires_payment_method" ||
      piStatus === "requires_confirmation";

    return jsonOk({
      requested_extra_seats: target,
      previous_extra_seats: currentPurchased,
      subscription_status: refreshed.status,
      pending_update: !!(refreshed as any).pending_update,
      invoice: latest
        ? {
            id: latest.id,
            status: latest.status,
            amount_due_cents: latest.amount_due ?? null,
            amount_paid_cents: latest.amount_paid ?? null,
            hosted_invoice_url: latest.hosted_invoice_url ?? null,
            invoice_pdf_url: latest.invoice_pdf ?? null,
          }
        : null,
      payment: {
        intent_status: piStatus,
        charged_immediately: !!latest && invoicePaid,
        requires_action: paymentRequiresAction,
        next_action_url: nextActionUrl,
      },
    });
  } catch (e: any) {
    return jsonError(500, e?.message ?? "Stripe error");
  }
});
