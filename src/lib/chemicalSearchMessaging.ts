// Presentation-only messaging for the chemical candidate list.
//
// The portal must never claim "more than one registered product matched" when
// the server returned a single candidate. Messaging is derived from the ACTUAL
// candidate count first, and only then from the server search state.
//
// This module changes no ranking, no ordering and no selection behaviour.

import type { ChemicalSearchResponse } from "@/lib/chemicalSearchFlow";

export type CandidatePromptKind =
  | "none"
  | "found"
  | "confirm_single"
  | "select_multiple";

export interface CandidatePrompt {
  kind: CandidatePromptKind;
  /** Section heading shown above the candidate list. */
  title: string;
  /** Secondary instruction, when one is warranted. */
  detail?: string;
}

const EXACT_STATES = new Set(["exact", "exact_match", "confident", "resolved", "unique"]);

/**
 * True when the server explicitly says this result may be taken without the
 * user confirming it. Absent metadata means the user confirms.
 */
export function serverAllowsAutoSelect(res: ChemicalSearchResponse): boolean {
  const s = res.summary;
  if (!s) return false;
  if (s.autoSelectAllowed === true) return true;
  if (s.autoSelectAllowed === false) return false;
  if (s.ambiguous === false) return true;
  return false;
}

export function candidatePrompt(res: ChemicalSearchResponse): CandidatePrompt {
  const count = res.candidates.length;
  if (count === 0) {
    return {
      kind: "none",
      title: "No registered product found",
      detail: "Enter manually",
    };
  }
  if (count > 1) {
    return {
      kind: "select_multiple",
      title: "Possible registered products",
      detail: "Select the correct registration.",
    };
  }
  const state = res.summary?.searchState?.toLowerCase();
  const exact =
    serverAllowsAutoSelect(res) || (state ? EXACT_STATES.has(state) : false);
  return exact
    ? { kind: "found", title: "Registered product found" }
    : {
        kind: "confirm_single",
        title: "Possible registered product",
        detail: "Confirm this is the product you use.",
      };
}
