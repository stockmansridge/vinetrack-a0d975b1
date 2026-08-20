// Chemical Lookup — final regression guard.
//
// Production regression: Prosaro 420 SC Foliar Fungicide (APVMA 63243) comes
// back from the resolver with NO withholding period. The portal must leave WHP
// blank in that case, even when a legacy AI suggestion in the same payload
// (or an earlier legacy candidate) offers a number.
import { describe, it, expect } from "vitest";
import {
  parseChemicalLookup,
  isStructuredLookupEnvelope,
} from "@/lib/chemicalLookupResolver";

/** Live-shaped structured response: authoritative identity, WHP unresolved. */
const PROSARO_LIVE = {
  match_source: "authoritative",
  jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
  field_provenance: {
    product_name: "official_register",
    registrant: "official_register",
    registration_number: "official_register",
    active_ingredients: "official_register",
    activity_groups: "authoritative_classification",
    registered_uses: "official_label",
  },
  product: {
    registered_product_name: "Prosaro 420 SC Foliar Fungicide",
    registrant: "Bayer CropScience Pty Ltd",
    registration_country: "AU",
    registration_scheme: "apvma",
    registration_number: "63243",
    active_ingredients: [
      { name: "Prothioconazole", concentration: 210, concentration_unit: "g/L", activity_group: { scheme: "frac", code: "3" } },
      { name: "Tebuconazole", concentration: 210, concentration_unit: "g/L", activity_group: { scheme: "frac", code: "3" } },
    ],
    registered_uses: [
      {
        crop: "Grapevines",
        target: "Powdery mildew",
        rates: [{ unit: "L/ha", value: 0.35, basis: "per_hectare" }],
        // WHP and REI are NOT returned by the live resolver.
      },
    ],
  },
  // A legacy-style AI suggestion travelling in the same payload.
  ai_suggestion: {
    product_name: "Prosaro 420 SC Fungicide",
    withholding_period_days: 35,
    re_entry_period_hours: 24,
  },
};

describe("Prosaro 420 SC — WHP must stay unresolved", () => {
  const r = parseChemicalLookup(PROSARO_LIVE, "AU");

  it("keeps the authoritative identity", () => {
    expect(r.authoritative).toBe(true);
    expect(r.fields.registrationNumber).toBe("63243");
    expect(r.fields.name).toBe("Prosaro 420 SC Foliar Fungicide");
  });

  it("leaves WHP and REI blank because the label did not return them", () => {
    expect(r.fields.withholdingDays).toBeUndefined();
    expect(r.fields.reEntryHours).toBeUndefined();
    expect(r.draft!.registeredUses[0].withholding_period_days).toBeUndefined();
    expect(r.unresolvedFields).toContain("withholding_period_days");
    expect(r.unresolvedFields).toContain("re_entry_period_hours");
  });

  it("never lifts the legacy/AI 35-day value into a canonical field", () => {
    expect(r.aiSuggestion?.withholdingText).toContain("35");
    // The WHP fields specifically must stay empty (label rates are unrelated).
    expect(r.fields.withholdingDays).toBeUndefined();
    expect(r.fields.withholdingText).toBeUndefined();
    expect(r.fields.reEntryHours).toBeUndefined();
    expect(r.draft!.registeredUses.some((u) => u.withholding_period_days != null)).toBe(false);
  });


  it("stays blank even when a legacy suggestion carries a WHP alongside it", () => {
    // Simulates the SavedChemicals apply path: the resolved branch is terminal,
    // so `whp` is set from the resolver only — undefined clears the field.
    const legacySuggestion = { whp_days: "35", rei_hours: "24" };
    const whp = r.fields.withholdingDays != null ? String(r.fields.withholdingDays) : "";
    const rei = r.fields.reEntryHours != null ? String(r.fields.reEntryHours) : "";
    expect(whp).toBe("");
    expect(rei).toBe("");
    expect(whp).not.toBe(legacySuggestion.whp_days);
  });
});

describe("legacy payloads are not structured resolver results", () => {
  it("rejects the live AI-shaped chemical-info-lookup body", () => {
    expect(
      isStructuredLookupEnvelope({
        activeIngredient: "Prothioconazole, Tebuconazole",
        brand: "Bayer",
        chemicalGroup: "Triazole",
        ratesPerHectare: [{ label: "Standard rate", value: 1.5 }],
      }),
    ).toBe(false);
  });

  it("rejects an error body", () => {
    expect(isStructuredLookupEnvelope({ error: "Unknown action" })).toBe(false);
  });

  it("accepts a contract-shaped body", () => {
    expect(isStructuredLookupEnvelope(PROSARO_LIVE)).toBe(true);
  });
});
