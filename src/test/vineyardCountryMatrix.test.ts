// Country normalisation parity — full VineTrack vineyard-country matrix.
//
// Canonical contract: docs/vineyard-country-contract.md (30 countries).
// Every country in the vineyard country picker must resolve to the same ISO-2
// code on the portal as it does on iOS/Android. This suite is parameterised
// over the whole set, not just AU/NZ/GB/US.
import { describe, it, expect } from "vitest";
import {
  VINEYARD_COUNTRIES,
  VINEYARD_COUNTRY_ALIASES,
  isSupportedVineyardCountry,
  resolveVineyardCountry,
} from "@/lib/vineyardCountries";
import { normaliseCountry } from "@/lib/chemicalIntelligenceWrite";
import {
  countryLabel,
  vineyardCountryCode,
  jurisdictionSuitability,
} from "@/lib/chemicalJurisdiction";

/** The canonical 30-country set published by Rork. */
const CANONICAL: ReadonlyArray<readonly [string, string]> = [
  ["AR", "Argentina"],
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["BG", "Bulgaria"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["HR", "Croatia"],
  ["FR", "France"],
  ["GE", "Georgia"],
  ["DE", "Germany"],
  ["GR", "Greece"],
  ["HU", "Hungary"],
  ["IN", "India"],
  ["IE", "Ireland"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JP", "Japan"],
  ["MX", "Mexico"],
  ["NZ", "New Zealand"],
  ["PT", "Portugal"],
  ["RO", "Romania"],
  ["SI", "Slovenia"],
  ["ZA", "South Africa"],
  ["ES", "Spain"],
  ["CH", "Switzerland"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["UY", "Uruguay"],
];

describe("vineyard country matrix", () => {
  it("matches the canonical 30-country contract exactly", () => {
    expect(VINEYARD_COUNTRIES).toHaveLength(30);
    const portal = [...VINEYARD_COUNTRIES].map((c) => `${c.code}:${c.name}`).sort();
    const canonical = CANONICAL.map(([code, name]) => `${code}:${name}`).sort();
    expect(portal).toEqual(canonical);
    const codes = VINEYARD_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z]{2}$/));
  });

  it.each(["BR", "CN", "IN", "IL", "JP"])("newly added jurisdiction %s is supported", (code) => {
    expect(isSupportedVineyardCountry(code)).toBe(true);
    expect(vineyardCountryCode(countryLabel(code))).toBe(code);
  });

  it.each(CANONICAL.map(([code, name]) => [name, code] as const))(
    "%s → %s",
    (name, code) => {
      // Display name
      expect(normaliseCountry(name)).toBe(code);
      expect(normaliseCountry(name.toLowerCase())).toBe(code);
      expect(normaliseCountry(`  ${name}  `)).toBe(code);
      expect(resolveVineyardCountry(name)).toBe(code);
      // Stored ISO-2 retained
      expect(normaliseCountry(code)).toBe(code);
      expect(normaliseCountry(code.toLowerCase())).toBe(code);
      // Round-trips back to the display name for messaging
      expect(countryLabel(code)).toBe(name);
      expect(isSupportedVineyardCountry(code)).toBe(true);
      // Accepted by chemical jurisdiction resolution
      expect(vineyardCountryCode(name)).toBe(code);
      expect(jurisdictionSuitability(code, name)).toBe("compatible");
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
    expect(normaliseCountry("Great Britain")).toBe("GB");
    expect(normaliseCountry("USA")).toBe("US");
    expect(normaliseCountry("United States of America")).toBe("US");
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
  // The lookup call always sends the resolved ISO-2 code. Every canonical
  // jurisdiction — including those without a verified national register —
  // must reach `chemical-info-lookup` as its own ISO-2 code.
  it.each(CANONICAL.map(([code, name]) => [name, code] as const))(
    "%s reaches lookup as %s",
    (name, code) => {
      const countryCode = vineyardCountryCode(name);
      expect(countryCode).toBe(code);
      // Shape of the body sent to `chemical-ai-lookup` / `chemical-info-lookup`.
      const body = { product_name: "Custodia 320 SC", country: countryCode, country_code: countryCode };
      expect(body.country).toBe(code);
      expect(body.country_code).toBe(code);
      expect(countryLabel(countryCode)).toBe(name);
    },
  );

  it("never borrows another country's label for a register-less jurisdiction", () => {
    for (const code of ["BR", "CN", "IN", "IL", "JP"]) {
      // An AU-registered product is not authoritative for these vineyards.
      expect(jurisdictionSuitability("AU", code)).toBe("mismatch");
      expect(jurisdictionSuitability("NZ", code)).toBe("mismatch");
      expect(jurisdictionSuitability("GB", code)).toBe("mismatch");
      expect(jurisdictionSuitability("US", code)).toBe("mismatch");
    }
  });
});
