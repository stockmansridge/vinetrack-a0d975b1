// Chemical Lookup — upgraded `chemical-info-lookup` resolver contract.
//
// Regression anchors:
//   Spray Seal        → APVMA 80160 / Omnia / Tebuconazole 430 g/L / FRAC 3
//   Custodia Forte    → APVMA 91636, authoritative actives, grape WHP 28 days
//   Custodia 320SC    → unresolved: no AI chemistry / rate / WHP applied
//   Ridomil Gold      → ambiguous: no AI chemistry / rate / WHP applied
//   Prosaro 420 SC    → authoritative wins, conflicts visible, AI never wins
import { describe, it, expect } from "vitest";
import {
  parseChemicalLookup,
  parseLookupJurisdiction,
  normaliseLookupMatchSource,
  isAuthoritativeProvenance,
  normaliseFieldProvenance,
} from "@/lib/chemicalLookupResolver";

const REGISTER_PROVENANCE = {
  product_name: "official_register",
  registrant: "official_register",
  registration_number: "official_register",
  category: "official_register",
  active_ingredients: "official_register",
  activity_groups: "authoritative_classification",
  registered_uses: "official_label",
  label_reference: "official_register",
};

const SPRAY_SEAL = {
  match_source: "authoritative",
  jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
  field_provenance: REGISTER_PROVENANCE,
  product: {
    registered_product_name: "Spray Seal",
    registrant: "Omnia Specialities Australia Pty Ltd",
    registration_country: "AU",
    registration_scheme: "apvma",
    registration_number: "80160",
    category: "Fungicide",
    label_reference: "https://portal.apvma.gov.au/pubcris?p_=80160",
    label_version: "2021-03",
    active_ingredients: [
      {
        name: "Tebuconazole",
        concentration: 430,
        concentration_unit: "g/L",
        activity_group: { scheme: "frac", code: "3" },
      },
    ],
    registered_uses: [
      {
        crop: "Grapevines",
        target: "Powdery mildew",
        rates: [{ unit: "mL/ha", value: 290, basis: "per_hectare" }],
        withholding_period_days: 30,
      },
    ],
  },
  ai_suggestion: {
    product_name: "Spray Seal Fungicide",
    active_ingredient: "Tebuconazole 250 g/L",
    withholding_period_days: 14,
  },
};

const CUSTODIA_FORTE = {
  match_source: "authoritative",
  jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
  field_provenance: REGISTER_PROVENANCE,
  product: {
    registered_product_name: "Custodia Forte",
    registrant: "Adama Australia Pty Ltd",
    registration_country: "AU",
    registration_scheme: "apvma",
    registration_number: "91636",
    active_ingredients: [
      {
        name: "Tebuconazole",
        concentration: 200,
        concentration_unit: "g/L",
        activity_group: { scheme: "frac", code: "3" },
      },
      {
        name: "Azoxystrobin",
        concentration: 120,
        concentration_unit: "g/L",
        activity_group: { scheme: "frac", code: "11" },
      },
    ],
    registered_uses: [
      {
        crop: "Grapevines",
        target: "Powdery mildew",
        rates: [{ unit: "mL/100L", value: 40, basis: "per_100l" }],
        withholding_period_days: 28,
        re_entry_period_hours: 24,
      },
    ],
  },
};

const CUSTODIA_320 = {
  match_source: "unresolved",
  jurisdiction: { country_code: "AU" },
  field_provenance: {},
  ai_suggestion: {
    product_name: "Custodia 320 SC",
    active_ingredient: "Tebuconazole 120 g/L + Azoxystrobin 200 g/L",
    rate_per_unit: 40,
    rate_unit: "mL/100L",
    withholding_period_days: 30,
    re_entry_period_hours: 24,
  },
};

const RIDOMIL = {
  match_source: "ambiguous",
  jurisdiction: { country_code: "AU" },
  ai_suggestion: {
    product_name: "Ridomil Gold MZ",
    active_ingredient: "Metalaxyl-M 40 g/kg + Mancozeb 640 g/kg",
    withholding_period_days: 28,
  },
};

const PROSARO = {
  match_source: "authoritative",
  jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
  field_provenance: REGISTER_PROVENANCE,
  product: {
    registered_product_name: "Prosaro 420 SC Foliar Fungicide",
    registrant: "Bayer CropScience Pty Ltd",
    registration_country: "AU",
    registration_scheme: "apvma",
    registration_number: "62731",
    active_ingredients: [
      { name: "Prothioconazole", concentration: 210, concentration_unit: "g/L", activity_group: { scheme: "frac", code: "3" } },
      { name: "Tebuconazole", concentration: 210, concentration_unit: "g/L", activity_group: { scheme: "frac", code: "3" } },
    ],
    registered_uses: [
      { crop: "Grapevines", target: "Powdery mildew", rates: [{ unit: "mL/ha", value: 300 }], withholding_period_days: 35 },
    ],
    verification_conflicts: [
      {
        field: "withholding_period_days",
        extracted_value: "14",
        authoritative_value: "35",
        extracted_source: "ai_interpretation",
        authoritative_source: "official_register",
      },
    ],
  },
  ai_suggestion: { withholding_period_text: "14 days", registrant: "Bayer" },
};

describe("resolver primitives", () => {
  it("normalises match sources", () => {
    expect(normaliseLookupMatchSource("authoritative")).toBe("authoritative");
    expect(normaliseLookupMatchSource("master")).toBe("master");
    expect(normaliseLookupMatchSource("ai_candidate")).toBe("ai_candidate");
    expect(normaliseLookupMatchSource("multiple_matches")).toBe("ambiguous");
    expect(normaliseLookupMatchSource("nope")).toBe("unresolved");
  });

  it("only trusts register / label / classification provenance", () => {
    expect(isAuthoritativeProvenance(normaliseFieldProvenance("official_register"))).toBe(true);
    expect(isAuthoritativeProvenance(normaliseFieldProvenance("manufacturer_label"))).toBe(true);
    expect(isAuthoritativeProvenance(normaliseFieldProvenance({ source: "frac" }))).toBe(true);
    expect(isAuthoritativeProvenance(normaliseFieldProvenance("ai_interpretation"))).toBe(false);
    expect(isAuthoritativeProvenance(normaliseFieldProvenance("ai_suggestion"))).toBe(false);
    expect(isAuthoritativeProvenance(normaliseFieldProvenance(undefined))).toBe(false);
  });

  it("takes the lookup country from jurisdiction alone", () => {
    const j = parseLookupJurisdiction({ jurisdiction: { country_code: "AU" } }, "AU");
    expect(j.country).toBe("AU");
    expect(j.status).toBe("resolved");
    expect(parseLookupJurisdiction({}, "AU").status).toBe("unknown");
    expect(parseLookupJurisdiction({ jurisdiction: { country: "NZ" } }, "AU").status).toBe("mismatch");
  });
});

describe("Spray Seal — APVMA 80160", () => {
  const r = parseChemicalLookup(SPRAY_SEAL, "AU");

  it("populates canonical identity from the structured response", () => {
    expect(r.authoritative).toBe(true);
    expect(r.fields.name).toBe("Spray Seal");
    expect(r.fields.registrant).toContain("Omnia");
    expect(r.fields.registrationNumber).toBe("80160");
    expect(r.fields.registrationScheme).toBe("apvma");
    expect(r.fields.registrationCountry).toBe("AU");
    expect(r.fields.category).toBe("Fungicide");
  });

  it("carries the active, its concentration and FRAC group", () => {
    const a = r.draft!.actives[0];
    expect(a.name).toBe("Tebuconazole");
    expect(a.concentration).toBe(430);
    expect(a.concentration_unit).toBe("g/L");
    expect(a.activity_group).toEqual({ scheme: "frac", code: "3" });
    expect(r.fields.chemicalGroupText).toContain("3");
  });

  it("never lets the AI suggestion overwrite canonical values", () => {
    expect(r.fields.name).not.toContain("Fungicide");
    expect(r.fields.withholdingDays).toBe(30);
    expect(r.aiSuggestion?.withholdingText).toBe("14 days");
  });

  it("registration country is known, so the form cannot say unknown", () => {
    expect(r.jurisdiction.country).toBe("AU");
    expect(r.draft!.registration.country).toBe("AU");
  });
});

describe("Custodia Forte — APVMA 91636", () => {
  const r = parseChemicalLookup(CUSTODIA_FORTE, "AU");

  it("resolves both actives and the grape withholding period", () => {
    expect(r.fields.registrationNumber).toBe("91636");
    expect(r.draft!.actives.map((a) => a.name)).toEqual(["Tebuconazole", "Azoxystrobin"]);
    expect(r.fields.withholdingDays).toBe(28);
    expect(r.fields.reEntryHours).toBe(24);
    expect(r.verificationStatus).toBe("verified");
  });
});

describe("Custodia 320SC — unresolved", () => {
  const r = parseChemicalLookup(CUSTODIA_320, "AU");

  it("populates nothing authoritative and shows guidance", () => {
    expect(r.authoritative).toBe(false);
    expect(r.matchSource).toBe("unresolved");
    expect(r.draft).toBeNull();
    expect(r.fields).toEqual({ physicalForm: "unknown" });
    expect(r.guidance).toBeTruthy();
    expect(r.verificationStatus).toBe("unverified");
  });

  it("keeps the AI suggestion visible but unapplied", () => {
    expect(r.aiSuggestion?.activeIngredient).toContain("Tebuconazole");
    expect(r.fields.activeIngredientText).toBeUndefined();
    expect(r.fields.withholdingDays).toBeUndefined();
  });
});

describe("Ridomil Gold — ambiguous", () => {
  const r = parseChemicalLookup(RIDOMIL, "AU");

  it("is treated as unresolved with no AI auto-fill", () => {
    expect(r.matchSource).toBe("ambiguous");
    expect(r.authoritative).toBe(false);
    expect(r.fields.withholdingDays).toBeUndefined();
    expect(r.draft).toBeNull();
    expect(r.guidance).toContain("More than one");
  });
});

describe("Prosaro 420 SC — conflicting evidence", () => {
  const r = parseChemicalLookup(PROSARO, "AU");

  it("keeps authoritative values and surfaces the conflict", () => {
    expect(r.verificationStatus).toBe("conflict");
    expect(r.conflicts).toHaveLength(1);
    expect(r.fields.withholdingDays).toBe(35);
    expect(r.fields.registrant).toBe("Bayer CropScience Pty Ltd");
    expect(r.aiSuggestion?.registrant).toBe("Bayer");
  });
});

describe("provenance gating", () => {
  it("drops fields the resolver could not evidence", () => {
    const r = parseChemicalLookup(
      {
        ...SPRAY_SEAL,
        field_provenance: { ...REGISTER_PROVENANCE, registered_uses: "ai_interpretation" },
      },
      "AU",
    );
    expect(r.fields.withholdingDays).toBeUndefined();
    expect(r.draft!.registeredUses).toHaveLength(0);
    expect(r.unresolvedFields).toContain("registered_uses");
  });

  it("does not populate chemistry that is only AI-interpreted", () => {
    const r = parseChemicalLookup(
      {
        ...SPRAY_SEAL,
        field_provenance: { ...REGISTER_PROVENANCE, active_ingredients: "ai_interpretation" },
      },
      "AU",
    );
    expect(r.draft!.actives).toHaveLength(0);
    expect(r.fields.activeIngredientText).toBeUndefined();
  });
});

/* ---------------------------- backend default_rate_options pass through */

describe("backend default_rate_options survive malformed registered_uses", () => {
  const OPTION = {
    option_key: "default_option_v1_42d1761ddc477436ffd40e7b881f0255",
    rate_ids: [
      "rate_v1_2b559abc7cadaefe20e405674c523811",
      "rate_v1_758843c84a12d817494ccd5acd13720f",
    ],
    basis: "per_100_litres",
    unit: "L",
    value: 2,
    min_value: null,
    max_value: null,
    condition_ambiguous: false,
  };

  const res = parseChemicalLookup(
    {
      match_source: "authoritative",
      jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
      field_provenance: {
        product_name: "official_register",
        registration_number: "official_register",
      },
      product: {
        registered_product_name: "Vicol",
        registration_country: "AU",
        registration_scheme: "apvma",
        registration_number: "33182",
        // Malformed / rate-less authoritative uses — the Portal must not repair
        // these, and must not derive a default from them.
        registered_uses: [{ crop: "Grapevines", rates: [] }],
      },
      default_rate_options: { per_hectare: [], per_100_litres: [OPTION] },
    },
    "AU",
  );

  it("renders the supplied /100 L option verbatim", () => {
    expect(res.defaultRateOptions?.per_100_litres).toHaveLength(1);
    expect(res.defaultRateOptions?.per_100_litres[0]).toMatchObject({
      option_key: OPTION.option_key,
      rate_ids: OPTION.rate_ids,
      basis: "per_100_litres",
      unit: "L",
      value: 2,
    });
    expect(res.defaultRateOptions?.per_hectare).toEqual([]);
  });

  it("does not reconstruct a default from the malformed uses", () => {
    expect(res.fields.rates ?? []).toHaveLength(0);
  });
});
