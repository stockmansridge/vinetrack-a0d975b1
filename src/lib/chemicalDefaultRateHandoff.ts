// Default-rate READ PRECEDENCE + spray hand-off (release contract §5/§6).
//
// A structured chemical's operational default is `saved_chemicals.default_rates`
// ONLY. `rate_per_ha` and the first `rates` entry are legacy compatibility
// projections and must never be promoted to the authority, and the two bases
// are never converted into each other.

import {
  decodePersistedDefaultRates,
  type CanonicalRateBasis,
  type PersistedDefaultRateSelection,
  type PersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";
import { BASIS_SUFFIX, defaultRateAmountText } from "@/lib/chemicalDefaultRateSelection";

export const RATE_CONFIRMATION_REQUIRED_LABEL = "Rate confirmation required";

/** Decode the persisted default rates of a saved-chemical row. */
export function confirmedDefaultRates(row: {
  default_rates?: unknown;
}): PersistedDefaultRates | null {
  return decodePersistedDefaultRates(row?.default_rates);
}

/** The confirmed selection for one canonical basis, or null. */
export function confirmedDefaultForBasis(
  defaults: PersistedDefaultRates | null,
  basis: CanonicalRateBasis,
): PersistedDefaultRateSelection | null {
  if (!defaults) return null;
  return basis === "per_hectare" ? defaults.per_hectare : defaults.per_100_litres;
}

/**
 * The single confirmed default when EXACTLY one basis is confirmed. Two
 * confirmed bases are ambiguous for a hand-off that has not chosen a basis
 * yet, so nothing is guessed.
 */
export function soleConfirmedDefault(
  defaults: PersistedDefaultRates | null,
): PersistedDefaultRateSelection | null {
  if (!defaults) return null;
  const present = [defaults.per_hectare, defaults.per_100_litres].filter(
    (s): s is PersistedDefaultRateSelection => !!s,
  );
  return present.length === 1 ? present[0] : null;
}

/** Portal product-rate basis token for a canonical persisted basis. */
export function productRateBasisFor(
  basis: CanonicalRateBasis,
): "whole_block_area" | "per_100_litres" {
  return basis === "per_hectare" ? "whole_block_area" : "per_100_litres";
}

/** Canonical persisted basis for a Portal product-rate basis, when comparable. */
export function canonicalBasisForProductRateBasis(
  basis: string | null | undefined,
): CanonicalRateBasis | null {
  if (basis === "per_100_litres") return "per_100_litres";
  if (basis === "whole_block_area" || basis === "treated_area") return "per_hectare";
  return null;
}

/**
 * List / detail display text for the confirmed default. Returns
 * "Rate confirmation required" when there is no valid confirmed default —
 * never a guessed amount from `rate_per_ha` or the first label rate.
 */
export function defaultRateDisplayText(row: { default_rates?: unknown }): string {
  const defaults = confirmedDefaultRates(row);
  const parts: string[] = [];
  for (const basis of ["per_hectare", "per_100_litres"] as CanonicalRateBasis[]) {
    const sel = confirmedDefaultForBasis(defaults, basis);
    if (sel) parts.push(`${defaultRateAmountText(sel)} ${BASIS_SUFFIX[basis]}`);
  }
  return parts.length ? parts.join(" · ") : RATE_CONFIRMATION_REQUIRED_LABEL;
}

/** Sort key: confirmed per-hectare amount first, else per-100 L, else null. */
export function defaultRateSortValue(row: { default_rates?: unknown }): number | null {
  const d = confirmedDefaultRates(row);
  const sel = d?.per_hectare ?? d?.per_100_litres ?? null;
  if (!sel) return null;
  return sel.value ?? sel.min_value ?? null;
}

/* ------------------------------------------------- spray line prefill (§1/§2) */

const SPRAY_UNITS: Record<string, "L" | "mL" | "kg" | "g"> = {
  l: "L",
  ml: "mL",
  kg: "kg",
  g: "g",
};

/**
 * The ONLY safe spray-line prefill: exactly one confirmed basis carrying an
 * explicit scalar amount, with the label-rate unit from the confirmed default
 * itself (never the inventory/commercial unit). A stored range never prefills —
 * neither its minimum, maximum nor a midpoint — and no unit is converted.
 */
export function confirmedSprayPrefill(
  defaults: PersistedDefaultRates | null,
): {
  rate: number;
  unit: "L" | "mL" | "kg" | "g";
  rateBasis: "whole_block_area" | "per_100_litres";
  /** SQL 222 — provenance of the confirmed default that produced this dose. */
  entryMethod: "canonical" | "manual";
} | null {
  const sole = soleConfirmedDefault(defaults);
  if (
    !sole ||
    sole.value == null ||
    sole.min_value != null ||
    sole.max_value != null ||
    !Number.isFinite(sole.value)
  ) {
    return null;
  }
  const unit = SPRAY_UNITS[(sole.unit ?? "").trim().toLowerCase()];
  if (!unit) return null;
  return {
    rate: sole.value,
    unit,
    rateBasis: productRateBasisFor(sole.basis),
    entryMethod: sole.entry_method === "manual" ? "manual" : "canonical",
  };
}

/**
 * SQL 222 — a confirmed MANUAL range never prefills a dose: the operator must
 * choose the actual application dose inside it, so the range is surfaced as
 * guidance on the spray line. Choosing that dose NEVER rewrites the saved
 * Chemical Store range. Canonical backend ranges keep their existing
 * behaviour and are not surfaced here.
 */
export function confirmedSprayRangeGuidance(
  defaults: PersistedDefaultRates | null,
): {
  min: number;
  max: number;
  unit: "L" | "mL" | "kg" | "g";
  rateBasis: "whole_block_area" | "per_100_litres";
} | null {
  const sole = soleConfirmedDefault(defaults);
  if (
    !sole ||
    sole.entry_method !== "manual" ||
    sole.value != null ||
    sole.min_value == null ||
    sole.max_value == null ||
    !Number.isFinite(sole.min_value) ||
    !Number.isFinite(sole.max_value)
  ) {
    return null;
  }
  const unit = SPRAY_UNITS[(sole.unit ?? "").trim().toLowerCase()];
  if (!unit) return null;
  return {
    min: sole.min_value,
    max: sole.max_value,
    unit,
    rateBasis: productRateBasisFor(sole.basis),
  };
}
