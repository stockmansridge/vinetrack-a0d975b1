// satellite-get-manifest
// Auth: system admin. Returns the per-paddock imagery manifest for a vineyard,
// PLUS a vineyard-level date-coverage index so the frontend never has to
// reconstruct the Image Date selector from raw scenes/assets/summaries.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
} from "../_shared/satellite-cdse.ts";

// Keep in sync with src/lib/satelliteCompleteness.ts and satellite-cdse.ts.
const CURRENT_PROCESSING_VERSION = "sentinel2-v3-eleven-layers";

type SceneRow = {
  id: string;
  paddock_id: string;
  acquired_at: string;
  processing_status: string;
  scene_cloud_cover_pct: number | null;
  paddock_valid_coverage_pct: number | null;
  paddock_cloud_cover_pct: number | null;
  provider_scene_id: string | null;
};
type AssetRow = {
  id: string;
  satellite_scene_id: string;
  index_type: string;
  asset_type: string | null;
  processing_version: string | null;
  storage_path: string | null;
  mime_type: string | null;
  bounds: { north: number; south: number; east: number; west: number } | null;
  raster_width: number | null;
  raster_height: number | null;
  native_resolution_m: number | null;
  display_resolution_m: number | null;
  data_type: string | null;
  scale_factor: number | null;
  no_data_sentinel: number | null;
  row_orientation: string | null;
  minimum_value: number | null;
  maximum_value: number | null;
  colour_scale: unknown;
  acquisition_date: string | null;
};

type SummaryRow = {
  satellite_scene_id: string;
  index_type: string;
  processing_version: string | null;
  mean_value: number | null;
  median_value: number | null;
  minimum_value: number | null;
  maximum_value: number | null;
  standard_deviation: number | null;
  percentile_10: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  percentile_90: number | null;
};

type LayerAsset = {
  asset_id: string;
  index_type: string;
  asset_type: "DISPLAY_RASTER" | "ANALYTICAL_RASTER";
  processing_version: string | null;
  storage_path: string | null;
  mime_type: string | null;
  bounds: { north: number; south: number; east: number; west: number } | null;
  raster_width: number | null;
  raster_height: number | null;
  native_resolution_m: number | null;
  display_resolution_m: number | null;
  data_type: string | null;
  scale_factor: number | null;
  no_data_sentinel: number | null;
  row_orientation: string | null;
  colour_scale: unknown;
  etag: string;
};

type LayerSummary = {
  mean_value: number | null;
  median_value: number | null;
  minimum_value: number | null;
  maximum_value: number | null;
  standard_deviation: number | null;
  percentile_10: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  percentile_90: number | null;
};

type LayerBundle = {
  index_type: string;
  display: LayerAsset | null;
  analytical: LayerAsset | null;
  summary: LayerSummary | null;
};

type PerPaddock = {
  paddock_id: string;
  scene_id: string;
  provider_scene_id: string | null;
  provider: string;
  acquired_at: string;
  acquisition_date: string;
  processing_version: string | null;
  paddock_valid_coverage_pct: number | null;
  paddock_cloud_cover_pct: number | null;
  scene_cloud_cover_pct: number | null;
  available_display_layers: string[];
  available_analytical_layers: string[];
  package_version_mismatch: boolean;
  layers: LayerBundle[];
};

type MissingPaddock = {
  paddock_id: string;
  reason: "no_scene_for_date" | "scene_not_complete" | "package_version_mismatch";
};

const PROVIDER_CHECK_INTERVAL_DAYS = 5;

type ProviderCheckStatus =
  | "never_checked" | "checked_recently" | "check_due" | "checking" | "failed";

type ProviderFreshness = {
  last_provider_check_at: string | null;
  last_provider_check_status: string | null;
  next_recommended_provider_check_at: string | null;
  provider_check_interval_days: number;
  provider_check_status: ProviderCheckStatus;
  active_job_id: string | null;
};

type DateCoverageEntry = {
  acquisition_date: string; // YYYY-MM-DD
  active_paddock_count: number;
  available_paddock_count: number;
  coverage_percent: number;
  available_paddock_ids: string[];
  missing_paddock_ids: string[];
  missing_paddocks: MissingPaddock[];
  paddocks: PerPaddock[];
  updated_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const vineyard_id: string | undefined = body?.vineyard_id;
  if (!vineyard_id) return jsonError(400, "bad_request", "vineyard_id is required");

  // Client supplies the currently active paddock IDs (from the VineTrack iOS
  // project's paddocks table). If missing, we still return coverage but based
  // only on paddocks that appear in the satellite tables.
  const clientActivePaddockIds: string[] = Array.isArray(body?.active_paddock_ids)
    ? body.active_paddock_ids.filter((v: unknown): v is string => typeof v === "string")
    : [];

  const supa = getServiceClient();

  // ---- Per-paddock manifest (existing behaviour) --------------------------
  const { data: manifestRows, error: manifestErr } = await supa
    .from("satellite_paddock_manifest")
    .select("*")
    .eq("vineyard_id", vineyard_id);
  if (manifestErr) return jsonError(500, "read_failed", manifestErr.message);

  // ---- Scenes + assets for the date-coverage index ------------------------
  const { data: scenes, error: scErr } = await supa
    .from("satellite_scenes")
    .select("id, paddock_id, acquired_at, processing_status, scene_cloud_cover_pct, paddock_valid_coverage_pct, paddock_cloud_cover_pct, provider_scene_id, updated_at")
    .eq("vineyard_id", vineyard_id);
  if (scErr) return jsonError(500, "read_failed", scErr.message);
  const sceneRows = (scenes ?? []) as (SceneRow & { updated_at: string })[];

  const sceneIds = sceneRows.map((s) => s.id);
  let assetRows: AssetRow[] = [];
  let summaryRows: SummaryRow[] = [];
  if (sceneIds.length > 0) {
    // Chunk in case of very long IN lists.
    const CHUNK = 500;
    for (let i = 0; i < sceneIds.length; i += CHUNK) {
      const slice = sceneIds.slice(i, i + CHUNK);
      const [{ data: assets, error: aErr }, { data: sums, error: sErr }] = await Promise.all([
        supa.from("satellite_raster_assets")
          .select("id, satellite_scene_id, index_type, asset_type, processing_version, storage_path, mime_type, bounds, raster_width, raster_height, native_resolution_m, display_resolution_m, data_type, scale_factor, no_data_sentinel, row_orientation, minimum_value, maximum_value, colour_scale, acquisition_date")
          .in("satellite_scene_id", slice),
        supa.from("satellite_index_summaries")
          .select("satellite_scene_id, index_type, processing_version, mean_value, median_value, minimum_value, maximum_value, standard_deviation, percentile_10, percentile_25, percentile_75, percentile_90")
          .in("satellite_scene_id", slice),
      ]);
      if (aErr) return jsonError(500, "read_failed", aErr.message);
      if (sErr) return jsonError(500, "read_failed", sErr.message);
      assetRows = assetRows.concat((assets ?? []) as AssetRow[]);
      summaryRows = summaryRows.concat((sums ?? []) as SummaryRow[]);
    }
  }

  const inferKind = (a: AssetRow): "DISPLAY_RASTER" | "ANALYTICAL_RASTER" =>
    a.asset_type === "DISPLAY_RASTER" || a.asset_type === "ANALYTICAL_RASTER"
      ? a.asset_type as "DISPLAY_RASTER" | "ANALYTICAL_RASTER"
      : (a.storage_path?.endsWith(".png") ? "DISPLAY_RASTER" : "ANALYTICAL_RASTER");

  // Index assets by scene, split by DISPLAY_RASTER / ANALYTICAL_RASTER at the
  // current processing version. Track whether an older-version asset was seen
  // so we can flag package_version_mismatch.
  const displayByScene = new Map<string, Set<string>>();
  const analyticalByScene = new Map<string, Set<string>>();
  const anyDisplayByScene = new Map<string, Set<string>>();
  const olderVersionByScene = new Map<string, Set<string>>();
  const currentVersionByScene = new Map<string, Set<string>>();
  // Per-scene, per-index full asset rows (current version only). Keyed by
  // `${sceneId}:${indexType}:${kind}` -> AssetRow.
  const assetByKey = new Map<string, AssetRow>();
  for (const a of assetRows) {
    const kind = inferKind(a);
    if (kind === "DISPLAY_RASTER") {
      const s = anyDisplayByScene.get(a.satellite_scene_id) ?? new Set<string>();
      s.add(a.index_type);
      anyDisplayByScene.set(a.satellite_scene_id, s);
    }
    if ((a.processing_version ?? "") === CURRENT_PROCESSING_VERSION) {
      const target = kind === "DISPLAY_RASTER" ? displayByScene : analyticalByScene;
      const s = target.get(a.satellite_scene_id) ?? new Set<string>();
      s.add(a.index_type);
      target.set(a.satellite_scene_id, s);
      const cv = currentVersionByScene.get(a.satellite_scene_id) ?? new Set<string>();
      cv.add(a.index_type);
      currentVersionByScene.set(a.satellite_scene_id, cv);
      assetByKey.set(`${a.satellite_scene_id}:${a.index_type}:${kind}`, a);
    } else {
      const s = olderVersionByScene.get(a.satellite_scene_id) ?? new Set<string>();
      s.add(String(a.processing_version ?? "unknown"));
      olderVersionByScene.set(a.satellite_scene_id, s);
    }
  }
  // Per-scene, per-index summaries at the current version.
  const summaryByKey = new Map<string, SummaryRow>();
  for (const s of summaryRows) {
    if ((s.processing_version ?? "") !== CURRENT_PROCESSING_VERSION) continue;
    summaryByKey.set(`${s.satellite_scene_id}:${s.index_type}`, s);
  }

  const toLayerAsset = (a: AssetRow): LayerAsset => ({
    asset_id: a.id,
    index_type: a.index_type,
    asset_type: inferKind(a),
    processing_version: a.processing_version,
    storage_path: a.storage_path,
    mime_type: a.mime_type,
    bounds: a.bounds,
    raster_width: a.raster_width,
    raster_height: a.raster_height,
    native_resolution_m: a.native_resolution_m,
    display_resolution_m: a.display_resolution_m,
    data_type: a.data_type,
    scale_factor: a.scale_factor,
    no_data_sentinel: a.no_data_sentinel,
    row_orientation: a.row_orientation,
    colour_scale: a.colour_scale,
    etag: `${a.id}:${a.processing_version ?? "unknown"}`,
  });


  // ---- Same-day best-scene selection --------------------------------------
  // Group all scenes by acquisition day. Per (date, paddock) pick one best
  // scene: (1) highest paddock_valid_coverage_pct, (2) lowest
  // paddock_cloud_cover_pct, (3) current-version display asset preferred over
  // older-only, (4) newest acquired_at.
  const preferCurrent = (id: string): number =>
    currentVersionByScene.has(id) ? 1 : (anyDisplayByScene.has(id) ? 0 : -1);
  const better = (a: SceneRow, b: SceneRow): SceneRow => {
    const cov = (b.paddock_valid_coverage_pct ?? -1) - (a.paddock_valid_coverage_pct ?? -1);
    if (cov > 0) return b; if (cov < 0) return a;
    const cl = (a.paddock_cloud_cover_pct ?? 101) - (b.paddock_cloud_cover_pct ?? 101);
    if (cl > 0) return b; if (cl < 0) return a;
    const pv = preferCurrent(b.id) - preferCurrent(a.id);
    if (pv > 0) return b; if (pv < 0) return a;
    return b.acquired_at > a.acquired_at ? b : a;
  };

  type PaddockDateBucket = {
    best: SceneRow | null;      // best COMPLETE scene
    hasIncomplete: boolean;     // any non-complete scene row
    updatedAt: string;
  };
  const perDate = new Map<string, Map<string, PaddockDateBucket>>(); // date -> paddock -> bucket
  const paddocksSeenInScenes = new Set<string>();
  for (const s of sceneRows) {
    paddocksSeenInScenes.add(s.paddock_id);
    const date = s.acquired_at.slice(0, 10);
    let per = perDate.get(date);
    if (!per) { per = new Map(); perDate.set(date, per); }
    const cur = per.get(s.paddock_id) ?? { best: null, hasIncomplete: false, updatedAt: s.updated_at };
    if (s.processing_status !== "complete") {
      cur.hasIncomplete = true;
    } else {
      cur.best = cur.best ? better(cur.best, s) : s;
    }
    if (s.updated_at > cur.updatedAt) cur.updatedAt = s.updated_at;
    per.set(s.paddock_id, cur);
  }

  // Determine the active paddock set. Prefer the client-supplied list (matches
  // the VineTrack paddocks table); otherwise fall back to the union of paddocks
  // that appear in this vineyard's satellite tables.
  const activePaddockIds = clientActivePaddockIds.length > 0
    ? Array.from(new Set(clientActivePaddockIds))
    : Array.from(new Set([
        ...paddocksSeenInScenes,
        ...(manifestRows ?? []).map((r: any) => String(r.paddock_id)),
      ]));

  const date_coverage: DateCoverageEntry[] = [];
  for (const [date, per] of perDate.entries()) {
    const available: PerPaddock[] = [];
    const missing: MissingPaddock[] = [];
    for (const pid of activePaddockIds) {
      const bucket = per.get(pid);
      if (!bucket || !bucket.best) {
        if (!bucket) {
          missing.push({ paddock_id: pid, reason: "no_scene_for_date" });
        } else if (bucket.hasIncomplete) {
          missing.push({ paddock_id: pid, reason: "scene_not_complete" });
        } else {
          missing.push({ paddock_id: pid, reason: "no_scene_for_date" });
        }
        continue;
      }
      const sceneId = bucket.best.id;
      const dispSet = displayByScene.get(sceneId) ?? new Set<string>();
      const analSet = analyticalByScene.get(sceneId) ?? new Set<string>();
      const hasCurrentDisplay = dispSet.size > 0;
      const versionMismatch = !hasCurrentDisplay && (anyDisplayByScene.get(sceneId)?.size ?? 0) > 0;
      if (!hasCurrentDisplay && versionMismatch) {
        missing.push({ paddock_id: pid, reason: "package_version_mismatch" });
        continue;
      }
      available.push({
        paddock_id: pid,
        scene_id: sceneId,
        provider_scene_id: bucket.best.provider_scene_id,
        acquired_at: bucket.best.acquired_at,
        processing_version: hasCurrentDisplay ? CURRENT_PROCESSING_VERSION : null,
        paddock_valid_coverage_pct: bucket.best.paddock_valid_coverage_pct,
        paddock_cloud_cover_pct: bucket.best.paddock_cloud_cover_pct,
        available_display_layers: Array.from(dispSet).sort(),
        available_analytical_layers: Array.from(analSet).sort(),
        package_version_mismatch: false,
      });
    }
    const activeCount = activePaddockIds.length;
    const coveragePercent = activeCount > 0
      ? Math.round((available.length / activeCount) * 1000) / 10
      : 0;
    date_coverage.push({
      acquisition_date: date,
      active_paddock_count: activeCount,
      available_paddock_count: available.length,
      coverage_percent: coveragePercent,
      available_paddock_ids: available.map((p) => p.paddock_id),
      missing_paddock_ids: missing.map((m) => m.paddock_id),
      missing_paddocks: missing,
      paddocks: available,
      updated_at: Array.from(per.values()).reduce((acc, b) => b.updatedAt > acc ? b.updatedAt : acc, ""),
    });
  }
  date_coverage.sort((a, b) => b.acquisition_date.localeCompare(a.acquisition_date));

  // Recommended default date: newest with full active coverage; else newest
  // with the highest available count.
  const active = activePaddockIds.length;
  let recommended_default_date: string | null = null;
  if (date_coverage.length > 0) {
    const full = date_coverage.find((d) => active > 0 && d.available_paddock_count >= active);
    if (full) recommended_default_date = full.acquisition_date;
    else {
      const best = [...date_coverage].sort((a, b) =>
        b.available_paddock_count - a.available_paddock_count
        || b.acquisition_date.localeCompare(a.acquisition_date))[0];
      recommended_default_date = best?.acquisition_date ?? null;
    }
  }

  const dates = date_coverage.map((d) => d.acquisition_date);
  const manifestUpdated = (manifestRows ?? []).reduce<string | null>((acc, r: any) => {
    const u = r.updated_at as string | null;
    if (!u) return acc;
    return !acc || u > acc ? u : acc;
  }, null);
  const sceneUpdated = date_coverage.reduce<string | null>((acc, d) =>
    !acc || (d.updated_at && d.updated_at > acc) ? d.updated_at : acc, null);
  const updated_at = [manifestUpdated, sceneUpdated].filter(Boolean).sort().pop() ?? null;

  // ---- Provider freshness (Copernicus check state) -----------------------
  // Best-effort: expire stale locks first so we don't report ghost 'checking'.
  try { await (supa as any).rpc("expire_stale_refresh_jobs"); } catch { /* ignore */ }
  const { data: providerJobs } = await supa
    .from("satellite_refresh_jobs")
    .select("id, status, started_at, completed_at, heartbeat_at, job_type")
    .eq("vineyard_id", vineyard_id)
    .eq("job_type", "provider_refresh")
    .order("started_at", { ascending: false })
    .limit(10);

  const jobsArr = (providerJobs ?? []) as Array<{ id: string; status: string; started_at: string | null; completed_at: string | null; heartbeat_at: string | null }>;
  const activeJob = jobsArr.find((j) => j.status === "queued" || j.status === "running") ?? null;
  const lastSuccess = jobsArr.find((j) => (j.status === "complete" || j.status === "partial") && !!j.completed_at) ?? null;
  const mostRecentTerminal = jobsArr.find((j) => j.status !== "queued" && j.status !== "running") ?? null;
  const failureAfterSuccess = mostRecentTerminal
    && (mostRecentTerminal.status === "failed" || mostRecentTerminal.status === "expired")
    && (!lastSuccess || (mostRecentTerminal.completed_at ?? "") > (lastSuccess.completed_at ?? ""));

  const nowMs = Date.now();
  const lastMs = lastSuccess?.completed_at ? new Date(lastSuccess.completed_at).getTime() : NaN;
  const ageDays = Number.isFinite(lastMs) ? (nowMs - lastMs) / 86400_000 : Infinity;
  let providerStatus: ProviderCheckStatus;
  if (activeJob) providerStatus = "checking";
  else if (failureAfterSuccess) providerStatus = "failed";
  else if (!lastSuccess) providerStatus = "never_checked";
  else if (ageDays < PROVIDER_CHECK_INTERVAL_DAYS) providerStatus = "checked_recently";
  else providerStatus = "check_due";

  const nextRecommended = lastSuccess?.completed_at
    ? new Date(new Date(lastSuccess.completed_at).getTime() + PROVIDER_CHECK_INTERVAL_DAYS * 86400_000).toISOString()
    : null;

  const provider_freshness: ProviderFreshness = {
    last_provider_check_at: lastSuccess?.completed_at ?? null,
    last_provider_check_status: lastSuccess?.status ?? (mostRecentTerminal?.status ?? null),
    next_recommended_provider_check_at: nextRecommended,
    provider_check_interval_days: PROVIDER_CHECK_INTERVAL_DAYS,
    provider_check_status: providerStatus,
    active_job_id: activeJob?.id ?? null,
  };

  return jsonOk({
    manifest_version: "v2",
    vineyard_id,
    updated_at,
    paddocks: manifestRows ?? [],
    date_coverage,
    recommended_default_date,
    newest_saved_date: dates[0] ?? null,
    oldest_saved_date: dates[dates.length - 1] ?? null,
    total_saved_dates: dates.length,
    provider_freshness,
    stats: {
      scene_rows_scanned: sceneRows.length,
      asset_rows_scanned: assetRows.length,
    },
  });
});
