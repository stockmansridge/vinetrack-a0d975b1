// Ticket #46 — CF 400 L/ha dilute ÷ 330 L/ha applied, stale persisted CF, rate bases.
import { describe, it, expect } from "vitest";
import { calculateSprayApplication, CONCENTRATION_FACTOR_MISMATCH } from "@/lib/sprayCalculation";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { evaluateSaveGate } from "@/lib/sprayApplicationDraft";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { emptySprayApplication, type SprayApplication, type SprayProductLine } from "@/lib/sprayApplicationDomain";
import { labelRateReferences } from "@/lib/manualSpray/labelRateReference";

const PADDOCKS = [{ id: "A", name: "A", area_ha: 2, row_width: 2.5 }];
const product = (over: Partial<SprayProductLine>): SprayProductLine => ({
  savedChemicalId: "c", productName: "P", rate: 100, unit: "mL", rateBasis: "per_100_litres",
  activityGroups: [], verificationStatus: "unverified", ...over,
});
function app(carrier: Partial<SprayApplication["carrier"]>, over: Partial<SprayApplication> = {}): SprayApplication {
  const base = emptySprayApplication();
  return {
    ...base, vineyardId: "v1", name: "Job", status: "planned", operationType: "foliar", mode: "foliar",
    blockIds: ["A"],
    carrier: { ...base.carrier, basis: "l_per_ha", sprayerOutputChoice: "custom", litresPerHectare: 330, diluteLitresPerHectare: 400, ...carrier },
    products: [product({}), product({ productName: "Ha", rate: 2, unit: "L", rateBasis: "whole_block_area" })],
    ...over,
  } as SprayApplication;
}
function run(a: SprayApplication) {
  const geometry = resolveApplicationGeometry({ paddocks: PADDOCKS, blockIds: a.blockIds, mode: a.mode, override: a.geometryOverride, totalTreatedBandWidthMetres: a.totalTreatedBandWidthMetres });
  const calculation = calculateSprayApplication({ application: a, geometry });
  return { calculation, gate: evaluateSaveGate({ application: a, calculation }), input: toSprayJobInput({ application: a, geometry, calculation }).input };
}

describe("concentration factor (ticket #46)", () => {
  it("400 / 330 derives ×1.2121 with exact inputs and saves it", () => {
    const { calculation, gate, input } = run(app({ concentrationFactor: null }));
    expect(calculation.carrier.concentrationFactor).toBeCloseTo(400 / 330, 4);
    expect(calculation.carrier.concentrationFactorSource).toBe("derived");
    expect(calculation.carrier.concentrationFactorInputs).toEqual({ diluteReference: 400, applied: 330, unit: "L/ha" });
    expect(gate.canSave).toBe(true);
    expect(input.concentration_factor).toBeCloseTo(1.212, 3);
  });

  it("a stale persisted CF 1 never silently prevails: explicit mismatch blocks save", () => {
    const { calculation, gate } = run(app({ concentrationFactor: 1 }));
    expect(calculation.carrier.concentrationFactorMismatch).toBe(true);
    // No silent chemistry change: recorded CF still used until the operator chooses.
    expect(calculation.carrier.concentrationFactor).toBe(1);
    expect(calculation.carrier.derivedConcentrationFactor).toBeCloseTo(1.2121, 4);
    expect(calculation.diagnostics.some((d) => d.code === CONCENTRATION_FACTOR_MISMATCH)).toBe(true);
    expect(gate.canSave).toBe(false);
  });

  it("operator choices resolve the mismatch intentionally", () => {
    const use = run(app({ concentrationFactor: null }));
    expect(use.calculation.carrier.concentrationFactor).toBeCloseTo(1.2121, 4);
    const keep = run(app({ concentrationFactor: 1, concentrationFactorKeptAgainst: 400 / 330 }));
    expect(keep.calculation.carrier.concentrationFactor).toBe(1);
    expect(keep.gate.canSave).toBe(true);
    // A keep decision made against a different derived CF no longer applies.
    const stale = run(app({ concentrationFactor: 1, concentrationFactorKeptAgainst: 1.5 }));
    expect(stale.gate.canSave).toBe(false);
  });

  it("matching persisted CF is not a mismatch", () => {
    const { calculation, gate } = run(app({ concentrationFactor: 1.212 }));
    expect(calculation.carrier.concentrationFactorMismatch).toBe(false);
    expect(gate.canSave).toBe(true);
  });

  it("completed history keeps its recorded CF and product quantities", () => {
    const { calculation, gate } = run(app({ concentrationFactor: 1 }, { status: "completed" }));
    expect(calculation.carrier.concentrationFactor).toBe(1);
    expect(gate.canSave).toBe(true);
    const p100 = calculation.products[0];
    expect(p100.concentrationFactorApplied).toBeNull();
    // 100 mL/100 L × (330 L/ha × 2 ha / 100) = 660 mL, unchanged.
    expect(p100.totalQuantity).toBeCloseTo(660, 6);
  });

  it("CF multiplies only per-100 L rates, never per-ha rates", () => {
    const { calculation } = run(app({ concentrationFactor: null }));
    const [p100, perHa] = calculation.products;
    expect(p100.concentrationFactorApplied).toBeCloseTo(1.2121, 4);
    expect(p100.totalQuantity).toBeCloseTo(660 * (400 / 330), 4); // = 800 mL
    expect(perHa.concentrationFactorApplied).toBeNull();
    expect(perHa.totalQuantity).toBeCloseTo(4, 6); // 2 L/ha × 2 ha
  });

  it("manual and banded never derive CF", () => {
    const manual = run(app({ basis: "manual", manualTotalLitres: 500, litresPerHectare: null, concentrationFactor: 1.5 }));
    expect(manual.calculation.carrier.concentrationFactor).toBe(1);
    expect(manual.calculation.carrier.concentrationFactorMismatch).toBe(false);
    const banded = run(app({ carrierAreaBasis: "whole_block_area", concentrationFactor: 1 }, { mode: "banded", operationType: "banded" }));
    expect(banded.calculation.carrier.concentrationFactor).toBeNull();
    expect(banded.calculation.carrier.concentrationFactorMismatch).toBe(false);
  });

  it("invalid inputs never produce a CF", () => {
    for (const bad of [0, -330, Number.NaN, null]) {
      const { calculation } = run(app({ litresPerHectare: bad as number | null, concentrationFactor: null }));
      expect(calculation.carrier.derivedConcentrationFactor).toBeNull();
      expect(calculation.carrier.concentrationFactorInputs).toBeNull();
    }
    // applied above dilute floors at 1
    expect(run(app({ litresPerHectare: 500, concentrationFactor: null })).calculation.carrier.concentrationFactor).toBe(1);
  });
});

describe("Manual Spray label-rate reference (actuals stay explicit)", () => {
  const rates = (p100: unknown, ha: unknown) => ({ version: 1, per_100_litres: p100, per_hectare: ha });
  const sel = (basis: string, value: number | null, unit: string, min: number | null = null, max: number | null = null) => ({
    option_key: "k", rate_ids: ["r"], basis, unit, value, min_value: min, max_value: max, source: "operator",
  });
  it("per-100 L gives a reference estimate from tank water only", () => {
    const r = labelRateReferences(rates(sel("per_100_litres", 200, "mL"), null), 330);
    expect(r).toEqual([{ basis: "per_100_litres", label: "200 mL/100 L", estimate: "660 mL" }]);
  });
  it("per-ha is shown but never estimated from water", () => {
    const r = labelRateReferences(rates(null, sel("per_hectare", 2, "L")), 330);
    expect(r).toEqual([{ basis: "per_hectare", label: "2 L/ha", estimate: null }]);
  });
  it("no water or no rates → no invented amounts", () => {
    expect(labelRateReferences(rates(sel("per_100_litres", 200, "mL"), null), null)[0].estimate).toBeNull();
    expect(labelRateReferences(null, 330)).toEqual([]);
  });
});
