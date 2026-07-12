// satellite-backfill-analytical (now: general layer backfill)
// Auth: system admin. For completed Sentinel-2 scenes that pre-date
// `sentinel2-v3-eleven-layers`, generate any missing per-layer assets:
//   - display raster (PNG)
//   - analytical raster (Float32 GeoTIFF, native resolution)
//   - statistical summary
// Reuses the existing scene + acquisition. Idempotent upserts keyed by
// (scene, index_type, asset_type, processing_version). Never re-renders an
// asset that already exists at the new version.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
  parseGeometryRings, toGeoJson, computeBbox, computeImageSize,
  evalscriptFor, statsEvalscript, analyticalEvalscript,
  processImage, processAnalyticalRaster, statisticsQuery,
  INDEX_TYPES, INDEX_NATIVE_RES_M, INDEX_BANDS, QC, PROCESSING_VERSION,
  DISPLAY_ASSET_TYPE, ANALYTICAL_ASSET_TYPE, ANALYTICAL_NO_DATA_SENTINEL, ANALYTICAL_ROW_ORIENTATION,
  CdseConfigError, CdseAuthError, ProviderError,
  type IndexType,
} from "../_shared/satellite-cdse.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const { vineyard_id, paddock_id, scene_ids, max_scenes } = body ?? {};
  if (!vineyard_id) return jsonError(400, "bad_request", "vineyard_id is required");

  const supa = getServiceClient();

  let sceneQ = supa.from("satellite_scenes")
    .select("id, vineyard_id, paddock_id, provider_scene_id, acquired_at")
    .eq("vineyard_id", vineyard_id)
    .eq("processing_status", "complete")
    .order("acquired_at", { ascending: false })
    .limit(typeof max_scenes === "number" ? max_scenes : 80);
  if (paddock_id && paddock_id !== "all") sceneQ = sceneQ.eq("paddock_id", paddock_id);
  if (Array.isArray(scene_ids) && scene_ids.length) sceneQ = sceneQ.in("id", scene_ids);
  const { data: scenes, error: sErr } = await sceneQ;
  if (sErr) return jsonError(500, "read_failed", sErr.message);
  if (!scenes || scenes.length === 0) {
    return jsonOk({ scanned: 0, backfilled: 0, skipped: 0, failures: [] });
  }

  const { data: existingAssets } = await supa.from("satellite_raster_assets")
    .select("satellite_scene_id, index_type, asset_type, processing_version, storage_path")
    .in("satellite_scene_id", scenes.map((s) => s.id))
    .eq("processing_version", PROCESSING_VERSION);
  const { data: existingSummaries } = await supa.from("satellite_index_summaries")
    .select("satellite_scene_id, index_type, processing_version")
    .in("satellite_scene_id", scenes.map((s) => s.id))
    .eq("processing_version", PROCESSING_VERSION);
  const haveDisplay = new Set<string>();
  const haveAnalytical = new Set<string>();
  for (const a of existingAssets ?? []) {
    const k = `${a.satellite_scene_id}:${a.index_type}`;
    if (a.asset_type === DISPLAY_ASSET_TYPE) haveDisplay.add(k);
    else if (a.asset_type === ANALYTICAL_ASSET_TYPE) haveAnalytical.add(k);
  }
  const haveSummary = new Set<string>();
  for (const s of existingSummaries ?? []) haveSummary.add(`${s.satellite_scene_id}:${s.index_type}`);

  const paddockIds = Array.from(new Set(scenes.map((s) => s.paddock_id)));
  const vtUrl = Deno.env.get("VINETRACK_SUPABASE_URL")!;
  const vtSrk = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!;
  const padRes = await fetch(
    `${vtUrl}/rest/v1/paddocks?id=in.(${paddockIds.join(",")})&select=id,polygon_points,name`,
    { headers: { apikey: vtSrk, Authorization: `Bearer ${vtSrk}` } },
  );
  if (!padRes.ok) return jsonError(500, "paddock_lookup_failed", "Could not load paddocks.");
  const paddocks: Array<{ id: string; polygon_points: any; name: string | null }> = await padRes.json();
  const padById = new Map(paddocks.map((p) => [p.id, p]));

  const requestedIndexes: IndexType[] = [...INDEX_TYPES] as IndexType[];

  let scanned = 0;
  let backfilled = 0;
  let skipped = 0;
  const failures: Array<{ scene_id: string; index: IndexType; message: string }> = [];
  const perPaddockPerLayer: Record<string, Record<string, string>> = {};

  for (const scene of scenes) {
    scanned++;
    const pad = padById.get(scene.paddock_id);
    if (!pad) { skipped++; continue; }
    const polys = parseGeometryRings(pad.polygon_points);
    if (polys.length === 0) { skipped++; continue; }
    const geometry = toGeoJson(polys);
    const bbox = computeBbox(polys);
    if (!bbox) { skipped++; continue; }
    perPaddockPerLayer[scene.paddock_id] ??= {};

    const acq = new Date(scene.acquired_at);
    const dayStart = new Date(acq); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(acq); dayEnd.setUTCHours(23, 59, 59, 999);
    const dateStart = dayStart.toISOString();
    const dateEnd = dayEnd.toISOString();
    const acqDateStr = acq.toISOString().slice(0, 10);

    for (const idx of requestedIndexes) {
      const key = `${scene.id}:${idx}`;
      const needDisplay = !haveDisplay.has(key);
      const needAnalytical = idx !== "TRUE_COLOUR" && !haveAnalytical.has(key);
      const needSummary = idx !== "TRUE_COLOUR" && !haveSummary.has(key);
      if (!needDisplay && !needAnalytical && !needSummary) continue;

      try {
        const nativeRes = INDEX_NATIVE_RES_M[idx];
        const displaySize = computeImageSize(bbox, QC.processImageTargetResolutionM, QC.processImageMaxSize);
        let minValue: number | null = null, maxValue: number | null = null;
        let percentiles: Record<string, number | null> = {};

        if (needSummary || needDisplay) {
          if (idx !== "TRUE_COLOUR") {
            const stats = await statisticsQuery({
              geometry, bbox, dateStart, dateEnd,
              evalscript: statsEvalscript(idx),
              resolutionM: Math.max(10, nativeRes),
            });
            const s = stats?.data?.[0]?.outputs?.index?.bands?.B0?.stats;
            if (s) {
              minValue = num(s.min); maxValue = num(s.max);
              const pct = s.percentiles ?? {};
              await supa.from("satellite_index_summaries").upsert({
                satellite_scene_id: scene.id, index_type: idx,
                mean_value: num(s.mean),
                median_value: num(pct["50.0"] ?? pct["50"]),
                minimum_value: minValue, maximum_value: maxValue,
                standard_deviation: num(s.stDev),
                percentile_10: num(pct["10.0"] ?? pct["10"]),
                percentile_25: num(pct["25.0"] ?? pct["25"]),
                percentile_75: num(pct["75.0"] ?? pct["75"]),
                percentile_90: num(pct["90.0"] ?? pct["90"]),
                valid_pixel_count: int(s.sampleCount) - int(s.noDataCount),
                no_data_pixel_count: int(s.noDataCount),
                processing_version: PROCESSING_VERSION,
              }, { onConflict: "satellite_scene_id,index_type,processing_version" });
              percentiles = {
                p10: num(pct["10.0"] ?? pct["10"]),
                p25: num(pct["25.0"] ?? pct["25"]),
                p50: num(pct["50.0"] ?? pct["50"]),
                p75: num(pct["75.0"] ?? pct["75"]),
                p90: num(pct["90.0"] ?? pct["90"]),
              } as any;
            }
          }
        }

        const displayPath = `${vineyard_id}/${scene.paddock_id}/${acqDateStr}/${scene.provider_scene_id}/${idx}.png`;
        if (needDisplay) {
          const png = await processImage({
            geometry, bbox, dateStart, dateEnd,
            evalscript: evalscriptFor(idx),
            width: displaySize.width, height: displaySize.height,
          });
          const up = await supa.storage.from("satellite-assets").upload(displayPath, png, {
            contentType: "image/png", upsert: true,
          });
          if (up.error) throw new Error(up.error.message);
          await supa.from("satellite_raster_assets").upsert({
            satellite_scene_id: scene.id, index_type: idx,
            asset_type: DISPLAY_ASSET_TYPE,
            storage_path: displayPath, mime_type: "image/png",
            bounds: { north: bbox[3], south: bbox[1], east: bbox[2], west: bbox[0] },
            raster_width: displaySize.width,
            raster_height: displaySize.height,
            native_resolution_m: nativeRes,
            display_resolution_m: displaySize.displayResolutionM,
            data_type: "UINT8_RGBA",
            scale_factor: null,
            no_data_sentinel: null,
            row_orientation: ANALYTICAL_ROW_ORIENTATION,
            acquisition_date: acqDateStr,
            minimum_value: minValue, maximum_value: maxValue,
            colour_scale: {
              formula: idx,
              bands: INDEX_BANDS[idx],
              time_interval: { from: dateStart, to: dateEnd },
              crs: "EPSG:4326",
              mosaicking_order: "leastCC",
              scl_mask_excluded_classes: [0, 1, 3, 8, 9, 10, 11],
              percentiles,
              backfilled: true,
            },
            processing_version: PROCESSING_VERSION,
          }, { onConflict: "satellite_scene_id,index_type,asset_type,processing_version" });
        }

        if (needAnalytical) {
          const analyticalSize = computeImageSize(bbox, nativeRes, QC.processImageMaxSize);
          const analyticalPath = `${vineyard_id}/${scene.paddock_id}/${acqDateStr}/${scene.provider_scene_id}/${idx}.analysis.tif`;
          const analytical = await processAnalyticalRaster({
            geometry, bbox, dateStart, dateEnd,
            evalscript: analyticalEvalscript(idx),
            width: analyticalSize.width, height: analyticalSize.height,
          });
          const up = await supa.storage.from("satellite-assets").upload(analyticalPath, analytical, {
            contentType: "image/tiff", upsert: true,
          });
          if (up.error) throw new Error(up.error.message);
          await supa.from("satellite_raster_assets").upsert({
            satellite_scene_id: scene.id, index_type: idx,
            asset_type: ANALYTICAL_ASSET_TYPE,
            storage_path: analyticalPath, mime_type: "image/tiff",
            bounds: { north: bbox[3], south: bbox[1], east: bbox[2], west: bbox[0] },
            raster_width: analyticalSize.width, raster_height: analyticalSize.height,
            native_resolution_m: nativeRes,
            display_resolution_m: analyticalSize.displayResolutionM,
            data_type: "Float32",
            scale_factor: 1,
            no_data_sentinel: ANALYTICAL_NO_DATA_SENTINEL,
            row_orientation: ANALYTICAL_ROW_ORIENTATION,
            acquisition_date: acqDateStr,
            colour_scale: {
              formula: idx,
              bands: INDEX_BANDS[idx],
              time_interval: { from: dateStart, to: dateEnd },
              crs: "EPSG:4326",
              mosaicking_order: "leastCC",
              scl_mask_excluded_classes: [0, 1, 3, 8, 9, 10, 11],
              backfilled: true,
            },
            processing_version: PROCESSING_VERSION,
          }, { onConflict: "satellite_scene_id,index_type,asset_type,processing_version" });
        }

        perPaddockPerLayer[scene.paddock_id][idx] = "ok";
        backfilled++;
      } catch (e) {
        const msg = (e as Error)?.message ?? "unknown";
        console.error(`[backfill] scene ${scene.id} ${idx} failed:`, msg);
        failures.push({ scene_id: scene.id, index: idx, message: msg });
        perPaddockPerLayer[scene.paddock_id][idx] = `error: ${msg}`;
        if (e instanceof CdseConfigError) return jsonError(503, e.code, e.message);
        if (e instanceof CdseAuthError) return jsonError(502, e.code, e.message);
        if (e instanceof ProviderError && e.status === 429) {
          return jsonOk({ scanned, backfilled, skipped, failures, halted: "rate_limited", per_paddock: perPaddockPerLayer });
        }
      }
    }
  }

  return jsonOk({ scanned, backfilled, skipped, failures, per_paddock: perPaddockPerLayer, processing_version: PROCESSING_VERSION });
});

function num(x: any): number | null { const n = Number(x); return Number.isFinite(n) ? n : null; }
function int(x: any): number { const n = Number(x); return Number.isFinite(n) ? Math.round(n) : 0; }
