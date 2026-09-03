// SQL 222 — shared user-confirmed manual-rate contract parity.
//
// manual entry -> save shape -> reload Chemical Store -> Spray Program line.
import { describe, it, expect } from "vitest";
import {
  emptyManualRateDraft,
  manualRateDraftFromSelection,
  manualRateSelection,
  isManualRateSelection,
  type ManualRateDraft,
} from "@/lib/chemicalManualRate";
import { decodePersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";
import { withBasisSelection } from "@/lib/chemicalDefaultRateSelection";
import {
  confirmedSprayPrefill,
  confirmedSprayRangeGuidance,
} from "@/lib/chemicalDefaultRateHandoff";
import { productLineFromChemical } from "@/lib/sprayApplicationDraft";
import { legacyRatePerHa } from "@/lib/savedChemicalLegacyRate";

const draft = (over: Partial<ManualRateDraft> = {}): ManualRateDraft => ({
  ...emptyManualRateDraft(),
  open: true,
  confirmed: true,
  ...over,
});

const scalarDraft = draft({ basis: "per_100_litres", unit: "L", value: "1.5" });
const rangeDraft = draft({
  kind: "range",
  basis: "per_100_litres",
  unit: "L",
  min: "2",
  max: "3",
});

/** What the editor writes to `saved_chemicals.default_rates`. */
const saved = (d: ManualRateDraft) => {
  const sel = manualRateSelection(d, { selected_at: "2026-09-03T00:00:00.000Z" })!;
  return JSON.parse(JSON.stringify(withBasisSelection(null, sel.basis, sel)));
};

describe("manual rate -> persisted default_rates (SQL 222)", () => {
  it("writes the shared shape for a 2–3 L/100 L range", () => {
    expect(saved(rangeDraft)).toEqual({
      version: 1,
      per_hectare: null,
      per_100_litres: {
        option_key: "",
        rate_ids: [],
        basis: "per_100_litres",
        unit: "L",
        value: null,
        min_value: 2,
        max_value: 3,
        source: "operator",
        entry_method: "manual",
        selected_at: "2026-09-03T00:00:00.000Z",
        label_version: null,
      },
    });
  });

  it("writes a scalar with min/max null", () => {
    const sel = saved(scalarDraft).per_100_litres;
    expect(sel).toMatchObject({ value: 1.5, min_value: null, max_value: null, entry_method: "manual" });
  });

  it("never mints canonical ids and never confirms an unconfirmed rate", () => {
    expect(JSON.stringify(saved(rangeDraft))).not.toMatch(/default_option_v1_|rate_v1_/);
    expect(manualRateSelection(draft({ value: "2", confirmed: false }))).toBeNull();
  });

  it("never derives rate_per_ha from a non-hectare manual rate", () => {
    expect(legacyRatePerHa({ typed: "", manual: rangeDraft, defaults: null })).toBeUndefined();
    expect(legacyRatePerHa({ typed: "", manual: scalarDraft, defaults: null })).toBeUndefined();
  });
});

describe("reload Chemical Store", () => {
  it("reconstructs the exact range, basis, unit and manual provenance", () => {
    const decoded = decodePersistedDefaultRates(saved(rangeDraft))!;
    const sel = decoded.per_100_litres!;
    expect(isManualRateSelection(sel)).toBe(true);
    expect(manualRateDraftFromSelection(sel)).toEqual({
      open: true,
      kind: "range",
      basis: "per_100_litres",
      unit: "L",
      value: "",
      min: "2",
      max: "3",
      confirmed: true,
    });
  });

  it("reconstructs a scalar manual rate", () => {
    const sel = decodePersistedDefaultRates(saved(scalarDraft))!.per_100_litres!;
    expect(manualRateDraftFromSelection(sel)).toMatchObject({ kind: "single", value: "1.5" });
  });

  it("keeps pre-222 rows canonical and rejects fabricated manual identities", () => {
    const legacy = decodePersistedDefaultRates({
      version: 1,
      per_hectare: {
        option_key: "default_option_v1_a",
        rate_ids: ["rate_v1_a"],
        basis: "per_hectare",
        unit: "L",
        value: 2,
        min_value: null,
        max_value: null,
        source: "operator",
      },
    })!;
    expect(legacy.per_hectare?.entry_method).toBe("canonical");
    expect(manualRateDraftFromSelection(legacy.per_hectare)).toBeNull();
    expect(
      decodePersistedDefaultRates({
        version: 1,
        per_hectare: {
          option_key: "default_option_v1_a",
          rate_ids: ["rate_v1_a"],
          basis: "per_hectare",
          unit: "L",
          value: 2,
          min_value: null,
          max_value: null,
          source: "operator",
          entry_method: "manual",
        },
      })!.per_hectare,
    ).toBeNull();
  });
});

describe("Spray Program consumption", () => {
  const line = (d: ManualRateDraft) =>
    productLineFromChemical({
      savedChemicalId: "chem-1",
      productName: "SACOA STIFLE DORMANT SPRAY OIL",
      unit: "L",
      intelligence: {
        defaultRates: decodePersistedDefaultRates(saved(d)),
        activityGroups: [],
        verification: { status: "unverified" },
        legacy: { chemicalGroup: null },
      } as any,
    });

  it("prefills a scalar manual rate", () => {
    expect(line(scalarDraft)).toMatchObject({
      rate: 1.5,
      unit: "L",
      rateBasis: "per_100_litres",
    });
  });

  it("requires a dose choice inside a manual range and shows the range", () => {
    const l = line(rangeDraft);
    expect(l.rate).toBeNull();
    expect(l).toMatchObject({
      labelMinRate: 2,
      labelMaxRate: 3,
      labelRateUnit: "L",
      rateBasis: "per_100_litres",
    });
    expect(confirmedSprayPrefill(decodePersistedDefaultRates(saved(rangeDraft)))).toBeNull();
    expect(confirmedSprayRangeGuidance(decodePersistedDefaultRates(saved(rangeDraft)))).toMatchObject(
      { min: 2, max: 3 },
    );
  });

  it("choosing the spray dose does not change the saved Chemical Store range", () => {
    const stored = saved(rangeDraft);
    const l = { ...line(rangeDraft), rate: 2.5 };
    expect(l.rate).toBe(2.5);
    expect(saved(rangeDraft)).toEqual(stored);
    expect(stored.per_100_litres).toMatchObject({ min_value: 2, max_value: 3, value: null });
  });
});
