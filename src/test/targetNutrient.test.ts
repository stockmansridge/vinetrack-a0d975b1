// Target Nutrient (Preview) math — contract examples and edge cases.
import { describe, it, expect } from "vitest";
import {
  computeTargetNutrient,
  buildProductAnalysisSnapshot,
  seedAnalysisFromLegacyProduct,
  NUTRIENT_CONTRACT_VERSION,
  type NutrientAnalysisEntry,
} from "@/lib/targetNutrient";

const base = {
  form: "solid" as const,
  targetRateUnit: "g/vine" as const,
  targetRate: 2,
  nutrientPercent: 16,
  nutrientPercentSource: "product_analysis" as const,
  analysisBasis: "elemental" as const,
  concentrationBasis: "w/w" as const,
  totalAreaHa: 2,
  totalVines: 4000,
};

describe("computeTargetNutrient — contract examples", () => {
  it("16% N, target 2 g N/vine = 12.5 g product/vine", () => {
    const r = computeTargetNutrient(base);
    expect(r.productPerVine).toBe(12.5);
    expect(r.productPerVineUnit).toBe("g/vine");
    expect(r.productUnit).toBe("kg");
    expect(r.totalProductRequired).toBe(50); // 12.5 g × 4000 vines ÷ 1000
    expect(r.totalNutrientKg).toBe(8); // 2 g × 4000 ÷ 1000
    expect(r.issues).toEqual([]);
  });

  it("20% Ca, target 2 g Ca/vine = 10 g product/vine", () => {
    const r = computeTargetNutrient({ ...base, nutrientPercent: 20 });
    expect(r.productPerVine).toBe(10);
    expect(r.totalProductRequired).toBe(40);
  });

  it("16% w/v liquid, target 2 g/vine = 12.5 mL product/vine (no density)", () => {
    const r = computeTargetNutrient({
      ...base,
      form: "liquid",
      concentrationBasis: "w/v",
    });
    expect(r.productPerVine).toBe(12.5);
    expect(r.productPerVineUnit).toBe("mL/vine");
    expect(r.productUnit).toBe("L");
    expect(r.totalProductRequired).toBe(50);
    expect(r.issues).toEqual([]);
  });

  it("kg/ha target: 30 kg N/ha at 46% (urea) over 2 ha", () => {
    const r = computeTargetNutrient({
      ...base,
      targetRateUnit: "kg/ha",
      targetRate: 30,
      nutrientPercent: 46,
    });
    expect(r.productPerHa).toBeCloseTo(65.217, 3);
    expect(r.productPerHaUnit).toBe("kg/ha");
    expect(r.totalNutrientKg).toBe(60);
    expect(r.totalProductRequired).toBeCloseTo(130.435, 3);
  });
});

describe("density rules", () => {
  const liquidWW = { ...base, form: "liquid" as const, concentrationBasis: "w/w" as const };

  it("w/w liquid without density blocks the volume result and explains why", () => {
    const r = computeTargetNutrient(liquidWW);
    expect(r.productPerVine).toBeNull();
    expect(r.productUnit).toBe("kg"); // mass stays honest
    expect(r.totalProductRequired).toBe(50); // mass still known
    expect(r.issues.some((m) => m.toLowerCase().includes("density"))).toBe(true);
  });

  it("w/w liquid with density converts mass to volume", () => {
    const r = computeTargetNutrient({ ...liquidWW, densityKgPerL: 1.25 });
    expect(r.productPerVine).toBe(10); // 12.5 g ÷ 1.25 kg/L = 10 mL
    expect(r.productPerVineUnit).toBe("mL/vine");
    expect(r.productUnit).toBe("L");
    expect(r.totalProductRequired).toBe(40); // 50 kg ÷ 1.25
    expect(r.issues).toEqual([]);
  });
});

describe("other nutrients also applied", () => {
  const others: NutrientAnalysisEntry[] = [
    { nutrientKey: "K", displayName: "Potassium", percent: 10, analysisBasis: "oxide", concentrationBasis: "w/w", sourceKind: "product_analysis" },
    { nutrientKey: "Zn", displayName: "Zinc", percent: 0, analysisBasis: "elemental", concentrationBasis: "w/w", sourceKind: "manual" },
  ];

  it("computes co-applied amounts honouring each nutrient's own basis", () => {
    const r = computeTargetNutrient({ ...base, otherNutrients: others });
    const k = r.others.find((o) => o.nutrientKey === "K")!;
    expect(k.totalKg).toBe(5); // 50 kg product × 10%
    expect(k.perVineG).toBe(1.25);
    expect(k.perHaKg).toBe(2.5);
    expect(k.analysisBasis).toBe("oxide"); // label travels, never converted
    const zn = r.others.find((o) => o.nutrientKey === "Zn")!;
    expect(zn.totalKg).toBeNull();
    expect(zn.note).toBeTruthy();
  });

  it("w/v co-nutrient needs a product volume — flagged when density is missing", () => {
    const r = computeTargetNutrient({
      ...base,
      form: "liquid",
      concentrationBasis: "w/w",
      otherNutrients: [
        { nutrientKey: "B", displayName: "Boron", percent: 2, analysisBasis: "elemental", concentrationBasis: "w/v", sourceKind: "product_analysis" },
      ],
    });
    const b = r.others[0];
    expect(b.totalKg).toBeNull();
    expect(b.note).toMatch(/density/i);
  });
});

describe("invalid input", () => {
  it("rejects missing/invalid percent and target", () => {
    const r = computeTargetNutrient({ ...base, nutrientPercent: 0, targetRate: 0 });
    expect(r.issues.length).toBe(2);
    expect(r.totalProductRequired).toBe(0);
  });

  it("rejects percent over 100", () => {
    const r = computeTargetNutrient({ ...base, nutrientPercent: 140 });
    expect(r.issues.some((m) => m.includes("between 0 and 100"))).toBe(true);
  });
});

describe("snapshot + seeding", () => {
  it("builds the contract snapshot shape (schema_version 1)", () => {
    const snap = buildProductAnalysisSnapshot([
      { nutrientKey: "N", displayName: "Nitrogen", percent: 16, analysisBasis: "elemental", concentrationBasis: "w/w", sourceKind: "product_analysis", isPrimary: true },
      { nutrientKey: "other:humic", displayName: "Humic acid", percent: 5, analysisBasis: "elemental", concentrationBasis: "w/v", sourceKind: "manual", sourceReference: "label photo" },
    ]);
    expect(snap.schema_version).toBe(1);
    expect(snap.nutrients).toHaveLength(2);
    expect(snap.nutrients[0]).toMatchObject({
      nutrient_key: "N", percent: 16, analysis_basis: "elemental",
      concentration_basis: "w/w", source_kind: "product_analysis", is_primary: true,
    });
    expect(snap.nutrients[1].declared_as).toBe("5% elemental w/v");
    expect(NUTRIENT_CONTRACT_VERSION).toBe("1");
  });

  it("never assumes legacy percentages are w/w", () => {
    expect(seedAnalysisFromLegacyProduct({ nitrogen_percent: 16, phosphorus_percent: null, potassium_percent: null, analysis_basis: "elemental" })).toEqual([]);
  });

  it("seeds local analysis only with known bases", () => {
    const entries = seedAnalysisFromLegacyProduct({
      nitrogen_percent: 16, phosphorus_percent: null, potassium_percent: 10,
      analysis_basis: "oxide",
      concentration_basis: "w/v",
    });
    expect(entries.map((e) => e.nutrientKey)).toEqual(["N", "K"]);
    expect(entries[0].analysisBasis).toBe("oxide");
    expect(entries[0].concentrationBasis).toBe("w/v");
    expect(entries[0].sourceKind).toBe("product_analysis");
    expect(entries[0].isPrimary).toBe(true);
  });
});
