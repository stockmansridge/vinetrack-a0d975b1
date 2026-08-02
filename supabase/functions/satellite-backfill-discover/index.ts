// satellite-backfill-discover
// Auth: system admin.
// Builds the list of imagery dates VineTrack EXPECTS for each paddock over the
// requested history window, compares it with what is already stored, and
// records every gap in `satellite_expected_dates`. Creates (or reuses) a single
// active `satellite_backfill_jobs` row per vineyard.
//
// Body: { vineyard_id, paddock_ids?: uuid[], history_days?: number,
//         index_types?: string[], max_cloud_pct?: number, auto?: boolean }
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
  parseGeometryRings, computeBbox,
  SENTINEL2_COLLECTION, PROVIDER, CDSE_CATALOG_URL, getCdseAccessTokenWithMetadata,
  CdseConfigError, CdseAuthError, ProviderError,
} from "../_shared/satellite-cdse.ts";

const DEFAULT_HISTORY_DAYS = 180;
const DEFAULT_MAX_CLOUD = 60;
const ACTIVE = ["queued", "discovering", "downloading", "processing"];

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

async function loadPaddocks(vineyardId: string, paddockIds?: string[]) {
  const vtUrl = Deno.env.get("VINETRACK_SUPABASE_URL")!;
  const vtSrk = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!;
  const filter = paddockIds?.length
    ? `&id=in.(${paddockIds.join(",")})`
    : "";
  const res = await fetch(
    `${vtUrl}/rest/v1/paddocks?vineyard_id=eq.${vineyardId}${filter}&select=id,name,polygon_points`,
    { headers: { apikey: vtSrk, Authorization: `Bearer ${vtSrk}` } },
  );
  if (!res.ok) throw new Error("Could not load paddocks.");
  return await res.json() as { id: string; name: string | null; polygon_points: unknown }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const vineyardId: string | undefined = body?.vineyard_id;
  if (!vineyardId) return jsonError(400, "bad_request", "vineyard_id is required");

  const historyDays = Math.min(Math.max(Number(body?.history_days ?? DEFAULT_HISTORY_DAYS), 7), 730);
  const maxCloud = Math.min(Math.max(Number(body?.max_cloud_pct ?? DEFAULT_MAX_CLOUD), 0), 100);
  const indexTypes: string[] = Array.isArray(body?.index_types) && body.index_types.length
    ? body.index_types : [];

  const supa = getServiceClient();

  // One active job per vineyard.
  const { data: existing } = await supa.from("satellite_backfill_jobs").select("*")
    .eq("vineyard_id", vineyardId).in("status", ACTIVE)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return jsonOk({ job: existing, already_running: true });

  let paddocks: { id: string; name: string | null; polygon_points: unknown }[];
  try {
    paddocks = await loadPaddocks(vineyardId, body?.paddock_ids);
  } catch (e) {
    return jsonError(500, "paddock_lookup_failed", (e as Error).message);
  }
  if (!paddocks.length) return jsonError(404, "no_paddocks", "No paddocks found for this vineyard.");

  const { data: job, error: jobErr } = await supa.from("satellite_backfill_jobs").insert({
    vineyard_id: vineyardId,
    requested_paddock_ids: paddocks.map((p) => p.id),
    index_types: indexTypes,
    status: "discovering",
    requested_by: admin.userId,
    auto_scheduled: Boolean(body?.auto),
    paddocks_total: paddocks.length,
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
  }).select("*").single();
  if (jobErr || !job) return jsonError(500, "job_create_failed", jobErr?.message ?? "Could not start job.");

  const end = new Date();
  const start = new Date(Date.now() - historyDays * 86400_000);
  const datetime = `${isoDay(start)}T00:00:00Z/${isoDay(end)}T23:59:59Z`;

  let newest: string | null = null;
  let oldest: string | null = null;
  let missing = 0;
  let skipped = 0;

  try {
    const token = (await getCdseAccessTokenWithMetadata()).token;

    for (const paddock of paddocks) {
      const polys = parseGeometryRings(paddock.polygon_points);
      if (!polys.length) continue;
      const bbox = computeBbox(polys);
      if (!bbox) continue;

      // Provider capture dates for this paddock in the window.
      const features: any[] = [];
      let next: any = { bbox, datetime, collections: [SENTINEL2_COLLECTION], limit: 100 };
      for (let page = 0; page < 8 && next; page++) {
        const res = await fetch(CDSE_CATALOG_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/geo+json, application/json",
          },
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new ProviderError(res.status, "catalog_failed", "Catalog search failed.", null, null);
        const json = await res.json();
        features.push(...(json?.features ?? []));
        const nextToken = json?.context?.next ?? json?.next ?? null;
        next = nextToken ? { ...next, next: nextToken } : null;
      }

      // Newest capture wins per calendar date.
      const byDate = new Map<string, { sceneId: string; acquiredAt: string; cloud: number | null }>();
      for (const f of features) {
        const acquiredAt: string | undefined = f?.properties?.datetime;
        const sceneId: string | undefined = f?.id;
        if (!acquiredAt || !sceneId) continue;
        const day = acquiredAt.slice(0, 10);
        const cloud = Number(f?.properties?.["eo:cloud_cover"]);
        const prev = byDate.get(day);
        if (!prev || acquiredAt > prev.acquiredAt) {
          byDate.set(day, { sceneId, acquiredAt, cloud: Number.isFinite(cloud) ? cloud : null });
        }
      }

      // What is already stored for this paddock?
      const { data: storedScenes } = await supa.from("satellite_scenes")
        .select("id,acquired_at,processing_status")
        .eq("vineyard_id", vineyardId).eq("paddock_id", paddock.id)
        .gte("acquired_at", start.toISOString());
      const storedByDay = new Map<string, { id: string; complete: boolean }>();
      for (const s of storedScenes ?? []) {
        const day = String(s.acquired_at).slice(0, 10);
        storedByDay.set(day, { id: s.id, complete: s.processing_status === "complete" });
      }

      const rows: any[] = [];
      for (const [day, cap] of byDate) {
        if (!newest || day > newest) newest = day;
        if (!oldest || day < oldest) oldest = day;
        const stored = storedByDay.get(day);
        let outcome = "pending";
        if (stored?.complete) { outcome = "downloaded"; skipped++; }
        else if (cap.cloud !== null && cap.cloud > maxCloud) { outcome = "cloud_obscured"; skipped++; }
        else missing++;
        rows.push({
          vineyard_id: vineyardId,
          paddock_id: paddock.id,
          index_type: "ALL",
          expected_date: day,
          provider: PROVIDER,
          outcome,
          satellite_scene_id: stored?.id ?? null,
          resolved_at: outcome === "pending" ? null : new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        });
      }

      if (rows.length) {
        // Never downgrade a date that is already downloaded.
        const { data: current } = await supa.from("satellite_expected_dates")
          .select("expected_date,outcome")
          .eq("vineyard_id", vineyardId).eq("paddock_id", paddock.id).eq("index_type", "ALL");
        const done = new Set((current ?? []).filter((r: any) => r.outcome === "downloaded")
          .map((r: any) => String(r.expected_date)));
        const upsertable = rows.filter((r) => !done.has(r.expected_date) || r.outcome === "downloaded");
        if (upsertable.length) {
          await supa.from("satellite_expected_dates").upsert(upsertable, {
            onConflict: "vineyard_id,paddock_id,index_type,expected_date",
          });
        }
      }

      await supa.from("satellite_backfill_jobs").update({
        heartbeat_at: new Date().toISOString(),
        current_paddock_id: paddock.id,
        missing_dates_found: missing,
        dates_skipped: skipped,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
  } catch (e) {
    const message = e instanceof CdseConfigError || e instanceof CdseAuthError
      ? "Satellite provider credentials are unavailable."
      : ((e as Error)?.message ?? "Discovery failed.");
    await supa.from("satellite_backfill_jobs").update({
      status: "failed", last_error: message.slice(0, 500),
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return jsonError(502, "discovery_failed", message);
  }

  const { data: updated } = await supa.from("satellite_backfill_jobs").update({
    status: missing > 0 ? "queued" : "completed",
    newest_date_checked: newest,
    oldest_date_checked: oldest,
    missing_dates_found: missing,
    dates_skipped: skipped,
    current_paddock_id: null,
    completed_at: missing > 0 ? null : new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", job.id).select("*").single();

  return jsonOk({
    job: updated,
    missing_dates: missing,
    skipped_dates: skipped,
    newest_date_checked: newest,
    oldest_date_checked: oldest,
  });
});
