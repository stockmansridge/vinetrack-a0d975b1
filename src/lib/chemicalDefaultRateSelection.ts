// Chemical default rates — operator selection / restore helpers.
//
// Gate D4B-P2B. Pure, clock-independent helpers that turn a BACKEND canonical
// option into a persisted selection and match a persisted selection back
// against the current canonical option set.
//
// GOVERNING RULE: a persisted selection may ONLY be produced by copying one
// `CanonicalDefaultRateOption` verbatim and adding provenance. Nothing here may
// ever derive a selection from `buildDefaultRateOptions()`, a
// `${basis}|${text}` key, `registered_uses` grouping, a typed legacy rate or
// `rate_per_ha`. No hashing, no grouping, no unit or basis conversion, and no
// display metadata inside `default_rates`.
import {
  CANONICAL_RATE_BASES,
  type CanonicalDefaultRateOption,
  type CanonicalDefaultRateOptions,
  type CanonicalRateBasis,
  type DefaultRateSelectionSource,
  type PersistedDefaultRateSelection,
  type PersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";

/* ------------------------------------------------------------- vocabulary */

/**
 * Match state of ONE persisted basis slot against the current canonical set.
 *
 *  - `no_selection` — nothing persisted for this basis.
 *  - `matched`      — a current canonical option is identical (see §3).
 *  - `needs_review` — canonical options ARE known and none matches. The stored
 *                     snapshot is kept; the operator must choose or clear.
 *  - `unavailable`  — canonical options have not been fetched in this editor
 *                     session, so the saved selection cannot be rechecked.
 */
export type DefaultRateSlotStatus =
  | "no_selection"
  | "matched"
  | "needs_review"
  | "unavailable";

export interface DefaultRateSlotState {
  basis: CanonicalRateBasis;
  status: DefaultRateSlotStatus;
  /** The persisted snapshot, untouched. Never substituted. */
  selection: PersistedDefaultRateSelection | null;
  /** The identical current canonical option — only when `status === "matched"`. */
  matchedOption: CanonicalDefaultRateOption | null;
}

export const UNAVAILABLE_MESSAGE =
  "Saved default — not rechecked against the current label in this session.";

export const NEEDS_REVIEW_MESSAGE =
  "Saved default no longer matches the current resolved label options. Review and choose a current option or clear the saved default.";

export const PRODUCT_CHANGED_MESSAGE =
  "Saved defaults were cleared because the registered product changed.";

/* --------------------------------------------------------------- empty state */

/** The valid version-1 empty contract. Never `null`, never partial. */
export function emptyPersistedDefaultRates(): PersistedDefaultRates {
  return { version: 1, per_hectare: null, per_100_litres: null };
}

/* -------------------------------------------------- create / replace / clear */

/**
 * Copy ONE backend canonical option into a persisted selection.
 *
 * Semantic fields (`option_key`, `rate_ids`, `basis`, `unit`, `value`,
 * `min_value`, `max_value`) are copied exactly. Only `source`, `selected_at`
 * and `label_version` are added. Optional backend DISPLAY metadata
 * (`targets`, `conditions`, `direction_ids`, `crops`, `condition_ambiguous`)
 * is deliberately NOT persisted.
 *
 * `selectedAt` is an argument so the builder stays clock-independent; the React
 * handler supplies `new Date().toISOString()`.
 */
export function selectionFromCanonicalOption(
  option: CanonicalDefaultRateOption,
  opts: {
    source: DefaultRateSelectionSource;
    selectedAt: string | null;
    labelVersion: string | null;
  },
): PersistedDefaultRateSelection {
  return {
    option_key: option.option_key,
    // Copied, never regrouped or reordered.
    rate_ids: [...option.rate_ids],
    basis: option.basis,
    unit: option.unit,
    value: option.value,
    min_value: option.min_value,
    max_value: option.max_value,
    source: opts.source,
    selected_at: opts.selectedAt,
    label_version: opts.labelVersion,
  };
}

/** Replace ONE basis slot, preserving the other slot byte-for-byte. */
export function withBasisSelection(
  current: PersistedDefaultRates | null,
  basis: CanonicalRateBasis,
  selection: PersistedDefaultRateSelection | null,
): PersistedDefaultRates {
  const base = current ?? emptyPersistedDefaultRates();
  return {
    version: 1,
    per_hectare: basis === "per_hectare" ? selection : base.per_hectare,
    per_100_litres: basis === "per_100_litres" ? selection : base.per_100_litres,
  };
}

/** Clear ONE basis slot, preserving the other slot. */
export function clearBasisSelection(
  current: PersistedDefaultRates | null,
  basis: CanonicalRateBasis,
): PersistedDefaultRates {
  return withBasisSelection(current, basis, null);
}

/** Clear BOTH slots (used only for a proven registered-product change, §7). */
export function clearAllBasisSelections(): PersistedDefaultRates {
  return emptyPersistedDefaultRates();
}

/* ------------------------------------------------------------------ matching */

function sameRateIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  // Order-insensitive comparison only. The stored IDs are never rewritten.
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

/**
 * A persisted selection is CURRENT only when a canonical option matches on
 * `option_key`, `basis`, the `rate_id` set, `unit`, `value`, `min_value` and
 * `max_value`. Never by numeric value alone, display text, target,
 * jurisdiction or legacy `rate_per_ha`.
 */
export function isSameDefaultRateSelection(
  selection: PersistedDefaultRateSelection,
  option: CanonicalDefaultRateOption,
): boolean {
  return (
    selection.option_key === option.option_key &&
    selection.basis === option.basis &&
    selection.unit === option.unit &&
    selection.value === option.value &&
    selection.min_value === option.min_value &&
    selection.max_value === option.max_value &&
    sameRateIdSet(selection.rate_ids, option.rate_ids)
  );
}

/* ------------------------------------- PART 10: vineyard dose within range */

/**
 * The vineyard's usual operational dose inside an authoritative label RANGE.
 *
 * Legal evidence and the vineyard's choice stay separate: the registered range
 * is never rewritten, and the selection is persisted in the exact shared D3
 * SINGLE shape (value set, bounds null) while still citing the range option's
 * `option_key` and `rate_ids`. Bases are never converted into one another.
 */
export function isNarrowedSelectionOf(
  selection: PersistedDefaultRateSelection,
  option: CanonicalDefaultRateOption,
): boolean {
  if (!isDefaultRateRange(option)) return false;
  if (selection.value == null) return false;
  if (selection.min_value != null || selection.max_value != null) return false;
  if (selection.option_key !== option.option_key) return false;
  if (selection.basis !== option.basis) return false;
  if (selection.unit !== option.unit) return false;
  if (!sameRateIdSet(selection.rate_ids, option.rate_ids)) return false;
  return selection.value >= (option.min_value as number) &&
    selection.value <= (option.max_value as number);
}

export type VineyardDoseValidation =
  | { ok: true; value: number }
  | { ok: false; message: string };

/**
 * Validate a typed vineyard dose against the authoritative amount.
 * Exact single-value label rates stay exact; range rates accept any value
 * between min and max inclusive.
 */
export function validateVineyardDose(
  option: CanonicalDefaultRateOption,
  raw: string | number | null | undefined,
): VineyardDoseValidation {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(value)) return { ok: false, message: "Enter a number" };
  if (isDefaultRateRange(option)) {
    const min = option.min_value as number;
    const max = option.max_value as number;
    if (value < min) return { ok: false, message: `Below the label minimum of ${min} ${option.unit}` };
    if (value > max) return { ok: false, message: `Above the label maximum of ${max} ${option.unit}` };
    return { ok: true, value };
  }
  if (option.value != null && value !== option.value) {
    return {
      ok: false,
      message: `The label states an exact rate of ${option.value} ${option.unit}`,
    };
  }
  return { ok: true, value };
}

/** Build the persisted SINGLE selection for a validated vineyard dose. */
export function narrowedSelectionFromOption(
  option: CanonicalDefaultRateOption,
  value: number,
  meta?: { selected_at?: string | null; label_version?: string | null },
): PersistedDefaultRateSelection {
  return {
    option_key: option.option_key,
    rate_ids: [...option.rate_ids],
    basis: option.basis,
    unit: option.unit,
    value,
    min_value: null,
    max_value: null,
    source: "operator",
    selected_at: meta?.selected_at ?? null,
    label_version: meta?.label_version ?? null,
  };
}

function optionsForBasis(
  options: CanonicalDefaultRateOptions | null,
  basis: CanonicalRateBasis,
): CanonicalDefaultRateOption[] {
  if (!options) return [];
  return basis === "per_hectare" ? options.per_hectare : options.per_100_litres;
}

/**
 * Match ONE persisted basis slot against the current canonical options.
 * Never substitutes and never clears.
 */
export function matchDefaultRateSlot(
  defaults: PersistedDefaultRates | null,
  options: CanonicalDefaultRateOptions | null,
  basis: CanonicalRateBasis,
): DefaultRateSlotState {
  const selection =
    (basis === "per_hectare" ? defaults?.per_hectare : defaults?.per_100_litres) ?? null;
  if (!selection) {
    return { basis, status: "no_selection", selection: null, matchedOption: null };
  }
  if (!options) {
    // Not fetched in this session — the snapshot itself is displayable.
    return { basis, status: "unavailable", selection, matchedOption: null };
  }
  const matchedOption =
    optionsForBasis(options, basis).find(
      (o) => isSameDefaultRateSelection(selection, o) || isNarrowedSelectionOf(selection, o),
    ) ?? null;
  return {
    basis,
    status: matchedOption ? "matched" : "needs_review",
    selection,
    matchedOption,
  };
}

/** Match both basis slots independently. */
export function matchDefaultRateSlots(
  defaults: PersistedDefaultRates | null,
  options: CanonicalDefaultRateOptions | null,
): Record<CanonicalRateBasis, DefaultRateSlotState> {
  return {
    per_hectare: matchDefaultRateSlot(defaults, options, "per_hectare"),
    per_100_litres: matchDefaultRateSlot(defaults, options, "per_100_litres"),
  };
}

/** True when either slot holds a persisted selection. */
export function hasAnyPersistedDefault(defaults: PersistedDefaultRates | null): boolean {
  if (!defaults) return false;
  return CANONICAL_RATE_BASES.some((b) =>
    b === "per_hectare" ? !!defaults.per_hectare : !!defaults.per_100_litres,
  );
}

/* ------------------------------------------------- registered product change */

export interface RegisteredProductIdentity {
  country?: string | null;
  scheme?: string | null;
  number?: string | null;
}

const idPart = (v: string | null | undefined): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.toUpperCase();
};

/**
 * A persisted default belongs to the product whose `rate_v1` identities it
 * cites. Returns true ONLY when both identities are fully known and any of
 * country / scheme / number actually differs. A label-revision change is NOT a
 * product change, and an unknown identity is never treated as different.
 */
export function isKnownDifferentRegisteredProduct(
  before: RegisteredProductIdentity | null | undefined,
  after: RegisteredProductIdentity | null | undefined,
): boolean {
  if (!before || !after) return false;
  const a = {
    country: idPart(before.country),
    scheme: idPart(before.scheme),
    number: idPart(before.number),
  };
  const b = {
    country: idPart(after.country),
    scheme: idPart(after.scheme),
    number: idPart(after.number),
  };
  // Identity must be PROVEN on both sides before anything is cleared.
  if (!a.number || !b.number) return false;
  if (!a.country || !b.country) return false;
  if (!a.scheme || !b.scheme) return false;
  return a.number !== b.number || a.country !== b.country || a.scheme !== b.scheme;
}

/* ---------------------------------------------------------------- display */

/**
 * Amount text for a canonical option or a persisted snapshot. Backend content
 * only — no conversion between bases and no range flattening.
 */
export function defaultRateAmountText(
  amount: Pick<CanonicalDefaultRateOption, "unit" | "value" | "min_value" | "max_value">,
): string {
  if (amount.value != null) return `${amount.value} ${amount.unit}`;
  if (amount.min_value != null && amount.max_value != null) {
    return `${amount.min_value}–${amount.max_value} ${amount.unit}`;
  }
  return amount.unit;
}

export const BASIS_SUFFIX: Record<CanonicalRateBasis, string> = {
  per_hectare: "/ha",
  per_100_litres: "/100 L",
};

export const BASIS_TITLE: Record<CanonicalRateBasis, string> = {
  per_hectare: "Per hectare",
  per_100_litres: "Per 100 L",
};

/** True for a genuine label range (value null, both bounds present). */
export function isDefaultRateRange(
  amount: Pick<CanonicalDefaultRateOption, "value" | "min_value" | "max_value">,
): boolean {
  return amount.value == null && amount.min_value != null && amount.max_value != null;
}
