// Portal ↔ iOS parity for the Canopy & Spray Volume path.
//
// A Program Step stores reusable configuration only. A live Plan Spray with
// real block geometry must resolve dilute reference, actual sprayer output,
// both representations, concentration factor and total water exactly as iOS.
import { describe, expect, it } from "vitest";
import { calculateCarrier, calculateProducts } from "@/lib/sprayCalculation";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import type { SprayProductLine } from "@/lib/sprayApplicationDomain";

const noGeometry = (): ApplicationGeometry =>
  ({
    grossAreaHa: null,
    treatedAreaHa: null,
    canonicalRowLengthMetres: null,
    rowSpacingMetres: null,
    uniformRowSpacing: true,
    geometrySource: "unavailable",
    geometryQuality: "incomplete",
    blocks: [],
    issues: ["no_blocks_selected"],
    diagnostics: [],
  }) as unknown as ApplicationGeometry;

// 0.49 ha at 2.8 m rows = 1,750 m of row.
const block = (): ApplicationGeometry =>
  ({
    grossAreaHa: 0.49,
    treatedAreaHa: 0.49,
    canonicalRowLengthMetres: 1750,
    rowSpacingMetres: 2.8,
    uniformRowSpacing: true,
    geometrySource: "mapped_rows",
    geometryQuality: "complete",
    blocks: [],
    issues: [],
    diagnostics: [],
  }) as unknown as ApplicationGeometry;

const smallVsp = { canopyType: "vsp", canopySize: "small", canopyDensity: "low" } as const;

const errors = (d: { severity: string }[]) => d.filter((x) => x.severity === "error");

describe("A — Program Step, L/100 m, VSP/Small/Low", () => {
  const c = calculateCarrier({
    geometry: noGeometry(),
    mode: "whole_block",
    templateMode: true,
    carrier: { basis: "l_per_100m", sprayerOutputChoice: "recommended", ...smallVsp },
  });
  it("shows the AWRI 10 L/100 m reference and saves without blocks", () => {
    expect(c.recommendedDiluteLitresPer100m).toBe(10);
    expect(errors(c.diagnostics)).toHaveLength(0);
  });
});

describe("B — Program Step, L/ha, use recommended volume", () => {
  const c = calculateCarrier({
    geometry: noGeometry(),
    mode: "whole_block",
    templateMode: true,
    carrier: { basis: "l_per_ha", sprayerOutputChoice: "recommended", ...smallVsp },
  });
  it("never fabricates an L/ha figure without row spacing", () => {
    expect(c.recommendedDiluteLitresPerHectare).toBeNull();
    expect(c.litresPerHectare).toBeNull();
  });
  it("saves the recommendation intent without error", () => {
    expect(errors(c.diagnostics)).toHaveLength(0);
  });
});

describe("C — Program Step, L/ha, set my own volume", () => {
  const c = calculateCarrier({
    geometry: noGeometry(),
    mode: "whole_block",
    templateMode: true,
    carrier: {
      basis: "l_per_ha",
      sprayerOutputChoice: "custom",
      litresPerHectare: 600,
      ...smallVsp,
    },
  });
  it("accepts and keeps 600 L/ha with no blocks", () => {
    expect(errors(c.diagnostics)).toHaveLength(0);
    expect(c.totalCarrierLitres).toBeNull();
  });
});

describe("D — live spray job, use recommended volume", () => {
  const c = calculateCarrier({
    geometry: block(),
    mode: "whole_block",
    carrier: { basis: "l_per_ha", sprayerOutputChoice: "recommended", ...smallVsp },
  });
  it("resolves 10 L/100 m to 357.14 L/ha, ~175 L total, CF 1.00", () => {
    expect(c.recommendedDiluteLitresPer100m).toBe(10);
    expect(c.recommendedDiluteLitresPerHectare).toBeCloseTo(357.142857, 4);
    expect(c.litresPerHectare).toBeCloseTo(357.142857, 4);
    expect(c.litresPer100m).toBeCloseTo(10, 6);
    expect(c.totalCarrierLitres).toBeCloseTo(175, 4);
    expect(c.concentrationFactor).toBeCloseTo(1, 6);
    expect(c.appliedFromRecommendation).toBe(true);
    expect(errors(c.diagnostics)).toHaveLength(0);
  });
});

describe("E — switching representation does not change the physical job", () => {
  const perHa = calculateCarrier({
    geometry: block(),
    mode: "whole_block",
    carrier: { basis: "l_per_ha", sprayerOutputChoice: "recommended", ...smallVsp },
  });
  const per100m = calculateCarrier({
    geometry: block(),
    mode: "whole_block",
    carrier: { basis: "l_per_100m", sprayerOutputChoice: "recommended", ...smallVsp },
  });
  it("gives the same total water and the same two representations", () => {
    expect(per100m.totalCarrierLitres).toBeCloseTo(perHa.totalCarrierLitres!, 6);
    expect(per100m.litresPerHectare).toBeCloseTo(perHa.litresPerHectare!, 6);
    expect(per100m.litresPer100m).toBeCloseTo(perHa.litresPer100m!, 6);
  });
});

describe("F — concentration from a custom 600 L/ha under VSP/Medium/High", () => {
  const c = calculateCarrier({
    geometry: block(),
    mode: "whole_block",
    carrier: {
      basis: "l_per_ha",
      sprayerOutputChoice: "custom",
      litresPerHectare: 600,
      canopyType: "vsp",
      canopySize: "medium",
      canopyDensity: "high",
    },
  });
  it("derives 1428.57 L/ha dilute, 16.8 L/100 m actual and CF 2.38", () => {
    expect(c.recommendedDiluteLitresPer100m).toBe(40);
    expect(c.recommendedDiluteLitresPerHectare).toBeCloseTo(1428.571, 3);
    expect(c.litresPer100m).toBeCloseTo(16.8, 6);
    expect(c.concentrationFactor).toBeCloseTo(2.38095, 4);
  });
});

describe("G/H — Manual total water and product bases", () => {
  const carrier = calculateCarrier({
    geometry: block(),
    mode: "whole_block",
    carrier: { basis: "manual", manualTotalLitres: 400 },
  });
  const products = calculateProducts({
    products: [
      {
        savedChemicalId: "c1",
        productName: "Per 100 L product",
        rate: 150,
        unit: "g",
        rateBasis: "per_100_litres",
      },
      {
        savedChemicalId: "c2",
        productName: "Per ha product",
        rate: 2,
        unit: "L",
        rateBasis: "whole_block_area",
      },
    ] as unknown as SprayProductLine[],
    geometry: block(),
    carrier,
  });

  it("G — 150 g/100 L over 400 L is 600 g", () => {
    expect(carrier.concentrationFactor).toBe(1);
    expect(products[0].totalQuantity).toBeCloseTo(600, 6);
  });

  it("H — a genuine 2 L/ha rate over 0.49 ha stays 0.98 L", () => {
    expect(products[1].totalQuantity).toBeCloseTo(0.98, 6);
    expect(products[1].concentrationFactorApplied).toBeNull();
  });

  it("blocks only the per-hectare product when the area is unknown", () => {
    const noArea = calculateProducts({
      products: [
        {
          savedChemicalId: "c2",
          productName: "Per ha product",
          rate: 2,
          unit: "L",
          rateBasis: "whole_block_area",
        },
      ] as unknown as SprayProductLine[],
      geometry: noGeometry(),
      carrier: calculateCarrier({
        geometry: noGeometry(),
        mode: "whole_block",
        carrier: { basis: "manual", manualTotalLitres: 400 },
      }),
    });
    expect(noArea[0].totalQuantity).toBeNull();
    expect(noArea[0].diagnostics.some((d) => /per hectare/i.test(d.message))).toBe(true);
  });
});
