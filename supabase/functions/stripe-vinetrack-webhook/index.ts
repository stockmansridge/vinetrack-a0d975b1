// Stripe webhook → VineTrack billing tables.
// Writes vinetrack_subscriptions, vinetrack_invoice_records and
// vinetrack_billing_events using the VineTrack service role.
// Public endpoint (Stripe POSTs here); auth is the Stripe signature.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown = { received: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function fail(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const VINETRACK_SUPABASE_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VINETRACK_SERVICE_ROLE_KEY = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET)
    return fail(503, "Stripe not configured.");
  if (!VINETRACK_SUPABASE_URL || !VINETRACK_SERVICE_ROLE_KEY)
    return fail(503, "VineTrack backend not configured.");

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
  const sig = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e: any) {
    return fail(400, `Invalid signature: ${e?.message ?? "unknown"}`);
  }

  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Always log the raw event (best-effort).
  try {
    await admin.from("vinetrack_billing_events").insert({
      provider: "stripe",
      event_type: event.type,
      external_event_id: event.id,
      payload: event as unknown as Record<string, unknown>,
    });
  } catch (e) {
    console.error("billing_events insert failed", e);
  }

  async function getTeamPlanId(): Promise<string | null> {
    const { data } = await admin
      .from("vinetrack_plans")
      .select("id")
      .eq("code", "team")
      .maybeSingle();
    return (data?.id as string) ?? null;
  }

  async function upsertSubscriptionFromStripe(sub: Stripe.Subscription, ownerHint?: string) {
    const ownerUserId =
      ownerHint ||
      (sub.metadata?.owner_user_id as string | undefined) ||
      null;
    if (!ownerUserId) {
      console.warn("subscription event with no owner_user_id", sub.id);
      return;
    }
    const planId = await getTeamPlanId();
    const item = sub.items?.data?.[0];
    const quantity = item?.quantity ?? 1;
    const row: Record<string, unknown> = {
      owner_user_id: ownerUserId,
      plan_id: planId,
      billing_provider: "stripe",
      status: sub.status,
      stripe_customer_id: sub.customer as string,
      stripe_subscription_id: sub.id,
      current_period_start: sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      trial_start: sub.trial_start
        ? new Date(sub.trial_start * 1000).toISOString()
        : null,
      trial_end: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      canceled_at: sub.canceled_at
        ? new Date(sub.canceled_at * 1000).toISOString()
        : null,
      seats_purchased: Math.max(0, quantity - 1), // first seat is "included"
      metadata: sub.metadata ?? {},
    };
    // upsert by stripe_subscription_id
    const { data: existing } = await admin
      .from("vinetrack_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    if (existing?.id) {
      await admin.from("vinetrack_subscriptions").update(row).eq("id", existing.id);
    } else {
      await admin.from("vinetrack_subscriptions").insert({
        ...row,
        started_at: new Date().toISOString(),
        seats_included: 3, // Team plan default; webhook is a coarse setter
      });
    }
  }

  async function upsertInvoice(inv: Stripe.Invoice) {
    const ownerUserId =
      (inv.subscription_details?.metadata?.owner_user_id as string | undefined) ||
      (inv.metadata?.owner_user_id as string | undefined) ||
      null;
    let subscriptionId: string | null = null;
    if (inv.subscription) {
      const { data } = await admin
        .from("vinetrack_subscriptions")
        .select("id, owner_user_id")
        .eq("stripe_subscription_id", inv.subscription as string)
        .maybeSingle();
      subscriptionId = (data?.id as string) ?? null;
    }
    const row: Record<string, unknown> = {
      subscription_id: subscriptionId,
      owner_user_id: ownerUserId,
      provider: "stripe",
      external_invoice_id: inv.id,
      invoice_number: inv.number ?? null,
      status: inv.status ?? "open",
      currency: (inv.currency ?? "aud").toUpperCase(),
      subtotal_cents: inv.subtotal ?? null,
      tax_cents: inv.tax ?? null,
      total_cents: inv.total ?? null,
      amount_paid_cents: inv.amount_paid ?? null,
      period_start: inv.period_start
        ? new Date(inv.period_start * 1000).toISOString()
        : null,
      period_end: inv.period_end
        ? new Date(inv.period_end * 1000).toISOString()
        : null,
      issued_at: inv.created
        ? new Date(inv.created * 1000).toISOString()
        : null,
      due_at: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
      paid_at:
        inv.status_transitions?.paid_at != null
          ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
          : null,
      hosted_invoice_url: inv.hosted_invoice_url ?? null,
      invoice_pdf_url: inv.invoice_pdf ?? null,
      metadata: inv.metadata ?? {},
    };
    const { data: existing } = await admin
      .from("vinetrack_invoice_records")
      .select("id")
      .eq("provider", "stripe")
      .eq("external_invoice_id", inv.id)
      .maybeSingle();
    if (existing?.id) {
      await admin.from("vinetrack_invoice_records").update(row).eq("id", existing.id);
    } else {
      await admin.from("vinetrack_invoice_records").insert(row);
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await upsertSubscriptionFromStripe(
            sub,
            (session.client_reference_id as string) || undefined
          );
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await upsertSubscriptionFromStripe(sub);
        break;
      }
      case "invoice.created":
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.marked_uncollectible": {
        const inv = event.data.object as Stripe.Invoice;
        await upsertInvoice(inv);
        break;
      }
      default:
        break;
    }
  } catch (e: any) {
    console.error("webhook handler error", e);
    return fail(500, e?.message ?? "Handler error");
  }

  return ok();
});
