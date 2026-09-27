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
  persistedDefaultRates,
  type MasterSearchHit,
} from "@/lib/chemicalSearchV2";
import * as chemicalSearchV2Module from "@/lib/chemicalSearchV2";
import {
  buildStagedLookupBody,
  buildStagedSavedChemicalInput,
  initialiseDefaultRatesFromStaged,
  parseStagedLookup,
} from "@/lib/chemicalStagedLookup";
import {
  RESISTANCE_NOT_APPLICABLE_TEXT,
  RESISTANCE_UNKNOWN_TEXT,
  RESISTANCE_UNRESOLVED_WARNING,
  resistanceStateDisplay,
} from "@/lib/chemicalIntelligence";
import { parseMasterViticultureRates } from "@/lib/masterCuration";
import { emptyManualRateDraft } from "@/lib/chemicalManualRate";
import type { SavedChemical } from "@/lib/savedChemicalsQuery";
import type { CanonicalRateBasis, PersistedDefaultRateSelection } from "@/lib/chemicalDefaultRatesContract";

const emptySelections = (): Record<CanonicalRateBasis, PersistedDefaultRateSelection | null> => ({
  per_hectare: null,
  per_100_litres: null,
});

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
  it("routes on the feature flag alone — System Admin is not required", () => {
    expect(chemicalSearchV2Enabled(true)).toBe(true);
    expect(chemicalSearchV2Enabled(false)).toBe(false);
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

/* ------------------------------------------------ staged online fallback -- */

const BEAST_RESPONSE = {
  resistance_classification_state: "classified",
  candidates: [
    {
      product_name: "CropSure Beast 200 Herbicide",
      registrant: "CROPSURE PTY LTD",
      registration_number: "90143",
      product_category: "herbicide",
      active_ingredient: "Glufosinate-ammonium 200 g/L",
      resistance_classification_state: "classified",
    },
  ],
  detail: {
    product_name: "CropSure Beast 200 Herbicide",
    product_category: "herbicide",
    form_type: "soluble liquid",
    activity_groups: ["10"],
    activity_group_scheme: "hrac",
    resistance_classification_state: "classified",
    active_ingredients: [
      { name: "Glufosinate-ammonium", concentration: 200, concentration_unit: "g/L" },
    ],
    registration: {
      registrant: "CROPSURE PTY LTD",
      registration_number: "90143",
      country_code: "AU",
      scheme: "apvma",
      manufacturer_label_url: "https://cropsure.example/beast-label.pdf",
      manufacturer_product_url: "https://cropsure.example/beast",
    },
    grapevine_uses: [
      {
        crop: "Vineyards",
        target_raw: "Weeds referenced in label directions",
        rates: [{ unit: "L", basis: "range_per_hectare", raw_text: "1.0 to 5.0", min_value: 1, max_value: 5 }],
      },
    ],
  },
};

describe("staged web_lookup_v2 fallback", () => {
  it("sends the staged action and, on candidate selection, the selected name", () => {
    expect(buildStagedLookupBody({ query: " Beast ", country: "AU" })).toEqual({
      action: "web_lookup_v2",
      query: "Beast",
      country: "AU",
    });
    expect(
      buildStagedLookupBody({ query: "Beast", country: "AU", selectedName: "CropSure Beast 200 Herbicide" }),
    ).toEqual({
      action: "web_lookup_v2",
      query: "Beast",
      country: "AU",
      selectedName: "CropSure Beast 200 Herbicide",
    });
  });

  it("identifies the agricultural product without a separate operator action", () => {
    // The Portal no longer exposes an explicit 'search label online' button.
    expect(Object.keys(chemicalSearchV2Module)).not.toContain("ONLINE_FALLBACK_LABEL");
    expect(Object.keys(chemicalSearchV2Module)).not.toContain("lookupChemicalLabelOnline");
    const parsed = parseStagedLookup(BEAST_RESPONSE);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].name).toBe("CropSure Beast 200 Herbicide");
    expect(parsed.candidates[0].registrant).toBe("CROPSURE PTY LTD");
  });

  it("Beast acceptance: identity, groups, rates and label provenance", () => {
    const detail = parseStagedLookup(BEAST_RESPONSE).detail!;
    expect(detail.productName).toBe("CropSure Beast 200 Herbicide");
    expect(detail.registrant).toBe("CROPSURE PTY LTD");
    expect(detail.registrationNumber).toBe("90143");
    expect(detail.activeIngredientText).toBe("Glufosinate-ammonium 200 g/L");
    expect(detail.activityGroupText).toBe("HRAC 10");
    expect(detail.resistanceState).toBe("classified");
    // The registered range is preserved exactly, never flattened or converted.
    expect(detail.rateOptions).toHaveLength(1);
    expect(detail.rateOptions[0]).toMatchObject({
      basis: "per_hectare",
      unit: "L",
      minValue: 1,
      maxValue: 5,
      value: null,
    });
    // A manufacturer-hosted PDF is never promoted to a regulator label, and the
    // marketing page is never a label.
    expect(detail.manufacturerLabelUrl).toBe("https://cropsure.example/beast-label.pdf");
    expect(detail.regulatorLabelUrl).toBe("");
    expect(detail.productUrl).toBe("https://cropsure.example/beast");
  });

  it("carries the backend resistance state into the Saved Chemical payload", () => {
    const detail = parseStagedLookup(BEAST_RESPONSE).detail!;
    const init = initialiseDefaultRatesFromStaged(detail.rateOptions);
    const input = buildStagedSavedChemicalInput(detail, persistedDefaultRates(init.selections));
    expect(input.resistance_classification_state).toBe("classified");
    expect(input.name).toBe("CropSure Beast 200 Herbicide");
    expect(input.label_url).toBe("https://cropsure.example/beast-label.pdf");
  });

  it("keeps an unresolved mixture unresolved even when one group is present", () => {
    const detail = parseStagedLookup({
      detail: {
        ...BEAST_RESPONSE.detail,
        resistance_classification_state: "unresolved",
        activity_groups: ["3"],
        activity_group_scheme: "frac",
      },
    }).detail!;
    expect(detail.resistanceState).toBe("unresolved");
    const input = buildStagedSavedChemicalInput(detail, persistedDefaultRates(emptySelections()));
    expect(input.resistance_classification_state).toBe("unresolved");
    expect(resistanceStateDisplay(detail.resistanceState, detail.activityGroupText)).toEqual({
      kind: "unresolved",
      text: RESISTANCE_UNKNOWN_TEXT,
      warning: RESISTANCE_UNRESOLVED_WARNING,
    });
  });

  it("does not invent a group for a not-applicable product", () => {
    const detail = parseStagedLookup({
      detail: {
        ...BEAST_RESPONSE.detail,
        resistance_classification_state: "not_applicable",
        activity_groups: [],
      },
    }).detail!;
    expect(detail.activityGroupText).toBe("");
    expect(resistanceStateDisplay(detail.resistanceState, detail.activityGroupText)).toEqual({
      kind: "not_applicable",
      text: RESISTANCE_NOT_APPLICABLE_TEXT,
    });
  });

  it("never turns an absent group into 'not applicable'", () => {
    const detail = parseStagedLookup({
      detail: { ...BEAST_RESPONSE.detail, resistance_classification_state: null, activity_groups: [] },
    }).detail!;
    expect(detail.resistanceState).toBeNull();
    expect(resistanceStateDisplay(detail.resistanceState, detail.activityGroupText).kind).toBe("none");
  });

  it("does not choose between genuinely different registered rates", () => {
    const detail = parseStagedLookup({
      detail: {
        ...BEAST_RESPONSE.detail,
        grapevine_uses: [
          {
            crop: "Vineyards",
            rates: [
              { unit: "L", basis: "per_hectare", value: 2, raw_text: "2 L/ha" },
              { unit: "L", basis: "per_hectare", value: 4, raw_text: "4 L/ha" },
            ],
          },
        ],
      },
    }).detail!;
    const init = initialiseDefaultRatesFromStaged(detail.rateOptions);
    expect(init.selections.per_hectare).toBeNull();
    expect(init.ambiguous.per_hectare).toHaveLength(2);
  });
});

describe("resistance state propagation", () => {
  it("keeps the Master RPC state verbatim and never derives it from groups", () => {
    const classified = normaliseMasterSearchHit({
      ...SPRAYSEED_ROW,
      activity_groups: ["22"],
      activity_group_scheme: "hrac",
      resistance_classification_state: "classified",
    })!;
    expect(classified.resistanceState).toBe("classified");
    expect(classified.activityGroupText).toBe("HRAC 22");
    expect(
      buildMasterSavedChemicalInput(classified, persistedDefaultRates(emptySelections()))
        .resistance_classification_state,
    ).toBe("classified");

    const unresolved = normaliseMasterSearchHit({
      ...SPRAYSEED_ROW,
      activity_groups: [],
      resistance_classification_state: "unresolved",
    })!;
    expect(unresolved.resistanceState).toBe("unresolved");
    expect(unresolved.activityGroupText).toBe("");

    const noState = normaliseMasterSearchHit({ ...SPRAYSEED_ROW, activity_groups: ["3"] })!;
    expect(noState.resistanceState).toBeNull();
  });

  it("defaults manual entry to unresolved", () => {
    const draft = { ...emptyManualRateDraft(), value: "2", unit: "L", basis: "per_hectare" as const };
    const input = buildManualSavedChemicalInput("Operator product", draft, {});
    expect(input?.resistance_classification_state).toBe("unresolved");
  });
});

