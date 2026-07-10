// satellite-process-scene
// Auth: system admin. Idempotent per (paddock, provider scene, index, processing_version).
// Behaviour:
//   1. Load and validate paddock geometry from VineTrack.
//   2. Create/refresh a processing job row (this project's DB).
//   3. For each requested index:
//        - call Sentinel Hub Statistical API to derive per-paddock stats
//          + valid-pixel coverage (using SCL cloud/shadow mask).
//        - reject the scene if paddock coverage < QC.minValidPaddockCoveragePct.
//        - call Sentinel Hub Process API to render a coloured PNG clipped to paddock.
//        - for numeric layers, call the same Process API geometry/grid to create
//          a single-band Float32 GeoTIFF analytical raster for hover sampling.
//        - upload both matched assets to private storage.
//        - upsert satellite_raster_assets + satellite_index_summaries rows.
//   4. Upsert one satellite_scenes row per paddock with quality/processing status.
//   5. Mark the job complete or failed.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
  parseGeometryRings, toGeoJson, computeBbox, computeImageSize, bboxSizeMeters,
  evalscriptFor, statsEvalscript, analyticalEvalscript, processImage, processAnalyticalRaster, statisticsQuery,
  INDEX_TYPES, INDEX_NATIVE_RES_M, QC, PROCESSING_VERSION, PROVIDER, SENTINEL2_COLLECTION,
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
  const { vineyard_id, paddock_id, provider_scene_id, acquired_at, scene_cloud_cover_pct } = body ?? {};
  const requested: IndexType[] = Array.isArray(body?.requested_index_types) && body.requested_index_types.length
    ? body.requested_index_types.filter((i: string) => (INDEX_TYPES as readonly string[]).includes(i))
    : ([...INDEX_TYPES] as IndexType[]);
  if (!vineyard_id || !paddock_id || !provider_scene_id || !acquired_at)
    return jsonError(400, "bad_request", "vineyard_id, paddock_id, provider_scene_id and acquired_at are required");

  const supa = getServiceClient();

  // Load paddock
  const vtUrl = Deno.env.get("VINETRACK_SUPABASE_URL")!;
  const vtSrk = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!;
  const padRes = await fetch(`${vtUrl}/rest/v1/paddocks?id=eq.${paddock_id}&select=id,vineyard_id,polygon_points,name`, {
    headers: { apikey: vtSrk, Authorization: `Bearer ${vtSrk}` },
  });
  if (!padRes.ok) return jsonError(500, "paddock_lookup_failed", "Could not load paddock.");
  const [paddock] = await padRes.json();
  if (!paddock) return jsonError(404, "paddock_not_found", "Paddock not found.");
  const polys = parseGeometryRings(paddock.polygon_points);
  if (polys.length === 0) return jsonError(422, "geometry_invalid", "Paddock geometry is missing or invalid.");
  const geometry = toGeoJson(polys);
  const bbox = computeBbox(polys)!;

  // Create job row
  const { data: job } = await supa.from("satellite_processing_jobs").insert({
    vineyard_id, paddock_id, requested_by: admin.userId, provider: PROVIDER,
    job_type: "process_scene", status: "processing", requested_index_types: requested,
    provider_scene_id, attempt_count: 1, started_at: new Date().toISOString(),
  }).select("id").maybeSingle();
  const jobId = job?.id;

  // One-day window straddling the scene acquisition date.
  const acq = new Date(acquired_at);
  const dayStart = new Date(acq); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(acq); dayEnd.setUTCHours(23, 59, 59, 999);
  const dateStart = dayStart.toISOString();
  const dateEnd = dayEnd.toISOString();

  // ---- 1. Coverage check via Statistical API on NDVI (SCL mask applied) ----
  let validCoveragePct: number | null = null;
  let quality: "good" | "partial" | "cloud_affected" | "no_data" = "good";
  try {
    const covStats = await statisticsQuery({
      geometry, bbox, dateStart, dateEnd,
      evalscript: statsEvalscript("NDVI"),
      resolutionM: 10,
    });
    const interval = covStats?.data?.[0];
    const outputs = interval?.outputs?.index?.bands?.B0?.stats;
    const sampleCount = outputs?.sampleCount ?? 0;
    const noDataCount = outputs?.noDataCount ?? 0;
    if (sampleCount > 0) {
      validCoveragePct = ((sampleCount - noDataCount) / sampleCount) * 100;
    }
  } catch (e) {
    if (jobId) await supa.from("satellite_processing_jobs").update({
      status: "failed", completed_at: new Date().toISOString(),
      error_code: (e as any)?.code ?? "coverage_check_failed",
      error_message: (e as Error)?.message ?? "Coverage check failed",
    }).eq("id", jobId);
    if (e instanceof CdseConfigError) return jsonError(503, e.code, e.message);
    if (e instanceof CdseAuthError) return jsonError(502, e.code, e.message);
    if (e instanceof ProviderError) return jsonError(e.status === 429 ? 429 : 502, e.code, e.message);
    return jsonError(500, "internal_error", "Coverage check failed.");
  }

  // The SCL-based mask alone is unreliable for small paddocks (returns 0% valid
  // pixels even on clear scenes). Only reject when the catalogue-level scene
  // cloud cover indicates the scene is unusable, or coverage is low AND the
  // scene itself is materially cloudy.
  const sceneCloudPct = typeof scene_cloud_cover_pct === "number" ? scene_cloud_cover_pct : null;
  const coverageBelow = validCoveragePct !== null && validCoveragePct < QC.minValidPaddockCoveragePct;
  const sceneTooCloudy = sceneCloudPct !== null && sceneCloudPct > QC.maxCatalogueCloudCoverPct;
  const shouldReject = sceneTooCloudy || (coverageBelow && sceneCloudPct !== null && sceneCloudPct > 40);

  if (shouldReject) {
    quality = validCoveragePct === null ? "no_data" : "cloud_affected";
    await supa.from("satellite_scenes").upsert({
      vineyard_id, paddock_id, provider: PROVIDER, collection: SENTINEL2_COLLECTION,
      provider_scene_id, acquired_at,
      scene_cloud_cover_pct: sceneCloudPct,
      paddock_valid_coverage_pct: validCoveragePct,
      paddock_cloud_cover_pct: validCoveragePct !== null ? 100 - validCoveragePct : null,
      spatial_resolution_m: 10,
      quality_status: quality,
      processing_status: "insufficient_coverage",
      source_metadata: { reason: "below_min_valid_coverage", min_pct: QC.minValidPaddockCoveragePct, scene_cloud_pct: sceneCloudPct },
    }, { onConflict: "provider,provider_scene_id,paddock_id" });
    if (jobId) await supa.from("satellite_processing_jobs").update({
      status: "no_suitable_scene", completed_at: new Date().toISOString(),
      error_code: "insufficient_coverage",
      error_message: `Scene cloud ${sceneCloudPct ?? "?"}%, paddock valid ${validCoveragePct?.toFixed(1) ?? "0"}%`,
    }).eq("id", jobId);
    return jsonOk({
      status: "insufficient_coverage",
      valid_coverage_pct: validCoveragePct,
      scene_cloud_cover_pct: sceneCloudPct,
      min_required_pct: QC.minValidPaddockCoveragePct,
    });
  }
  if (validCoveragePct === null || validCoveragePct < 95) quality = "partial";

  // ---- 2. Upsert the scene row (processing) ----
  const { data: sceneRow, error: sceneErr } = await supa.from("satellite_scenes").upsert({
    vineyard_id, paddock_id, provider: PROVIDER, collection: SENTINEL2_COLLECTION,
    provider_scene_id, acquired_at,
    scene_cloud_cover_pct: scene_cloud_cover_pct ?? null,
    paddock_valid_coverage_pct: validCoveragePct,
    paddock_cloud_cover_pct: 100 - validCoveragePct,
    spatial_resolution_m: 10,
    quality_status: quality,
    processing_status: "processing",
    source_metadata: { bbox },
  }, { onConflict: "provider,provider_scene_id,paddock_id" }).select("id").maybeSingle();
  if (sceneErr || !sceneRow) {
    if (jobId) await supa.from("satellite_processing_jobs").update({
      status: "failed", completed_at: new Date().toISOString(),
      error_code: "scene_upsert_failed", error_message: sceneErr?.message,
    }).eq("id", jobId);
    return jsonError(500, "scene_upsert_failed", "Failed to record scene.");
  }
  const sceneId = sceneRow.id as string;

  const { data: existingAssets } = await supa
    .from("satellite_raster_assets")
    .select("id,index_type,asset_type,storage_path,raster_width,raster_height,processing_version,mime_type")
    .eq("satellite_scene_id", sceneId)
    .eq("processing_version", PROCESSING_VERSION);

  // ---- 3. For each requested index: stats + display PNG + analytical GeoTIFF ----
  const generated: string[] = [];
  const failures: Array<{ index: IndexType; message: string }> = [];

  const acqDateStr = acq.toISOString().slice(0, 10);
  const paddockName = String(paddock.name ?? paddock.id);

  for (const idx of requested) {
    try {
      const nativeRes = INDEX_NATIVE_RES_M[idx];
      const { width, height, displayResolutionM } = computeImageSize(bbox, QC.processImageTargetResolutionM, QC.processImageMaxSize);

      // Colour ramp descriptor for the DB (client mirrors this).
      let minValue: number | null = null;
      let maxValue: number | null = null;
      let percentiles: Record<string, number | null> = {};

      // Statistical API — skip for TRUE_COLOUR.
      if (idx !== "TRUE_COLOUR") {
        const stats = await statisticsQuery({
          geometry, bbox, dateStart, dateEnd,
          evalscript: statsEvalscript(idx),
          resolutionM: Math.max(10, nativeRes),
        });
        const interval = stats?.data?.[0];
        const s = interval?.outputs?.index?.bands?.B0?.stats;
        if (s) {
          minValue = num(s.min);
          maxValue = num(s.max);
          const pct = s.percentiles ?? {};
          await supa.from("satellite_index_summaries").upsert({
            satellite_scene_id: sceneId, index_type: idx,
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

      const path = `${vineyard_id}/${paddock_id}/${acqDateStr}/${provider_scene_id}/${idx}.png`;
      const existingDisplay = (existingAssets ?? []).find((a: any) =>
        a.index_type === idx &&
        (a.asset_type === DISPLAY_ASSET_TYPE || (!a.asset_type && a.mime_type === "image/png"))
      );
      const displayPath = existingDisplay?.storage_path ?? path;

      if (!existingDisplay) {
        // Process API — coloured PNG clipped to paddock geometry.
        const png = await processImage({
          geometry, bbox, dateStart, dateEnd,
          evalscript: evalscriptFor(idx),
          width, height,
        });

        const up = await supa.storage.from("satellite-assets").upload(displayPath, png, {
          contentType: "image/png", upsert: true,
        });
        if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
      }

      await supa.from("satellite_raster_assets").upsert({
        satellite_scene_id: sceneId, index_type: idx,
        asset_type: DISPLAY_ASSET_TYPE,
        storage_path: displayPath, mime_type: "image/png",
        bounds: { north: bbox[3], south: bbox[1], east: bbox[2], west: bbox[0] },
        raster_width: width,
        raster_height: height,
        native_resolution_m: nativeRes, display_resolution_m: displayResolutionM,
        data_type: "UINT8_RGBA",
        scale_factor: null,
        no_data_sentinel: null,
        row_orientation: ANALYTICAL_ROW_ORIENTATION,
        acquisition_date: acqDateStr,
        minimum_value: minValue, maximum_value: maxValue,
        colour_scale: {
          formula: idx,
          bands: bandsFor(idx),
          time_interval: { from: dateStart, to: dateEnd },
          crs: "EPSG:4326",
          mosaicking_order: "leastCC",
          scl_mask_excluded_classes: [0, 1, 3, 8, 9, 10, 11],
          resampling: nativeRes > QC.processImageTargetResolutionM ? "bilinear" : "none",
          percentiles,
        },
        processing_version: PROCESSING_VERSION,
      }, { onConflict: "satellite_scene_id,index_type,asset_type,processing_version" });

      if (idx !== "TRUE_COLOUR") {
        const analyticalPath = `${vineyard_id}/${paddock_id}/${acqDateStr}/${provider_scene_id}/${idx}.analysis.tif`;
        const existingAnalytical = (existingAssets ?? []).find((a: any) =>
          a.index_type === idx && a.asset_type === ANALYTICAL_ASSET_TYPE
        );
        const analyticalStoragePath = existingAnalytical?.storage_path ?? analyticalPath;

        if (!existingAnalytical) {
          const analytical = await processAnalyticalRaster({
            geometry, bbox, dateStart, dateEnd,
            evalscript: analyticalEvalscript(idx),
            width, height,
          });
          const analyticalUp = await supa.storage.from("satellite-assets").upload(analyticalStoragePath, analytical, {
            contentType: "image/tiff", upsert: true,
          });
          if (analyticalUp.error) throw new Error(`Analytical storage upload failed: ${analyticalUp.error.message}`);
        }

        await supa.from("satellite_raster_assets").upsert({
          satellite_scene_id: sceneId, index_type: idx,
          asset_type: ANALYTICAL_ASSET_TYPE,
          storage_path: analyticalStoragePath, mime_type: "image/tiff",
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
          minimum_value: minValue,
          maximum_value: maxValue,
          colour_scale: {
            formula: idx,
            bands: bandsFor(idx),
            time_interval: { from: dateStart, to: dateEnd },
            crs: "EPSG:4326",
            mosaicking_order: "leastCC",
            scl_mask_excluded_classes: [0, 1, 3, 8, 9, 10, 11],
            matched_display_asset_type: DISPLAY_ASSET_TYPE,
            matched_display_storage_path: displayPath,
          },
          processing_version: PROCESSING_VERSION,
        }, { onConflict: "satellite_scene_id,index_type,asset_type,processing_version" });
      }

      generated.push(idx);
    } catch (e) {
      const msg = (e as Error)?.message ?? "unknown";
      console.error(`[satellite-process-scene] ${idx} failed:`, msg);
      failures.push({ index: idx, message: msg });
    }
  }

  const finalStatus = generated.length > 0 ? "complete" : "failed";
  await supa.from("satellite_scenes").update({
    processing_status: finalStatus,
  }).eq("id", sceneId);

  if (jobId) await supa.from("satellite_processing_jobs").update({
    status: finalStatus, completed_at: new Date().toISOString(),
    error_code: failures.length && !generated.length ? "processing_failed" : null,
    error_message: failures.length ? failures.map((f) => `${f.index}: ${f.message}`).join("; ").slice(0, 500) : null,
  }).eq("id", jobId);

  return jsonOk({
    status: finalStatus, scene_id: sceneId, generated, failures,
    paddock: { id: paddock_id, name: paddockName },
    valid_coverage_pct: validCoveragePct,
    quality_status: quality,
  });
});

function num(x: any): number | null { const n = Number(x); return Number.isFinite(n) ? n : null; }
function int(x: any): number { const n = Number(x); return Number.isFinite(n) ? Math.round(n) : 0; }
function bandsFor(i: IndexType): string[] {
  switch (i) {
    case "TRUE_COLOUR": return ["B02", "B03", "B04"];
    case "NDVI": case "MSAVI": return ["B04", "B08"];
    case "NDRE": case "RECI": return ["B05", "B08"];
    case "NDMI": return ["B08", "B11"];
  }
}
