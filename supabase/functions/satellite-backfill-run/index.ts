// satellite-backfill-run
// Auth: system admin.
// Processes the next batch of missing imagery dates for an active backfill job,
// NEWEST MISSING FIRST, by delegating each date to satellite-process-scene.
// Safe to call repeatedly: each call claims a small batch, updates progress and
// returns how much work remains, so the job survives page refreshes.
//
// Body: { job_id?: uuid, vineyard_id?: uuid, batch_size?: number }
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
  SENTINEL2_COLLECTION, CDSE_CATALOG_URL, getCdseAccessTokenWithMetadata,
} from "../_shared/satellite-cdse.ts";

const ACTIVE = ["queued", "discovering", "downloading", "processing"];
const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const batchSize = Math.min(Math.max(Number(body?.batch_size ?? 2), 1), 5);

  const supa = getServiceClient();

  let jobQuery = supa.from("satellite_backfill_jobs").select("*");
  if (body?.job_id) jobQuery = jobQuery.eq("id", body.job_id);
  else if (body?.vineyard_id) jobQuery = jobQuery.eq("vineyard_id", body.vineyard_id).in("status", ACTIVE);
  else return jsonError(400, "bad_request", "job_id or vineyard_id is required");

  const { data: job } = await jobQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!job) return jsonError(404, "job_not_found", "No backfill job found.");
  if (!ACTIVE.includes(job.status)) {
    return jsonOk({ job, remaining: 0, processed: [], finished: true });
  }

  const nowIso = () => new Date().toISOString();

  // Claim the next batch — newest missing date first.
  const { data: pending } = await supa.from("satellite_expected_dates")
    .select("*")
    .eq("vineyard_id", job.vineyard_id)
    .in("outcome", ["pending", "retry_pending"])
    .in("paddock_id", job.requested_paddock_ids ?? [])
    .lt("attempts", MAX_ATTEMPTS)
    .order("expected_date", { ascending: false })
    .limit(batchSize);

  if (!pending?.length) {
    const { data: failedLeft } = await supa.from("satellite_expected_dates")
      .select("id", { count: "exact", head: false })
      .eq("vineyard_id", job.vineyard_id).eq("outcome", "failed").limit(1);
    const { data: finished } = await supa.from("satellite_backfill_jobs").update({
      status: (job.dates_failed ?? 0) > 0 || failedLeft?.length ? "completed_with_warnings" : "completed",
      completed_at: nowIso(), current_processing_date: null, current_paddock_id: null,
      heartbeat_at: nowIso(), updated_at: nowIso(),
    }).eq("id", job.id).select("*").single();
    return jsonOk({ job: finished, remaining: 0, processed: [], finished: true });
  }

  await supa.from("satellite_backfill_jobs").update({
    status: "processing", heartbeat_at: nowIso(), updated_at: nowIso(),
  }).eq("id", job.id);

  const authHeader = req.headers.get("Authorization") ?? "";
  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const token = (await getCdseAccessTokenWithMetadata()).token;

  const processed: any[] = [];
  let completed = job.dates_completed ?? 0;
  let failedCount = job.dates_failed ?? 0;
  let skipped = job.dates_skipped ?? 0;

  for (const item of pending) {
    await supa.from("satellite_expected_dates").update({
      outcome: "processing", attempts: (item.attempts ?? 0) + 1, updated_at: nowIso(),
    }).eq("id", item.id);
    await supa.from("satellite_backfill_jobs").update({
      current_processing_date: item.expected_date,
      current_paddock_id: item.paddock_id,
      heartbeat_at: nowIso(), updated_at: nowIso(),
    }).eq("id", job.id);

    try {
      // Resolve the provider scene for that exact date + paddock.
      const { data: pad } = await supa.from("satellite_scenes")
        .select("bbox_west").limit(0); // no-op keeps type inference simple
      void pad;

      const vtUrl = Deno.env.get("VINETRACK_SUPABASE_URL")!;
      const vtSrk = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!;
      const padRes = await fetch(
        `${vtUrl}/rest/v1/paddocks?id=eq.${item.paddock_id}&select=id,polygon_points`,
        { headers: { apikey: vtSrk, Authorization: `Bearer ${vtSrk}` } },
      );
      const [paddock] = padRes.ok ? await padRes.json() : [null];
      if (!paddock) throw new Error("Paddock not found.");

      const { parseGeometryRings, computeBbox } = await import("../_shared/satellite-cdse.ts");
      const polys = parseGeometryRings(paddock.polygon_points);
      const bbox = computeBbox(polys);
      if (!bbox) throw new Error("Paddock geometry is invalid.");

      const catalogRes = await fetch(CDSE_CATALOG_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/geo+json, application/json",
        },
        body: JSON.stringify({
          bbox,
          datetime: `${item.expected_date}T00:00:00Z/${item.expected_date}T23:59:59Z`,
          collections: [SENTINEL2_COLLECTION],
          limit: 5,
        }),
      });
      if (!catalogRes.ok) throw new Error(`Provider catalog error (${catalogRes.status}).`);
      const catalog = await catalogRes.json();
      const feature = (catalog?.features ?? [])
        .sort((a: any, b: any) => String(b?.properties?.datetime).localeCompare(String(a?.properties?.datetime)))[0];

      if (!feature) {
        await supa.from("satellite_expected_dates").update({
          outcome: "no_provider_capture", resolved_at: nowIso(), updated_at: nowIso(),
        }).eq("id", item.id);
        skipped++;
        processed.push({ paddock_id: item.paddock_id, date: item.expected_date, outcome: "no_provider_capture" });
        continue;
      }

      const procRes = await fetch(`${baseUrl}/functions/v1/satellite-process-scene`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          ...(anon ? { apikey: anon } : {}),
        },
        body: JSON.stringify({
          vineyard_id: job.vineyard_id,
          paddock_id: item.paddock_id,
          provider_scene_id: feature.id,
          acquired_at: feature?.properties?.datetime,
          scene_cloud_cover_pct: feature?.properties?.["eo:cloud_cover"] ?? null,
          ...(job.index_types?.length ? { requested_index_types: job.index_types } : {}),
        }),
      });
      const procJson = await procRes.json().catch(() => ({}));
      const status = procJson?.status ?? (procRes.ok ? "complete" : "failed");

      if (procRes.ok && (status === "complete" || status === "partial")) {
        await supa.from("satellite_expected_dates").update({
          outcome: "downloaded", satellite_scene_id: procJson?.scene_id ?? null,
          resolved_at: nowIso(), last_error: status === "partial" ? "Some layers unavailable." : null,
          updated_at: nowIso(),
        }).eq("id", item.id);
        completed++;
        processed.push({ paddock_id: item.paddock_id, date: item.expected_date, outcome: status });
      } else if (status === "rate_limited") {
        // Back off: leave the date for the next run without burning an attempt.
        await supa.from("satellite_expected_dates").update({
          outcome: "retry_pending", attempts: item.attempts ?? 0,
          next_retry_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          last_error: "Provider rate limit reached.", updated_at: nowIso(),
        }).eq("id", item.id);
        processed.push({ paddock_id: item.paddock_id, date: item.expected_date, outcome: "rate_limited" });
        break;
      } else {
        const attempts = (item.attempts ?? 0) + 1;
        const msg = String(procJson?.message ?? procJson?.error ?? "Processing failed.").slice(0, 400);
        await supa.from("satellite_expected_dates").update({
          outcome: attempts >= MAX_ATTEMPTS ? "failed" : "retry_pending",
          next_retry_at: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + 60_000).toISOString(),
          last_error: msg, updated_at: nowIso(),
        }).eq("id", item.id);
        if (attempts >= MAX_ATTEMPTS) failedCount++;
        processed.push({ paddock_id: item.paddock_id, date: item.expected_date, outcome: "failed", error: msg });
      }
    } catch (e) {
      const attempts = (item.attempts ?? 0) + 1;
      const msg = ((e as Error)?.message ?? "Processing failed.").slice(0, 400);
      await supa.from("satellite_expected_dates").update({
        outcome: attempts >= MAX_ATTEMPTS ? "failed" : "retry_pending",
        last_error: msg, updated_at: nowIso(),
      }).eq("id", item.id);
      if (attempts >= MAX_ATTEMPTS) failedCount++;
      processed.push({ paddock_id: item.paddock_id, date: item.expected_date, outcome: "failed", error: msg });
    }
  }

  const { count: remaining } = await supa.from("satellite_expected_dates")
    .select("id", { count: "exact", head: true })
    .eq("vineyard_id", job.vineyard_id)
    .in("outcome", ["pending", "retry_pending", "processing"])
    .lt("attempts", MAX_ATTEMPTS);

  const finished = (remaining ?? 0) === 0;
  const { data: updatedJob } = await supa.from("satellite_backfill_jobs").update({
    status: finished ? (failedCount > 0 ? "completed_with_warnings" : "completed") : "processing",
    dates_completed: completed,
    dates_failed: failedCount,
    dates_skipped: skipped,
    completed_at: finished ? nowIso() : null,
    current_processing_date: finished ? null : job.current_processing_date,
    current_paddock_id: finished ? null : job.current_paddock_id,
    heartbeat_at: nowIso(), updated_at: nowIso(),
  }).eq("id", job.id).select("*").single();

  return jsonOk({ job: updatedJob, processed, remaining: remaining ?? 0, finished });
});
