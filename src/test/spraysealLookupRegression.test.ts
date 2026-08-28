// Sprayseal portal regression — parsed against RAW production
// `chemical-info-lookup` responses captured from tbafuqwruefgkbyxrxyb.
//
// The deployed envelope is flat: identity lives in `registration`, the
// jurisdiction block uses `resolved_country_code`, and the match source is
// `authoritative_candidate`. The portal must resolve APVMA 80160 for both
// spellings and must never claim the registration country is unknown when
// the jurisdiction resolved to AU.
import { describe, it, expect } from "vitest";
import { parseChemicalLookup } from "@/lib/chemicalLookupResolver";
import { jurisdictionNotice } from "@/lib/chemicalJurisdiction";
import SPRAYSEAL from "./fixtures/sprayseal-au.json";
import SPRAY_SEAL from "./fixtures/spray-seal-au.json";
import UNRESOLVED from "./fixtures/spray-seal-unresolved.json";

describe.each([
  ["Sprayseal", SPRAYSEAL],
  ["Spray Seal", SPRAY_SEAL],
])("%s — production envelope", (_label, payload) => {
  const r = parseChemicalLookup(payload, "AU");

  it("resolves the authoritative APVMA identity", () => {
    expect(r.matchSource).toBe("authoritative");
    expect(r.authoritative).toBe(true);
    expect(r.fields.registrationNumber).toBe("80160");
    expect(r.fields.registrationScheme).toBe("apvma");
    expect(r.fields.name).toBe("Sprayseal Pruning Wound Treatment");
    expect(r.fields.registrant).toContain("OMNIA");
  });

  it("badges the country as AU with no unknown-country warning", () => {
    expect(r.jurisdiction.country).toBe("AU");
    expect(r.jurisdiction.status).toBe("resolved");
    expect(jurisdictionNotice(r.fields.registrationCountry, "AU").message).toBeNull();
  });

  it("never invents a withholding period the register did not state", () => {
    expect(r.fields.withholdingDays).toBeUndefined();
    expect(r.unresolvedFields).toContain("withholding_periods");
  });
});

describe("unresolved product", () => {
  const r = parseChemicalLookup(UNRESOLVED, "AU");

  it("fails closed with no canonical fields", () => {
    expect(r.matchSource).toBe("unresolved");
    expect(r.authoritative).toBe(false);
    expect(r.fields).toEqual({ physicalForm: "unknown" });
    expect(r.draft).toBeNull();
  });
});

describe("jurisdiction messaging", () => {
  it("blames the registration, not the country, when the vineyard country is known", () => {
    const n = jurisdictionNotice(null, "AU");
    expect(n.message).toBe(
      "Australia registration not resolved — label guidance is not confirmed.",
    );
    expect(n.message).not.toContain("Registration country unknown");
  });
});
