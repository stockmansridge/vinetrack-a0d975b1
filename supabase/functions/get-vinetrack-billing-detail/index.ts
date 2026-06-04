// Service-role billing detail for the caller's active VineTrack Team
// subscription. Single source of truth for the Billing page:
// - calls get_my_vinetrack_access() in user context
// - resolves the active Team subscription owned by the caller
// - returns access row, subscription row, licences and invoices, plus
//   any query errors and debug info.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET")
    return json(405, { error: "Method not allowed" });

  const VINETRACK_SUPABASE_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VINETRACK_SERVICE_ROLE_KEY = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const VINETRACK_ANON_KEY = Deno.env.get("VINETRACK_ANON_KEY");
  if (!VINETRACK_SUPABASE_URL || !VINETRACK_SERVICE_ROLE_KEY || !VINETRACK_ANON_KEY)
    return json(503, { error: "VineTrack backend is not configured." });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer "))
    return json(401, { error: "Unauthorized" });

  const userClient = createClient(VINETRACK_SUPABASE_URL, VINETRACK_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "Unauthorized" });
  const caller = userData.user;

  const admin = createClient(VINETRACK_SUPABASE_URL, VINETRACK_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Access row via RPC in user context (RLS-aware).
  let accessRow: any = null;
  let accessError: string | null = null;
  try {
    const { data, error } = await (userClient as any).rpc("get_my_vinetrack_access");
    if (error) accessError = error.message ?? String(error);
    else accessRow = Array.isArray(data) ? data[0] ?? null : data ?? null;
  } catch (e: any) {
    accessError = e?.message ?? String(e);
  }

  // Resolve active Team subscription for caller (owner).
  const { data: sub, error: subErr } = await admin
    .from("vinetrack_subscriptions")
    .select(
      "id, owner_user_id, status, billing_provider, plan_id, stripe_subscription_id, stripe_customer_id, primary_vineyard_id, seats_included, seats_purchased, current_period_start, current_period_end, trial_end, cancel_at_period_end, canceled_at, created_at, deleted_at",
    )
    .eq("owner_user_id", caller.id)
    .eq("billing_provider", "stripe")
    .is("deleted_at", null)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub?.id) {
    return json(200, {
      access: accessRow,
      subscription: null,
      licences: [],
      invoices: [],
      errors: { access: accessError, subscription: subErr?.message ?? null },
      debug: { caller_id: caller.id, reason: "no_active_team_subscription" },
    });
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
      await admin.from("vinetrack_user_licences").insert({
        subscription_id: sub.id,
        user_id: caller.id,
        invited_email: caller.email ?? null,
        vineyard_id: (sub as any).primary_vineyard_id ?? null,
        status: "active",
        assigned_by: caller.id,
        metadata: { source: "owner_repair", role: "owner" },
      });
      ownerLicenceCreated = true;
    }
  } catch (e) {
    console.warn("[get-vinetrack-billing-detail] owner repair failed", (e as any)?.message);
  }

  const [licRes, invRes] = await Promise.all([
    admin
      .from("vinetrack_user_licences")
      .select(
        "id, subscription_id, user_id, invited_email, vineyard_id, status, assigned_by, created_at, metadata",
      )
      .eq("subscription_id", sub.id)
      .order("created_at", { ascending: true }),
    admin
      .from("vinetrack_invoice_records")
      .select(
        "id, invoice_number, status, currency, total_cents, amount_paid_cents, period_start, period_end, issued_at, paid_at, hosted_invoice_url, invoice_pdf_url, subscription_id, owner_user_id, provider, external_invoice_id",
      )
      .eq("subscription_id", sub.id)
      .order("issued_at", { ascending: false }),
  ]);

  let invoices = invRes.data ?? [];
  let invoicesFallbackUsed = false;
  if (!invRes.error && invoices.length === 0) {
    const fb = await admin
      .from("vinetrack_invoice_records")
      .select(
        "id, invoice_number, status, currency, total_cents, amount_paid_cents, period_start, period_end, issued_at, paid_at, hosted_invoice_url, invoice_pdf_url, subscription_id, owner_user_id, provider, external_invoice_id",
      )
      .eq("owner_user_id", caller.id)
      .eq("provider", "stripe")
      .order("issued_at", { ascending: false });
    if (!fb.error && (fb.data ?? []).length > 0) {
      invoices = fb.data ?? [];
      invoicesFallbackUsed = true;
    }
  }

  return json(200, {
    access: accessRow,
    subscription: sub,
    licences: licRes.data ?? [],
    invoices,
    errors: {
      access: accessError,
      subscription: null,
      licences: licRes.error?.message ?? null,
      invoices: invRes.error?.message ?? null,
    },
    debug: {
      caller_id: caller.id,
      subscription_id: sub.id,
      stripe_subscription_id: sub.stripe_subscription_id,
      licences_count: (licRes.data ?? []).length,
      invoices_count: invoices.length,
      invoices_fallback_used: invoicesFallbackUsed,
      owner_licence_created: ownerLicenceCreated,
    },
  });
});
