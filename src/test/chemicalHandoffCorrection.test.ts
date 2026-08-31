// Final handoff correction: confirmed scalar-only prefill, confirmed label-rate
// unit, and id-based binding that never carries one product's rate onto another.
import { describe, it, expect } from "vitest";
import { confirmedSprayPrefill } from "@/lib/chemicalDefaultRateHandoff";
import { productLineFromChemical } from "@/lib/sprayApplicationDraft";
import { bindChemicalToLine } from "@/components/spray/wizard/ProductsStep";
import type { PersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";

const sel = (over: Record<string, unknown> = {}) => ({
  option_key: "default_option_v1_x",
  rate_ids: ["rate_v1_a"],
  basis: "per_hectare",
  unit: "L",
  value: 2,
  min_value: null,
  max_value: null,
  source: "operator" as const,
  selected_at: null,
  label_version: null,
  ...over,
});

const defaults = (over: Partial<PersistedDefaultRates>): PersistedDefaultRates =>
  ({ version: 1, per_hectare: null, per_100_litres: null, ...over }) as PersistedDefaultRates;

function chem(
  id: string,
  name: string,
  d: PersistedDefaultRates | null,
  inventoryUnit: string | null,
): ChemicalIntelligence {
  return {
    id,
    name,
    activityGroups: [],
    registeredUses: [],
    verification: { status: "unverified" },
    legacy: { chemicalGroup: null },
    commercial: { unit: inventoryUnit, costPerUnit: null },
    defaultRates: d,
  } as unknown as ChemicalIntelligence;
}

describe("confirmed scalar prefill", () => {
  it("hands a confirmed 2 L/ha scalar to the spray line", () => {
    const line = productLineFromChemical({
      savedChemicalId: "c1",
      productName: "P",
      unit: "L",
      intelligence: chem("c1", "P", defaults({ per_hectare: sel() as any }), "L"),
    });
    expect(line.rate).toBe(2);
    expect(line.unit).toBe("L");
    expect(line.rateBasis).toBe("whole_block_area");
  });

  it("uses the confirmed label-rate unit, never the inventory unit", () => {
    const d = defaults({ per_hectare: sel({ unit: "g", value: 560 }) as any });
    const line = productLineFromChemical({
      savedChemicalId: "c1",
      productName: "P",
      unit: "kg",
      intelligence: chem("c1", "P", d, "kg"),
    });
    expect(line.rate).toBe(560);
    expect(line.unit).toBe("g");
  });

  it("never prefills from a stored range", () => {
    const d = defaults({
      per_hectare: sel({ unit: "g", value: null, min_value: 560, max_value: 700 }) as any,
    });
    expect(confirmedSprayPrefill(d)).toBeNull();
    const line = productLineFromChemical({
      savedChemicalId: "c1",
      productName: "P",
      unit: "kg",
      intelligence: chem("c1", "P", d, "kg"),
    });
    expect(line.rate).toBeNull();
    expect(line.rateBasis).toBeNull();
    expect(line.unit).toBe("kg");
  });

  it("does not prefill when two bases are confirmed", () => {
    const d = defaults({
      per_hectare: sel() as any,
      per_100_litres: sel({ basis: "per_100_litres", unit: "g", value: 150 }) as any,
    });
    expect(confirmedSprayPrefill(d)).toBeNull();
  });

  it("does not prefill on missing or malformed defaults", () => {
    expect(confirmedSprayPrefill(null)).toBeNull();
    expect(
      confirmedSprayPrefill(defaults({ per_hectare: sel({ unit: "oz" }) as any })),
    ).toBeNull();
    expect(
      confirmedSprayPrefill(defaults({ per_hectare: sel({ value: Number.NaN }) as any })),
    ).toBeNull();
  });

  it("never falls back to a legacy rate_per_ha or a first label rate", () => {
    const intel = {
      ...chem("c1", "P", null, "L"),
      commercial: { unit: "L", costPerUnit: null, preferredRatePerHa: 9 },
      registeredUses: [{ rates: [{ rate_id: "r1", basis: "per_hectare", unit: "L", min: 1, max: 3 }] }],
    } as unknown as ChemicalIntelligence;
    const line = productLineFromChemical({
      savedChemicalId: "c1",
      productName: "P",
      unit: "L",
      intelligence: intel,
    });
    expect(line.rate).toBeNull();
    expect(line.rateBasis).toBeNull();
  });
});

describe("binding a Chemical Store product to a line", () => {
  const blank = () =>
    productLineFromChemical({ savedChemicalId: null, productName: null, unit: null });

  const a = chem("A", "Prod A", defaults({ per_hectare: sel() as any }), "L");
  const b = chem(
    "B",
    "Prod B",
    defaults({ per_100_litres: sel({ basis: "per_100_litres", unit: "g", value: 150 }) as any }),
    "kg",
  );

  it("delivers the confirmed default to a blank line", () => {
    const bound = bindChemicalToLine(blank(), a, "A");
    expect(bound.rate).toBe(2);
    expect(bound.unit).toBe("L");
    expect(bound.rateBasis).toBe("whole_block_area");
  });

  it("does not carry product A's rate/unit/basis onto product B", () => {
    const bound = bindChemicalToLine(bindChemicalToLine(blank(), a, "A"), b, "B");
    expect(bound.savedChemicalId).toBe("B");
    expect(bound.rate).toBe(150);
    expect(bound.unit).toBe("g");
    expect(bound.rateBasis).toBe("per_100_litres");
  });

  it("preserves an operator-edited rate when the same product is rebound", () => {
    const edited = { ...bindChemicalToLine(blank(), a, "A"), rate: 3.5, unit: "L" as const, notes: "n" };
    const rebound = bindChemicalToLine(edited, a, "A");
    expect(rebound.rate).toBe(3.5);
    expect(rebound.unit).toBe("L");
    expect(rebound.notes).toBe("n");
  });

  it("delivers the confirmed default to a newly appended line for a new chemical", () => {
    const appended = bindChemicalToLine(blank(), b, "B");
    expect(appended.rate).toBe(150);
    expect(appended.unit).toBe("g");
  });

  it("never binds on a name match alone", () => {
    const bound = bindChemicalToLine(blank(), null, null);
    expect(bound.savedChemicalId).toBeNull();
    expect(bound.productName).toBeNull();
  });
});
