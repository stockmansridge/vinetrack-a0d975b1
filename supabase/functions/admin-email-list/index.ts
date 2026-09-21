// System-admin only: read and manage public.email_list_subscribers.
// Caller must be an ACTIVE system admin on the canonical VineTrack project;
// the read/write happens on that same canonical VineTrack database via its
// service role, alongside support_requests (see sql/242). The table grants
// nothing to anon/authenticated, so this function is the only way the Portal
// can reach it.
//
// While sql/242 is not yet applied, reads/writes fall back to the legacy copy
// of the table on the Portal's own project so the admin page keeps working
// through the cutover. The legacy table is retired once canonical is live.
//
// POST { action: "list" } -> { subscribers: [...] }
// POST { action: "set_status", id, status: "subscribed" | "unsubscribed" }
// POST { action: "bulk_status", ids: string[], status } -> { updated }
// POST { action: "update", id, email, first_name, last_name } -> { subscriber }
// POST { action: "delete", ids: string[] } -> { deleted }
// POST { action: "import", rows: [{ email, first_name?, last_name?, status?,
//        source?, source_page? }], source? } -> { created, updated, skipped }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  isMissingTableError,
  SUBSCRIBER_COLUMNS,
  upsertSubscriber,
} from "../_shared/email-list.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vinetrack-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const jsonError = (status: number, message: string) => json(status, { error: message });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_ANON = Deno.env.get("VINETRACK_ANON_KEY");
  const VT_SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const CLOUD_URL = Deno.env.get("SUPABASE_URL");
  const CLOUD_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!VT_URL || !VT_ANON || !VT_SERVICE || !CLOUD_URL || !CLOUD_SERVICE) {
    return jsonError(503, "Backend is not configured.");
  }

  const vinetrackToken = (req.headers.get("x-vinetrack-token") ?? "").trim();
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = vinetrackToken ||
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "");
  if (!bearer) return jsonError(401, "Unauthorized");

  const userClient = createClient(VT_URL, VT_ANON, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(bearer);
  if (userErr || !userData?.user) return jsonError(401, "Unauthorized");

  const { data: isAdmin, error: adminErr } = await userClient.rpc("is_system_admin");
  if (adminErr) return jsonError(403, "Could not verify system admin access.");
  if (!isAdmin) return jsonError(403, "System admin access required.");

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body.action ?? "list");

  // Canonical VineTrack database owns the subscriber data.
  const admin = createClient(VT_URL, VT_SERVICE, { auth: { persistSession: false } });
  // Legacy copy on the Portal's own project — cutover fallback only.
  const legacy = createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } });

  const listFrom = (client: ReturnType<typeof createClient>) =>
    client
      .from("email_list_subscribers")
      .select(SUBSCRIBER_COLUMNS)
      .order("subscribed_at", { ascending: false })
      .limit(5000);

  if (action === "list") {
    let { data, error } = await listFrom(admin);
    if (error && isMissingTableError(error)) {
      console.error("email_list_subscribers missing on VineTrack — apply sql/242; reading legacy");
      ({ data, error } = await listFrom(legacy));
    }
    if (error) return jsonError(500, `Could not load the email list: ${error.message}`);
    return json(200, { subscribers: data ?? [] });
  }

  if (action === "set_status") {
    const id = String(body.id ?? "");
    const status = String(body.status ?? "");
    if (!id) return jsonError(400, "A subscriber id is required.");
    if (status !== "subscribed" && status !== "unsubscribed") {
      return jsonError(400, "Status must be subscribed or unsubscribed.");
    }
    const now = new Date().toISOString();
    const patch = status === "unsubscribed"
      ? { status, unsubscribed_at: now, updated_at: now }
      : { status, unsubscribed_at: null, subscribed_at: now, updated_at: now };
    const updateIn = (client: ReturnType<typeof createClient>) =>
      client
        .from("email_list_subscribers")
        .update(patch)
        .eq("id", id)
        .select(SUBSCRIBER_COLUMNS)
        .maybeSingle();

    let { data, error } = await updateIn(admin);
    if ((error && isMissingTableError(error)) || (!error && !data)) {
      // Missing table, or an id that only exists in the legacy copy.
      const fallback = await updateIn(legacy);
      if (fallback.data || fallback.error) ({ data, error } = fallback);
    }
    if (error) return jsonError(500, `Could not update the subscriber: ${error.message}`);
    if (!data) return jsonError(404, "Subscriber not found.");
    return json(200, { success: true, subscriber: data });
  }

  /** Whichever copy of the table actually exists right now. */
  const resolveStore = async () => {
    const probe = await admin.from("email_list_subscribers").select("id").limit(1);
    if (probe.error && isMissingTableError(probe.error)) {
      console.error("email_list_subscribers missing on VineTrack — apply sql/242; using legacy");
      return legacy;
    }
    return admin;
  };

  const readIds = (): string[] => {
    const raw = Array.isArray(body.ids) ? body.ids : [];
    return Array.from(
      new Set(raw.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0)),
    ).slice(0, 5000);
  };

  if (action === "bulk_status") {
    const ids = readIds();
    const status = String(body.status ?? "");
    if (ids.length === 0) return jsonError(400, "Select at least one subscriber.");
    if (status !== "subscribed" && status !== "unsubscribed") {
      return jsonError(400, "Status must be subscribed or unsubscribed.");
    }
    const now = new Date().toISOString();
    const patch = status === "unsubscribed"
      ? { status, unsubscribed_at: now, updated_at: now }
      : { status, unsubscribed_at: null, subscribed_at: now, updated_at: now };

    const store = await resolveStore();
    const { data, error } = await store
      .from("email_list_subscribers")
      .update(patch)
      .in("id", ids)
      .select("id");
    if (error) return jsonError(500, `Could not update the subscribers: ${error.message}`);
    return json(200, { success: true, updated: (data ?? []).length });
  }

  if (action === "update") {
    const id = String(body.id ?? "").trim();
    if (!id) return jsonError(400, "A subscriber id is required.");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return jsonError(400, "Enter a valid email address.");
    }
    const firstRaw = body.first_name === undefined || body.first_name === null
      ? ""
      : String(body.first_name).trim();
    const lastRaw = body.last_name === undefined || body.last_name === null
      ? ""
      : String(body.last_name).trim();
    if (firstRaw.length > 120 || lastRaw.length > 120) {
      return jsonError(400, "Names must be 120 characters or fewer.");
    }

    const store = await resolveStore();
    // One canonical row per address: block a rename onto somebody else.
    const clash = await store
      .from("email_list_subscribers")
      .select("id")
      .ilike("email", email)
      .neq("id", id)
      .limit(1);
    if (clash.error) {
      return jsonError(500, `Could not update the subscriber: ${clash.error.message}`);
    }
    if ((clash.data ?? []).length > 0) {
      return jsonError(409, "Another subscriber already uses that email address.");
    }

    const { data, error } = await store
      .from("email_list_subscribers")
      .update({
        email,
        first_name: firstRaw || null,
        last_name: lastRaw || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(SUBSCRIBER_COLUMNS)
      .maybeSingle();
    if (error) return jsonError(500, `Could not update the subscriber: ${error.message}`);
    if (!data) return jsonError(404, "Subscriber not found.");
    return json(200, { success: true, subscriber: data });
  }

  if (action === "delete") {
    const ids = readIds();
    if (ids.length === 0) return jsonError(400, "Select at least one subscriber.");
    const store = await resolveStore();
    const { data, error } = await store
      .from("email_list_subscribers")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) return jsonError(500, `Could not delete the subscribers: ${error.message}`);
    return json(200, { success: true, deleted: (data ?? []).length });
  }

  if (action === "import") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return jsonError(400, "There were no rows to import.");
    if (rows.length > 5000) return jsonError(400, "Import at most 5000 rows at a time.");
    const defaultSource = String(body.source ?? "manual") || "manual";

    const store = await resolveStore();
    let created = 0;
    let updated = 0;
    const failed: string[] = [];

    for (const raw of rows) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const email = String(r.email ?? "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
        failed.push(email || "(blank)");
        continue;
      }
      const wantUnsubscribed = String(r.status ?? "").trim().toLowerCase() === "unsubscribed";
      const res = await upsertSubscriber(store, {
        email,
        first_name: r.first_name ? String(r.first_name).slice(0, 120) : null,
        last_name: r.last_name ? String(r.last_name).slice(0, 120) : null,
        source: r.source ? String(r.source).slice(0, 60) : defaultSource,
        source_page: r.source_page ? String(r.source_page).slice(0, 300) : null,
        consent_text: null,
        consent_version: null,
      });
      if (!res.ok) {
        failed.push(email);
        continue;
      }
      if (res.outcome === "created") created += 1;
      else updated += 1;

      // Imported lists may legitimately carry already-unsubscribed people.
      if (wantUnsubscribed) {
        const now = new Date().toISOString();
        await store
          .from("email_list_subscribers")
          .update({ status: "unsubscribed", unsubscribed_at: now, updated_at: now })
          .ilike("email", email);
      }
    }

    return json(200, {
      success: true,
      created,
      updated,
      skipped: failed.length,
      skipped_emails: failed.slice(0, 20),
    });
  }

  return jsonError(400, "Unknown action");
});
