import { describe, expect, it } from "vitest";
import { selectSavedPair, type SavedCandidate } from "./satelliteSavedSelection";
import { CURRENT_PROCESSING_VERSION as V6, REQUIRED_INDICES, reportFromManifest } from "./satelliteCompleteness";
import { deriveCropHealthViewModel, displayKeyFor } from "./cropHealthViewModel";
import type { ManifestResponse, ManifestLayerAsset } from "./satelliteManifest";

const V3 = "sentinel2-v3-eleven-layers";
const DATE = "2026-08-01";
const ids = Array.from({ length: 8 }, (_, i) => `fixture-paddock-${i}`);
const assets: SavedCandidate[] = ids.flatMap((id) => [V3,V6].flatMap((version) => REQUIRED_INDICES.flatMap((index) => {
  const base = { satellite_scene_id: `scene-${id}`, index_type: index, processing_version: version };
  return [{ ...base, id: `${id}-${version}-${index}-display`, asset_type: "DISPLAY_RASTER", storage_path: "saved.png" },
    ...(index === "TRUE_COLOUR" ? [] : [{ ...base, id: `${id}-${version}-${index}-analysis`, asset_type: "ANALYTICAL_RASTER", storage_path: "saved.tif" }])];
})));
const layerAsset = (asset: SavedCandidate): ManifestLayerAsset => ({
  asset_id: asset.id, index_type: asset.index_type as ManifestLayerAsset["index_type"],
  asset_type: asset.asset_type as ManifestLayerAsset["asset_type"], processing_version: asset.processing_version ?? null,
  storage_path: asset.storage_path, mime_type: asset.asset_type === "DISPLAY_RASTER" ? "image/png" : "image/tiff",
  bounds: { north: -33, south: -34, east: 150, west: 149 }, raster_width: 16, raster_height: 16,
  native_resolution_m: ["NDRE","RECI","RENDVI","NDMI","PSRI"].includes(asset.index_type) ? 20 : 10,
  display_resolution_m: 10, data_type: null, scale_factor: null, no_data_sentinel: null, row_orientation: null, colour_scale: null, etag: asset.id,
});

describe("eight-paddock 1 Aug zero-summary golden fixture", () => {
  it("makes all eight NDVI displays eligible/mounted without analysis or summaries; remains partial", () => {
    const paddocks = ids.map((id) => ({
      vineyard_id: "fixture-vineyard", paddock_id: id, latest_display_scene_id: `scene-${id}`, latest_display_acquired_at: DATE,
      latest_complete_scene_id: null, latest_complete_acquired_at: null, latest_processing_version: V3,
      available_layer_types: REQUIRED_INDICES, available_analytical_types: REQUIRED_INDICES.filter((i) => i !== "TRUE_COLOUR"),
      missing_display_count: 0, missing_analytical_count: 0, missing_summary_count: 10, package_status: "partial" as const,
      last_provider_check_at: null, last_successful_refresh_at: null, last_asset_repair_at: null, updated_at: "2026-10-19",
    }));
    const datePaddocks = ids.map((id) => ({
      paddock_id: id, scene_id: `scene-${id}`, provider_scene_id: `source-${id}`, provider: "sentinel-2-l2a",
      acquired_at: `${DATE}T01:00:00Z`, acquisition_date: DATE, processing_version: V6,
      paddock_valid_coverage_pct: null, paddock_cloud_cover_pct: null, scene_cloud_cover_pct: null,
      available_display_layers: REQUIRED_INDICES, available_analytical_layers: REQUIRED_INDICES.filter((i) => i !== "TRUE_COLOUR"),
      package_version_mismatch: false,
      layers: REQUIRED_INDICES.map((index) => {
        const pair = selectSavedPair(assets, `scene-${id}`, index);
        return { index_type: index, display: pair.display ? layerAsset(pair.display) : null,
          analytical: pair.analytical ? layerAsset(pair.analytical) : null, summary: null };
      }),
    }));
    const manifest: ManifestResponse = { manifest_version: "v3", vineyard_id: "fixture-vineyard", updated_at: "2026-10-19", paddocks,
      date_coverage: [{ acquisition_date: DATE, active_paddock_count: 8, available_paddock_count: 8, coverage_percent: 100,
        available_paddock_ids: ids, missing_paddock_ids: [], missing_paddocks: [], paddocks: datePaddocks, updated_at: "2026-10-19" }] };
    const keys = datePaddocks.map((p) => displayKeyFor(p.paddock_id, DATE, "NDVI", p.layers.find((l) => l.index_type === "NDVI")?.display?.asset_id ?? null));
    const view = deriveCropHealthViewModel({ manifest, selectedDate: DATE, selectedLayer: "NDVI", activePaddocks: ids.map((id) => ({ id, name: id })),
      displayLoadState: new Map(keys.map((key) => [key, { phase: "loaded" }])), analyticalLoadState: new Map(),
      overlayLifecycle: new Map(keys.map((key) => [key, { phase: "mounted" }])) });
    expect(view.summary.layerAssetsAvailable).toBe(8); expect(view.summary.overlaysMounted).toBe(8);
    expect(view.summary.analyticalReady).toBe(0); expect(view.summary.completePackages).toBe(0); expect(view.summary.partialPackages).toBe(8);
    expect(view.paddocks.every((p) => p.acquisitionDate === DATE && p.nativeResolutionM === 10)).toBe(true);
    expect(datePaddocks.every((p) => p.layers.find((l) => l.index_type === "NDRE")?.analytical?.native_resolution_m === 20)).toBe(true);
    const report = reportFromManifest(ids.map((id) => ({ id, name: id })), paddocks);
    expect(report.totals.missingSummaries).toBe(80); expect(report.totals.completePaddocks).toBe(0);
  });

  it("prefers v6 regardless of ordering and never pairs a v3 analytical with it", () => {
    const scene = `scene-${ids[0]}`;
    const pair = selectSavedPair([...assets].reverse(), scene, "NDVI");
    expect(pair.display?.processing_version).toBe(V6); expect(pair.analytical?.processing_version).toBe(V6);
    const noV6Analysis = assets.filter((a) => !(a.asset_type === "ANALYTICAL_RASTER" && a.processing_version === V6));
    expect(selectSavedPair(noV6Analysis, scene, "NDVI").analytical).toBeUndefined();
  });

  it("uses v3 when it is the newest supported saved display; rejects unknown versions", () => {
    const v3 = assets.filter((a) => a.processing_version === V3);
    expect(selectSavedPair(v3, `scene-${ids[0]}`, "NDVI").display?.processing_version).toBe(V3);
    expect(selectSavedPair(v3.map((a) => ({ ...a, processing_version: "unknown" })), `scene-${ids[0]}`, "NDVI").display).toBeUndefined();
  });
});