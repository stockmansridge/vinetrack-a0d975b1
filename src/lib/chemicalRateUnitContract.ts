// Structured rate UNIT contract for Chemical Intelligence (`registered_uses`).
//
// One rule, shared with the manual rate contract in `chemicalManualRate.ts`:
// a structured rate carries a BARE numerator unit (L / mL / kg / g). The
// denominator lives in the rate BASIS (per hectare / per 100 L) and must never
// appear inside `unit`. `unit: "L/ha"` with `basis: "per_100_litres"` is a
// contradiction and is exactly the malformed shape found in production.
//
// This module is PURE. It never guesses what the operator meant: an
// unambiguous legacy composite may be DISPLAYED as its numerator, a
// contradictory one is left untouched and flagged for review.

import { MANUAL_RATE_UNITS, type ManualRateUnit } from "@/lib/chemicalManualRate";

/** The only canonical numerator units for a structured rate. */
export const CANONICAL_RATE_UNITS = MANUAL_RATE_UNITS;
export type CanonicalRateUnit = ManualRateUnit;

export const RATE_UNIT_MESSAGE =
  "Rate unit must be L, mL, kg or g. Choose Per hectare or Per 100 L separately.";

export const RATE_UNIT_REVIEW_MESSAGE =
  "This rate's unit contradicts its rate basis. Choose the unit and basis again — VineTrack will not guess.";

type BasisFamily = "per_hectare" | "per_100_litres" | "other";

/** Which denominator a structured basis implies. */
export function basisFamily(basis: string | null | undefined): BasisFamily {
  switch (basis) {
    case "per_hectare":
    case "range_per_hectare":
      return "per_hectare";
    case "per_100_litres":
    case "range_per_100_litres":
      return "per_100_litres";
    default:
      return "other";
  }
}

export const isStructuredRangeBasis = (basis: string | null | undefined): boolean =>
  basis === "range_per_hectare" || basis === "range_per_100_litres";

/** Exact canonical unit, tolerating case only ("ml" -> "mL"). */
export function canonicalRateUnit(unit: unknown): CanonicalRateUnit | null {
  const t = String(unit ?? "").trim();
  if (!t) return null;
  const lc = t.toLowerCase();
  if (lc === "l") return "L";
  if (lc === "ml") return "mL";
  if (lc === "kg") return "kg";
  if (lc === "g") return "g";
  return null;
}

/** The denominator embedded in a composite unit string, when there is one. */
export function unitDenominator(unit: unknown): BasisFamily | null {
  const t = String(unit ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!t.includes("/")) return null;
  const den = t.slice(t.indexOf("/") + 1);
  if (den === "ha" || den === "hectare" || den === "hectares") return "per_hectare";
  if (den === "100l" || den === "100litres" || den === "100litre" || den === "100l.")
    return "per_100_litres";
  return "other";
}

/** True when `unit` carries a denominator such as /ha or /100 L. */
export const hasCompositeUnit = (unit: unknown): boolean => unitDenominator(unit) != null;

export type RateUnitNormalisation =
  | { status: "missing"; unit: "" }
  | { status: "ok"; unit: CanonicalRateUnit }
  /** Legacy composite, unambiguous against the basis — safe to display bare. */
  | { status: "normalised"; unit: CanonicalRateUnit }
  /** Contradictory or unrecognised — never auto-corrected. */
  | { status: "needs_review"; unit: string };

/**
 * Reading an existing structured rate for EDITING.
 *   "L/ha"  + per_hectare      -> normalised to "L"
 *   "mL/100 L" + per_100_litres -> normalised to "mL"
 *   "L/ha"  + per_100_litres   -> needs_review (left exactly as stored)
 */
export function normaliseStructuredRateUnit(
  unit: unknown,
  basis: string | null | undefined,
): RateUnitNormalisation {
  const raw = String(unit ?? "").trim();
  if (!raw) return { status: "missing", unit: "" };
  const bare = canonicalRateUnit(raw);
  if (bare) return { status: "ok", unit: bare };

  const den = unitDenominator(raw);
  const numerator = canonicalRateUnit(raw.slice(0, raw.indexOf("/")));
  const family = basisFamily(basis);
  if (den && den !== "other" && numerator && family !== "other" && den === family) {
    return { status: "normalised", unit: numerator };
  }
  return { status: "needs_review", unit: raw };
}

export interface StructuredRateLike {
  basis?: string | null;
  unit?: string | null;
  value?: number | null;
  min_value?: number | null;
  max_value?: number | null;
}

export type RateValidation = { ok: true } | { ok: false; message: string };

const positive = (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const present = (v: unknown): boolean => v != null;

/**
 * Save-boundary validation of ONE structured rate. Reference-only rates
 * (`basis: "other"`) carry raw label text rather than an operational amount and
 * are left alone.
 */
export function validateStructuredRate(rate: StructuredRateLike): RateValidation {
  const basis = rate.basis ?? "other";
  if (basisFamily(basis) === "other") return { ok: true };

  if (hasCompositeUnit(rate.unit)) return { ok: false, message: RATE_UNIT_MESSAGE };
  if (!canonicalRateUnit(rate.unit)) return { ok: false, message: RATE_UNIT_MESSAGE };

  if (isStructuredRangeBasis(basis)) {
    if (!positive(rate.min_value) || !positive(rate.max_value)) {
      return { ok: false, message: "Enter a minimum and a maximum rate, both greater than zero." };
    }
    if ((rate.max_value as number) < (rate.min_value as number)) {
      return { ok: false, message: "Maximum rate cannot be below the minimum." };
    }
    if (present(rate.value)) {
      return {
        ok: false,
        message: "A range rate cannot also carry a single rate. Remove one of them.",
      };
    }
    return { ok: true };
  }

  if (!positive(rate.value)) {
    return { ok: false, message: "Enter a rate greater than zero." };
  }
  if (present(rate.min_value) || present(rate.max_value)) {
    return {
      ok: false,
      message: "A single rate cannot also carry a minimum and maximum. Choose Range instead.",
    };
  }
  return { ok: true };
}

export interface RateProblem {
  useIndex: number;
  rateIndex: number;
  message: string;
}

/** Every structured-rate problem across a set of registered uses. */
export function structuredRateProblems(
  uses: Array<{ rates?: StructuredRateLike[] | null }> | null | undefined,
): RateProblem[] {
  const out: RateProblem[] = [];
  (uses ?? []).forEach((use, useIndex) => {
    (use?.rates ?? []).forEach((rate, rateIndex) => {
      const v = validateStructuredRate(rate ?? {});
      if (!v.ok) out.push({ useIndex, rateIndex, message: v.message });
    });
  });
  return out;
}

/**
 * Save boundary. Throws a message the operator can act on rather than
 * persisting contradictory structured data.
 */
export function assertStructuredRatesValid(
  uses: Array<{ rates?: StructuredRateLike[] | null }> | null | undefined,
): void {
  const problems = structuredRateProblems(uses);
  if (problems.length) throw new Error(problems[0].message);
}
