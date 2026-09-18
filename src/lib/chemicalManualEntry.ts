// Manual chemical entry contract (portal parity with the mobile
// `ChemicalSaveContract`).
//
// This module is PURE. It never calls the network, never writes, and never
// invents chemistry. It answers one question: is this operator-authored draft
// a usable, sprayable chemical record?
//
// Hard boundaries:
//   * A manual product is UNVERIFIED. Typing a registration number or a URL
//     never verifies it and never creates a master link.
//   * A rate is calculable or it is not: free text is not a rate.
//   * A range stays a range. No midpoint, no min, no max, no conversion.
//   * Empty active ingredients are legitimate — never demand an invented one.

import {
  isRangeBasis,
  LABEL_RATE_BASES,
  type LabelRateBasis,
  type WriteLabelRate,
  type WriteRegisteredUse,
} from "@/lib/chemicalIntelligenceWrite";
import {
  validateManualRate,
  type ManualRateDraft,
} from "@/lib/chemicalManualRate";

/* ------------------------------------------------------------- user copy */

export const ENTER_MANUALLY_LABEL = "Enter manually";

export const MANUAL_ENTRY_HELPER =
  "Enter the product details from its label. Manually entered products remain unverified until checked against a registered product.";

export const MANUAL_PROVENANCE_BADGE = "Unverified / manually entered";

/**
 * Manual entry is a deliberate choice, not a failed lookup: the registered
 * product recovery wording must never be reused here.
 */
export const MANUAL_RATE_ENTRY_MESSAGE =
  "You are entering this rate from the product label yourself. It is saved as a user-entered rate.";

export const ADD_GRAPEVINE_USE_LABEL = "Add grapevine use";

/* ------------------------------------------------------------- rate rules */

const finitePositive = (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

const isKnownBasis = (b: unknown): b is LabelRateBasis =>
  typeof b === "string" && (LABEL_RATE_BASES as string[]).includes(b);

/**
 * A rate that a spray can actually be calculated from. A scalar must be finite
 * and greater than zero; a range needs BOTH endpoints positive and finite with
 * max >= min. The unit must be stated.
 */
export function isUsableLabelRate(rate: WriteLabelRate | null | undefined): boolean {
  if (!rate) return false;
  if (!isKnownBasis(rate.basis)) return false;
  if (!String(rate.unit ?? "").trim()) return false;
  if (isRangeBasis(rate.basis)) {
    const min = rate.min_value;
    const max = rate.max_value;
    return finitePositive(min) && finitePositive(max) && (max as number) >= (min as number);
  }
  return finitePositive(rate.value);
}

/** True when the use is a grapevine use carrying at least one usable rate. */
export function useHasUsableRate(use: WriteRegisteredUse): boolean {
  return (use.rates ?? []).some(isUsableLabelRate);
}

/* --------------------------------------------------------- save contract */

/**
 * SIMPLIFIED manual save contract (all platforms).
 *
 * A manually entered vineyard chemical needs a product name and a usable
 * default rate — rate type, rate basis, amount(s) and product unit. Nothing
 * else can block the save: category, registration number, product form,
 * manufacturer, active ingredients, resistance groups, label links, registered
 * uses, WHP/REI, restrictions, purchase, inventory, notes and verification
 * metadata are ALL optional information.
 */
export type ManualContractField = "name" | "rate";

export interface ManualContractViolation {
  field: ManualContractField;
  message: string;
}

export interface ManualContractInput {
  name?: string | null;
  /**
   * The operator's default-rate draft. `null`/absent means no rate has been
   * entered yet, which is the only rate violation possible.
   */
  rate?: ManualRateDraft | null;
  /**
   * Accepted for compatibility with existing callers and NEVER validated:
   * registered uses are optional for manual entry and are only populated from
   * the Master Catalogue, product labels, Chemical Search or label extraction.
   */
  uses?: readonly WriteRegisteredUse[];
  /** Accepted and never validated — product category is optional. */
  category?: string | null;
}

export const MANUAL_CONTRACT_MESSAGE: Record<ManualContractField, string> = {
  name: "Enter the product name.",
  rate: "Enter a default rate: a single amount, or a minimum and maximum, with a product unit.",
};

export function evaluateManualSaveContract(
  input: ManualContractInput,
): { ok: boolean; violations: ManualContractViolation[] } {
  const violations: ManualContractViolation[] = [];
  if (!String(input.name ?? "").trim()) {
    violations.push({ field: "name", message: MANUAL_CONTRACT_MESSAGE.name });
  }
  if (!input.rate) {
    violations.push({ field: "rate", message: MANUAL_CONTRACT_MESSAGE.rate });
  } else {
    const rate = validateManualRate(input.rate);
    if (rate.ok === false) violations.push({ field: "rate", message: rate.message });
  }
  return { ok: violations.length === 0, violations };
}

export const violationFields = (
  violations: readonly ManualContractViolation[],
): Set<ManualContractField> => new Set(violations.map((v) => v.field));

/**
 * Existing records: pre-existing incompleteness must stay repairable, so only
 * violations that this editing session INTRODUCED can block a save.
 */
export function newlyIntroducedViolations(
  baseline: readonly ManualContractViolation[],
  current: readonly ManualContractViolation[],
): ManualContractViolation[] {
  const had = violationFields(baseline);
  return current.filter((v) => !had.has(v.field));
}
