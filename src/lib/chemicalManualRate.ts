// Manual RATE fallback for an already-resolved registered product.
//
// This module exists for ONE recovery case: the backend resolved an
// authoritative registered product (APVMA identity, actives, manufacturer,
// category, label links) but could not read a usable grapevine RATE from the
// label. The operator may then enter the rate themselves.
//
// Hard boundaries:
//   * This is NOT manual chemical entry. The product stays `registered`.
//   * NOTHING here mints a canonical `default_option_v1_*` or `rate_v1_*`
//     identity — those are backend-minted label identities.
//   * A range stays a range. No midpoint, no collapse to min/max, and
//     /ha and /100 L are never converted into one another.

import type {
  CanonicalRateBasis,
  PersistedDefaultRateSelection,
} from "@/lib/chemicalDefaultRatesContract";
import type {
  LabelRateBasis,
  WriteLabelRate,
  WriteRegisteredUse,
} from "@/lib/chemicalIntelligenceWrite";

export type ManualRateKind = "single" | "range";

/** The units VineTrack already uses for product amounts. Not free text. */
export const MANUAL_RATE_UNITS = ["L", "mL", "kg", "g"] as const;
export type ManualRateUnit = (typeof MANUAL_RATE_UNITS)[number];

export const MANUAL_RATE_BASIS_LABEL: Record<CanonicalRateBasis, string> = {
  per_hectare: "Per hectare",
  per_100_litres: "Per 100 L",
};

export const MANUAL_RATE_BASIS_SUFFIX: Record<CanonicalRateBasis, string> = {
  per_hectare: "/ha",
  per_100_litres: "/100 L",
};

export const ENTER_RATE_MANUALLY_LABEL = "Enter rate manually";

export const MANUAL_RATE_PROVENANCE_MESSAGE =
  "User-entered rate — VineTrack could not read this rate automatically from the product label.";

export const MANUAL_RATE_CONFIRM_LABEL =
  "I have checked this rate against the current product label";

export const MANUAL_RATE_CONFIRMED_BADGE = "User-confirmed";

export interface ManualRateDraft {
  open: boolean;
  kind: ManualRateKind;
  basis: CanonicalRateBasis;
  unit: ManualRateUnit;
  /** Single-rate amount, as typed. */
  value: string;
  /** Range bounds, as typed. */
  min: string;
  max: string;
  confirmed: boolean;
}

export function emptyManualRateDraft(): ManualRateDraft {
  return {
    open: false,
    kind: "single",
    basis: "per_hectare",
    unit: "L",
    value: "",
    min: "",
    max: "",
    confirmed: false,
  };
}

export type ManualRateValidation =
  | {
      ok: true;
      kind: ManualRateKind;
      basis: CanonicalRateBasis;
      unit: ManualRateUnit;
      value: number | null;
      min_value: number | null;
      max_value: number | null;
    }
  | { ok: false; message: string };

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Pure validation. Numbers must be finite and greater than zero; a range needs
 * BOTH bounds and max may never fall below min.
 */
export function validateManualRate(draft: ManualRateDraft): ManualRateValidation {
  if (draft.kind === "single") {
    const v = num(draft.value);
    if (v == null) return { ok: false, message: "Enter a rate." };
    if (v <= 0) return { ok: false, message: "Rate must be greater than zero." };
    return {
      ok: true,
      kind: "single",
      basis: draft.basis,
      unit: draft.unit,
      value: v,
      min_value: null,
      max_value: null,
    };
  }
  const min = num(draft.min);
  const max = num(draft.max);
  if (min == null) return { ok: false, message: "Enter a minimum rate." };
  if (max == null) return { ok: false, message: "Enter a maximum rate." };
  if (min <= 0 || max <= 0) {
    return { ok: false, message: "Rates must be greater than zero." };
  }
  if (max < min) {
    return { ok: false, message: "Maximum cannot be below the minimum." };
  }
  return {
    ok: true,
    kind: "range",
    basis: draft.basis,
    unit: draft.unit,
    value: null,
    min_value: min,
    max_value: max,
  };
}

/** Display only — "2–4 L/ha". Never feeds a calculation. */
export function manualRateSummary(draft: ManualRateDraft): string | null {
  const v = validateManualRate(draft);
  if (!v.ok) return null;
  const suffix = `${v.unit}${MANUAL_RATE_BASIS_SUFFIX[v.basis]}`;
  return v.kind === "single"
    ? `${v.value} ${suffix}`
    : `${v.min_value}–${v.max_value} ${suffix}`;
}

/** The manual rate only satisfies the save gate once explicitly confirmed. */
export function manualRateSatisfiesGate(draft: ManualRateDraft | null | undefined): boolean {
  if (!draft || !draft.open) return false;
  return draft.confirmed && validateManualRate(draft).ok;
}

const LABEL_BASIS: Record<ManualRateKind, Record<CanonicalRateBasis, LabelRateBasis>> = {
  single: { per_hectare: "per_hectare", per_100_litres: "per_100_litres" },
  range: { per_hectare: "range_per_hectare", per_100_litres: "range_per_100_litres" },
};

/**
 * The user-entered rate expressed in the EXISTING Chemical Intelligence rate
 * shape, carrying explicit user-entered provenance so it can never later be
 * represented as an automatically extracted label rate.
 */
export function manualRateLabelRate(draft: ManualRateDraft): WriteLabelRate | null {
  const v = validateManualRate(draft);
  if (!v.ok) return null;
  const rate: WriteLabelRate = {
    label: "User-entered rate",
    basis: LABEL_BASIS[v.kind][v.basis],
    unit: v.unit,
    raw_text: manualRateSummary(draft) ?? "",
    extra: {
      source: "user_entered",
      user_entered: true,
      user_confirmed_against_label: draft.confirmed,
    },
  };
  if (v.kind === "single") rate.value = v.value ?? undefined;
  else {
    rate.min_value = v.min_value ?? undefined;
    rate.max_value = v.max_value ?? undefined;
  }
  return rate;
}

/**
 * A grapevine use carrying only the user-entered rate. Its provenance is
 * `user_entered` on every claim, so no consumer can mistake it for label
 * evidence. No canonical option/rate identity is minted.
 */
export function manualRateRegisteredUse(
  draft: ManualRateDraft,
  target?: string | null,
): WriteRegisteredUse | null {
  const rate = manualRateLabelRate(draft);
  if (!rate) return null;
  return {
    crop: "Grapevines",
    target_raw: (target ?? "").trim() || "Operator-entered rate",
    rates: [rate],
    provenance: {
      claim: "user_entered",
      rates: "user_entered",
      withholding_period: null,
      re_entry: null,
      restrictions: null,
    },
    extra: { user_entered: true, user_confirmed_against_label: draft.confirmed },
  } as WriteRegisteredUse;
}

/* ------------------------------------- SQL 222 shared manual-rate contract */

/**
 * The operational selection for a user-entered, user-confirmed rate.
 *
 * `source` stays `operator`; `entry_method: "manual"` is what distinguishes it
 * from a backend label option. It carries an EMPTY `option_key` and EMPTY
 * `rate_ids` — no canonical identity is ever fabricated — and a range stays a
 * range (no midpoint, no collapse, no basis/unit conversion).
 */
export function manualRateSelection(
  draft: ManualRateDraft,
  meta?: { selected_at?: string | null },
): PersistedDefaultRateSelection | null {
  if (!manualRateSatisfiesGate(draft)) return null;
  const v = validateManualRate(draft);
  if (!v.ok) return null;
  return {
    option_key: "",
    rate_ids: [],
    basis: v.basis,
    unit: v.unit,
    value: v.value,
    min_value: v.min_value,
    max_value: v.max_value,
    source: "operator",
    entry_method: "manual",
    selected_at: meta?.selected_at ?? null,
    label_version: null,
  };
}

/** True for a persisted selection the operator typed themselves. */
export function isManualRateSelection(
  selection: Pick<PersistedDefaultRateSelection, "entry_method"> | null | undefined,
): boolean {
  return selection?.entry_method === "manual";
}

const isManualUnit = (u: string): u is ManualRateUnit =>
  (MANUAL_RATE_UNITS as readonly string[]).includes(u);

/**
 * Reopening the Chemical Store: reconstruct the EXACT manual draft (rate type,
 * basis, unit, amounts and confirmed provenance) from the persisted selection.
 */
export function manualRateDraftFromSelection(
  selection: PersistedDefaultRateSelection | null | undefined,
): ManualRateDraft | null {
  if (!selection || !isManualRateSelection(selection)) return null;
  if (!isManualUnit(selection.unit)) return null;
  const isRange = selection.value == null;
  if (isRange && (selection.min_value == null || selection.max_value == null)) return null;
  return {
    open: true,
    kind: isRange ? "range" : "single",
    basis: selection.basis,
    unit: selection.unit,
    value: isRange ? "" : String(selection.value),
    min: isRange ? String(selection.min_value) : "",
    max: isRange ? String(selection.max_value) : "",
    confirmed: true,
  };
}
