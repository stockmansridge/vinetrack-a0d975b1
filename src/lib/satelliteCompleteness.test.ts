import { describe, it, expect } from "vitest";
import {
  inspectCompleteness,
  REQUIRED_INDICES,
  CURRENT_PROCESSING_VERSION,
  type CompletenessScene,
  type CompletenessAsset,
  type CompletenessSummary,
} from "./satelliteCompleteness";

const NUMERIC = REQUIRED_INDICES.filter((i) => i !== "TRUE_COLOUR");
const now = new Date("2026-07-12T00:00:00Z");
const fresh = "2026-07-11T02:00:00Z";

function completeSceneFor(sceneId: string, paddockId: string) {
  const scene: CompletenessScene = {
    id: sceneId,
    paddock_id: paddockId,
    provider_scene_id: `prov-${sceneId}`,
    acquired_at: fresh,
    scene_cloud_cover_pct: 5,
    processing_status: "complete",
  };
  const assets: CompletenessAsset[] = [];
  const summaries: CompletenessSummary[] = [];
  for (const idx of REQUIRED_INDICES) {
    assets.push({
      satellite_scene_id: sceneId,
      index_type: idx,
      asset_type: "DISPLAY_RASTER",
      storage_path: `${sceneId}/${idx}.png`,
      processing_version: CURRENT_PROCESSING_VERSION,
    });
    if (idx !== "TRUE_COLOUR") {
      assets.push({
        satellite_scene_id: sceneId,
        index_type: idx,
        asset_type: "ANALYTICAL_RASTER",
        storage_path: `${sceneId}/${idx}.analysis.tif`,
        processing_version: CURRENT_PROCESSING_VERSION,
      });
      summaries.push({ satellite_scene_id: sceneId, index_type: idx });
    }
  }
  return { scene, assets, summaries };
}

describe("inspectCompleteness", () => {
  it("all paddocks complete → no work", () => {
    const a = completeSceneFor("s1", "p1");
    const b = completeSceneFor("s2", "p2");
    const report = inspectCompleteness({
      paddocks: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }],
      scenes: [a.scene, b.scene],
      assets: [...a.assets, ...b.assets],
      summaries: [...a.summaries, ...b.summaries],
      now,
    });
    expect(report.totals.totalMissing).toBe(0);
    expect(report.totals.completePaddocks).toBe(2);
    expect(report.perPaddock.every((p) => p.state === "complete")).toBe(true);
  });

  it("one paddock with no scene → missing_latest_scene, all layers requested", () => {
    const a = completeSceneFor("s1", "p1");
    const report = inspectCompleteness({
      paddocks: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }],
      scenes: [a.scene],
      assets: a.assets,
      summaries: a.summaries,
      now,
    });
    expect(report.totals.missingPaddocks).toBe(1);
    const p2 = report.perPaddock.find((p) => p.paddockId === "p2")!;
    expect(p2.state).toBe("missing_latest_scene");
    expect(p2.indicesRequiringWork).toEqual(REQUIRED_INDICES);
  });

  it("scene missing one analytical raster → only that index requested", () => {
    const a = completeSceneFor("s1", "p1");
    const assets = a.assets.filter(
      (x) => !(x.index_type === "PSRI" && x.asset_type === "ANALYTICAL_RASTER"),
    );
    const report = inspectCompleteness({
      paddocks: [{ id: "p1", name: "P1" }],
      scenes: [a.scene],
      assets,
      summaries: a.summaries,
      now,
    });
    const p = report.perPaddock[0];
    expect(p.state).toBe("incomplete_scene");
    expect(p.missingAnalyticalLayers).toEqual(["PSRI"]);
    expect(p.missingDisplayLayers).toEqual([]);
    expect(p.missingSummaries).toEqual([]);
    expect(p.indicesRequiringWork).toEqual(["PSRI"]);
  });

  it("scene missing one summary → only that index requested", () => {
    const a = completeSceneFor("s1", "p1");
    const summaries = a.summaries.filter((s) => s.index_type !== "GCI");
    const report = inspectCompleteness({
      paddocks: [{ id: "p1", name: "P1" }],
      scenes: [a.scene],
      assets: a.assets,
      summaries,
      now,
    });
    const p = report.perPaddock[0];
    expect(p.state).toBe("incomplete_scene");
    expect(p.missingSummaries).toEqual(["GCI"]);
    expect(p.indicesRequiringWork).toEqual(["GCI"]);
  });

  it("scene on older processing version → old_processing_version state", () => {
    const a = completeSceneFor("s1", "p1");
    const assets = a.assets.map((x) => ({ ...x, processing_version: "sentinel2-v2" }));
    const report = inspectCompleteness({
      paddocks: [{ id: "p1", name: "P1" }],
      scenes: [a.scene],
      assets,
      summaries: a.summaries,
      now,
    });
    const p = report.perPaddock[0];
    expect(p.state).toBe("old_processing_version");
    expect(p.onOldProcessingVersion).toBe(true);
    expect(p.indicesRequiringWork.length).toBe(REQUIRED_INDICES.length);
  });

  it("mixed vineyard state", () => {
    const good = completeSceneFor("s-ok", "p-ok");
    const partial = completeSceneFor("s-partial", "p-partial");
    const partialAssets = partial.assets.filter(
      (x) => !(x.index_type === "NDMI" && x.asset_type === "ANALYTICAL_RASTER"),
    );
    const report = inspectCompleteness({
      paddocks: [
        { id: "p-ok", name: "OK" },
        { id: "p-partial", name: "Partial" },
        { id: "p-missing", name: "Missing" },
      ],
      scenes: [good.scene, partial.scene],
      assets: [...good.assets, ...partialAssets],
      summaries: [...good.summaries, ...partial.summaries],
      now,
    });
    expect(report.totals.completePaddocks).toBe(1);
    expect(report.totals.incompletePaddocks).toBe(1);
    expect(report.totals.missingPaddocks).toBe(1);
    expect(report.totals.totalMissing).toBe(2);
  });

  it("scene older than the fresh window is treated as missing latest", () => {
    const stale = completeSceneFor("s1", "p1");
    stale.scene.acquired_at = "2026-07-01T00:00:00Z"; // 11 days before `now`
    const report = inspectCompleteness({
      paddocks: [{ id: "p1", name: "P1" }],
      scenes: [stale.scene],
      assets: stale.assets,
      summaries: stale.summaries,
      now,
    });
    expect(report.perPaddock[0].state).toBe("missing_latest_scene");
  });
});

// Guard against silent drift of the required-layer set.
describe("REQUIRED_INDICES", () => {
  it("has all 11 layers including TRUE_COLOUR", () => {
    expect(REQUIRED_INDICES.length).toBe(11);
    expect(REQUIRED_INDICES).toContain("TRUE_COLOUR");
    expect(NUMERIC.length).toBe(10);
  });
});
