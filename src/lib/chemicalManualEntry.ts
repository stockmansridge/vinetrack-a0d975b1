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
import { grapevineOnlyUses } from "@/lib/chemicalVineyardScope";

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

export type ManualContractField = "name" | "category" | "grapevine_use" | "rate";

export interface ManualContractViolation {
  field: ManualContractField;
  message: string;
}

export interface ManualContractInput {
  name?: string | null;
  /** RAW shared category key. A display label is not a category. */
  category?: string | null;
  uses: readonly WriteRegisteredUse[];
}

export const MANUAL_CONTRACT_MESSAGE: Record<ManualContractField, string> = {
  name: "Enter the product name from the label.",
  category: "Choose the product category.",
  grapevine_use: "Add at least one grapevine use.",
  rate: "Enter a label rate for the grapevine use: a single amount, or a minimum and maximum, with a unit.",
};

/**
 * Mirror of the mobile minimum manual-record contract. Registration number,
 * label URL, WHP, REI, purchase data and active ingredients are all optional.
 */
export function evaluateManualSaveContract(
  input: ManualContractInput,
): { ok: boolean; violations: ManualContractViolation[] } {
  const violations: ManualContractViolation[] = [];
  if (!String(input.name ?? "").trim()) {
    violations.push({ field: "name", message: MANUAL_CONTRACT_MESSAGE.name });
  }
  if (!String(input.category ?? "").trim()) {
    violations.push({ field: "category", message: MANUAL_CONTRACT_MESSAGE.category });
  }
  const grapevine = grapevineOnlyUses(input.uses as WriteRegisteredUse[]);
  if (grapevine.length === 0) {
    violations.push({ field: "grapevine_use", message: MANUAL_CONTRACT_MESSAGE.grapevine_use });
  } else if (!grapevine.some(useHasUsableRate)) {
    violations.push({ field: "rate", message: MANUAL_CONTRACT_MESSAGE.rate });
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
