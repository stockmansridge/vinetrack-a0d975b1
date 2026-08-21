// P6 — Spray Tool calculation parity regressions.
//
// Formulas under test (the authoritative contract):
//   carrier L/ha mode : total L = L/ha × GROSS ha ; L/100 m = L/ha × spacing ÷ 100
//   carrier L/100 m   : total L = (row length m ÷ 100) × applied L/100 m
//                       L/ha    = applied L/100 m × 100 ÷ row spacing m
//   concentration     : CF = max(1, dilute ÷ applied)
//   treated area      : row length m × total band width m ÷ 10 000
//   product totals    : rate × (gross ha | treated ha | total L ÷ 100 | row m ÷ 100)
import { describe, expect, it } from "vitest";
import {
  buildApplicationGeometry,
  resolveBlockGeometry,
} from "@/lib/sprayApplicationGeometry";
import {
  calculateCarrier,
  calculateProducts,
  concentrationFactorFrom,
} from "@/lib/sprayCalculation";
import {
  applyLabelRate,
  isApplicableLabelRate,
  suggestRateBasisFromLabel,
} from "@/lib/sprayApplicationDraft";
import type { SprayProductLine } from "@/lib/sprayApplicationDomain";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { readFileSync } from "node:fs";

/** 10 ha block, 3 m rows → 33 333.33 m of row. */
const block = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  name: "Block 1",
  area_ha: 10,
  row_width: 3,
  ...over,
});

const geom = (mode: "whole_block" | "banded", band?: number) =>
  buildApplicationGeometry([
    resolveBlockGeometry({
      paddock: block(),
      mode,
      totalTreatedBandWidthMetres: band ?? null,
    }),
  ]);

const line = (over: Partial<SprayProductLine>): SprayProductLine => ({
  savedChemicalId: "c1",
  productName: "Product",
  rate: null,
  unit: "L",
  rateBasis: null,
  activityGroups: [],
  verificationStatus: "unverified",
  ...over,
});

describe("P6A — product rate parity", () => {
  const g = geom("whole_block");
  const carrier = calculateCarrier({
    geometry: g,
    mode: "whole_block",
    carrier: { basis: "l_per_ha", litresPerHectare: 500 },
  });

  it("per hectare uses gross hectares", () => {
    const [r] = calculateProducts({
      products: [line({ rate: 2, rateBasis: "whole_block_area" })],
      geometry: g,
      carrier,
    });
    expect(r.multiplierKind).toBe("whole_block_hectares");
    expect(r.totalQuantity).toBeCloseTo(20, 6); // 2 L/ha × 10 ha
  });

  it("per 100 L uses the carrier volume", () => {
    expect(carrier.totalCarrierLitres).toBeCloseTo(5000, 6); // 500 × 10
    const [r] = calculateProducts({
      products: [line({ rate: 30, unit: "mL", rateBasis: "per_100_litres" })],
      geometry: g,
      carrier,
    });
    expect(r.totalQuantity).toBeCloseTo(1500, 6); // 30 mL × 50 hundred-litres
  });

  it("per 100 m uses canonical row length", () => {
    const [r] = calculateProducts({
      products: [line({ rate: 1, rateBasis: "per_100_metres" })],
      geometry: g,
      carrier,
    });
    expect(r.totalQuantity).toBeCloseTo(333.3333, 3);
  });

  it("keeps both endpoints of a rate range and never picks one", () => {
    const applied = applyLabelRate(line({}), {
      min: 35,
      max: 54,
      unit: "mL",
      basis: "range_per_100_litres",
    });
    expect(applied.labelMinRate).toBe(35);
    expect(applied.labelMaxRate).toBe(54);
    expect(applied.rate).toBeNull(); // operator still chooses
    expect(applied.rateBasis).toBe("per_100_litres");
  });

  it('never promotes basis:"other" reference text into an application rate', () => {
    const ref = { min: null, max: null, unit: "", basis: "other", rawText: "150 mL/ha to 300 mL/ha + adjuvant", referenceOnly: true };
    expect(isApplicableLabelRate(ref)).toBe(false);
    const applied = applyLabelRate(line({ labelMinRate: 9, labelMaxRate: 9, labelRateUnit: "L" }), ref);
    expect(applied.labelMinRate).toBeNull();
    expect(applied.labelMaxRate).toBeNull();
    expect(applied.rate).toBeNull();
    expect(applied.rateBasis).toBeNull();
  });

  it("never invents a rate from unresolved evidence", () => {
    const unresolved = { min: null, max: null, unit: "mL", basis: "per_hectare" };
    expect(isApplicableLabelRate(unresolved)).toBe(false);
    const [r] = calculateProducts({
      products: [line({ rate: null, rateBasis: "whole_block_area" })],
      geometry: g,
      carrier,
    });
    expect(r.totalQuantity).toBeNull();
    expect(r.diagnostics.some((d) => d.code === "missing_rate")).toBe(true);
  });

  it("does not guess gross vs treated hectares for a banded job", () => {
    expect(suggestRateBasisFromLabel("per_hectare", "whole_block")).toBe("whole_block_area");
    expect(suggestRateBasisFromLabel("per_hectare", "banded")).toBeNull();
    expect(suggestRateBasisFromLabel("range_per_100_litres", "banded")).toBe("per_100_litres");
  });

  it("consumes a P4/P5 Saved Chemical multi-rate use without flattening", () => {
    const fixture = JSON.parse(readFileSync("src/test/fixtures/ld2-custodia-forte-au.json", "utf8"));
    const intel = toChemicalIntelligence({
      id: "c1",
      name: "CUSTODIA FORTE FUNGICIDE",
      registered_uses: fixture.registered_uses,
    } as any);
    const use = intel.registeredUses.find((u) => /POWDERY/i.test(u.target ?? ""))!;
    expect(use.rates).toHaveLength(2);
    expect(use.rates[0].min).toBe(35);
    expect(use.rates[0].max).toBe(54);
    const hectareRate = use.rates.find((r) => (r.basis ?? "").includes("hectare"))!;
    expect(hectareRate.min).toBe(540);

    const per100 = applyLabelRate(line({}), use.rates[0], "whole_block");
    expect(per100.rateBasis).toBe("per_100_litres");
    const perHa = applyLabelRate(line({}), hectareRate, "whole_block");
    expect(perHa.rateBasis).toBe("whole_block_area");
    expect(perHa.labelMinRate).toBe(540);
  });
});

describe("P6B — L/100 m calculation close-out", () => {
  const g = geom("whole_block");

  it("derives total litres and L/ha from applied L/100 m and row spacing", () => {
    const c = calculateCarrier({
      geometry: g,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 12, diluteLitresPer100m: 30 },
    });
    expect(c.litresPer100m).toBe(12);
    expect(c.totalCarrierLitres).toBeCloseTo((33333.3333 / 100) * 12, 1); // 4000 L
    expect(c.litresPerHectare).toBeCloseTo(400, 6); // 12 × 100 ÷ 3
    // dilute is a reference only — it drives the concentration factor
    expect(c.concentrationFactor).toBeCloseTo(2.5, 6);
    expect(c.concentrationFactorSource).toBe("derived");
  });

  it("never treats the dilute/runoff volume as the applied volume", () => {
    const c = calculateCarrier({
      geometry: g,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", diluteLitresPer100m: 30 },
    });
    expect(c.totalCarrierLitres).toBeNull();
    expect(c.litresPerHectare).toBeNull();
    expect(c.diagnostics.some((d) => d.code === "dilute_only_carrier_rate")).toBe(true);
  });

  it("derives the applied volume from dilute ÷ persisted concentration factor, and says so", () => {
    const c = calculateCarrier({
      geometry: g,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", diluteLitresPer100m: 30, concentrationFactor: 3 },
    });
    expect(c.litresPer100m).toBeCloseTo(10, 6);
    expect(c.litresPerHectare).toBeCloseTo(333.3333, 3);
    expect(c.concentrationFactorSource).toBe("persisted");
    expect(c.diagnostics.some((d) => d.code === "applied_rate_derived_from_dilute")).toBe(true);
  });

  it("concentrated spraying floors the concentration factor at 1", () => {
    expect(concentrationFactorFrom(30, 10)).toBe(3);
    expect(concentrationFactorFrom(10, 30)).toBe(1);
  });

  it("leaves L/ha mode unchanged and derives the equivalent L/100 m", () => {
    const c = calculateCarrier({
      geometry: g,
      mode: "whole_block",
      carrier: { basis: "l_per_ha", litresPerHectare: 400, diluteLitresPerHectare: 1000 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(4000, 6);
    expect(c.litresPer100m).toBeCloseTo(12, 6); // 400 × 3 ÷ 100
    expect(c.concentrationFactor).toBeCloseTo(2.5, 6);
    expect(c.diagnostics).toEqual([]);
  });

  it("switching basis never reinterprets the other basis's stored values", () => {
    const stored = {
      litresPerHectare: 400,
      diluteLitresPerHectare: 1000,
      appliedLitresPer100m: 9,
      diluteLitresPer100m: 27,
    };
    const asHa = calculateCarrier({ geometry: g, mode: "whole_block", carrier: { basis: "l_per_ha", ...stored } });
    const as100 = calculateCarrier({ geometry: g, mode: "whole_block", carrier: { basis: "l_per_100m", ...stored } });
    expect(asHa.litresPerHectare).toBe(400);
    expect(as100.litresPer100m).toBe(9);
    expect(as100.litresPerHectare).toBeCloseTo(300, 6); // 9 × 100 ÷ 3, not 400
  });

  it("refuses to derive L/ha when row spacings differ", () => {
    const mixed = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: block(), mode: "whole_block" }),
      resolveBlockGeometry({ paddock: block({ id: "b2", row_width: 2.5 }), mode: "whole_block" }),
    ]);
    const c = calculateCarrier({
      geometry: mixed,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 12 },
    });
    expect(c.litresPerHectare).toBeNull();
    expect(c.diagnostics.some((d) => d.code === "cannot_derive_litres_per_hectare")).toBe(true);
  });
});

describe("P6C — banded spray parity", () => {
  // 10 ha, 3 m rows, 1 m total band → treated = 33 333.33 × 1 ÷ 10 000 = 3.333 ha
  const g = geom("banded", 1);

  it("keeps gross area separate from treated area", () => {
    expect(g.grossAreaHa).toBe(10);
    expect(g.treatedAreaHa).toBeCloseTo(3.3333, 3);
    expect(g.treatedAreaMethod).toBe("area_and_spacing_fallback");
  });

  it("carrier L/ha still applies to gross hectares for a banded job", () => {
    const c = calculateCarrier({
      geometry: g,
      mode: "banded",
      carrier: { basis: "l_per_ha", litresPerHectare: 300 },
    });
    expect(c.carrierAreaHa).toBe(10);
    expect(c.totalCarrierLitres).toBeCloseTo(3000, 6);
  });

  it("treated-ha and gross-ha product rates give different, correct totals", () => {
    const c = calculateCarrier({
      geometry: g,
      mode: "banded",
      carrier: { basis: "l_per_ha", litresPerHectare: 300 },
    });
    const [treated, gross] = calculateProducts({
      products: [
        line({ rate: 3, rateBasis: "treated_area" }),
        line({ rate: 3, rateBasis: "whole_block_area" }),
      ],
      geometry: g,
      carrier: c,
    });
    expect(treated.totalQuantity).toBeCloseTo(10, 3); // 3 × 3.333 treated ha
    expect(gross.totalQuantity).toBeCloseTo(30, 6); // 3 × 10 gross ha
  });

  it("banded per-100-L rates use the carrier volume once, with no area double-count", () => {
    const c = calculateCarrier({
      geometry: g,
      mode: "banded",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 6 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(2000, 1); // 333.33 hundred-metres × 6
    const [r] = calculateProducts({
      products: [line({ rate: 50, unit: "mL", rateBasis: "per_100_litres" })],
      geometry: g,
      carrier: c,
    });
    expect(r.multiplier).toBeCloseTo(20, 3); // 2000 L ÷ 100 — row length applied once
    expect(r.totalQuantity).toBeCloseTo(1000, 3);
  });

  it("banded without a band width reports missing treated area instead of guessing", () => {
    const g2 = geom("banded");
    expect(g2.treatedAreaHa).toBeNull();
    expect(g2.issues).toContain("missing_band_width");
  });
});
