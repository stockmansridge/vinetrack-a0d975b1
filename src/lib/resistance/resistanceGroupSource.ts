// P7 — one shared way to turn Chemical Intelligence into resistance groups.
//
// Both resistance surfaces (the Live Resistance Check on a spray draft and the
// standalone Resistance Planner) previously derived group codes and evidence
// quality separately. Identical chemistry could therefore be described as
// "verified" on one screen and "unverified" on the other, which is exactly the
// discrepancy that makes an operator distrust both. Everything either surface
// needs to answer "which groups, and how well do we know them?" lives here.
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { normaliseGroupCode } from "./resistanceRuleset";
import {
  availabilityFromVerificationStatus,
  type ChemicalIntelligenceAvailability,
} from "./resistanceEvent";

/**
 * Scheme-qualified code for one activity group, accepting either the read
 * model's uppercase schemes ("FRAC"/"HRAC"/"IRAC"/"NA") or the write model's
 * lowercase tokens ("frac"/"hrac"/"irac"/"not_applicable"). A herbicide or
 * insecticide code keeps its scheme so it can never be read as the fungicide
 * group carrying the same numeral.
 */
export function qualifiedGroupCode(
  scheme: string | null | undefined,
  code: string | null | undefined,
): string | null {
  const s = (scheme ?? "").trim().toUpperCase();
  if (!code || !code.trim()) return null;
  if (s === "NA" || s === "NOT_APPLICABLE") return null;
  if (s === "HRAC" || s === "IRAC") return `${s} ${code.trim()}`;
  return code.trim();
}

/**
 * Scheme-qualified group codes carried by a product's STRUCTURED intelligence.
 * The scheme is preserved because HRAC 9 and FRAC 9 are different chemistry
 * that happen to share a numeral.
 */
export function structuredGroupCodes(
  intel: ChemicalIntelligence | null | undefined,
): string[] {
  if (!intel?.structured) return [];
  return intel.activityGroups
    .map((g) => qualifiedGroupCode(g.scheme, g.code))
    .filter((c): c is string => !!c);
}

const normalisedSet = (codes: string[]): Set<string> => {
  const out = new Set<string>();
  for (const c of codes) {
    const n = normaliseGroupCode(c);
    if (n) out.add(n);
  }
  return out;
};

/**
 * True when every code being evaluated is actually backed by the product's
 * structured chemistry. A group typed by hand alongside a linked product is
 * still a hand-typed group: linkage alone cannot vouch for it.
 */
export function codesAreStructurallyBacked(
  intel: ChemicalIntelligence | null | undefined,
  codes: string[],
): boolean {
  if (!intel?.structured || codes.length === 0) return false;
  const backed = normalisedSet(structuredGroupCodes(intel));
  if (backed.size === 0) return false;
  for (const code of normalisedSet(codes)) if (!backed.has(code)) return false;
  return true;
}

/**
 * Evidence quality for a set of group codes. Never optimistic: unverified or
 * unbacked codes stay unverified, and no codes at all is `unavailable` rather
 * than a silent pass.
 */
export function availabilityForGroupCodes(args: {
  intel: ChemicalIntelligence | null | undefined;
  codes: string[];
}): ChemicalIntelligenceAvailability {
  const { intel, codes } = args;
  if (codes.length === 0) return "unavailable";
  if (!codesAreStructurallyBacked(intel, codes)) return "available_unverified";
  return availabilityFromVerificationStatus(intel!.verification.status);
}

/**
 * The groups a proposed product line contributes, resolved identically for the
 * wizard and the planner: structured chemistry first, hand-entered codes only
 * as a declared fallback.
 */
export function resolveProductGroups(args: {
  intel: ChemicalIntelligence | null | undefined;
  /** Codes typed on the line/position when structured chemistry is absent. */
  fallbackCodes: string[];
  /** When set, these codes are evaluated verbatim (planner positions). */
  explicitCodes?: string[] | null;
}): { codes: string[]; availability: ChemicalIntelligenceAvailability } {
  const { intel, fallbackCodes, explicitCodes } = args;
  const structured = structuredGroupCodes(intel);
  const codes =
    explicitCodes && explicitCodes.length > 0
      ? explicitCodes
      : structured.length > 0
        ? structured
        : fallbackCodes;
  return { codes, availability: availabilityForGroupCodes({ intel, codes }) };
}
