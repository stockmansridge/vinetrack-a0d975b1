// satellite-backfill-analytical
// Auth: system admin. Generates missing analytical (Float32 GeoTIFF) rasters
// for completed scenes that were processed before the analytical asset was
// introduced. Reuses existing display PNGs — does NOT re-render them.
//
// Each analytical raster is rendered at the index's NATIVE resolution:
//   NDVI / MSAVI: 10 m
//   NDRE / RECI / NDMI: 20 m
// Bounds match the paddock bbox — identical to the display PNG's bbox — so
// browser sampling uses the same georeference.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
  parseGeometryRings, toGeoJson, computeBbox, computeImageSize,
  analyticalEvalscript, processAnalyticalRaster,
  INDEX_TYPES, INDEX_NATIVE_RES_M, QC, PROCESSING_VERSION,
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

  // Load completed scenes for this vineyard (optionally scoped).
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
    .select("satellite_scene_id, index_type, asset_type")
    .in("satellite_scene_id", scenes.map((s) => s.id));
  const have = new Set<string>();
  for (const a of existingAssets ?? []) {
    if (a.asset_type === ANALYTICAL_ASSET_TYPE) {
      have.add(`${a.satellite_scene_id}:${a.index_type}`);
    }
  }

  // Preload paddock geometry — one query per unique paddock.
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

  const requestedIndexes: IndexType[] = ([...INDEX_TYPES] as IndexType[]).filter((i) => i !== "TRUE_COLOUR");

  let scanned = 0;
  let backfilled = 0;
  let skipped = 0;
  const failures: Array<{ scene_id: string; index: IndexType; message: string }> = [];

  for (const scene of scenes) {
    scanned++;
    const pad = padById.get(scene.paddock_id);
    if (!pad) { skipped++; continue; }
    const polys = parseGeometryRings(pad.polygon_points);
    if (polys.length === 0) { skipped++; continue; }
    const geometry = toGeoJson(polys);
    const bbox = computeBbox(polys);
    if (!bbox) { skipped++; continue; }

    const acq = new Date(scene.acquired_at);
    const dayStart = new Date(acq); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(acq); dayEnd.setUTCHours(23, 59, 59, 999);
    const dateStart = dayStart.toISOString();
    const dateEnd = dayEnd.toISOString();
    const acqDateStr = acq.toISOString().slice(0, 10);

    for (const idx of requestedIndexes) {
      if (have.has(`${scene.id}:${idx}`)) continue;
      try {
        const nativeRes = INDEX_NATIVE_RES_M[idx];
        // Render at NATIVE resolution — one analytical cell per native satellite cell.
        const { width, height, displayResolutionM } = computeImageSize(bbox, nativeRes, QC.processImageMaxSize);
        const analytical = await processAnalyticalRaster({
          geometry, bbox, dateStart, dateEnd,
          evalscript: analyticalEvalscript(idx),
          width, height,
        });
        const analyticalPath = `${vineyard_id}/${scene.paddock_id}/${acqDateStr}/${scene.provider_scene_id}/${idx}.analysis.tif`;
        const up = await supa.storage.from("satellite-assets").upload(analyticalPath, analytical, {
          contentType: "image/tiff", upsert: true,
        });
        if (up.error) throw new Error(up.error.message);

        await supa.from("satellite_raster_assets").upsert({
          satellite_scene_id: scene.id,
          index_type: idx,
          asset_type: ANALYTICAL_ASSET_TYPE,
          storage_path: analyticalPath,
          mime_type: "image/tiff",
          bounds: { north: bbox[3], south: bbox[1], east: bbox[2], west: bbox[0] },
          raster_width: width,
          raster_height: height,
          native_resolution_m: nativeRes,
          display_resolution_m: displayResolutionM,
          data_type: "Float32",
          scale_factor: 1,
          no_data_sentinel: ANALYTICAL_NO_DATA_SENTINEL,
          row_orientation: ANALYTICAL_ROW_ORIENTATION,
          acquisition_date: acqDateStr,
          colour_scale: {
            formula: idx,
            time_interval: { from: dateStart, to: dateEnd },
            crs: "EPSG:4326",
            mosaicking_order: "leastCC",
            scl_mask_excluded_classes: [0, 1, 3, 8, 9, 10, 11],
            backfilled: true,
          },
          processing_version: PROCESSING_VERSION,
        }, { onConflict: "satellite_scene_id,index_type,asset_type,processing_version" });
        backfilled++;
      } catch (e) {
        const msg = (e as Error)?.message ?? "unknown";
        console.error(`[backfill] scene ${scene.id} ${idx} failed:`, msg);
        failures.push({ scene_id: scene.id, index: idx, message: msg });
        if (e instanceof CdseConfigError) return jsonError(503, e.code, e.message);
        if (e instanceof CdseAuthError) return jsonError(502, e.code, e.message);
        if (e instanceof ProviderError && e.status === 429) {
          return jsonOk({ scanned, backfilled, skipped, failures, halted: "rate_limited" });
        }
      }
    }
  }

  return jsonOk({ scanned, backfilled, skipped, failures });
});
