// Service-role read for the caller's active VineTrack Team subscription:
// returns subscription summary, licences and invoices, and ensures an
// owner licence row exists (repair). Caller must be the owner of an
// active Stripe Team subscription.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(status: number, message: string, debug?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: message, debug }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return jsonError(405, "Method not allowed");

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

  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Find the caller's most-recent active Stripe Team subscription.
  const { data: sub, error: subErr } = await admin
    .from("vinetrack_subscriptions")
    .select(
      "id, owner_user_id, status, seats_included, seats_purchased, primary_vineyard_id, stripe_subscription_id, current_period_end, billing_provider",
    )
    .eq("owner_user_id", caller.id)
    .eq("billing_provider", "stripe")
    .is("deleted_at", null)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subErr) {
    return jsonError(500, subErr.message, { phase: "subscription_lookup" });
  }
  if (!sub?.id) {
    return new Response(
      JSON.stringify({
        subscription: null,
        licences: [],
        invoices: [],
        debug: { reason: "no_active_team_subscription", caller_id: caller.id },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Ensure owner licence exists (repair).
  let ownerLicenceCreated = false;
  try {
    const { data: ownerLic } = await admin
      .from("vinetrack_user_licences")
      .select("id")
      .eq("subscription_id", sub.id)
      .eq("user_id", caller.id)
      .in("status", ["active", "pending"])
      .maybeSingle();
    if (!ownerLic?.id) {
      const ownerEmail = caller.email ?? null;
      await admin.from("vinetrack_user_licences").insert({
        subscription_id: sub.id,
        user_id: caller.id,
        invited_email: ownerEmail,
        vineyard_id: (sub as any).primary_vineyard_id ?? null,
        status: "active",
        assigned_by: caller.id,
        metadata: { source: "owner_repair", role: "owner" },
      });
      ownerLicenceCreated = true;
    }
  } catch (e) {
    console.warn("[get-vinetrack-team-licences] owner repair failed", (e as any)?.message);
  }

  // Licences for this subscription.
  const { data: licences, error: licErr } = await admin
    .from("vinetrack_user_licences")
    .select(
      "id, subscription_id, user_id, invited_email, vineyard_id, status, assigned_by, created_at, metadata",
    )
    .eq("subscription_id", sub.id)
    .order("created_at", { ascending: true });

  // Invoices for this subscription, with fallback by owner_user_id.
  let invoices: any[] = [];
  let invoicesError: string | null = null;
  let invoicesFallbackUsed = false;
  {
    const q = await admin
      .from("vinetrack_invoice_records")
      .select(
        "id, invoice_number, status, currency, total_cents, amount_paid_cents, period_start, period_end, issued_at, paid_at, hosted_invoice_url, invoice_pdf_url, subscription_id, owner_user_id, provider",
      )
      .eq("subscription_id", sub.id)
      .order("issued_at", { ascending: false });
    if (q.error) {
      invoicesError = q.error.message;
    } else {
      invoices = q.data ?? [];
    }
    if (!invoicesError && invoices.length === 0) {
      // Fallback: query by owner_user_id + stripe provider.
      const fb = await admin
        .from("vinetrack_invoice_records")
        .select(
          "id, invoice_number, status, currency, total_cents, amount_paid_cents, period_start, period_end, issued_at, paid_at, hosted_invoice_url, invoice_pdf_url, subscription_id, owner_user_id, provider",
        )
        .eq("owner_user_id", caller.id)
        .eq("provider", "stripe")
        .order("issued_at", { ascending: false });
      if (!fb.error && (fb.data ?? []).length > 0) {
        invoices = fb.data ?? [];
        invoicesFallbackUsed = true;
      }
    }
  }

  return new Response(
    JSON.stringify({
      subscription: sub,
      licences: licences ?? [],
      invoices,
      debug: {
        caller_id: caller.id,
        subscription_id: sub.id,
        stripe_subscription_id: sub.stripe_subscription_id,
        licences_error: licErr?.message ?? null,
        licences_count: (licences ?? []).length,
        invoices_error: invoicesError,
        invoices_count: invoices.length,
        invoices_fallback_used: invoicesFallbackUsed,
        owner_licence_created: ownerLicenceCreated,
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
