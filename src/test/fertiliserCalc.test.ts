import { describe, it, expect } from "vitest";
import {
  compareInventory,
  computeCalculation,
  isFertiliserProduct,
  packBreakdown,
  seasonProductCost,
  costPerHectare,
  costPerVine,
  defaultProductUnit,
  defaultRateUnit,
  round2,
} from "@/lib/fertiliserCalc";

describe("fertiliserCalc.computeCalculation", () => {
  const blocks = [
    { paddockId: "a", paddockName: "A", areaHa: 2, vineCount: 4000 },
    { paddockId: "b", paddockName: "B", areaHa: 3, vineCount: 6000 },
  ];

  it("perHectare distributes product proportional to area", () => {
    const r = computeCalculation({
      mode: "perHectare",
      applicationRate: 50, // kg/ha
      packSize: 25,
      pricePerPack: 100,
      allocations: blocks,
    });
    expect(r.totalAreaHa).toBe(5);
    expect(r.totalProductRequired).toBe(250); // 50 * 5
    expect(r.packCount).toBe(10);
    expect(r.estimatedProductCost).toBe(1000);
    expect(r.allocations[0].productRequired).toBe(100);
    expect(r.allocations[1].productRequired).toBe(150);
    // Cost reconciles to parent exactly.
    const sum = r.allocations.reduce((s, a) => s + (a.allocatedCost ?? 0), 0);
    expect(round2(sum)).toBe(r.estimatedProductCost);
  });

  it("perVine multiplies rate by vine count", () => {
    const r = computeCalculation({
      mode: "perVine",
      applicationRate: 5, // g/vine
      packSize: 25,
      pricePerPack: 200,
      allocations: blocks,
    });
    // g/vine × vines ÷ 1000 = kg
    expect(r.totalVines).toBe(10_000);
    expect(r.totalProductRequired).toBe(50);
    expect(r.allocations[0].productRequired).toBe(20);
    expect(r.allocations[1].productRequired).toBe(30);
  });

  it("includes labour and machinery in totalJobCost", () => {
    const r = computeCalculation({
      mode: "perHectare",
      applicationRate: 10,
      packSize: 20,
      pricePerPack: 40,
      labourCost: 250,
      machineryCost: 120,
      allocations: blocks,
    });
    // total product = 10 * 5 = 50 kg → 2.5 packs → 2.5 * 40 = 100 product cost
    expect(r.estimatedProductCost).toBe(100);
    expect(r.totalJobCost).toBe(round2(100 + 250 + 120));
  });

  it("returns null pack_count and product cost when pack size missing", () => {
    const r = computeCalculation({
      mode: "perHectare",
      applicationRate: 10,
      allocations: blocks,
    });
    expect(r.packCount).toBeNull();
    expect(r.estimatedProductCost).toBeNull();
    for (const a of r.allocations) expect(a.allocatedCost).toBeNull();
  });

  it("handles zero-area/zero-vine blocks without exploding", () => {
    const r = computeCalculation({
      mode: "perHectare",
      applicationRate: 25,
      packSize: 10,
      pricePerPack: 50,
      allocations: [
        { paddockId: "a", paddockName: "A", areaHa: 0, vineCount: 0 },
        { paddockId: "b", paddockName: "B", areaHa: 4, vineCount: 8000 },
      ],
    });
    expect(r.allocations[0].productRequired).toBe(0);
    expect(r.allocations[0].allocatedCost).toBe(0);
    expect(r.allocations[1].productRequired).toBe(100);
    expect(r.allocations[1].allocatedCost).toBe(r.estimatedProductCost);
  });
});

describe("fertiliserCalc.defaults", () => {
  it("rate + product units match form", () => {
    expect(defaultRateUnit("perHectare", "solid")).toBe("kg/ha");
    expect(defaultRateUnit("perHectare", "liquid")).toBe("L/ha");
    expect(defaultRateUnit("perVine", "solid")).toBe("g/vine");
    expect(defaultRateUnit("perVine", "liquid")).toBe("mL/vine");
    expect(defaultProductUnit("solid")).toBe("kg");
    expect(defaultProductUnit("liquid")).toBe("L");
  });
});

describe("fertiliserCalc iOS parity", () => {
  it("per hectare liquid", () => {
    const r = computeCalculation({ mode: "perHectare", applicationRate: 4, allocations: [{ paddockId: "a", paddockName: "A", areaHa: 2.5, vineCount: 0 }] });
    expect(r.totalProductRequired).toBe(10);
  });
  it("per vine liquid mL/vine ÷ 1000 = L", () => {
    const r = computeCalculation({ mode: "perVine", applicationRate: 200, allocations: [{ paddockId: "a", paddockName: "A", areaHa: 1, vineCount: 3000 }] });
    expect(r.totalProductRequired).toBe(600);
  });
  it("manual calculation with no blocks", () => {
    const v = computeCalculation({ mode: "perVine", applicationRate: 5, allocations: [], manual: { vineCount: 10_000 } });
    expect(v.totalProductRequired).toBe(50);
    expect(v.allocations).toEqual([]);
    const h = computeCalculation({ mode: "perHectare", applicationRate: 50, allocations: [], manual: { areaHa: 3 } });
    expect(h.totalProductRequired).toBe(150);
  });
  it("pack breakdown: 2.4 packs → 2 full, 0.4/40%, 3 to open", () => {
    expect(packBreakdown(60, 25)).toEqual({ packsRequired: 2.4, fullPacks: 2, partialPack: 0.4, partialPercent: 40, packsToOpen: 3 });
    expect(packBreakdown(50, 25)?.packsToOpen).toBe(2);
    expect(packBreakdown(50, null)).toBeNull();
  });
  it("product cost override reconciles across blocks", () => {
    const r = computeCalculation({ mode: "perHectare", applicationRate: 10, productCostOverride: 100.01, allocations: [
      { paddockId: "a", paddockName: "A", areaHa: 1, vineCount: 0 },
      { paddockId: "b", paddockName: "B", areaHa: 2, vineCount: 0 },
    ] });
    expect(r.estimatedProductCost).toBe(100.01);
    expect(round2(r.allocations.reduce((s, a) => s + (a.allocatedCost ?? 0), 0))).toBe(100.01);
    expect(computeCalculation({ mode: "perHectare", applicationRate: 10, packSize: 1, pricePerPack: 5, productCostOverride: null, allocations: [] }).estimatedProductCost).toBeNull();
  });
  it("cost per ha / vine", () => {
    expect(costPerHectare(500, 5)).toBe(100);
    expect(costPerVine(500, 10_000)).toBe(0.05);
    expect(costPerHectare(null, 5)).toBeNull();
  });
  it("season price cost converts kg → g base", () => {
    expect(seasonProductCost({ pricing_basis: "season_weighted_purchase_average", weighted_cost_per_base_unit: 0.004, base_unit: "g" }, 50, "kg")).toBe(200);
    expect(seasonProductCost({ pricing_basis: "season_purchase_cost_unavailable", weighted_cost_per_base_unit: 0.004, base_unit: "g" }, 50, "kg")).toBeNull();
    expect(seasonProductCost({ pricing_basis: "season_weighted_purchase_average", weighted_cost_per_base_unit: 0.004, base_unit: "mL" }, 50, "kg")).toBeNull();
  });
  it("inventory comparison converts g → kg and flags shortage", () => {
    expect(compareInventory(30000, "g", 50, "kg")).toEqual({ available: 30, required: 50, after: -20, shortage: true, unit: "kg" });
    expect(compareInventory(100, "L", 50, "kg")).toBeNull();
  });
  it("uncategorised products are not fertiliser", () => {
    expect(isFertiliserProduct({ product_category: null })).toBe(false);
    expect(isFertiliserProduct({ product_category: "granularFertiliser" })).toBe(true);
    expect(isFertiliserProduct({ product_category: "fungicide" })).toBe(false);
  });
});
