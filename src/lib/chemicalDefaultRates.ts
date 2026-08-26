// Default rate selection — a USER decision built only from authoritative
// structured GRAPEVINE label rates.
//
// D4B-P2A BOUNDARY: this module is LEGACY / DISPLAY-ONLY until D4B-P2B. Its
// locally minted option ids (`${basis}|${rate.text}`) are presentation keys and
// must NEVER be persisted. The operational identity for a persisted operator
// default is the backend canonical `default_rate_options` contract in
// `src/lib/chemicalDefaultRatesContract.ts` (`option_key` + `rate_ids`).
//
// Hard rules encoded here:
//   * options come from grapevine registered uses only (never other crops,
//     never AI suggestions, never brochure text);
//   * /100 L and /ha are separate universes — one is NEVER derived from the
//     other;
//   * a label-stated range stays ONE option and is never collapsed;
//   * different conditional rates are never merged into a synthetic range;
//   * the recommendation is conservative (see `recommend` below).

import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import { selectRates, type LookupRateView } from "@/lib/chemicalLabelRates";
import { isGrapevineUse } from "@/lib/chemicalGrapevineUses";
import type { RateBasis } from "@/lib/rateBasis";

/* ------------------------------------------------------------ jurisdiction */

/** Australian state/territory tokens as they appear in label conditions. */
const STATE_ALIASES: Record<string, string[]> = {
  NSW: ["nsw", "new south wales"],
  VIC: ["vic", "victoria"],
  QLD: ["qld", "queensland"],
  SA: ["sa", "south australia"],
  WA: ["wa", "western australia"],
  TAS: ["tas", "tasmania"],
  NT: ["nt", "northern territory"],
  ACT: ["act", "australian capital territory"],
};

export const STATE_CODES = Object.keys(STATE_ALIASES);

/** Normalise a free-text state/region to a canonical code, when recognised. */
export function normaliseJurisdiction(value?: string | null): string | undefined {
  const t = (value ?? "").trim().toLowerCase();
  if (!t) return undefined;
  for (const [code, aliases] of Object.entries(STATE_ALIASES)) {
    if (aliases.includes(t)) return code;
  }
  return undefined;
}

/** Every state named in a label condition / restriction string. */
export function jurisdictionsInText(text?: string | null): string[] {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return [];
  const out: string[] = [];
  for (const [code, aliases] of Object.entries(STATE_ALIASES)) {
    const hit = aliases.some((a) =>
      new RegExp(`(^|[^a-z])${a.replace(/ /g, "\\s+")}([^a-z]|$)`, "i").test(t),
    );
    if (hit) out.push(code);
  }
  return out;
}

/* ----------------------------------------------------------------- options */

export interface DefaultRateOption {
  /** Stable identity: basis + rate text. Distinct label rates never merge. */
  id: string;
  basis: RateBasis;
  /** Display rate, e.g. "3 L/100 L" or "100–200 mL/100 L" (range kept whole). */
  text: string;
  /** Single numeric value; undefined for a label range. */
  value?: number;
  isRange: boolean;
  composedUnit?: string;
  /** "European Red Mite — NSW, Vic, SA" style context lines. */
  contexts: string[];
  /** States the option is registered for. Empty = no state qualification. */
  jurisdictions: string[];
}

export interface DefaultRateGroup {
  basis: RateBasis;
  options: DefaultRateOption[];
  /** Set only when the conservative rule can pick one safely. */
  recommendedId?: string;
  recommendationReason?: "jurisdiction" | "only_registered_rate";
  /** True when the operator must choose (multiple applicable options). */
  requiresChoice: boolean;
  /** Message when the label carries no rate on this basis. */
  emptyMessage?: string;
}

export interface DefaultRateOptions {
  per100L: DefaultRateGroup;
  perHectare: DefaultRateGroup;
  /** Jurisdiction actually used for the recommendation, when known. */
  jurisdiction?: string;
}

export const NO_PER_HECTARE_MESSAGE =
  "No registered per-hectare rate on this label";
export const NO_PER_100L_MESSAGE = "No registered per-100 L rate on this label";

const contextLine = (use: WriteRegisteredUse, rate: LookupRateView): string => {
  const target = (rate.label ?? use.target_raw ?? use.crop ?? "").trim();
  const cond = (rate.condition ?? "").trim();
  return [target, cond].filter(Boolean).join(" — ");
};

function collect(
  uses: WriteRegisteredUse[],
  basis: RateBasis,
): DefaultRateOption[] {
  const byId = new Map<string, DefaultRateOption>();
  for (const use of uses) {
    for (const rate of selectRates(use).usable) {
      if (rate.rateBasis !== basis) continue;
      const id = `${basis}|${rate.text}`;
      const line = contextLine(use, rate);
      const states = Array.from(
        new Set([
          ...jurisdictionsInText(rate.condition),
          ...jurisdictionsInText(use.restrictions),
        ]),
      );
      const existing = byId.get(id);
      if (existing) {
        if (line && !existing.contexts.includes(line)) existing.contexts.push(line);
        for (const st of states) {
          if (!existing.jurisdictions.includes(st)) existing.jurisdictions.push(st);
        }
        continue;
      }
      byId.set(id, {
        id,
        basis,
        text: rate.text,
        value: rate.isRange ? undefined : rate.value,
        isRange: rate.isRange,
        composedUnit: rate.composedUnit,
        contexts: line ? [line] : [],
        jurisdictions: states,
      });
    }
  }
  return Array.from(byId.values());
}

function recommend(
  basis: RateBasis,
  options: DefaultRateOption[],
  jurisdiction?: string,
): DefaultRateGroup {
  const base: DefaultRateGroup = { basis, options, requiresChoice: false };
  if (!options.length) {
    return {
      ...base,
      emptyMessage:
        basis === "per_hectare" ? NO_PER_HECTARE_MESSAGE : NO_PER_100L_MESSAGE,
    };
  }
  // 1. Exactly one distinct registered rate for the vineyard jurisdiction.
  if (jurisdiction) {
    const applicable = options.filter((o) => o.jurisdictions.includes(jurisdiction));
    if (applicable.length === 1) {
      return { ...base, recommendedId: applicable[0].id, recommendationReason: "jurisdiction" };
    }
    if (applicable.length > 1) return { ...base, requiresChoice: true };
  }
  // 2. Exactly one distinct grapevine rate for this basis across the label —
  //    and never a rate that is registered only for other jurisdictions.
  if (options.length === 1) {
    const only = options[0];
    const excluded =
      !!jurisdiction && only.jurisdictions.length > 0 &&
      !only.jurisdictions.includes(jurisdiction);
    if (!excluded) {
      return { ...base, recommendedId: only.id, recommendationReason: "only_registered_rate" };
    }
    return { ...base, requiresChoice: true };
  }
  // 3. Ambiguous — the operator must choose.
  return { ...base, requiresChoice: true };
}

export function buildDefaultRateOptions(
  uses: WriteRegisteredUse[],
  opts?: { jurisdiction?: string | null },
): DefaultRateOptions {
  const jurisdiction = normaliseJurisdiction(opts?.jurisdiction) ?? undefined;
  const grapevine = (uses ?? []).filter(isGrapevineUse);
  return {
    per100L: recommend("per_100L", collect(grapevine, "per_100L"), jurisdiction),
    perHectare: recommend("per_hectare", collect(grapevine, "per_hectare"), jurisdiction),
    jurisdiction,
  };
}

/** Smallest legacy-compatible representation of a chosen default. */
export interface ChosenDefaultRate {
  /** Numeric default; null when the option is a label range (user enters it). */
  value: number | null;
  /** Composed unit text, e.g. "L/100L". */
  unit?: string;
  basis: RateBasis;
  optionId: string;
}

export const chosenDefault = (o: DefaultRateOption): ChosenDefaultRate => ({
  value: o.isRange ? null : (o.value ?? null),
  unit: o.composedUnit,
  basis: o.basis,
  optionId: o.id,
});
