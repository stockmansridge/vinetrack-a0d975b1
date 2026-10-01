// Canonical Master rate-choice view.
//
// The backend `default_rate_options` are ALREADY grouped by operational rate
// identity (basis + amount/range + unit + method). The Portal renders exactly
// those options — one radio per option, never one per flattened weed row — and
// never regroups, merges or widens ranges.
//
// Strict viticulture guard: an option whose backend `crops` list names no
// grapevine crop is never selectable. Options without a crops list are trusted
// as the backend's vineyard projection.

import type {
  CanonicalDefaultRateOption,
  CanonicalDefaultRateOptions,
  CanonicalRateBasis,
} from "@/lib/chemicalDefaultRatesContract";

const GRAPEVINE_CROPS = new Set([
  "vineyard", "vineyards", "grape", "grapes", "grapevine", "grapevines",
]);

export const isGrapevineCropName = (c: string): boolean =>
  GRAPEVINE_CROPS.has(c.trim().toLowerCase());

export function isVineyardOption(o: CanonicalDefaultRateOption): boolean {
  if (!o.crops || o.crops.length === 0) return true;
  return o.crops.some(isGrapevineCropName);
}

export function selectableVineyardOptions(
  options: CanonicalDefaultRateOptions | null | undefined,
): CanonicalDefaultRateOptions {
  return {
    per_hectare: (options?.per_hectare ?? []).filter(isVineyardOption),
    per_100_litres: (options?.per_100_litres ?? []).filter(isVineyardOption),
  };
}

const UNIT_SUFFIX: Record<CanonicalRateBasis, string> = {
  per_hectare: "/ha",
  per_100_litres: "/100 L",
};

const fmt = (n: number) => String(Number(n.toFixed(4)));

/** "2–3 L/ha", "500–1000 mL/100 L", "6 L/ha". Amounts exactly as served. */
export function canonicalOptionAmount(o: CanonicalDefaultRateOption): string {
  const amount =
    o.value != null ? fmt(o.value) : `${fmt(o.min_value ?? 0)}–${fmt(o.max_value ?? 0)}`;
  return `${amount} ${o.unit}${UNIT_SUFFIX[o.basis]}`;
}

/** "2–3 L/ha — Boom". */
export function canonicalOptionHeading(o: CanonicalDefaultRateOption): string {
  const method = (o.conditions ?? []).filter(Boolean).join(", ");
  return method ? `${canonicalOptionAmount(o)} — ${method}` : canonicalOptionAmount(o);
}

export const TARGET_PREVIEW_COUNT = 3;

/** Collapsed target summary: first few names, then "+ N more". */
export function targetSummary(
  targets: string[] | undefined,
  previewCount = TARGET_PREVIEW_COUNT,
): { preview: string; hiddenCount: number } {
  const list = (targets ?? []).filter(Boolean);
  const shown = list.slice(0, previewCount);
  const hiddenCount = Math.max(0, list.length - shown.length);
  return {
    preview: shown.join(", ") + (hiddenCount > 0 ? ` + ${hiddenCount} more` : ""),
    hiddenCount,
  };
}

export const MASTER_RATES_UNAVAILABLE_TEXT =
  "Catalogue rate details could not be loaded. Try again or enter a rate manually.";
