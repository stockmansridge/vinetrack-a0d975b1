// LD-2 — authoritative PDF-extracted label rates.
//
// The production `chemical-info-lookup` resolver now returns real label rates
// inside each `registered_uses[].rates[]`. This module is the single place
// that turns those wire rows into something the portal may display or apply.
//
// Rules encoded here (they are label-safety rules, not cosmetics):
//
//   per_100_litres        → usable numeric rate, per 100 L of spray water
//   per_hectare           → usable numeric rate, per hectare
//   range_per_100_litres  → min/max preserved, NEVER collapsed to one number
//   range_per_hectare     → min/max preserved, NEVER collapsed to one number
//   other                 → reference-only raw_text; never auto-fills a number
//
// A use with `rates: []` means the resolver resolved no authoritative rate for
// that use — the portal leaves the rate blank rather than inventing one.

import {
  isRangeBasis,
  type LabelRateBasis,
  type WriteLabelRate,
  type WriteRegisteredUse,
} from "@/lib/chemicalIntelligenceWrite";
import { chemUnitOnly, composeUnit, normaliseUnit, type RateBasis } from "@/lib/rateBasis";

export interface LookupRateView {
  basis: LabelRateBasis;
  unit: string;
  value?: number;
  min?: number;
  max?: number;
  /** True for range_per_* — min/max are kept and never averaged. */
  isRange: boolean;
  /** True when the row carries no usable numeric spray rate (basis "other"). */
  referenceOnly: boolean;
  label?: string;
  rawText?: string;
  /** Verbatim label condition this rate applies under, when supplied. */
  condition?: string;
  /** Server flag — the condition could not be resolved unambiguously. */
  conditionAmbiguous?: boolean;
  /** Human display, e.g. "35–54 mL/100 L". */
  text: string;
  /** Portal unit text ("mL/100L", "L/ha") — undefined when reference-only. */
  composedUnit?: string;
  /** Rate basis in portal terms — undefined when reference-only. */
  rateBasis?: RateBasis;
  /** The ONLY value that may auto-fill a numeric rate field. */
  autoFillValue?: number;
}

const suffixFor = (basis: LabelRateBasis): string =>
  basis === "per_100_litres" || basis === "range_per_100_litres"
    ? "/100 L"
    : basis === "per_hectare" || basis === "range_per_hectare"
      ? "/ha"
      : "";

const portalBasis = (basis: LabelRateBasis): RateBasis | undefined =>
  basis === "per_100_litres" || basis === "range_per_100_litres"
    ? "per_100L"
    : basis === "per_hectare" || basis === "range_per_hectare"
      ? "per_hectare"
      : undefined;

const nfmt = (n: number): string => String(Number(n));

export function toRateView(rate: WriteLabelRate): LookupRateView {
  const basis = rate.basis;
  const range = isRangeBasis(basis);
  // Some registers state the unit with the basis baked in ("L/ha"). Strip it
  // so the display never reads "0.35 L/ha/ha".
  const unit = chemUnitOnly((rate.unit ?? "").trim()).trim();
  const rawText = rate.raw_text?.trim() || undefined;
  const rb = portalBasis(basis);

  // basis "other" (and anything with no usable number/unit) is reference-only.
  const hasNumber = range
    ? rate.min_value != null || rate.max_value != null
    : rate.value != null;
  const referenceOnly = basis === "other" || !rb || !unit || !hasNumber;

  let text: string;
  if (referenceOnly) {
    text = rawText ?? "Rate stated on label";
  } else if (range) {
    const lo = rate.min_value;
    const hi = rate.max_value;
    text =
      lo != null && hi != null && lo !== hi
        ? `${nfmt(lo)}–${nfmt(hi)} ${unit}${suffixFor(basis)}`
        : `${nfmt((lo ?? hi) as number)} ${unit}${suffixFor(basis)}`;
  } else {
    text = `${nfmt(rate.value as number)} ${unit}${suffixFor(basis)}`;
  }

  const chemUnit = normaliseUnit(unit);
  return {
    basis,
    unit,
    value: range ? undefined : rate.value,
    min: range ? rate.min_value : undefined,
    max: range ? rate.max_value : undefined,
    isRange: range,
    referenceOnly,
    label: rate.label?.trim() || undefined,
    rawText,
    condition: rate.condition?.trim() || undefined,
    conditionAmbiguous: rate.condition_ambiguous,
    text,
    composedUnit:
      referenceOnly || !rb || !chemUnit ? undefined : composeUnit(chemUnit, rb),
    rateBasis: referenceOnly ? undefined : rb,
    // Ranges are never collapsed, so they never auto-fill a single number.
    autoFillValue: referenceOnly || range ? undefined : rate.value,
  };
}

export const rateViews = (use?: WriteRegisteredUse | null): LookupRateView[] =>
  (use?.rates ?? []).map(toRateView);

export interface RateSelection {
  all: LookupRateView[];
  /** Every usable rate, both bases, in label order. Never flattened. */
  usable: LookupRateView[];
  /** Every /100 L rate — a label may state more than one. */
  per100LAll: LookupRateView[];
  /** Every /ha rate — a label may state more than one. */
  perHectareAll: LookupRateView[];
  per100L?: LookupRateView;
  perHectare?: LookupRateView;
  /** Reference-only rows (basis "other") — display, never applied. */
  referenceOnly: LookupRateView[];
  /** Preferred row for the single portal rate field, if any. */
  preferred?: LookupRateView;
  /** Combined display text, e.g. "35–54 mL/100 L · 540 mL/ha". */
  text?: string;
}

export function selectRates(use?: WriteRegisteredUse | null): RateSelection {
  const all = rateViews(use);
  const usable = all.filter((r) => !r.referenceOnly);
  const per100LAll = usable.filter((r) => r.rateBasis === "per_100L");
  const perHectareAll = usable.filter((r) => r.rateBasis === "per_hectare");
  const per100L = per100LAll[0];
  const perHectare = perHectareAll[0];
  const preferred = per100L ?? perHectare;
  const text = usable.length ? usable.map((r) => r.text).join(" · ") : undefined;
  return {
    all,
    usable,
    per100LAll,
    perHectareAll,
    per100L,
    perHectare,
    referenceOnly: all.filter((r) => r.referenceOnly),
    preferred,
    text,
  };
}

/* ------------------------------------------------------- withholding text */

const NOT_REQUIRED = /not\s+required\s+when\s+used\s+as\s+directed/i;

/**
 * WHP 0 that comes from label wording "NOT REQUIRED WHEN USED AS DIRECTED" is
 * a statement, not a zero-day period, and must read as such.
 */
export function withholdingDisplay(
  days?: number | null,
  context?: string | null,
): string | undefined {
  if (days == null) return undefined;
  if (days === 0 && context && NOT_REQUIRED.test(context))
    return "Not required when used as directed";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export const isNotRequiredWording = (context?: string | null): boolean =>
  !!context && NOT_REQUIRED.test(context);
