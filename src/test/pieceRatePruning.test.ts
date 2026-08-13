import { describe, it, expect } from "vitest";
import {
  parseVineCountOverrideInput,
  readVineCountOverride,
  withVineCountOverride,
  calculatedRowVineCount,
  effectiveRowVineCount,
  sumEffectiveRowVineCounts,
  mergeGeneratedGeometry,
  parseRawRows,
} from "@/lib/paddockRowVines";
import {
  pieceRateTotalCost,
  resolveCostingMethod,
  taskLabourCost,
  costPerHectare,
} from "@/lib/pieceRateCosting";
import { allocationPieceRateRows } from "@/lib/pruningActivityContract";

const row = (n: number, extra: Record<string, any> = {}) => ({
  id: `row-${n}`,
  number: n,
  startPoint: { latitude: -34.0, longitude: 138.0 },
  endPoint: { latitude: -34.001, longitude: 138.0 },
  ...extra,
});

describe("per-row vine count override (SQL 188)", () => {
  it("reads an existing override and ignores invalid values", () => {
    expect(readVineCountOverride(row(1, { vineCountOverride: 182 }))).toBe(182);
    expect(readVineCountOverride(row(1))).toBeNull();
    expect(readVineCountOverride(row(1, { vineCountOverride: 0 }))).toBeNull();
    expect(readVineCountOverride(row(1, { vineCountOverride: -5 }))).toBeNull();
    expect(readVineCountOverride(row(1, { vineCountOverride: 12.5 }))).toBeNull();
  });

  it("validates user input: whole positive numbers, blank clears", () => {
    expect(parseVineCountOverrideInput("182")).toEqual({ ok: true, value: 182 });
    expect(parseVineCountOverrideInput("")).toEqual({ ok: true, value: null });
    expect(parseVineCountOverrideInput("  ")).toEqual({ ok: true, value: null });
    expect(parseVineCountOverrideInput("-3").ok).toBe(false);
    expect(parseVineCountOverrideInput("12.5").ok).toBe(false);
    expect(parseVineCountOverrideInput("0").ok).toBe(false);
  });

  it("sets and clears the key without dropping other row properties", () => {
    const original = row(12, { customMobileKey: "keep me", vineCountOverride: 100 });
    const set = withVineCountOverride(original, 182);
    expect(set).toMatchObject({ id: "row-12", number: 12, customMobileKey: "keep me", vineCountOverride: 182 });
    expect(set.startPoint).toEqual(original.startPoint);

    const cleared = withVineCountOverride(set, null);
    expect("vineCountOverride" in cleared).toBe(false);
    expect(cleared.customMobileKey).toBe("keep me");
    expect(cleared.id).toBe("row-12");
  });

  it("effective count = override ?? calculated", () => {
    const spacing = 1.8;
    const plain = row(1);
    const calculated = calculatedRowVineCount(plain, spacing, 336);
    expect(calculated).toBe(Math.round(336 / 1.8));
    expect(effectiveRowVineCount(plain, spacing, 336)).toBe(calculated);
    expect(effectiveRowVineCount(row(1, { vineCountOverride: 182 }), spacing, 336)).toBe(182);
  });

  it("block total from rows sums effective counts", () => {
    const rows = [
      row(1, { vineCountOverride: 180 }),
      row(2, { vineCountOverride: 184 }),
      row(3, { vineCountOverride: 176 }),
    ];
    expect(sumEffectiveRowVineCounts(rows, 1.8, 100)).toBe(540);
  });

  it("merging regenerated geometry preserves ids, overrides and unknown keys", () => {
    const stored = parseRawRows([
      row(1, { vineCountOverride: 182, syncTag: "abc" }),
      row(2, { syncTag: "def" }),
    ]);
    const generated = [
      { id: "regen-a", number: 1, startPoint: { latitude: -35, longitude: 139 }, endPoint: { latitude: -35.1, longitude: 139 } },
      { id: "regen-b", number: 2, startPoint: { latitude: -35, longitude: 139.01 }, endPoint: { latitude: -35.1, longitude: 139.01 } },
    ];
    const merged = mergeGeneratedGeometry(stored, generated);
    expect(merged[0].id).toBe("row-1");
    expect(merged[0].vineCountOverride).toBe(182);
    expect(merged[0].syncTag).toBe("abc");
    // geometry refreshed
    expect(merged[0].startPoint).toEqual({ latitude: -35, longitude: 139 });
    expect(merged[1].id).toBe("row-2");
    expect(merged[1].vineCountOverride).toBeUndefined();
  });
});

describe("piece rate costing (SQL 188)", () => {
  it("legacy and new tasks resolve to hourly by default", () => {
    expect(resolveCostingMethod(null)).toBe("hourly");
    expect(resolveCostingMethod({})).toBe("hourly");
    expect(resolveCostingMethod({ costing_method: null })).toBe("hourly");
    expect(resolveCostingMethod({ costing_method: "something_else" })).toBe("hourly");
    // never inferred from the presence of a rate
    expect(resolveCostingMethod({ piece_rate_per_vine: 1.27 } as any)).toBe("hourly");
    expect(resolveCostingMethod({ costing_method: "piece_rate" })).toBe("piece_rate");
  });

  it("matches the contract worked examples exactly", () => {
    expect(pieceRateTotalCost(2238, 1.27)).toBe(2842.26);
    expect(pieceRateTotalCost(540, 1.25)).toBe(675);
    expect(pieceRateTotalCost(3, 0.1)).toBe(0.3);
    expect(pieceRateTotalCost(1, 0.005)).toBe(0.01); // half away from zero
    expect(pieceRateTotalCost(null, 1.27)).toBeNull();
    expect(pieceRateTotalCost(100, null)).toBeNull();
  });

  it("uses exactly one labour total, never a sum", () => {
    const hourly = { costing_method: "hourly" };
    expect(taskLabourCost(hourly, 412.5)).toBe(412.5);

    const piece = {
      costing_method: "piece_rate",
      piece_rate_total_cost: 2842.26,
      piece_vine_count: 2238,
      piece_rate_per_vine: 1.27,
    };
    expect(taskLabourCost(piece, 999)).toBe(2842.26);

    // generated column not read back yet -> derived from snapshot columns
    expect(taskLabourCost(
      { costing_method: "piece_rate", piece_vine_count: 2238, piece_rate_per_vine: 1.27 },
      999,
    )).toBe(2842.26);
  });

  it("historical jobs keep their snapshot when vineyard rows change", () => {
    const saved = {
      costing_method: "piece_rate",
      piece_vine_count: 540,
      piece_rate_per_vine: 1.25,
      piece_rate_total_cost: 675,
    };
    // rows edited later to 600 vines — the saved job must not move
    expect(taskLabourCost(saved, 0)).toBe(675);
    expect(saved.piece_vine_count).toBe(540);
  });

  it("hours never affect a piece rate cost", () => {
    const piece = { costing_method: "piece_rate", piece_rate_total_cost: 2842.26 };
    expect(taskLabourCost(piece, 0)).toBe(2842.26);
    expect(taskLabourCost(piece, 5000)).toBe(2842.26);
  });

  it("cost per hectare", () => {
    expect(costPerHectare(2842.26, 0.99)).toBe(2870.97);
    expect(costPerHectare(2842.26, 0)).toBeNull();
    expect(costPerHectare(null, 5)).toBeNull();
  });
});

describe("piece rate quantity from selected rows", () => {
  const alloc = (quarters: Record<string, any>) => ({
    paddockId: "pad-1",
    paddockName: "Block A",
    variety: "Shiraz",
    quarters,
    seasonId: null,
  });

  it("uses effective vine counts of the selected quarters, grouped per row", () => {
    const a = alloc({
      "1:1": { rowNumber: 1, segmentNumber: 1, paddockRowId: "r1", rowLabel: "1", vines: 45, effVines: 45.5 },
      "1:2": { rowNumber: 1, segmentNumber: 2, paddockRowId: "r1", rowLabel: "1", vines: 45, effVines: 45.5 },
      "1:3": { rowNumber: 1, segmentNumber: 3, paddockRowId: "r1", rowLabel: "1", vines: 45, effVines: 45.5 },
      "1:4": { rowNumber: 1, segmentNumber: 4, paddockRowId: "r1", rowLabel: "1", vines: 45, effVines: 45.5 },
      "2:1": { rowNumber: 2, segmentNumber: 1, paddockRowId: "r2", rowLabel: "2", vines: 45, effVines: 46 },
    });
    const rows = allocationPieceRateRows(a as any);
    expect(rows).toEqual([
      { paddock_id: "pad-1", paddock_row_id: "r1", row_number: 1, vine_count: 182 },
      { paddock_id: "pad-1", paddock_row_id: "r2", row_number: 2, vine_count: 46 },
    ]);
  });

  it("falls back to the standard estimate when no override data is present", () => {
    const a = alloc({
      "3:1": { rowNumber: 3, segmentNumber: 1, paddockRowId: "r3", rowLabel: "3", vines: 40 },
    });
    expect(allocationPieceRateRows(a as any)[0].vine_count).toBe(40);
  });
});
