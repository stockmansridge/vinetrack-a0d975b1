import { describe, it, expect } from "vitest";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { actualVineCount, assumedFullVineCount } from "@/lib/fertiliserVineBasis";

const rows = (lens: number[], nums?: number[]) =>
  lens.map((l, i) => ({ number: nums?.[i] ?? i + 1, length_m: l }));
const base = (extra: Record<string, any> = {}) => ({ rows: rows([100, 120, 110]), ...extra });

describe("row length resolver", () => {
  it("geometry only → 330 m", () => {
    const m = deriveMetrics(base());
    expect(m.totalRowLengthM).toBeCloseTo(330, 6);
    expect(m.rowLengthSource).toBe("geometry");
  });
  it("singular override is the block total: 315 m, not 945 m", () => {
    const m = deriveMetrics(base({ row_length_override: 315 }));
    expect(m.totalRowLengthM).toBe(315);
    expect(m.rowLengthSource).toBe("block-override");
  });
  it("plural row overrides → 95 + 120 + 108 = 323 m", () => {
    const m = deriveMetrics(base({ row_length_overrides: { "1": 95, "3": 108 } }));
    expect(m.totalRowLengthM).toBeCloseTo(323, 6);
    expect(m.rowLengthSource).toBe("per-row-override");
  });
  it("plural wins over singular", () => {
    const m = deriveMetrics(base({ row_length_override: 315, row_length_overrides: { "1": 95, "3": 108 } }));
    expect(m.totalRowLengthM).toBeCloseTo(323, 6);
  });
  it("plural keys use row number and support decimals", () => {
    const m = deriveMetrics({ rows: rows([100, 120], [1, 3.5]), row_length_overrides: { "3.5": 244.2 } });
    expect(m.totalRowLengthM).toBeCloseTo(344.2, 6);
  });
  it("invalid / non-positive plural entries ignored", () => {
    const m = deriveMetrics(base({ row_length_overrides: { "1": 0, "2": -5, "3": "abc" } }));
    expect(m.totalRowLengthM).toBeCloseTo(330, 6);
    expect(m.rowLengthSource).toBe("geometry");
  });
});

describe("Assumed full vine count", () => {
  it("323 m ÷ 1.2 m → 269", () => {
    expect(assumedFullVineCount(base({ vine_spacing: 1.2, row_length_overrides: { "1": 95, "3": 108 } })).count).toBe(269);
  });
  it("singular 315 m ÷ 1.2 m → 262", () => {
    expect(assumedFullVineCount(base({ vine_spacing: 1.2, row_length_override: 315 })).count).toBe(262);
  });
  it("Actual ignores row-length overrides", () => {
    const p = base({ vine_spacing: 1.2, vine_count_override: 250, row_length_override: 315, row_length_overrides: { "1": 95 } });
    expect(actualVineCount(p)).toEqual({ actualVineCount: 250, actualVineCountSource: "block_override" });
  });
});
