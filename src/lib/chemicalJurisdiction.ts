// Chemical jurisdiction enforcement (shared Rork contract).
//
// One rule underpins this module: the CURRENT VINEYARD'S country decides which
// label is authoritative. Never the browser locale, the OS locale, the user's
// country, an IP guess, or whatever country the AI felt like answering for.
//
// When the vineyard country is unknown the portal fails CLOSED: lookups are
// blocked and the operator is asked to set the vineyard country.
//
// A jurisdiction mismatch never erases chemistry. Actives, concentrations and
// FRAC/HRAC/IRAC groups remain valid product facts; only LABEL facts
// (registered uses, rates, WHP, re-entry, restrictions) stop being
// authoritative for the current vineyard.
import { normaliseCountry } from "@/lib/chemicalIntelligenceWrite";

export type JurisdictionSuitability = "compatible" | "mismatch" | "unknown";

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  GB: "United Kingdom",
  US: "United States",
  ZA: "South Africa",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  DE: "Germany",
  CL: "Chile",
  AR: "Argentina",
  CA: "Canada",
};

/** ISO-2 code for the selected vineyard, or null when it cannot be resolved. */
export function vineyardCountryCode(value: unknown): string | null {
  const code = normaliseCountry(value);
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

/** Human country name for messaging; falls back to the ISO code. */
export function countryLabel(code: string | null | undefined): string {
  const c = vineyardCountryCode(code);
  if (!c) return "unknown";
  return COUNTRY_NAMES[c] ?? c;
}

/**
 * Relationship between a product's registration country and the vineyard's
 * country. Computed on demand — never persisted (contract §7).
 */
export function jurisdictionSuitability(
  registrationCountry: unknown,
  vineyardCountry: unknown,
): JurisdictionSuitability {
  const reg = vineyardCountryCode(registrationCountry);
  const vin = vineyardCountryCode(vineyardCountry);
  if (!reg || !vin) return "unknown";
  return reg === vin ? "compatible" : "mismatch";
}

/** Label facts are authoritative only for a confirmed same-country label. */
export function labelFactsAuthoritative(suitability: JurisdictionSuitability): boolean {
  return suitability === "compatible";
}

export const MISSING_VINEYARD_COUNTRY_TITLE = "Vineyard country not set";

export const MISSING_VINEYARD_COUNTRY_MESSAGE =
  "Set the vineyard country before looking up chemicals. VineTrack will not guess a jurisdiction.";

/** "Registered for Australia — current vineyard is New Zealand". */
export function jurisdictionMismatchMessage(
  registrationCountry: unknown,
  vineyardCountry: unknown,
): string {
  return `Registered for ${countryLabel(registrationCountry)} — current vineyard is ${countryLabel(
    vineyardCountry,
  )}`;
}

/** "Verify a New Zealand registration before using label-specific guidance." */
export function jurisdictionVerifyPrompt(vineyardCountry: unknown): string {
  return `Verify a ${countryLabel(
    vineyardCountry,
  )} registration before using label-specific guidance.`;
}

export interface JurisdictionNotice {
  suitability: JurisdictionSuitability;
  /** True when label rates / WHP / REI may be presented as authoritative. */
  labelAuthoritative: boolean;
  /** Headline sentence, or null when compatible. */
  message: string | null;
  /** Follow-up instruction, or null when compatible. */
  action: string | null;
}

/**
 * Everything the UI needs to present a product honestly for this vineyard.
 * Chemistry is always retained; only the label authority changes.
 */
export function jurisdictionNotice(
  registrationCountry: unknown,
  vineyardCountry: unknown,
): JurisdictionNotice {
  const suitability = jurisdictionSuitability(registrationCountry, vineyardCountry);
  if (suitability === "compatible") {
    return { suitability, labelAuthoritative: true, message: null, action: null };
  }
  if (suitability === "mismatch") {
    return {
      suitability,
      labelAuthoritative: false,
      message: jurisdictionMismatchMessage(registrationCountry, vineyardCountry),
      action: jurisdictionVerifyPrompt(vineyardCountry),
    };
  }
  const vin = vineyardCountryCode(vineyardCountry);
  return {
    suitability,
    labelAuthoritative: false,
    message: vin
      ? "Registration country unknown — label guidance is not confirmed for this vineyard."
      : MISSING_VINEYARD_COUNTRY_MESSAGE,
    action: vin ? jurisdictionVerifyPrompt(vin) : null,
  };
}

/** A Master record is only eligible when it is registered in this country. */
export function masterEligibleForVineyard(
  masterCountry: unknown,
  vineyardCountry: unknown,
): boolean {
  return jurisdictionSuitability(masterCountry, vineyardCountry) === "compatible";
}
