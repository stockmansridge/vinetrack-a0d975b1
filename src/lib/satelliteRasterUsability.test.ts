import { describe, expect, it } from "vitest";
import { encode } from "fast-png";
import { fromArrayBuffer, writeArrayBuffer } from "geotiff";
import {
  applyRasterVerdicts, inspectAnalyticalValues, inspectDisplayPng, judgeAnalytical, judgeDisplay,
  UnusableRasterError, VERIFIED_NATIVE_VERSION, type RasterVerdict,
} from "./satelliteRasterUsability";
import { deriveCropHealthViewModel, displayKeyFor } from "./cropHealthViewModel";
import { reasonToCustomerMessage } from "./cropHealthCopy";
import {
  REAL_1AUG_NDVI_PNG_B64, REAL_1AUG_NDVI_TIFF_B64, REAL_1AUG_TRUE_COLOUR_PNG_B64,
} from "@/test/fixtures/cropHealthRealBlankAssets";

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const png = (w: number, h: number, fill: (i: number) => [number, number, number, number]) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill(i), i * 4);
  return encode({ width: w, height: h, data, channels: 4, depth: 8 });
};
async function readTiff(bytes: Uint8Array) {
  const t = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const img = await t.getImage();
  return { img, values: (await img.readRasters({ interleave: true })) as unknown as ArrayLike<number> };
}
const utmTiff = (values: number[], w: number, h: number) => new Uint8Array(writeArrayBuffer(new Float32Array(values), {
  width: w, height: h, SampleFormat: [3], BitsPerSample: [32], ModelPixelScale: [10, 10, 0],
  ModelTiepoint: [0, 0, 0, 500000, 6300000, 0], ProjectedCSTypeGeoKey: 32755, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1,
} as never));

describe("real production 1 Aug 2026 Stockman's Ridge bytes", () => {
  it("NDVI PNG (91 bytes) decodes to 16×33 with every pixel alpha 0 → blank", () => {
    const i = inspectDisplayPng(b64(REAL_1AUG_NDVI_PNG_B64));
    expect([i.width, i.height, i.totalPixels, i.visiblePixels, i.transparentPixels]).toEqual([16, 33, 528, 0, 528]);
    expect(judgeDisplay(i, { width: 16, height: 33, processingVersion: "sentinel2-v6-native-10m" }).kind).toBe("blank");
  });
  it("True Colour PNG is byte-identical and also blank", () => {
    expect(REAL_1AUG_TRUE_COLOUR_PNG_B64).toBe(REAL_1AUG_NDVI_PNG_B64);
    expect(judgeDisplay(inspectDisplayPng(b64(REAL_1AUG_TRUE_COLOUR_PNG_B64)), {}).kind).toBe("blank");
  });
  it("NDVI analysis TIFF (522 bytes) is 528 cells of -9999 → blank", async () => {
    const { img, values } = await readTiff(b64(REAL_1AUG_NDVI_TIFF_B64));
    const i = inspectAnalyticalValues(values, img.getWidth(), img.getHeight(), -9999, [-1, 1]);
    expect([i.cells, i.validCells, i.noDataCells]).toEqual([528, 0, 528]);
    expect(judgeAnalytical(i, { width: 16, height: 33 }).kind).toBe("blank");
  });
  it("v3 record (16×25) pointing at the same storage key holds v6 bytes (16×33) → invalid", () => {
    const i = inspectDisplayPng(b64(REAL_1AUG_NDVI_PNG_B64));
    const v = judgeDisplay(i, { width: 16, height: 25, processingVersion: "sentinel2-v3-eleven-layers" });
    expect(v.kind).toBe("invalid");
    expect(v.message).toContain("16×33");
  });
});

describe("display usability", () => {
  it("rejects a blob with a valid PNG signature/IHDR but truncated content", () => {
    const real = b64(REAL_1AUG_NDVI_PNG_B64);
    const truncated = real.slice(0, 40);
    expect(() => inspectDisplayPng(truncated)).toThrow(UnusableRasterError);
  });
  it("accepts real nonzero NDVI colours on the verified native version", () => {
    const bytes = png(4, 4, (i) => [20 + i, 200, 40, 255]);
    const v = judgeDisplay(inspectDisplayPng(bytes), { width: 4, height: 4, processingVersion: VERIFIED_NATIVE_VERSION });
    expect(v.kind).toBe("verified");
  });
  it("mixed valid / cloud-masked image is usable with an exact visible count", () => {
    const bytes = png(4, 4, (i) => (i < 6 ? [0, 0, 0, 0] : [30, 180, 40, 255]));
    const i = inspectDisplayPng(bytes);
    expect([i.visiblePixels, i.transparentPixels]).toEqual([10, 6]);
    expect(judgeDisplay(i, { width: 4, height: 4 }).kind).toBe("legacy");
  });
});

describe("analytical usability", () => {
  it("100% no-data Float32 TIFF is blank", async () => {
    const { img, values } = await readTiff(utmTiff(new Array(16).fill(-9999), 4, 4));
    const i = inspectAnalyticalValues(values, img.getWidth(), img.getHeight(), -9999, [-1, 1]);
    expect(judgeAnalytical(i, { width: 4, height: 4 }).kind).toBe("blank");
  });
  it("all-NaN TIFF is blank", async () => {
    const { img, values } = await readTiff(utmTiff(new Array(16).fill(NaN), 4, 4));
    expect(inspectAnalyticalValues(values, img.getWidth(), img.getHeight(), -9999, null).nanCells).toBe(16);
  });
  it("mixed valid / cloud NDVI on native 10 m UTM is verified for v7", async () => {
    const vals = Array.from({ length: 16 }, (_, k) => (k % 4 === 0 ? -9999 : 0.5));
    const { img, values } = await readTiff(utmTiff(vals, 4, 4));
    const i = inspectAnalyticalValues(values, 4, 4, -9999, [-1, 1]);
    expect([i.validCells, i.noDataCells, i.min, i.max]).toEqual([12, 4, 0.5, 0.5]);
    const grid = { epsg: Number(img.getGeoKeys()?.ProjectedCSTypeGeoKey), resolution: img.getResolution() };
    expect(judgeAnalytical(i, { width: 4, height: 4, processingVersion: VERIFIED_NATIVE_VERSION, grid }).kind).toBe("verified");
  });
  it("v7 analysis on EPSG:3857 (like the legacy files) is invalid", () => {
    const i = inspectAnalyticalValues([0.4, 0.5, 0.6, 0.7], 2, 2, -9999, [-1, 1]);
    expect(judgeAnalytical(i, { processingVersion: VERIFIED_NATIVE_VERSION, grid: { epsg: 3857, resolution: [8.125, -10] } }).kind).toBe("invalid");
  });
  it("NDVI outside [-1,1] does not count as valid", () => {
    expect(inspectAnalyticalValues([3, -9999, 0.2], 3, 1, -9999, [-1, 1]).validCells).toBe(1);
  });
});

describe("timeline and status gating", () => {
  const entry = { date: "2026-08-01", status: "available", paddockCount: 8, activeCount: 8, coveragePercent: 100 };
  const ids = Array.from({ length: 8 }, (_, i) => `a${i}`);
  const blank: RasterVerdict = { kind: "blank", message: "0 visible" };
  it("8/8 saved but all blank becomes stored_blank with 0 usable", () => {
    const v = new Map(ids.map((id) => [id, blank]));
    const [out] = applyRasterVerdicts([entry], () => ids, v);
    expect(out.status).toBe("stored_blank");
    expect(out.paddockCount).toBe(0);
    expect(out.coveragePercent).toBe(0);
  });
  it("partially blank date is partial with only usable paddocks counted", () => {
    const v = new Map<string, RasterVerdict>(ids.map((id, i) => [id, i < 3 ? { kind: "legacy", message: "" } : blank]));
    const [out] = applyRasterVerdicts([entry], () => ids, v);
    expect([out.status, out.paddockCount]).toEqual(["partial", 3]);
  });
  it("unchecked dates keep server status but are noted as not yet checked", () => {
    const [out] = applyRasterVerdicts([entry], () => ids, new Map());
    expect(out.status).toBe("available");
    expect(out.note).toContain("not yet checked");
  });
  it("view model reports stored_blank, not loading or displayed, and no spinner", () => {
    const vm = deriveCropHealthViewModel({
      manifest: {
        paddocks: [], date_coverage: [{
          acquisition_date: "2026-08-01", paddocks: [{
            paddock_id: "p1", scene_id: "s1",
            layers: [{ index_type: "NDVI", display: { asset_id: "d1", processing_version: "sentinel2-v6-native-10m" } }],
          }],
        }],
      } as never,
      selectedDate: "2026-08-01", selectedLayer: "NDVI",
      activePaddocks: [{ id: "p1", name: "Block 1" }],
      displayLoadState: new Map([[displayKeyFor("p1", "2026-08-01", "NDVI", "d1"), { phase: "failed" as const, verdict: "blank" as const, errorMessage: "0 of 528 pixels visible" }]]),
      analyticalLoadState: new Map(), overlayLifecycle: new Map(),
    });
    const p = vm.byId.p1;
    expect(p.availabilityReason).toBe("stored_blank");
    expect(p.displayStatus).toBe("failed");
    expect(vm.summary.storedBlank).toBe(1);
    expect(vm.summary.usableDisplays).toBe(0);
    expect(reasonToCustomerMessage("stored_blank", "NDVI")).not.toBe(reasonToCustomerMessage("no_scene_for_date", "NDVI"));
  });
});
