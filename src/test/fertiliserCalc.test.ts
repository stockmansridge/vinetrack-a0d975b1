import { describe, it, expect } from "vitest";
import {
  computeCalculation,
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
      packSize: 1000, // kg pack size but g rate — unit responsibility of caller
      pricePerPack: 200,
      allocations: blocks,
    });
    expect(r.totalVines).toBe(10_000);
    expect(r.totalProductRequired).toBe(50_000);
    expect(r.allocations[0].productRequired).toBe(20_000);
    expect(r.allocations[1].productRequired).toBe(30_000);
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
