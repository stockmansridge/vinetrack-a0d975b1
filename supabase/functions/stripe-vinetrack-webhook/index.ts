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

function logEvent(message: string, detail: Record<string, unknown>) {
  console.log(`[stripe-vinetrack-webhook] ${message}`, detail);
}

function stringifyError(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const err = error as Record<string, unknown>;
    return [err.message, err.details, err.hint, err.code]
      .filter(Boolean)
      .join(" | ") || JSON.stringify(err);
  }
  return String(error);
}

function getInvoiceStripeSubId(inv: Stripe.Invoice): string | null {
  return (
    (typeof inv.subscription === "string" ? inv.subscription : (inv.subscription as any)?.id) ||
    ((inv as any).parent?.subscription_details?.subscription as string | undefined) ||
    ((inv as any).subscription_details?.subscription as string | undefined) ||
    ((inv as any).lines?.data?.[0]?.subscription as string | undefined) ||
    ((inv as any).lines?.data?.[0]?.parent?.subscription_item_details?.subscription as
      | string
      | undefined) ||
    null
  );
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

  async function expectData<T>(
    promise: Promise<{ data: T | null; error: any }>,
    context: string,
    meta: Record<string, unknown> = {},
  ): Promise<T> {
    const { data, error } = await promise;
    if (error) {
      const message = stringifyError(error);
      logEvent(`${context} failed`, { ...meta, error: message });
      throw new Error(`${context}: ${message}`);
    }
    if (data == null) {
      const message = `${context}: no data returned`;
      logEvent(`${context} failed`, { ...meta, error: message });
      throw new Error(message);
    }
    return data;
  }

  async function expectOk(
    promise: Promise<{ error: any }>,
    context: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await promise;
    if (error) {
      const message = stringifyError(error);
      logEvent(`${context} failed`, { ...meta, error: message });
      throw new Error(`${context}: ${message}`);
    }
  }

  async function getTeamPlan(): Promise<{ id: string | null; seats_included: number }> {
    // Try with seats_included; if the column doesn't exist (42703), fall back.
    let row: any = null;
    let lastError: any = null;
    for (const cols of ["id, seats_included", "id, included_seats", "id"]) {
      const { data, error } = await admin
        .from("vinetrack_plans")
        .select(cols)
        .eq("code", "team")
        .maybeSingle();
      if (!error) {
        row = data;
        break;
      }
      lastError = error;
      if ((error as any)?.code !== "42703") break;
    }
    if (!row && lastError) {
      logEvent("Load team plan failed", { error: stringifyError(lastError) });
      throw new Error(`Load team plan: ${stringifyError(lastError)}`);
    }
    const included =
      (row?.seats_included as number | undefined) ??
      (row?.included_seats as number | undefined) ??
      3;
    return {
      id: (row?.id as string) ?? null,
      seats_included: included,
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
    const { data, error } = await admin
      .from("vinetrack_subscriptions")
      .select("id, owner_user_id, primary_vineyard_id, status, seats_included, seats_purchased, stripe_customer_id, created_at")
      .eq("stripe_subscription_id", stripeSubId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Find subscription by Stripe ID: ${stringifyError(error)}`);
    }
    return data ?? null;
  }

  async function findLatestActiveTeamSubByCustomer(customerId: string) {
    const { data, error } = await admin
      .from("vinetrack_subscriptions")
      .select("id, owner_user_id, primary_vineyard_id, stripe_subscription_id, stripe_customer_id, status, created_at")
      .eq("billing_provider", "stripe")
      .eq("stripe_customer_id", customerId)
      .is("deleted_at", null)
      .in("status", ["active", "trialing", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Find latest team subscription by customer: ${stringifyError(error)}`);
    }
    return data ?? null;
  }

  /** Upsert subscription by stripe_subscription_id. Never creates duplicates. */
  async function upsertSubscriptionFromStripe(
    sub: Stripe.Subscription,
    ownerHint?: string | null,
    vineyardHint?: string | null,
  ) {
    const ownerUserId = ownerHint || ownerFromMeta(sub.metadata as any) || null;
    const plan = await getTeamPlan();
    if (!plan.id) {
      throw new Error("Team plan id is missing for Team subscription webhook.");
    }

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

    const existing = await findSubByStripeId(sub.id);
    const resolvedOwner = ownerUserId || (existing?.owner_user_id as string | null) || null;
    const resolvedVineyard =
      primaryVineyardId || (existing?.primary_vineyard_id as string | null) || null;

    if (!resolvedOwner) {
      throw new Error(`owner_user_id is required for Team subscription ${sub.id}`);
    }

    const stripeCustomerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

    const baseRow: Record<string, unknown> = {
      owner_user_id: resolvedOwner,
      plan_id: plan.id,
      billing_provider: "stripe",
      status: sub.status,
      stripe_customer_id: stripeCustomerId,
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
    // Clear any stale soft-delete when Stripe says the subscription is live.
    if (["active", "trialing", "past_due", "incomplete"].includes(sub.status)) {
      (baseRow as any).deleted_at = null;
    }
    if (resolvedVineyard) {
      (baseRow as any).primary_vineyard_id = resolvedVineyard;
    }

    let subRowId: string | null = null;
    if (existing?.id) {
      const updated = await expectData(
        admin
          .from("vinetrack_subscriptions")
          .update(baseRow)
          .eq("id", existing.id)
          .select("id")
          .maybeSingle(),
        "Update Team subscription",
        {
          stripeSubscriptionId: sub.id,
          ownerUserId: resolvedOwner,
          primaryVineyardId: resolvedVineyard,
        },
      );
      subRowId = updated.id as string;
    } else {
      const insertRow: Record<string, unknown> = {
        ...baseRow,
        started_at: new Date().toISOString(),
        seats_included: plan.seats_included,
      };
      const inserted = await expectData(
        admin
          .from("vinetrack_subscriptions")
          .insert(insertRow)
          .select("id")
          .maybeSingle(),
        "Insert Team subscription",
        {
          stripeSubscriptionId: sub.id,
          ownerUserId: resolvedOwner,
          primaryVineyardId: resolvedVineyard,
        },
      );
      subRowId = inserted.id as string;
    }

    if (!subRowId) {
      throw new Error(`Failed to resolve Team subscription row id for ${sub.id}`);
    }

    await expectOk(
      admin
        .from("vinetrack_billing_events")
        .update({ subscription_id: subRowId, owner_user_id: resolvedOwner })
        .eq("provider", "stripe")
        .is("subscription_id", null)
        .or([
          `payload->data->object->>id.eq.${sub.id}`,
          `payload->data->object->>subscription.eq.${sub.id}`,
          `payload->data->object->parent->subscription_details->>subscription.eq.${sub.id}`,
          `payload->data->object->subscription_details->>subscription.eq.${sub.id}`,
          `payload->data->object->lines->data->0->>subscription.eq.${sub.id}`,
          `payload->data->object->lines->data->0->parent->subscription_item_details->>subscription.eq.${sub.id}`,
        ].join(",")),
      "Backfill billing events",
      {
        stripeSubscriptionId: sub.id,
        ownerUserId: resolvedOwner,
        supabaseSubscriptionId: subRowId,
      },
    );

    if (["active", "trialing", "past_due"].includes(sub.status)) {
      await ensureOwnerLicence(subRowId, resolvedOwner, resolvedVineyard);
    }

    logEvent("subscription upserted", {
      eventType: event.type,
      stripeSubscriptionId: sub.id,
      ownerUserId: resolvedOwner,
      primaryVineyardId: resolvedVineyard,
      supabaseSubscriptionId: subRowId,
    });

    return { subRowId, ownerUserId: resolvedOwner, primaryVineyardId: resolvedVineyard };
  }

  async function ensureOwnerLicence(
    subscriptionId: string,
    ownerUserId: string,
    vineyardId: string | null,
  ) {
    const { data: existing, error: existingError } = await admin
      .from("vinetrack_user_licences")
      .select("id, status")
      .eq("subscription_id", subscriptionId)
      .eq("user_id", ownerUserId)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Lookup owner licence: ${stringifyError(existingError)}`);
    }
    if (existing?.id) {
      if (existing.status !== "active") {
        await expectOk(
          admin
            .from("vinetrack_user_licences")
            .update({ status: "active" })
            .eq("id", existing.id),
          "Update owner licence",
          { subscriptionId, ownerUserId, vineyardId, licenceId: existing.id },
        );
      }
      return;
    }

    let ownerEmail: string | null = null;
    try {
      const { data: au } = await (admin as any).auth.admin.getUserById(ownerUserId);
      ownerEmail = au?.user?.email ?? null;
    } catch {
      ownerEmail = null;
    }

    await expectOk(
      admin.from("vinetrack_user_licences").insert({
        subscription_id: subscriptionId,
        user_id: ownerUserId,
        invited_email: ownerEmail,
        vineyard_id: vineyardId,
        status: "active",
        assigned_by: ownerUserId,
        metadata: { source: "stripe_webhook" },
      }),
      "Insert owner licence",
      { subscriptionId, ownerUserId, vineyardId },
    );
  }

  async function upsertInvoice(inv: Stripe.Invoice) {
    let invoice = inv;
    let stripeSubscriptionId = getInvoiceStripeSubId(invoice);
    const customerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;

    if (!stripeSubscriptionId) {
      invoice = await stripe.invoices.retrieve(inv.id, { expand: ["subscription"] }) as Stripe.Invoice;
      stripeSubscriptionId = getInvoiceStripeSubId(invoice);
    }

    let subRow = stripeSubscriptionId ? await findSubByStripeId(stripeSubscriptionId) : null;
    if (!subRow && stripeSubscriptionId) {
      const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      const upserted = await upsertSubscriptionFromStripe(stripeSub);
      subRow = {
        id: upserted.subRowId,
        owner_user_id: upserted.ownerUserId,
        primary_vineyard_id: upserted.primaryVineyardId,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer?.id ?? null,
      } as any;
    }

    if (!subRow && customerId) {
      subRow = await findLatestActiveTeamSubByCustomer(customerId);
      if (subRow?.stripe_subscription_id) {
        stripeSubscriptionId = subRow.stripe_subscription_id as string;
      }
    }

    const subscriptionId = (subRow?.id as string | null) ?? null;
    const ownerUserId =
      ownerFromMeta((invoice as any).subscription_details?.metadata, invoice.metadata as any) ||
      (subRow?.owner_user_id as string | null) ||
      null;

    const totalTax =
      typeof invoice.tax === "number"
        ? invoice.tax
        : (invoice.total_tax_amounts ?? []).reduce(
            (acc, t) => acc + ((t as any)?.amount ?? 0),
            0,
          ) || null;

    const row: Record<string, unknown> = {
      subscription_id: subscriptionId,
      owner_user_id: ownerUserId,
      provider: "stripe",
      external_invoice_id: invoice.id,
      invoice_number: invoice.number ?? null,
      status: invoice.status ?? "open",
      currency: (invoice.currency ?? "aud").toUpperCase(),
      subtotal_cents: invoice.subtotal ?? null,
      tax_cents: totalTax,
      total_cents: invoice.total ?? null,
      amount_paid_cents: invoice.amount_paid ?? null,
      period_start: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : null,
      period_end: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : null,
      issued_at: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
      due_at: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      paid_at: invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
        : null,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      invoice_pdf_url: invoice.invoice_pdf ?? null,
      metadata: {
        ...(invoice.metadata ?? {}),
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: customerId,
        customer: customerId,
        subscription_details: (invoice as any).subscription_details ?? null,
      },
    };

    const { data: existing, error: existingError } = await admin
      .from("vinetrack_invoice_records")
      .select("id")
      .eq("provider", "stripe")
      .eq("external_invoice_id", invoice.id)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Lookup invoice record: ${stringifyError(existingError)}`);
    }

    if (existing?.id) {
      await expectOk(
        admin.from("vinetrack_invoice_records").update(row).eq("id", existing.id),
        "Update invoice record",
        { invoiceId: invoice.id, stripeSubscriptionId, ownerUserId, supabaseSubscriptionId: subscriptionId },
      );
    } else {
      await expectOk(
        admin.from("vinetrack_invoice_records").insert(row),
        "Insert invoice record",
        { invoiceId: invoice.id, stripeSubscriptionId, ownerUserId, supabaseSubscriptionId: subscriptionId },
      );
    }

    if (subscriptionId || ownerUserId) {
      const filters: string[] = [];
      if (stripeSubscriptionId) {
        filters.push(`metadata->>stripe_subscription_id.eq.${stripeSubscriptionId}`);
      }
      if (customerId) {
        filters.push(`metadata->>stripe_customer_id.eq.${customerId}`);
        filters.push(`metadata->>customer.eq.${customerId}`);
      }
      if (filters.length) {
        await expectOk(
          admin
            .from("vinetrack_invoice_records")
            .update({ subscription_id: subscriptionId, owner_user_id: ownerUserId })
            .eq("provider", "stripe")
            .is("subscription_id", null)
            .or(filters.join(",")),
          "Backfill invoice records",
          { invoiceId: invoice.id, stripeSubscriptionId, customerId, ownerUserId, supabaseSubscriptionId: subscriptionId },
        );
      }
    }

    logEvent("invoice upserted", {
      eventType: event.type,
      stripeSubscriptionId,
      ownerUserId,
      primaryVineyardId: (subRow?.primary_vineyard_id as string | null) ?? null,
      supabaseSubscriptionId: subscriptionId,
      invoiceId: invoice.id,
    });

    return {
      stripeSubscriptionId,
      subscriptionId,
      ownerUserId,
      primaryVineyardId: (subRow?.primary_vineyard_id as string | null) ?? null,
      invoiceId: invoice.id,
    };
  }

  // ---------- log raw event (linked when possible) ----------
  let eventLinkedSubId: string | null = null;
  let eventLinkedOwner: string | null = null;
  try {
    const obj: any = (event.data?.object ?? {}) as any;
    const stripeSubId: string | null =
      obj?.object === "subscription"
        ? obj.id
        : obj?.subscription ??
          obj?.parent?.subscription_details?.subscription ??
          obj?.subscription_details?.subscription ??
          obj?.lines?.data?.[0]?.subscription ??
          obj?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ??
          null;
    if (stripeSubId) {
      const subRow = await findSubByStripeId(stripeSubId);
      eventLinkedSubId = subRow?.id ?? null;
      eventLinkedOwner = subRow?.owner_user_id ?? null;
    }
    if (!eventLinkedOwner) {
      eventLinkedOwner =
        ownerFromMeta(obj?.metadata, obj?.subscription_details?.metadata) ?? null;
    }
    const { error: insertEventError } = await admin
      .from("vinetrack_billing_events")
      .upsert(
        {
          provider: "stripe",
          event_type: event.type,
          external_event_id: event.id,
          subscription_id: eventLinkedSubId,
          owner_user_id: eventLinkedOwner,
          payload: event as unknown as Record<string, unknown>,
        },
        { onConflict: "provider,external_event_id", ignoreDuplicates: false },
      );
    if (insertEventError) {
      const message = stringifyError(insertEventError);
      logEvent("Upsert billing event failed", {
        eventType: event.type,
        stripeSubscriptionId: stripeSubId,
        ownerUserId: eventLinkedOwner,
        supabaseSubscriptionId: eventLinkedSubId,
        invoiceId: obj?.object === "invoice" ? obj?.id ?? null : null,
        error: message,
      });
      // Don't fail the whole webhook just because we couldn't log the event.
      // The handler dispatch below is what actually links subscriptions/invoices.
      console.error("billing_events upsert failed (continuing)", message);
    }
  } catch (e) {
    console.error("billing_events logging failed (continuing)", e);
  }

  // ---------- dispatch ----------
  try {
    logEvent("event received", {
      eventType: event.type,
      stripeSubscriptionId:
        (event.data.object as any)?.object === "subscription"
          ? (event.data.object as any)?.id ?? null
          : getInvoiceStripeSubId(event.data.object as Stripe.Invoice),
      ownerUserId:
        ownerFromMeta(
          (event.data.object as any)?.metadata,
          (event.data.object as any)?.subscription_details?.metadata,
        ) ?? eventLinkedOwner,
      primaryVineyardId:
        vineyardFromMeta(
          (event.data.object as any)?.metadata,
          (event.data.object as any)?.subscription_details?.metadata,
        ) ?? null,
      supabaseSubscriptionId: eventLinkedSubId,
      invoiceId: (event.data.object as any)?.object === "invoice" ? (event.data.object as any)?.id ?? null : null,
    });

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
        const linked = await upsertInvoice(inv);
        // On paid/renewal, make sure owner licence still exists.
        if (
          event.type === "invoice.paid" &&
          linked.subscriptionId &&
          linked.ownerUserId
        ) {
            await ensureOwnerLicence(
              linked.subscriptionId,
              linked.ownerUserId,
              linked.primaryVineyardId,
            );
        }
        break;
      }
      default:
        break;
    }
  } catch (e: any) {
    const errorMessage = stringifyError(e);
    console.error("webhook handler error", e);
    logEvent("handler error", { eventType: event.type, error: errorMessage });
    return fail(500, errorMessage || "Handler error");
  }

  return ok();
});
