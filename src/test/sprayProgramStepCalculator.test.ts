// Program Step (template) vs Plan Spray parity with the iOS Spray Calculator.
//
// A Program Step is reusable configuration: no blocks, therefore no geometry,
// therefore no total water and no geometry errors. Plan Spray is where real
// quantities are resolved.
import { describe, expect, it } from "vitest";
import {
  calculateCarrier,
  calculateProducts,
  calculateSprayApplication,
} from "@/lib/sprayCalculation";
import { litresPerHectareFromPer100m } from "@/lib/sprayCanopy";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import type { SprayApplication, SprayProductLine } from "@/lib/sprayApplicationDomain";

const emptyGeometry = (): ApplicationGeometry =>
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

const blockGeometry = (over: Partial<ApplicationGeometry> = {}): ApplicationGeometry =>
  ({
    grossAreaHa: 0.49,
    treatedAreaHa: 0.49,
    // 0.49 ha at 2.8 m rows = 1,750 m of row.
    canonicalRowLengthMetres: 1750,
    rowSpacingMetres: 2.8,
    uniformRowSpacing: true,
    geometrySource: "mapped_rows",
    geometryQuality: "complete",
    blocks: [],
    issues: [],
    diagnostics: [],
    ...over,
  }) as unknown as ApplicationGeometry;

const programStep = (carrier: Record<string, unknown>): SprayApplication =>
  ({
    isTemplate: true,
    mode: "whole_block",
    operationType: "spray",
    blockIds: [],
    products: [
      {
        savedChemicalId: "c1",
        productName: "Dithane",
        rate: 150,
        unit: "g",
        rateBasis: "per_100_litres",
      },
    ],
    carrier: {
      canopyType: "vsp",
      canopySize: "small",
      canopyDensity: "low",
      ...carrier,
    },
  }) as unknown as SprayApplication;

const errors = (d: { severity: string }[]) => d.filter((x) => x.severity === "error");

describe("A — Program Step with an own L/ha rate and no block geometry", () => {
  const result = calculateSprayApplication({
    application: programStep({
      basis: "l_per_ha",
      sprayerOutputChoice: "custom",
      litresPerHectare: 600,
    }),
    geometry: emptyGeometry(),
  });

  it("is valid — no geometry error is raised", () => {
    expect(errors(result.diagnostics)).toHaveLength(0);
    expect(result.canRecord).toBe(true);
  });

  it("stores the 600 L/ha default without attempting a total-water calculation", () => {
    expect(result.carrier.basis).toBe("l_per_ha");
    expect(result.carrier.totalCarrierLitres).toBeNull();
    expect(result.products[0].totalQuantity).toBeNull();
  });

  it("defers the missing figures instead of failing", () => {
    expect(result.diagnostics.every((d) => d.severity !== "error")).toBe(true);
    expect(result.diagnostics.map((d) => d.message)).toContain(
      "Calculated when blocks are selected.",
    );
  });
});

describe("B — Program Step using the canopy recommendation with no geometry", () => {
  const result = calculateSprayApplication({
    application: programStep({
      basis: "l_per_ha",
      sprayerOutputChoice: "recommended",
      litresPerHectare: null,
    }),
    geometry: emptyGeometry(),
  });

  it("keeps the AWRI reference but never invents an L/ha figure", () => {
    expect(result.carrier.recommendedDiluteLitresPer100m).toBe(10);
    expect(result.carrier.recommendedDiluteLitresPerHectare).toBeNull();
    expect(result.carrier.litresPerHectare).toBeNull();
  });

  it("does not block saving", () => {
    expect(errors(result.diagnostics)).toHaveLength(0);
  });

  it("leaves the concentration factor unresolved rather than guessing", () => {
    expect(result.carrier.concentrationFactor).toBeNull();
  });
});

describe("C — row-spacing conversion", () => {
  it("converts 10 L/100 m at 2.8 m rows to 357.142857 L/ha", () => {
    expect(litresPerHectareFromPer100m(10, 2.8)).toBeCloseTo(357.142857, 6);
  });
});

describe("D — Plan Spray using the recommendation", () => {
  const carrier = calculateCarrier({
    geometry: blockGeometry(),
    mode: "whole_block",
    carrier: {
      basis: "l_per_ha",
      litresPerHectare: 357.142857,
      canopyType: "vsp",
      canopySize: "small",
      canopyDensity: "low",
    },
  });

  it("applies 357.142857 L/ha over 0.49 ha for about 175 L", () => {
    expect(carrier.totalCarrierLitres).toBeCloseTo(175, 3);
  });

  it("is a dilute spray — CF 1.00", () => {
    expect(carrier.concentrationFactor).toBe(1);
  });
});

describe("E — Plan Spray with the operator's own L/ha rate", () => {
  it("derives CF 1.19 from a 714 L/ha reference against 600 L/ha applied", () => {
    const carrier = calculateCarrier({
      geometry: blockGeometry(),
      mode: "whole_block",
      carrier: {
        basis: "l_per_ha",
        litresPerHectare: 600,
        diluteLitresPerHectare: 714,
      },
    });
    expect(carrier.concentrationFactor).toBeCloseTo(1.19, 2);
  });

  it("uses the canopy recommendation as the dilute reference when none is stored", () => {
    // VSP · full · high = 75 L/100 m → 75 × 100 ÷ 2.8 = 2678.57 L/ha.
    const carrier = calculateCarrier({
      geometry: blockGeometry(),
      mode: "whole_block",
      carrier: {
        basis: "l_per_ha",
        litresPerHectare: 600,
        canopyType: "vsp",
        canopySize: "full",
        canopyDensity: "high",
      },
    });
    expect(carrier.recommendedDiluteLitresPerHectare).toBeCloseTo(2678.571, 3);
    expect(carrier.concentrationFactor).toBeCloseTo(2678.571 / 600, 3);
  });
});

describe("F — L/100 m mode uses the canonical row length", () => {
  it("total water = L/100 m × row length ÷ 100", () => {
    const carrier = calculateCarrier({
      geometry: blockGeometry(),
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 10 },
    });
    expect(carrier.totalCarrierLitres).toBeCloseTo(175, 6);
    expect(carrier.litresPerHectare).toBeCloseTo(357.142857, 6);
  });
});

describe("G — per-100 L product under an L/ha sprayer basis", () => {
  it("calculates from total carrier volume × CF, never needing a per-ha label rate", () => {
    const carrier = calculateCarrier({
      geometry: blockGeometry(),
      mode: "whole_block",
      carrier: {
        basis: "l_per_ha",
        litresPerHectare: 600,
        diluteLitresPerHectare: 1200,
      },
    });
    const line = {
      savedChemicalId: "c1",
      productName: "Dithane",
      rate: 150,
      unit: "g",
      rateBasis: "per_100_litres",
    } as unknown as SprayProductLine;
    const [p] = calculateProducts({ products: [line], geometry: blockGeometry(), carrier });
    // 600 × 0.49 = 294 L → 150 g/100 L × 2.94 × CF 2 = 882 g.
    expect(carrier.totalCarrierLitres).toBeCloseTo(294, 6);
    expect(p.concentrationFactorApplied).toBeCloseTo(2, 6);
    expect(p.totalQuantity).toBeCloseTo(882, 6);
    expect(p.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });
});

describe("H — Manual mode", () => {
  it("accepts a known total water with no canopy or geometry requirement", () => {
    const result = calculateSprayApplication({
      application: programStep({
        basis: "manual",
        manualTotalLitres: 400,
        canopyType: null,
        canopySize: null,
        canopyDensity: null,
      }),
      geometry: emptyGeometry(),
    });
    expect(result.carrier.totalCarrierLitres).toBe(400);
    expect(result.carrier.concentrationFactor).toBe(1);
    expect(errors(result.diagnostics)).toHaveLength(0);
  });
});
