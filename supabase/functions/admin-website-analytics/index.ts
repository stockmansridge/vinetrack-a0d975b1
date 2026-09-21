// System-admin only: aggregated Website Analytics report.
//
// Same secure admin pattern as admin-email-list: the caller's VineTrack JWT is
// verified and public.is_system_admin() must be true, then all reads happen on
// the canonical VineTrack database with its service role.
//
// Aggregation happens HERE (server-side) — the browser only ever receives
// summary totals and series, never raw page-view rows.
//
// POST { action: "report", date_from, date_to, granularity, environment? }
//   -> { summary, traffic_series, contact_series, pages, meta }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildAnalyticsReport,
  localDate,
  REPORT_TZ,
  WEBSITE_SUBSCRIBER_SOURCES,
  type Granularity,
} from "../_shared/website-analytics-agg.ts";

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

const MAX_ROWS = 100_000;
const PAGE = 1000;

// deno-lint-ignore no-explicit-any
type Client = any;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" ||
    /does not exist|could not find the table|schema cache/i.test(error.message ?? "");
}

/** Page through a filtered range so the report is never silently truncated. */
async function fetchAll(
  client: Client,
  table: string,
  columns: string,
  apply: (q: Client) => Client,
): Promise<{ rows: Record<string, unknown>[]; missingTable: boolean; error?: string }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await apply(client.from(table).select(columns))
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return { rows, missingTable: isMissingTable(error), error: error.message };
    }
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { rows, missingTable: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_ANON = Deno.env.get("VINETRACK_ANON_KEY");
  const VT_SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  if (!VT_URL || !VT_ANON || !VT_SERVICE) return jsonError(503, "Backend is not configured.");

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
  const action = String(body.action ?? "report");
  if (action !== "report") return jsonError(400, "Unknown action");

  const granularityRaw = String(body.granularity ?? "day");
  const granularity: Granularity = granularityRaw === "month" || granularityRaw === "year"
    ? granularityRaw
    : "day";

  const environment = String(body.environment ?? "production") === "preview"
    ? "preview"
    : "production";

  // ISO instants bounding the reporting window. The website only started
  // sending events recently, so "All time" is simply a very early date_from.
  const dateFrom = String(body.date_from ?? "");
  const dateTo = String(body.date_to ?? "");
  const fromIso = dateFrom ? new Date(dateFrom).toISOString() : new Date(0).toISOString();
  const toIso = dateTo ? new Date(dateTo).toISOString() : new Date().toISOString();
  if (Number.isNaN(new Date(fromIso).getTime()) || Number.isNaN(new Date(toIso).getTime())) {
    return jsonError(400, "Invalid date range.");
  }

  const admin = createClient(VT_URL, VT_SERVICE, { auth: { persistSession: false } });
  const inRange = (q: Client) => q.gte("created_at", fromIso).lte("created_at", toIso);

  const [views, demos, subs, priorDemos, priorSubs] = await Promise.all([
    fetchAll(admin, "website_page_views", "created_at, page_path, session_id", (q) =>
      inRange(q).eq("environment", environment)),
    fetchAll(admin, "support_requests", "created_at, submitter_email", (q) =>
      inRange(q).eq("category", "website_demo")),
    fetchAll(admin, "email_list_subscribers", "created_at, email, source", (q) =>
      inRange(q).in("source", WEBSITE_SUBSCRIBER_SOURCES)),
    fetchAll(admin, "support_requests", "submitter_email", (q) =>
      q.lt("created_at", fromIso).eq("category", "website_demo")),
    fetchAll(admin, "email_list_subscribers", "email", (q) =>
      q.lt("created_at", fromIso).in("source", WEBSITE_SUBSCRIBER_SOURCES)),
  ]);

  if (demos.error && !demos.missingTable) {
    return jsonError(500, `Could not load demo requests: ${demos.error}`);
  }

  const priorContacts = [
    ...priorDemos.rows.map((r) => String(r.submitter_email ?? "")),
    ...priorSubs.rows.map((r) => String(r.email ?? "")),
  ].filter(Boolean);

  const report = buildAnalyticsReport({
    // deno-lint-ignore no-explicit-any
    pageViews: views.rows as any,
    // deno-lint-ignore no-explicit-any
    demoRequests: demos.rows as any,
    // deno-lint-ignore no-explicit-any
    subscribers: subs.rows as any,
    priorContacts,
    granularity,
    fromDay: localDate(fromIso),
    toDay: localDate(toIso),
  });

  return json(200, {
    ...report,
    meta: {
      timezone: REPORT_TZ,
      granularity,
      environment,
      date_from: fromIso,
      date_to: toIso,
      // True until sql/243 has been applied to the canonical VineTrack database.
      traffic_table_pending: views.missingTable,
      subscribers_table_pending: subs.missingTable,
    },
  });
});
