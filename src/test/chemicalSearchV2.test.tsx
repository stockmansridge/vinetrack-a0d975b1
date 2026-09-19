// Chemical Search V2 — focused contract tests (vineyard Chemical Store).
import { describe, it, expect } from "vitest";
import {
  activeIngredientSummary,
  buildManualSavedChemicalInput,
  buildMasterSavedChemicalInput,
  chemicalSearchV2Enabled,
  findVineyardDuplicate,
  hasAnyDefaultRate,
  initialiseDefaultRatesFromMaster,
  normaliseMasterSearchHit,
  normaliseOnlineLookup,
  persistedDefaultRates,
  type MasterSearchHit,
} from "@/lib/chemicalSearchV2";
import { parseMasterViticultureRates } from "@/lib/masterCuration";
import { emptyManualRateDraft } from "@/lib/chemicalManualRate";
import type { SavedChemical } from "@/lib/savedChemicalsQuery";

const SPRAYSEED_ROW = {
  id: "master-1",
  registered_product_name: "SPRAY.SEED 250 HERBICIDE",
  registrant: "Syngenta",
  registration_number: "46516",
  product_category: "herbicide",
  active_ingredients: [
    { name: "Paraquat", concentration: "135", concentration_unit: "g/L" },
    { name: "Diquat", concentration: "115", concentration_unit: "g/L" },
  ],
  viticulture_rates: [
    { basis: "per_hectare", kind: "range", unit: "L", min_value: 2.4, max_value: 3.2 },
    { basis: "per_100_litres", kind: "range", unit: "mL", min_value: 240, max_value: 320 },
  ],
  catalogue_version: 7,
  label_version: "2024-1",
};

describe("V2 gate", () => {
  it("is visible only with the flag enabled AND a System Admin", () => {
    expect(chemicalSearchV2Enabled(true, true)).toBe(true);
    expect(chemicalSearchV2Enabled(true, false)).toBe(false);
    expect(chemicalSearchV2Enabled(false, true)).toBe(false);
    expect(chemicalSearchV2Enabled(false, false)).toBe(false);
  });
});

describe("master search normalisation", () => {
  it("reads a flat RPC row", () => {
    const hit = normaliseMasterSearchHit(SPRAYSEED_ROW)!;
    expect(hit.productName).toBe("SPRAY.SEED 250 HERBICIDE");
    expect(hit.registrationNumber).toBe("46516");
    expect(hit.registrant).toBe("Syngenta");
    expect(hit.category).toBe("herbicide");
    expect(hit.activeIngredients).toBe("Paraquat 135 g/L + Diquat 115 g/L");
    expect(hit.rateSummary).toBe("2.4–3.2 L/ha · 240–320 mL/100 L");
  });

  it("reads a nested row and drops unusable entries", () => {
    expect(normaliseMasterSearchHit({ master: SPRAYSEED_ROW })!.id).toBe("master-1");
    expect(normaliseMasterSearchHit({ id: "x" })).toBeNull();
    expect(normaliseMasterSearchHit(null)).toBeNull();
  });

  it("summarises active ingredients from plain text too", () => {
    expect(activeIngredientSummary("Sulphur 800 g/kg")).toBe("Sulphur 800 g/kg");
  });
});

describe("master rate → operational default initialisation", () => {
  const rates = parseMasterViticultureRates(SPRAYSEED_ROW.viticulture_rates);

  it("populates both bases independently when each is unambiguous", () => {
    const init = initialiseDefaultRatesFromMaster(rates);
    expect(init.selections.per_hectare).toMatchObject({
      basis: "per_hectare", unit: "L", value: null, min_value: 2.4, max_value: 3.2,
    });
    expect(init.selections.per_100_litres).toMatchObject({
      basis: "per_100_litres", unit: "mL", value: null, min_value: 240, max_value: 320,
    });
    expect(init.ambiguous.per_hectare).toEqual([]);
    expect(init.ambiguous.per_100_litres).toEqual([]);
  });

  it("keeps ranges as ranges and never mints a canonical identity", () => {
    const sel = initialiseDefaultRatesFromMaster(rates).selections.per_hectare!;
    expect(sel.value).toBeNull();
    expect(sel.option_key).toBe("");
    expect(sel.rate_ids).toEqual([]);
    expect(sel.entry_method).toBe("manual");
    expect(sel.source).toBe("operator");
  });

  it("leaves genuinely different options unselected", () => {
    const ambiguousRates = parseMasterViticultureRates([
      { basis: "per_hectare", kind: "single", unit: "L", value: 2 },
      { basis: "per_hectare", kind: "single", unit: "L", value: 4 },
      { basis: "per_100_litres", kind: "single", unit: "mL", value: 200 },
    ]);
    const init = initialiseDefaultRatesFromMaster(ambiguousRates);
    expect(init.selections.per_hectare).toBeNull();
    expect(init.ambiguous.per_hectare).toHaveLength(2);
    expect(init.selections.per_100_litres).toMatchObject({ value: 200 });
  });

  it("only initialises a basis the master actually covers", () => {
    const onlyHa = parseMasterViticultureRates([
      { basis: "per_hectare", kind: "single", unit: "L", value: 2 },
    ]);
    const init = initialiseDefaultRatesFromMaster(onlyHa);
    expect(init.selections.per_hectare).not.toBeNull();
    expect(init.selections.per_100_litres).toBeNull();
  });
});

describe("saving a Master chemical", () => {
  const hit = normaliseMasterSearchHit(SPRAYSEED_ROW)! as MasterSearchHit;

  it("saves without the operator re-entering a rate", () => {
    const init = initialiseDefaultRatesFromMaster(hit.rates);
    const rates = persistedDefaultRates(init.selections);
    expect(hasAnyDefaultRate(rates)).toBe(true);
    const input = buildMasterSavedChemicalInput(hit, rates);
    expect(input.name).toBe("SPRAY.SEED 250 HERBICIDE");
    expect(input.master_chemical_id).toBe("master-1");
    expect(input.master_source_revision).toBe(7);
    expect(input.default_rates).toEqual(rates);
    // A range never becomes a legacy per-hectare scalar.
    expect(input.rate_per_ha).toBeNull();
    // Master registered information is never written back.
    expect((input as any).viticulture_rates).toBeUndefined();
  });
});

describe("manual entry", () => {
  it("saves with only a name and a valid operational rate", () => {
    const input = buildManualSavedChemicalInput("Local Wettable Sulphur", {
      ...emptyManualRateDraft(),
      open: true,
      kind: "single",
      basis: "per_hectare",
      unit: "kg",
      value: "3",
      confirmed: false,
    })!;
    expect(input.name).toBe("Local Wettable Sulphur");
    expect(input.default_rates?.per_hectare).toMatchObject({ unit: "kg", value: 3, entry_method: "manual" });
    expect(input.product_category).toBeUndefined();
    expect((input as any).registered_uses).toBeUndefined();
    expect((input as any).master_chemical_id).toBeUndefined();
  });

  it("refuses a missing name or an invalid rate", () => {
    const draft = { ...emptyManualRateDraft(), open: true, value: "3" };
    expect(buildManualSavedChemicalInput("   ", draft)).toBeNull();
    expect(buildManualSavedChemicalInput("X", { ...emptyManualRateDraft(), open: true })).toBeNull();
    expect(
      buildManualSavedChemicalInput("X", {
        ...emptyManualRateDraft(), open: true, kind: "range", min: "5", max: "2",
      }),
    ).toBeNull();
  });

  it("keeps a manual range a range", () => {
    const input = buildManualSavedChemicalInput("Ranger", {
      ...emptyManualRateDraft(), open: true, kind: "range", basis: "per_100_litres", unit: "mL",
      min: "240", max: "320",
    })!;
    expect(input.default_rates?.per_100_litres).toMatchObject({
      value: null, min_value: 240, max_value: 320, unit: "mL",
    });
  });

  it("accepts optional details without requiring them", () => {
    const input = buildManualSavedChemicalInput(
      "Sulphur",
      { ...emptyManualRateDraft(), open: true, value: "2" },
      { manufacturer: "Local Co", notes: "From the shed", productCategory: "fungicide" },
    )!;
    expect(input.manufacturer).toBe("Local Co");
    expect(input.notes).toBe("From the shed");
    expect(input.product_category).toBe("fungicide");
  });
});

describe("duplicate handling", () => {
  const library = [
    { id: "a", vineyard_id: "v", name: "Spray.Seed 250", master_chemical_id: "master-1", registration_number: "46516" },
    { id: "b", vineyard_id: "v", name: "Local Wettable Sulphur" },
  ] as SavedChemical[];

  it("matches master id first, then registration, then exact name", () => {
    expect(findVineyardDuplicate(library, { masterChemicalId: "master-1" })!.reason).toBe("master");
    expect(findVineyardDuplicate(library, { registrationNumber: "46516" })!.reason).toBe("registration");
    expect(findVineyardDuplicate(library, { name: "  local wettable sulphur " })!.reason).toBe("name");
  });

  it("does not fuzzy match", () => {
    expect(findVineyardDuplicate(library, { name: "Wettable Sulphur" })).toBeNull();
    expect(findVineyardDuplicate(library, {})).toBeNull();
  });
});

describe("online fallback parsing", () => {
  it("reads whatever the edge function returned and keeps the typed name", () => {
    const result = normaliseOnlineLookup(
      { chemical: { registered_product_name: "Kocide Blue", registrant: "Certis", label_reference: "https://x/label.pdf" } },
      "kocide",
    )!;
    expect(result.productName).toBe("Kocide Blue");
    expect(result.labelUrl).toBe("https://x/label.pdf");
    expect(normaliseOnlineLookup({}, "Fallback Name")!.productName).toBe("Fallback Name");
    expect(normaliseOnlineLookup(null, "x")).toBeNull();
  });
});
