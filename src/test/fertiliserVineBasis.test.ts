import { describe, it, expect } from "vitest";
import { actualVineCount, assumedFullVineCount, resolveVineBasis, type BasisBlock } from "@/lib/fertiliserVineBasis";
import { computeCalculation } from "@/lib/fertiliserCalc";

// Rows with an explicit length_m so geometry is deterministic.
const rows = (lens: number[], overrides: (number | undefined)[] = []) =>
  lens.map((l, i) => ({ number: i + 1, length_m: l, ...(overrides[i] ? { vineCountOverride: overrides[i] } : {}) }));

describe("Actual vine count", () => {
  it("block override resolves as Actual", () => {
    expect(actualVineCount({ vine_count_override: 4200, vine_spacing: 1, rows: rows([100]) }))
      .toEqual({ actualVineCount: 4200, actualVineCountSource: "block_override" });
  });
  it("complete per-row overrides resolve as Actual", () => {
    expect(actualVineCount({ vine_spacing: 1, rows: [{ number: 1, vineCountOverride: 180 }, { number: 2, vineCountOverride: 175 }] }))
      .toEqual({ actualVineCount: 355, actualVineCountSource: "row_overrides" });
  });
  it("row overrides count only when every row resolves (partial rejected)", () => {
    // Row 2 has no override and no start/end geometry → incomplete.
    expect(actualVineCount({ vine_spacing: 1, rows: [{ number: 1, vineCountOverride: 180 }, { number: 2 }] }).actualVineCountSource)
      .toBe("unavailable");
  });
  it("no physical/manual count → unavailable", () => {
    expect(actualVineCount({ vine_spacing: 1.5, rows: rows([300, 300]) }))
      .toEqual({ actualVineCount: null, actualVineCountSource: "unavailable" });
  });
});

describe("Assumed full vine count", () => {
  it("ignores block override and uses row length ÷ spacing", () => {
    expect(assumedFullVineCount({ vine_count_override: 10, vine_spacing: 2, rows: rows([1000, 1000]) }).count).toBe(1000);
  });
  it("ignores per-row vine-count overrides", () => {
    expect(assumedFullVineCount({ vine_spacing: 2, rows: rows([1000, 1000], [3, 4]) }).count).toBe(1000);
  });
  it("respects a row-length override", () => {
    expect(assumedFullVineCount({ vine_spacing: 2, rows: rows([1000, 1000]), row_length_override: 500 }).count).toBe(500);
  });
  it("missing vine spacing → unavailable", () => {
    expect(assumedFullVineCount({ vine_spacing: null, rows: rows([1000]) })).toEqual({ count: null, reason: "no_vine_spacing" });
  });
  it("missing row length → unavailable", () => {
    expect(assumedFullVineCount({ vine_spacing: 2, rows: [] })).toEqual({ count: null, reason: "no_row_length" });
  });
});

const blk = (id: string, actual: number | null, full: number | null, stored = 1): BasisBlock => ({
  id, name: `Block ${id}`, areaHa: 1, vineCount: stored,
  actualVineCount: actual, actualVineCountSource: actual == null ? "unavailable" : "block_override",
  assumedFullVineCount: full, assumedFullReason: full == null ? "no_vine_spacing" : null,
});
const calcFor = (basis: any, blocks: BasisBlock[], mode: any = "perVine", ids?: Set<string>) => {
  const r = resolveVineBasis(blocks, mode, basis, ids);
  const c = computeCalculation({
    mode, applicationRate: 10, packSize: null, pricePerPack: null, labourCost: 0, machineryCost: 0,
    allocations: r.blocks.map((x) => ({ paddockId: x.block.id, paddockName: x.block.name, areaHa: x.block.areaHa, vineCount: x.vineCount })),
  } as any);
  return { r, c };
};

describe("Calculator basis", () => {
  const two = [blk("A", 4200, 5000), blk("B", 3600, 4000)];
  it("Actual: 4,200 + 3,600 = 7,800 and reconciles", () => {
    const { c, r } = calcFor("actual", two);
    expect(r.issues).toEqual([]);
    expect(c.allocations.map((a) => a.vineCount)).toEqual([4200, 3600]);
    expect(c.totalVines).toBe(7800);
    expect(c.allocations.reduce((s, a) => s + a.productRequired, 0)).toBeCloseTo(c.totalProductRequired, 3);
    expect(c.totalProductRequired).toBeCloseTo(78, 3);
  });
  it("Assumed full: 5,000 + 4,000 = 9,000; switching recalculates", () => {
    const { c } = calcFor("assumed_full", two);
    expect(c.allocations.map((a) => a.vineCount)).toEqual([5000, 4000]);
    expect(c.totalVines).toBe(9000);
    expect(c.totalProductRequired).toBeCloseTo(90, 3);
  });
  it("missing counts produce blocking issues naming the blocks", () => {
    expect(calcFor("actual", [blk("4", null, 5000), blk("5", null, 1)]).r.issues[0])
      .toBe("Actual vine count is not available for Block 4 and Block 5. Add a vine-count override in Block Setup or use Assumed full vine count.");
    expect(calcFor("assumed_full", [blk("7", 1, null)]).r.issues[0])
      .toBe("Assumed full vine count cannot be calculated for Block 7 because vine spacing is not available.");
  });
  it("Per Hectare is unaffected by the basis", () => {
    const { c, r } = calcFor("actual", [blk("4", null, null, 123)], "perHectare");
    expect(r.issues).toEqual([]);
    expect(c.totalAreaHa).toBe(1);
    expect(c.totalProductRequired).toBeCloseTo(10, 3);
  });
  it("no-block manual vine count is unaffected", () => {
    expect(resolveVineBasis([], "perVine", "actual")).toEqual({ blocks: [], issues: [] });
    const c = computeCalculation({ mode: "perVine", applicationRate: 10, packSize: null, pricePerPack: null, labourCost: 0, machineryCost: 0, allocations: [], manual: { vineCount: 2000 } } as any);
    expect(c.totalVines).toBe(2000);
  });
  it("legacy record keeps stored allocation vine counts (snapshot), never today's block settings", () => {
    const stored = [blk("A", 4200, 5000, 4100), blk("B", 3600, 4000, 3900)];
    const { c, r } = calcFor("snapshot", stored, "perVine", new Set(["A", "B"]));
    expect(r.issues).toEqual([]);
    expect(c.allocations.map((a) => a.vineCount)).toEqual([4100, 3900]);
    expect(c.totalVines).toBe(8000);
  });
});
