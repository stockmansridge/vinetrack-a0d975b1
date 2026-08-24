// Portal Spray Calculator parity with the final iOS contract:
//   - three spray-volume paths (L/100 m, L/ha, Manual)
//   - AWRI canopy tables for VSP and Sprawl
//   - CF = max(1.0, dilute ÷ applied), applied to dilute per-100 L rates
//   - manual total water bypasses canopy and geometry entirely
import { describe, expect, it } from "vitest";
import {
  CANOPY_DILUTE_RANGE_L_PER_100M,
  litresPerHectareFromPer100m,
  recommendedDiluteLitresPer100m,
  recommendedDiluteLitresPerHectare,
} from "@/lib/sprayCanopy";
import { calculateCarrier, calculateProducts } from "@/lib/sprayCalculation";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import type { SprayProductLine } from "@/lib/sprayApplicationDomain";

const geometry = (over: Partial<ApplicationGeometry> = {}): ApplicationGeometry =>
  ({
    grossAreaHa: 10,
    treatedAreaHa: 10,
    canonicalRowLengthMetres: 33_333.33,
    rowSpacingMetres: 3,
    uniformRowSpacing: true,
    geometrySource: "mapped_rows",
    geometryQuality: "complete",
    blocks: [],
    diagnostics: [],
    ...over,
  }) as unknown as ApplicationGeometry;

const line = (over: Partial<SprayProductLine> = {}): SprayProductLine =>
  ({
    savedChemicalId: "c1",
    productName: "Product",
    rate: 100,
    unit: "mL",
    rateBasis: "per_100_litres",
    ...over,
  }) as unknown as SprayProductLine;

describe("AWRI canopy tables", () => {
  it("keeps VSP and Sprawl distinct at the larger canopies", () => {
    expect(CANOPY_DILUTE_RANGE_L_PER_100M.vsp.full).toEqual({ low: 45, high: 75 });
    expect(CANOPY_DILUTE_RANGE_L_PER_100M.sprawl.full).toEqual({ low: 60, high: 90 });
  });

  it("uses the low end for a low-density canopy and the high end for a dense one", () => {
    expect(recommendedDiluteLitresPer100m("vsp", "medium", "low")).toBe(20);
    expect(recommendedDiluteLitresPer100m("vsp", "medium", "high")).toBe(40);
    expect(recommendedDiluteLitresPer100m("sprawl", "large", "high")).toBe(60);
  });

  it("returns nothing rather than guessing when the canopy is unanswered", () => {
    expect(recommendedDiluteLitresPer100m("vsp", null, "high")).toBeNull();
    expect(recommendedDiluteLitresPer100m(null, "full", "high")).toBeNull();
    expect(recommendedDiluteLitresPer100m("vsp", "full", null)).toBeNull();
  });

  it("converts to L/ha with the vineyard's own row spacing, not a 3 m assumption", () => {
    expect(litresPerHectareFromPer100m(40, 3)).toBeCloseTo(1333.333, 3);
    expect(litresPerHectareFromPer100m(40, 2.5)).toBeCloseTo(1600, 6);
    expect(recommendedDiluteLitresPerHectare("vsp", "medium", "high", null)).toBeNull();
  });
});

describe("spray volume paths", () => {
  it("L/100 m — total water comes from the applied rate and the row length", () => {
    const c = calculateCarrier({
      geometry: geometry(),
      mode: "whole_block",
      carrier: {
        basis: "l_per_100m",
        appliedLitresPer100m: 30,
        diluteLitresPer100m: 60,
        canopyType: "vsp",
        canopySize: "large",
        canopyDensity: "high",
      },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(10_000, 0);
    expect(c.litresPerHectare).toBeCloseTo(1000, 0);
    expect(c.concentrationFactor).toBeCloseTo(2, 6);
    expect(c.concentrationFactorSource).toBe("derived");
    expect(c.recommendedDiluteLitresPer100m).toBe(45);
    expect(c.derivedRatesAreReferenceOnly).toBe(false);
  });

  it("L/ha — total water is the applied rate over gross hectares", () => {
    const c = calculateCarrier({
      geometry: geometry(),
      mode: "whole_block",
      carrier: { basis: "l_per_ha", litresPerHectare: 500, diluteLitresPerHectare: 1000 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(5000, 6);
    expect(c.concentrationFactor).toBeCloseTo(2, 6);
  });

  it("floors the concentration factor at 1.00 when the applied volume exceeds dilute", () => {
    const c = calculateCarrier({
      geometry: geometry(),
      mode: "whole_block",
      carrier: { basis: "l_per_ha", litresPerHectare: 1200, diluteLitresPerHectare: 1000 },
    });
    expect(c.concentrationFactor).toBe(1);
  });

  it("manual — the entered total is used verbatim and CF is exactly 1.00", () => {
    const c = calculateCarrier({
      geometry: geometry(),
      mode: "whole_block",
      carrier: { basis: "manual", manualTotalLitres: 600, diluteLitresPerHectare: 1000 },
    });
    expect(c.totalCarrierLitres).toBe(600);
    expect(c.concentrationFactor).toBe(1);
    expect(c.concentrationFactorSource).toBe("manual");
    expect(c.derivedRatesAreReferenceOnly).toBe(true);
    expect(c.diagnostics).toHaveLength(0);
  });

  it("manual — works with no geometry at all (knapsack / spot spray)", () => {
    const c = calculateCarrier({
      geometry: geometry({
        grossAreaHa: null,
        treatedAreaHa: null,
        canonicalRowLengthMetres: null,
        rowSpacingMetres: null,
      } as Partial<ApplicationGeometry>),
      mode: "whole_block",
      carrier: { basis: "manual", manualTotalLitres: 15 },
    });
    expect(c.totalCarrierLitres).toBe(15);
    expect(c.litresPerHectare).toBeNull();
    expect(c.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("manual — asks for the total instead of inventing one", () => {
    const c = calculateCarrier({
      geometry: geometry(),
      mode: "whole_block",
      carrier: { basis: "manual", manualTotalLitres: null },
    });
    expect(c.totalCarrierLitres).toBeNull();
    expect(c.diagnostics.map((d) => d.code)).toContain("missing_manual_total_water");
  });
});

describe("dilute per-100 L rates under concentration", () => {
  const carrierFor = (dilute: number | null) =>
    calculateCarrier({
      geometry: geometry(),
      mode: "whole_block",
      carrier: {
        basis: "l_per_100m",
        appliedLitresPer100m: 30,
        diluteLitresPer100m: dilute,
      },
    });

  it("multiplies a per-100 L label rate by the concentration factor", () => {
    const carrier = carrierFor(60); // CF ×2, 10,000 L applied
    const [p] = calculateProducts({ products: [line()], geometry: geometry(), carrier });
    // 100 mL/100 L × (10,000 ÷ 100) × 2 = 20,000 mL
    expect(p.concentrationFactorApplied).toBeCloseTo(2, 6);
    expect(p.totalQuantity).toBeCloseTo(20_000, 1);
  });

  it("leaves a dilute application untouched (CF 1.00)", () => {
    const carrier = carrierFor(30);
    const [p] = calculateProducts({ products: [line()], geometry: geometry(), carrier });
    expect(p.concentrationFactorApplied).toBeNull();
    expect(p.totalQuantity).toBeCloseTo(10_000, 1);
  });

  it("never applies the CF to an area-based or per-100 m rate", () => {
    const carrier = carrierFor(60);
    const products = calculateProducts({
      products: [
        line({ rateBasis: "whole_block_area", rate: 2, unit: "L" }),
        line({ rateBasis: "per_100_metres", rate: 0.5, unit: "L" }),
      ],
      geometry: geometry(),
      carrier,
    });
    expect(products[0].concentrationFactorApplied).toBeNull();
    expect(products[0].totalQuantity).toBeCloseTo(20, 6);
    expect(products[1].concentrationFactorApplied).toBeNull();
    expect(products[1].totalQuantity).toBeCloseTo(166.667, 3);
  });

  it("uses the manual total unchanged for a per-100 L rate", () => {
    const carrier = calculateCarrier({
      geometry: geometry(),
      mode: "whole_block",
      carrier: { basis: "manual", manualTotalLitres: 400 },
    });
    const [p] = calculateProducts({ products: [line()], geometry: geometry(), carrier });
    expect(p.concentrationFactorApplied).toBeNull();
    expect(p.totalQuantity).toBeCloseTo(400, 6);
  });
});
