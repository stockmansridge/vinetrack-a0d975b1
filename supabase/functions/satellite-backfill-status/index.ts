// satellite-backfill-status
// Auth: system admin.
// Returns the active (or most recent) backfill job for a vineyard plus a
// breakdown of expected-date outcomes, so the portal can show accurate
// progress even after a page refresh.
//
// Body: { vineyard_id }
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
} from "../_shared/satellite-cdse.ts";

const ACTIVE = ["queued", "discovering", "downloading", "processing"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const vineyardId: string | undefined = body?.vineyard_id;
  if (!vineyardId) return jsonError(400, "bad_request", "vineyard_id is required");

  const supa = getServiceClient();

  const [{ data: activeJob }, { data: lastJob }, { data: dates }, { data: settings }] = await Promise.all([
    supa.from("satellite_backfill_jobs").select("*").eq("vineyard_id", vineyardId)
      .in("status", ACTIVE).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("satellite_backfill_jobs").select("*").eq("vineyard_id", vineyardId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("satellite_expected_dates").select("outcome,expected_date,paddock_id,last_error")
      .eq("vineyard_id", vineyardId).order("expected_date", { ascending: false }).limit(2000),
    supa.from("satellite_backfill_settings").select("*").eq("vineyard_id", vineyardId).maybeSingle(),
  ]);

  const counts: Record<string, number> = {};
  let newestMissing: string | null = null;
  let oldestMissing: string | null = null;
  for (const row of dates ?? []) {
    const o = String(row.outcome);
    counts[o] = (counts[o] ?? 0) + 1;
    if (o === "pending" || o === "retry_pending" || o === "processing") {
      const d = String(row.expected_date);
      if (!newestMissing || d > newestMissing) newestMissing = d;
      if (!oldestMissing || d < oldestMissing) oldestMissing = d;
    }
  }

  // Per-date rollup so the portal timeline can show every KNOWN date with a
  // status, not just the dates that already have saved imagery.
  const RANK: Record<string, number> = {
    processing: 6, pending: 5, retry_pending: 5, failed: 4,
    downloaded: 3, available: 3, cloud_obscured: 2, invalid_coverage: 2,
    no_provider_capture: 1,
  };
  const byDate = new Map<string, { date: string; outcomes: Record<string, number>; paddocks: number; last_error: string | null }>();
  for (const row of dates ?? []) {
    const d = String(row.expected_date);
    let e = byDate.get(d);
    if (!e) { e = { date: d, outcomes: {}, paddocks: 0, last_error: null }; byDate.set(d, e); }
    const o = String(row.outcome);
    e.outcomes[o] = (e.outcomes[o] ?? 0) + 1;
    e.paddocks += 1;
    if (row.last_error && !e.last_error) e.last_error = String(row.last_error);
  }
  const expectedDates = Array.from(byDate.values()).map((e) => {
    let dominant = "pending";
    let best = -1;
    for (const [o, n] of Object.entries(e.outcomes)) {
      const r = (RANK[o] ?? 0) * 1000 + n;
      if (r > best) { best = r; dominant = o; }
    }
    const downloaded = (e.outcomes.downloaded ?? 0) + (e.outcomes.available ?? 0);
    return {
      date: e.date,
      status: dominant,
      outcomes: e.outcomes,
      paddocks_total: e.paddocks,
      paddocks_downloaded: downloaded,
      last_error: e.last_error,
    };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));

  const missing = (counts.pending ?? 0) + (counts.retry_pending ?? 0) + (counts.processing ?? 0);
  const done = counts.downloaded ?? 0;
  const total = (dates ?? []).length;

  return jsonOk({
    active_job: activeJob ?? null,
    last_job: lastJob ?? null,
    settings: settings ?? null,
    outcome_counts: counts,
    expected_dates: expectedDates,
    expected_date_total: total,
    missing_dates: missing,
    downloaded_dates: done,
    newest_missing_date: newestMissing,
    oldest_missing_date: oldestMissing,
    percent_complete: total > 0 ? Math.round((done / total) * 100) : 0,
  });
});
