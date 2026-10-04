import { describe, it, expect } from "vitest";
import {
  buildVineyardPreferredRate,
  decodeVineyardPreferredRate,
  withPreferredRateFallback,
  preferredRateTitle,
} from "@/lib/vineyardPreferredRate";
import { productLineFromChemical } from "@/lib/sprayApplicationDraft";
import { toChemicalLine } from "@/lib/sprayApplicationSave";
import { planSprayPrefillFromProgramStep } from "@/lib/sprayProgramStep";
import { bindChemicalToLine } from "@/components/spray/wizard/ProductsStep";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";

const pref = { amount: 2, unit: "L", basis: "per_hectare", note: null };
const row = (extra: Record<string, any> = {}) =>
  ({ id: "c1", vineyard_id: "v1", name: "Stifle", unit: "Litres", ...extra }) as any;

describe("Vineyard Preferred Rate", () => {
  it("builds and decodes the canonical live/mobile amount contract", () => {
    const b = buildVineyardPreferredRate({ value: "2", unit: "L", basis: "per_hectare" });
    expect(b).toEqual({ ok: true, value: pref });
    expect(decodeVineyardPreferredRate(pref)).toEqual(pref);
    expect(buildVineyardPreferredRate({ value: "", unit: "", basis: "" })).toEqual({ ok: true, value: null });
    expect(buildVineyardPreferredRate({ value: "2", unit: "L/ha", basis: "per_hectare" }).ok).toBe(false);
    const built = (b as any).value;
    expect(built).not.toHaveProperty("value");
    expect(built).not.toHaveProperty("version");
    expect(preferredRateTitle("Stockmans Ridge")).toBe("Stockmans Ridge Preferred Rate");
  });

  it("prefills a new product line with no registered rate (case 1/3/10)", () => {
    const intel = toChemicalIntelligence(row({ vineyard_preferred_rate: pref }));
    const line = productLineFromChemical({ savedChemicalId: "c1", productName: "Stifle", unit: "L", intelligence: intel });
    expect(line.rate).toBe(2);
    expect(line.unit).toBe("L");
    expect(line.rateBasis).toBe("whole_block_area");
    expect(line.labelMinRate).toBeNull();
  });

  it("keeps /100 L distinct (case 11)", () => {
    const intel = toChemicalIntelligence(row({ vineyard_preferred_rate: { ...pref, amount: 150, unit: "mL", basis: "per_100_litres" } }));
    const line = productLineFromChemical({ savedChemicalId: "c1", productName: "S", unit: "mL", intelligence: intel });
    expect(line.rateBasis).toBe("per_100_litres");
    expect(toChemicalLine(line as any).product_rate_basis).toBe("per_100_litres");
  });

  it("Program Step rate is preserved on rebind and carried into Plan Spray (case 5/7/12)", () => {
    const intel = toChemicalIntelligence(row({ vineyard_preferred_rate: pref }));
    const stepLine = { ...productLineFromChemical({ savedChemicalId: "c1", productName: "S", unit: "L", intelligence: intel }), rate: 1.5, rateSource: null };
    expect(bindChemicalToLine(stepLine, intel, "c1").rate).toBe(1.5);
    const prefill = planSprayPrefillFromProgramStep({ products: [stepLine], carrier: {}, geometryOverride: {} } as any);
    expect(withPreferredRateFallback(prefill.products![0], intel.vineyardPreferredRate).rate).toBe(1.5);
    // The chemical's preferred rate is untouched.
    expect(intel.vineyardPreferredRate?.amount).toBe(2);
  });

  it("older step with no stored rate falls back to the preferred rate (case 13)", () => {
    const line = productLineFromChemical({ savedChemicalId: "c1", productName: "S", unit: "L" });
    const out = withPreferredRateFallback(line, decodeVineyardPreferredRate(pref));
    expect(out.rate).toBe(2);
  });

  it("no preferred rate keeps the existing default path (case 9)", () => {
    const intel = toChemicalIntelligence(row());
    const line = productLineFromChemical({ savedChemicalId: "c1", productName: "S", unit: "L", intelligence: intel });
    expect(line.rate).toBeNull();
    expect(line.rateSource).toBeNull();
  });

  it("decodes mobile values with updated_at/updated_by; legacy shape read-only", () => {
    const mobile = { ...pref, updated_at: "2026-10-01T00:00:00Z", updated_by: "u1" };
    expect(decodeVineyardPreferredRate(mobile)).toEqual(mobile);
    expect(decodeVineyardPreferredRate({ version: 1, value: 2, unit: "L", basis: "per_hectare", note: null })).toEqual(pref);
    expect(decodeVineyardPreferredRate({ amount: 0, unit: "L", basis: "per_hectare" })).toBeNull();
  });

  it("clear writes NULL; default/registered data untouched", () => {
    expect(buildVineyardPreferredRate({ value: "  ", unit: "L", basis: "per_hectare" })).toEqual({ ok: true, value: null });
    const defaults = { version: 1, per_hectare: null, per_100_litres: null };
    const intel = toChemicalIntelligence(row({ vineyard_preferred_rate: pref, default_rates: defaults }));
    productLineFromChemical({ savedChemicalId: "c1", productName: "S", unit: "L", intelligence: intel });
    expect(defaults).toEqual({ version: 1, per_hectare: null, per_100_litres: null });
  });
});
