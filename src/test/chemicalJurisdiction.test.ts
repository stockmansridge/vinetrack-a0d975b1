// Chemical jurisdiction enforcement — cross-country fixtures.
//
// The vineyard's country is the only jurisdiction authority. These tests pin
// the contract behaviours: fail-closed lookups, country-scoped Master search,
// preserved chemistry on mismatch, and honest re-verify outcomes.
import { describe, it, expect } from "vitest";
import {
  countryLabel,
  jurisdictionNotice,
  jurisdictionSuitability,
  labelFactsAuthoritative,
  masterEligibleForVineyard,
  vineyardCountryCode,
  MISSING_VINEYARD_COUNTRY_MESSAGE,
} from "@/lib/chemicalJurisdiction";
import { normaliseCountry } from "@/lib/chemicalIntelligenceWrite";
import {
  matchMasterByIdentity,
  masterChemicalDraft,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";
import { reverifyChemical } from "@/lib/chemicalReverify";
import { emptyDraft } from "@/lib/chemicalIntelligenceWrite";

const AU_MASTER: MasterChemicalRow = {
  id: "m-custodia",
  registration_country: "AU",
  registration_scheme: "apvma",
  registration_number: "66541",
  registration_identity_key: "AU:apvma:66541",
  registered_product_name: "Custodia 320 SC",
  registrant: "Adama Australia Pty Ltd",
  review_status: "approved",
  verification_status: "verified",
  catalogue_version: 3,
  label_reference: "https://portal.apvma.gov.au/pubcris?p_=66541",
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
  registered_uses: [],
  verification_unresolved_fields: [],
  verification_conflicts: [],
};

describe("vineyard country normalisation", () => {
  it("normalises names and aliases to ISO-2", () => {
    expect(normaliseCountry("Australia")).toBe("AU");
    expect(normaliseCountry("australia")).toBe("AU");
    expect(normaliseCountry("New Zealand")).toBe("NZ");
    expect(normaliseCountry("UK")).toBe("GB");
    expect(normaliseCountry("USA")).toBe("US");
  });

  it("refuses to guess a country", () => {
    expect(vineyardCountryCode(null)).toBeNull();
    expect(vineyardCountryCode("")).toBeNull();
    expect(vineyardCountryCode("Somewhere")).toBeNull();
  });

  it("labels countries for messaging", () => {
    expect(countryLabel("AU")).toBe("Australia");
    expect(countryLabel("nz")).toBe("New Zealand");
  });
});

describe("jurisdiction suitability", () => {
  it("matches only same-country registrations", () => {
    expect(jurisdictionSuitability("AU", "Australia")).toBe("compatible");
    expect(jurisdictionSuitability("AU", "New Zealand")).toBe("mismatch");
    expect(jurisdictionSuitability(null, "AU")).toBe("unknown");
    expect(jurisdictionSuitability("AU", null)).toBe("unknown");
  });

  it("only treats a same-country label as authoritative", () => {
    expect(labelFactsAuthoritative(jurisdictionSuitability("AU", "AU"))).toBe(true);
    expect(labelFactsAuthoritative(jurisdictionSuitability("AU", "NZ"))).toBe(false);
    expect(labelFactsAuthoritative(jurisdictionSuitability("AU", null))).toBe(false);
  });

  it("fails closed with an actionable message when the vineyard country is missing", () => {
    const n = jurisdictionNotice("AU", null);
    expect(n.labelAuthoritative).toBe(false);
    expect(n.message).toBe(MISSING_VINEYARD_COUNTRY_MESSAGE);
  });

  it("explains the mismatch without hiding the product", () => {
    const n = jurisdictionNotice("AU", "NZ");
    expect(n.suitability).toBe("mismatch");
    expect(n.message).toContain("Registered for Australia");
    expect(n.message).toContain("New Zealand");
    expect(n.action).toContain("New Zealand registration");
  });
});

describe("Master catalogue is country-scoped", () => {
  it("matches an AU master only for an AU vineyard", () => {
    expect(matchMasterByIdentity([AU_MASTER], "Custodia 320 SC", "AU")).toBeTruthy();
    expect(matchMasterByIdentity([AU_MASTER], "Custodia 320 SC", "NZ")).toBeNull();
    expect(matchMasterByIdentity([AU_MASTER], "Custodia 320 SC", null)).toBeNull();
  });

  it("never treats a foreign master as eligible", () => {
    expect(masterEligibleForVineyard(AU_MASTER.registration_country, "AU")).toBe(true);
    expect(masterEligibleForVineyard(AU_MASTER.registration_country, "NZ")).toBe(false);
  });

  it("preserves chemistry even when the record is foreign", () => {
    const draft = masterChemicalDraft(AU_MASTER);
    expect(draft.actives.map((a) => a.name)).toEqual(["Tebuconazole", "Azoxystrobin"]);
    expect(draft.actives.map((a) => a.concentration)).toEqual([200, 120]);
    // Chemistry survives; jurisdiction is judged separately.
    expect(masterEligibleForVineyard(AU_MASTER.registration_country, "NZ")).toBe(false);
  });
});

describe("re-verify honours the vineyard jurisdiction", () => {
  it("confirms identity but refuses to call a foreign label verified here", async () => {
    const r = await reverifyChemical({
      draft: emptyDraft(),
      productName: "Custodia 320 SC",
      country: "AU",
      vineyardCountry: "NZ",
      lookup: async () => [
        {
          product_name: "Custodia 320 SC",
          registration_number: "66541",
          registration_scheme: "APVMA",
          country: "Australia",
          label_reference: "https://portal.apvma.gov.au/pubcris?p_=66541",
          active_ingredient: "Tebuconazole 200 g/L, Azoxystrobin 120 g/L",
        },
      ],
    });
    expect(r.jurisdiction).toBe("mismatch");
    expect(r.title).toContain("not verified for this vineyard");
    expect(r.detail).toContain("New Zealand");
    // Chemistry is still proposed.
    expect(r.proposed?.actives.map((a) => a.name)).toEqual(["Tebuconazole", "Azoxystrobin"]);
  });

  it("reports compatibility for a same-country registration", async () => {
    const r = await reverifyChemical({
      draft: emptyDraft(),
      productName: "Custodia 320 SC",
      country: "AU",
      vineyardCountry: "AU",
      lookup: async () => [
        {
          product_name: "Custodia 320 SC",
          registration_number: "66541",
          registration_scheme: "APVMA",
          country: "Australia",
          label_reference: "https://portal.apvma.gov.au/pubcris?p_=66541",
          active_ingredient: "Tebuconazole 200 g/L, Azoxystrobin 120 g/L",
        },
      ],
    });
    expect(r.jurisdiction).toBe("compatible");
    expect(r.title).not.toContain("not verified");
  });
});
