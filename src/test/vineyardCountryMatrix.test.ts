// Country normalisation parity — full VineTrack vineyard-country matrix.
//
// Every country in the vineyard country picker must resolve to the same ISO-2
// code on the portal as it does on iOS/Android. This suite is parameterised
// over the whole set, not just AU/NZ/GB/US.
import { describe, it, expect } from "vitest";
import {
  VINEYARD_COUNTRIES,
  VINEYARD_COUNTRY_ALIASES,
  isSupportedVineyardCountry,
} from "@/lib/vineyardCountries";
import { normaliseCountry } from "@/lib/chemicalIntelligenceWrite";
import { countryLabel, vineyardCountryCode } from "@/lib/chemicalJurisdiction";

describe("vineyard country matrix", () => {
  it("supports exactly the shared 25-country picker set", () => {
    expect(VINEYARD_COUNTRIES).toHaveLength(25);
    const codes = VINEYARD_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z]{2}$/));
  });

  it.each(VINEYARD_COUNTRIES.map((c) => [c.name, c.code] as const))(
    "%s → %s",
    (name, code) => {
      // Display name
      expect(normaliseCountry(name)).toBe(code);
      expect(normaliseCountry(name.toLowerCase())).toBe(code);
      expect(normaliseCountry(`  ${name}  `)).toBe(code);
      // Stored ISO-2 retained
      expect(normaliseCountry(code)).toBe(code);
      expect(normaliseCountry(code.toLowerCase())).toBe(code);
      // Round-trips back to the display name for messaging
      expect(countryLabel(code)).toBe(name);
      expect(isSupportedVineyardCountry(code)).toBe(true);
    },
  );

  it.each(Object.entries(VINEYARD_COUNTRY_ALIASES))(
    "alias %s → %s",
    (alias, code) => {
      expect(normaliseCountry(alias)).toBe(code);
      expect(isSupportedVineyardCountry(code)).toBe(true);
    },
  );

  it("keeps the contract-named aliases working", () => {
    expect(normaliseCountry("UK")).toBe("GB");
    expect(normaliseCountry("USA")).toBe("US");
    expect(normaliseCountry("Aotearoa")).toBe("NZ");
  });

  it("fails closed on unsupported values and never guesses two letters", () => {
    for (const bad of ["Somewhere", "Narnia", "XX", "zz", "", "  ", null, undefined, 42]) {
      expect(normaliseCountry(bad as unknown)).toBeUndefined();
      expect(vineyardCountryCode(bad as unknown)).toBeNull();
    }
    // A valid-looking but unsupported ISO code is still unresolved.
    expect(normaliseCountry("SO")).toBeUndefined();
    expect(isSupportedVineyardCountry("SO")).toBe(false);
  });
});

describe("jurisdiction transmission to chemical lookup", () => {
  // The lookup call always sends the resolved ISO-2 code. These are the
  // representative non-AU jurisdictions required by the contract.
  const REPRESENTATIVE = [
    ["New Zealand", "NZ"],
    ["United Kingdom", "GB"],
    ["United States", "US"],
    ["France", "FR"],
    ["Chile", "CL"],
    ["South Africa", "ZA"],
  ] as const;

  it.each(REPRESENTATIVE)("%s reaches lookup as %s", (name, code) => {
    const countryCode = vineyardCountryCode(name);
    expect(countryCode).toBe(code);
    // Shape of the body sent to `chemical-ai-lookup`.
    const body = { product_name: "Custodia 320 SC", country: countryCode, country_code: countryCode };
    expect(body.country).toBe(code);
    expect(body.country_code).toBe(code);
    expect(countryLabel(countryCode)).toBe(name);
  });
});
