// Stripe webhook → VineTrack billing tables.
// - Upserts vinetrack_subscriptions by stripe_subscription_id (no duplicates).
// - Links vinetrack_billing_events and vinetrack_invoice_records to
//   owner_user_id + subscription_id.
// - Ensures an active owner licence exists for Team subscriptions.
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
  const STRIPE_PRICE_TEAM_EXTRA_USER = Deno.env.get("STRIPE_PRICE_TEAM_EXTRA_USER");
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

  // ---------- helpers ----------

  async function getTeamPlan(): Promise<{ id: string | null; seats_included: number }> {
    const { data } = await admin
      .from("vinetrack_plans")
      .select("id, seats_included")
      .eq("code", "team")
      .maybeSingle();
    return {
      id: (data?.id as string) ?? null,
      seats_included: (data?.seats_included as number) ?? 3,
    };
  }

  /** Pull owner_user_id from a Stripe object's metadata chain. */
  function ownerFromMeta(
    primary?: Record<string, string> | null,
    fallback?: Record<string, string> | null,
  ): string | null {
    return (
      (primary?.owner_user_id as string | undefined) ||
      (fallback?.owner_user_id as string | undefined) ||
      null
    );
  }
  function vineyardFromMeta(
    primary?: Record<string, string> | null,
    fallback?: Record<string, string> | null,
  ): string | null {
    return (
      (primary?.primary_vineyard_id as string | undefined) ||
      (fallback?.primary_vineyard_id as string | undefined) ||
      null
    );
  }

  /** Find the VineTrack subscription row id (and owner) for a Stripe sub id. */
  async function findSubByStripeId(stripeSubId: string) {
    const { data } = await admin
      .from("vinetrack_subscriptions")
      .select("id, owner_user_id, primary_vineyard_id, status, seats_included, seats_purchased")
      .eq("stripe_subscription_id", stripeSubId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  }

  /** Upsert subscription by stripe_subscription_id. Never creates duplicates. */
  async function upsertSubscriptionFromStripe(
    sub: Stripe.Subscription,
    ownerHint?: string | null,
    vineyardHint?: string | null,
  ) {
    const ownerUserId =
      ownerHint ||
      ownerFromMeta(sub.metadata as any) ||
      null;

    if (!ownerUserId) {
      console.warn("[webhook] subscription with no owner_user_id", sub.id);
    }

    const plan = await getTeamPlan();
    // Compute seat counts from Stripe items.
    let baseQty = 0;
    let extraQty = 0;
    for (const item of sub.items?.data ?? []) {
      const priceId = item.price?.id;
      const qty = item.quantity ?? 0;
      if (STRIPE_PRICE_TEAM_EXTRA_USER && priceId === STRIPE_PRICE_TEAM_EXTRA_USER) {
        extraQty += qty;
      } else {
        baseQty += qty;
      }
    }
    // First "base" seat is included with the plan; any base qty above 1 also counts as extra.
    const seatsPurchased = extraQty + Math.max(0, baseQty - 1);

    const primaryVineyardId =
      vineyardHint ||
      vineyardFromMeta(sub.metadata as any) ||
      null;

    const baseRow: Record<string, unknown> = {
      owner_user_id: ownerUserId,
      plan_id: plan.id,
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
      seats_purchased: seatsPurchased,
      metadata: sub.metadata ?? {},
    };
    if (primaryVineyardId) {
      (baseRow as any).primary_vineyard_id = primaryVineyardId;
    }

    const existing = await findSubByStripeId(sub.id);
    let subRowId: string | null = null;
    let resolvedOwner: string | null = ownerUserId;
    let resolvedVineyard: string | null = primaryVineyardId;

    if (existing?.id) {
      // Keep existing owner / vineyard if Stripe metadata didn't provide them.
      const update: Record<string, unknown> = { ...baseRow };
      if (!ownerUserId && existing.owner_user_id) {
        (update as any).owner_user_id = existing.owner_user_id;
        resolvedOwner = existing.owner_user_id as string;
      }
      if (!primaryVineyardId && existing.primary_vineyard_id) {
        resolvedVineyard = existing.primary_vineyard_id as string;
      }
      await admin.from("vinetrack_subscriptions").update(update).eq("id", existing.id);
      subRowId = existing.id as string;
    } else {
      const insertRow: Record<string, unknown> = {
        ...baseRow,
        started_at: new Date().toISOString(),
        seats_included: plan.seats_included,
      };
      const { data: inserted } = await admin
        .from("vinetrack_subscriptions")
        .insert(insertRow)
        .select("id")
        .maybeSingle();
      subRowId = (inserted?.id as string) ?? null;
    }

    // Back-fill any prior billing events for this Stripe sub.
    if (subRowId) {
      try {
        await admin
          .from("vinetrack_billing_events")
          .update({ subscription_id: subRowId, owner_user_id: resolvedOwner })
          .eq("provider", "stripe")
          .or(
            `external_event_id.eq.${sub.id},payload->data->object->>id.eq.${sub.id}`,
          )
          .is("subscription_id", null);
      } catch (e) {
        console.warn("[webhook] back-fill billing_events failed", (e as any)?.message);
      }
    }

    // Ensure owner licence for active Team subscriptions.
    if (
      subRowId &&
      resolvedOwner &&
      ["active", "trialing", "past_due"].includes(sub.status)
    ) {
      await ensureOwnerLicence(subRowId, resolvedOwner, resolvedVineyard);
    }

    return { subRowId, ownerUserId: resolvedOwner, primaryVineyardId: resolvedVineyard };
  }

  async function ensureOwnerLicence(
    subscriptionId: string,
    ownerUserId: string,
    vineyardId: string | null,
  ) {
    try {
      const { data: existing } = await admin
        .from("vinetrack_user_licences")
        .select("id, status")
        .eq("subscription_id", subscriptionId)
        .eq("user_id", ownerUserId)
        .maybeSingle();
      if (existing?.id) {
        if (existing.status !== "active") {
          await admin
            .from("vinetrack_user_licences")
            .update({ status: "active" })
            .eq("id", existing.id);
        }
        return;
      }
      // Resolve owner email (best-effort).
      let ownerEmail: string | null = null;
      try {
        const { data: au } = await (admin as any).auth.admin.getUserById(ownerUserId);
        ownerEmail = au?.user?.email ?? null;
      } catch { /* ignore */ }

      await admin.from("vinetrack_user_licences").insert({
        subscription_id: subscriptionId,
        user_id: ownerUserId,
        invited_email: ownerEmail,
        vineyard_id: vineyardId,
        status: "active",
        assigned_by: ownerUserId,
        metadata: { source: "stripe_webhook" },
      });
    } catch (e) {
      console.warn("[webhook] ensureOwnerLicence failed", (e as any)?.message);
    }
  }

  async function upsertInvoice(inv: Stripe.Invoice) {
    let subscriptionId: string | null = null;
    let ownerUserId: string | null =
      ownerFromMeta(
        (inv as any).subscription_details?.metadata,
        inv.metadata as any,
      ) ?? null;

    if (inv.subscription) {
      const subRow = await findSubByStripeId(inv.subscription as string);
      subscriptionId = subRow?.id ?? null;
      if (!ownerUserId) ownerUserId = subRow?.owner_user_id ?? null;
    }

    const totalTax =
      typeof inv.tax === "number"
        ? inv.tax
        : (inv.total_tax_amounts ?? []).reduce(
            (acc, t) => acc + ((t as any)?.amount ?? 0),
            0,
          ) || null;

    const row: Record<string, unknown> = {
      subscription_id: subscriptionId,
      owner_user_id: ownerUserId,
      provider: "stripe",
      external_invoice_id: inv.id,
      invoice_number: inv.number ?? null,
      status: inv.status ?? "open",
      currency: (inv.currency ?? "aud").toUpperCase(),
      subtotal_cents: inv.subtotal ?? null,
      tax_cents: totalTax,
      total_cents: inv.total ?? null,
      amount_paid_cents: inv.amount_paid ?? null,
      period_start: inv.period_start
        ? new Date(inv.period_start * 1000).toISOString()
        : null,
      period_end: inv.period_end
        ? new Date(inv.period_end * 1000).toISOString()
        : null,
      issued_at: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      due_at: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
      paid_at: inv.status_transitions?.paid_at
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

  // ---------- log raw event (linked when possible) ----------
  let eventLinkedSubId: string | null = null;
  let eventLinkedOwner: string | null = null;
  try {
    const obj: any = (event.data?.object ?? {}) as any;
    const stripeSubId: string | null =
      obj?.object === "subscription"
        ? obj.id
        : obj?.subscription ?? null;
    if (stripeSubId) {
      const subRow = await findSubByStripeId(stripeSubId);
      eventLinkedSubId = subRow?.id ?? null;
      eventLinkedOwner = subRow?.owner_user_id ?? null;
    }
    if (!eventLinkedOwner) {
      eventLinkedOwner =
        ownerFromMeta(obj?.metadata, obj?.subscription_details?.metadata) ?? null;
    }
    await admin.from("vinetrack_billing_events").insert({
      provider: "stripe",
      event_type: event.type,
      external_event_id: event.id,
      subscription_id: eventLinkedSubId,
      owner_user_id: eventLinkedOwner,
      payload: event as unknown as Record<string, unknown>,
    });
  } catch (e) {
    console.error("billing_events insert failed", e);
  }

  // ---------- dispatch ----------
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const ownerHint =
          (session.client_reference_id as string) ||
          ownerFromMeta(session.metadata as any) ||
          null;
        const vineyardHint = vineyardFromMeta(session.metadata as any);
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await upsertSubscriptionFromStripe(sub, ownerHint, vineyardHint);
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
        // On paid/renewal, make sure owner licence still exists.
        if (event.type === "invoice.paid" && inv.subscription) {
          const subRow = await findSubByStripeId(inv.subscription as string);
          if (subRow?.id && subRow.owner_user_id) {
            await ensureOwnerLicence(
              subRow.id,
              subRow.owner_user_id as string,
              (subRow as any).primary_vineyard_id ?? null,
            );
          }
        }
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
