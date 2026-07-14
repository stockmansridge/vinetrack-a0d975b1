import { describe, it, expect } from "vitest";
import {
  deriveCropHealthViewModel,
  displayKeyFor,
  analyticalKeyFor,
  type AssetLoadState,
  type OverlayLifecycleState,
} from "@/lib/cropHealthViewModel";
import type { ManifestResponse } from "@/lib/satelliteManifest";
import type { SatelliteIndexType } from "@/types/satellite";

const LAYER: SatelliteIndexType = "NDVI";
const DATE = "2026-07-09";

function buildManifest(paddockIds: string[], opts: {
  layer?: SatelliteIndexType;
  withDisplay?: boolean;
  withAnalytical?: boolean;
  packageMismatch?: boolean;
  packageStatus?: "complete" | "partial" | "upgrade_required" | "no_imagery" | "display_available";
  omitPaddockOnDate?: string[];
} = {}): ManifestResponse {
  const layer = opts.layer ?? LAYER;
  const dateEntry = {
    acquisition_date: DATE,
    active_paddock_count: paddockIds.length,
    available_paddock_count: paddockIds.length - (opts.omitPaddockOnDate?.length ?? 0),
    coverage_percent: 100,
    available_paddock_ids: paddockIds.filter((id) => !opts.omitPaddockOnDate?.includes(id)),
    missing_paddock_ids: opts.omitPaddockOnDate ?? [],
    missing_paddocks: (opts.omitPaddockOnDate ?? []).map((paddock_id) => ({
      paddock_id,
      reason: "no_scene_for_date" as const,
    })),
    paddocks: paddockIds
      .filter((id) => !opts.omitPaddockOnDate?.includes(id))
      .map((id) => ({
        paddock_id: id,
        scene_id: `scene-${id}`,
        provider_scene_id: null,
        provider: "COPERNICUS_SENTINEL_2",
        acquired_at: `${DATE}T00:00:00Z`,
        acquisition_date: DATE,
        processing_version: "sentinel2-v3-eleven-layers",
        paddock_valid_coverage_pct: 100,
        paddock_cloud_cover_pct: 0,
        scene_cloud_cover_pct: 0,
        available_display_layers: [layer],
        available_analytical_layers: [layer],
        package_version_mismatch: opts.packageMismatch ?? false,
        layers: [
          {
            index_type: layer,
            display: opts.withDisplay === false ? null : {
              asset_id: `disp-${id}`,
              index_type: layer,
              asset_type: "DISPLAY_RASTER" as const,
              processing_version: "sentinel2-v3-eleven-layers",
              storage_path: `p/${id}.png`,
              mime_type: "image/png",
              bounds: { north: 1, south: 0, east: 1, west: 0 },
              raster_width: 100,
              raster_height: 100,
              native_resolution_m: 10,
              display_resolution_m: 10,
              data_type: "uint8",
              scale_factor: null,
              no_data_sentinel: null,
              row_orientation: null,
              colour_scale: null,
              etag: "e",
            },
            analytical: opts.withAnalytical === false ? null : {
              asset_id: `ana-${id}`,
              index_type: layer,
              asset_type: "ANALYTICAL_RASTER" as const,
              processing_version: "sentinel2-v3-eleven-layers",
              storage_path: `p/${id}.tif`,
              mime_type: "image/tiff",
              bounds: { north: 1, south: 0, east: 1, west: 0 },
              raster_width: 100,
              raster_height: 100,
              native_resolution_m: 10,
              display_resolution_m: 10,
              data_type: "float32",
              scale_factor: null,
              no_data_sentinel: null,
              row_orientation: null,
              colour_scale: null,
              etag: "e",
            },
            summary: null,
          },
        ],
      })),
    updated_at: new Date().toISOString(),
  };

  return {
    manifest_version: "v3",
    vineyard_id: "vy",
    updated_at: null,
    date_coverage: [dateEntry],
    paddocks: paddockIds.map((id) => ({
      vineyard_id: "vy",
      paddock_id: id,
      latest_display_scene_id: `scene-${id}`,
      latest_display_acquired_at: `${DATE}T00:00:00Z`,
      latest_complete_scene_id: `scene-${id}`,
      latest_complete_acquired_at: `${DATE}T00:00:00Z`,
      latest_processing_version: "sentinel2-v3-eleven-layers",
      available_layer_types: [layer],
      available_analytical_types: [layer],
      missing_display_count: 0,
      missing_analytical_count: 0,
      missing_summary_count: 0,
      package_status: opts.packageStatus ?? "complete",
      last_provider_check_at: null,
      last_successful_refresh_at: null,
      last_asset_repair_at: null,
      updated_at: new Date().toISOString(),
    })),
  } as ManifestResponse;
}

const paddocks = [
  { id: "p1", name: "Paddock 1" },
  { id: "p2", name: "Paddock 2" },
  { id: "p3", name: "Paddock 3" },
];

function loaded(): AssetLoadState { return { phase: "loaded" }; }
function loading(): AssetLoadState { return { phase: "loading" }; }
function failed(msg = "boom"): AssetLoadState { return { phase: "failed", errorMessage: msg }; }
function mounted(): OverlayLifecycleState { return { phase: "mounted" }; }
function errored(msg = "mount boom"): OverlayLifecycleState { return { phase: "error", errorMessage: msg }; }

describe("deriveCropHealthViewModel", () => {
  it("full coverage: every paddock displayed, coverage = 100%", () => {
    const manifest = buildManifest(paddocks.map((p) => p.id));
    const disp = new Map<string, AssetLoadState>();
    const ana = new Map<string, AssetLoadState>();
    const life = new Map<string, OverlayLifecycleState>();
    for (const p of paddocks) {
      disp.set(displayKeyFor(p.id, DATE, LAYER, `disp-${p.id}`), loaded());
      ana.set(analyticalKeyFor(p.id, `scene-${p.id}`, LAYER, `ana-${p.id}`), loaded());
      life.set(displayKeyFor(p.id, DATE, LAYER, `disp-${p.id}`), mounted());
    }
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: paddocks,
      displayLoadState: disp, analyticalLoadState: ana, overlayLifecycle: life,
    });
    expect(vm.summary.overlaysMounted).toBe(3);
    expect(vm.summary.coveragePercent).toBe(100);
    for (const p of vm.paddocks) expect(p.availabilityReason).toBe("displayed");
  });

  it("mixed loading/mounted: only mounted counts as displayed", () => {
    const manifest = buildManifest(paddocks.map((p) => p.id));
    const disp = new Map<string, AssetLoadState>();
    const ana = new Map<string, AssetLoadState>();
    const life = new Map<string, OverlayLifecycleState>();
    // p1 mounted, p2 loading, p3 loaded but not yet mounted
    disp.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), loaded());
    life.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), mounted());
    disp.set(displayKeyFor("p2", DATE, LAYER, "disp-p2"), loading());
    disp.set(displayKeyFor("p3", DATE, LAYER, "disp-p3"), loaded());
    for (const p of paddocks) {
      ana.set(analyticalKeyFor(p.id, `scene-${p.id}`, LAYER, `ana-${p.id}`), loaded());
    }
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: paddocks,
      displayLoadState: disp, analyticalLoadState: ana, overlayLifecycle: life,
    });
    expect(vm.summary.overlaysMounted).toBe(1);
    expect(vm.byId.p1.availabilityReason).toBe("displayed");
    expect(vm.byId.p2.availabilityReason).toBe("loading");
    expect(vm.byId.p3.availabilityReason).toBe("loading");
  });

  it("layer missing on paddock: selected_layer_missing", () => {
    const manifest = buildManifest(["p1"], { withDisplay: false });
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: [paddocks[0]],
      displayLoadState: new Map(), analyticalLoadState: new Map(), overlayLifecycle: new Map(),
    });
    expect(vm.byId.p1.availabilityReason).toBe("selected_layer_missing");
    expect(vm.summary.overlaysMounted).toBe(0);
  });

  it("no scene for date: no_scene_for_date", () => {
    const manifest = buildManifest(["p1"], { omitPaddockOnDate: ["p1"] });
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: [paddocks[0]],
      displayLoadState: new Map(), analyticalLoadState: new Map(), overlayLifecycle: new Map(),
    });
    expect(vm.byId.p1.availabilityReason).toBe("no_scene_for_date");
  });

  it("asset load failure surfaces asset_load_failed", () => {
    const manifest = buildManifest(["p1"]);
    const disp = new Map<string, AssetLoadState>();
    disp.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), failed("net"));
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: [paddocks[0]],
      displayLoadState: disp, analyticalLoadState: new Map(), overlayLifecycle: new Map(),
    });
    expect(vm.byId.p1.availabilityReason).toBe("asset_load_failed");
    expect(vm.byId.p1.errorMessage).toBe("net");
  });

  it("mount failure surfaces overlay_mount_failed", () => {
    const manifest = buildManifest(["p1"]);
    const disp = new Map<string, AssetLoadState>();
    const life = new Map<string, OverlayLifecycleState>();
    disp.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), loaded());
    life.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), errored());
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: [paddocks[0]],
      displayLoadState: disp, analyticalLoadState: new Map(), overlayLifecycle: life,
    });
    expect(vm.byId.p1.availabilityReason).toBe("overlay_mount_failed");
  });

  it("package upgrade required wins over other reasons", () => {
    const manifest = buildManifest(["p1"], { packageStatus: "upgrade_required" });
    const disp = new Map<string, AssetLoadState>();
    const life = new Map<string, OverlayLifecycleState>();
    disp.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), loaded());
    life.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), mounted());
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: [paddocks[0]],
      displayLoadState: disp, analyticalLoadState: new Map(), overlayLifecycle: life,
    });
    expect(vm.byId.p1.availabilityReason).toBe("package_upgrade_required");
  });

  it("cell hover unavailable when analytical missing", () => {
    const manifest = buildManifest(["p1"], { withAnalytical: false });
    const disp = new Map<string, AssetLoadState>();
    const life = new Map<string, OverlayLifecycleState>();
    disp.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), loaded());
    life.set(displayKeyFor("p1", DATE, LAYER, "disp-p1"), mounted());
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: [paddocks[0]],
      displayLoadState: disp, analyticalLoadState: new Map(), overlayLifecycle: life,
    });
    expect(vm.byId.p1.availabilityReason).toBe("cell_data_incomplete");
    expect(vm.byId.p1.cellHoverReady).toBe(false);
  });

  it("stale keys from a previous date do not count toward the new date", () => {
    const manifest = buildManifest(["p1"]);
    const disp = new Map<string, AssetLoadState>();
    const life = new Map<string, OverlayLifecycleState>();
    // Simulate leftover state from an earlier date
    disp.set(displayKeyFor("p1", "2026-01-01", LAYER, "disp-old"), loaded());
    life.set(displayKeyFor("p1", "2026-01-01", LAYER, "disp-old"), mounted());
    const vm = deriveCropHealthViewModel({
      manifest, selectedDate: DATE, selectedLayer: LAYER,
      activePaddocks: [paddocks[0]],
      displayLoadState: disp, analyticalLoadState: new Map(), overlayLifecycle: life,
    });
    expect(vm.summary.overlaysMounted).toBe(0);
    expect(vm.byId.p1.availabilityReason).toBe("loading");
  });
});
