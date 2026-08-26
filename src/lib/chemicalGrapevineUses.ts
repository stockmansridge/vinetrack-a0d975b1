// Grapevine-first projection of the structured registered uses.
//
// A vineyard operator only cares about the grapevine rows on a label. Every
// other crop stays in the record (nothing is discarded) but is hidden behind
// an explicit "Other crops on this label" control.
//
// The backend projection wins when it is present: any per-use flag such as
// `is_grapevine`, `grapevine`, or `crop_group: "grapevine"` is trusted before
// the portal looks at the crop text.

import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import { selectRates, withholdingDisplay, type LookupRateView } from "@/lib/chemicalLabelRates";

export const NO_GRAPEVINE_RATE_MESSAGE =
  "No registered grapevine rate was resolved from the label.";

const GRAPEVINE_TEXT = /\b(grape|grapevine|grapevines|vine|vines|vitis|wine\s*grape|table\s*grape)\b/i;

const truthy = (v: unknown): boolean =>
  v === true || v === "true" || v === 1 || v === "1";

/** Backend projection flag, when the server supplied one. */
export function grapevineFlag(use: WriteRegisteredUse): boolean | undefined {
  const extra = (use.extra ?? {}) as Record<string, unknown>;
  const prov = (use.provenance ?? {}) as Record<string, unknown>;
  for (const src of [extra, prov]) {
    for (const key of ["is_grapevine", "isGrapevine", "grapevine"]) {
      if (src[key] != null) return truthy(src[key]);
    }
    const group = src["crop_group"] ?? src["cropGroup"];
    if (typeof group === "string" && group.trim() !== "") {
      return GRAPEVINE_TEXT.test(group);
    }
  }
  return undefined;
}

export function isGrapevineUse(use: WriteRegisteredUse): boolean {
  const flagged = grapevineFlag(use);
  if (flagged != null) return flagged;
  return GRAPEVINE_TEXT.test(use.crop ?? "");
}

export interface PartitionedUses {
  grapevine: WriteRegisteredUse[];
  other: WriteRegisteredUse[];
}

export function partitionRegisteredUses(uses: WriteRegisteredUse[]): PartitionedUses {
  const grapevine: WriteRegisteredUse[] = [];
  const other: WriteRegisteredUse[] = [];
  for (const u of uses) (isGrapevineUse(u) ? grapevine : other).push(u);
  return { grapevine, other };
}

/* --------------------------------------------- normal grapevine projection */

const MANUFACTURER_TEXT = /manufacturer/i;

/**
 * Which evidence a registered use came from, when the wire rows say so. The
 * manufacturer label is the document actually in the shed, so it wins for
 * normal display when it duplicates a regulator row.
 */
export function useSourceKind(
  use: WriteRegisteredUse,
): "manufacturer_label" | "official_register" | undefined {
  const blobs = [use.extra, use.provenance].filter(Boolean) as Record<string, unknown>[];
  const text = blobs
    .flatMap((b) => Object.values(b))
    .map((v) => (typeof v === "string" ? v : ""))
    .join(" ");
  if (MANUFACTURER_TEXT.test(text)) return "manufacturer_label";
  if (/official_register|apvma|regulator/i.test(text)) return "official_register";
  return undefined;
}

const normTarget = (u: WriteRegisteredUse): string =>
  (u.target_raw || u.crop || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const hasUsableRate = (u: WriteRegisteredUse): boolean =>
  selectRates(u).usable.length > 0;

/**
 * Grapevine rows for the NORMAL screen. Rate-less duplicates of a target that
 * already has an authoritative rated row are suppressed, and a manufacturer
 * label row is preferred over the older regulator row for the same target.
 * Nothing is deleted — Advanced/audit still reads the full `registeredUses`.
 */
export function normalGrapevineUses(uses: WriteRegisteredUse[]): WriteRegisteredUse[] {
  const grapevine = partitionRegisteredUses(uses ?? []).grapevine;
  const groups = new Map<string, WriteRegisteredUse[]>();
  for (const u of grapevine) {
    const key = normTarget(u);
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const kept = new Set<WriteRegisteredUse>();
  for (const rows of groups.values()) {
    const rated = rows.filter(hasUsableRate);
    if (!rated.length) {
      rows.forEach((r) => kept.add(r));
      continue;
    }
    const manufacturer = rated.filter((r) => useSourceKind(r) === "manufacturer_label");
    (manufacturer.length ? manufacturer : rated).forEach((r) => kept.add(r));
  }
  return grapevine.filter((u) => kept.has(u));
}


export interface UseRateLine {
  /** Human rate text, e.g. "3 L/100 L". Never converted between bases. */
  text: string;
  basisLabel: string;
  /** Target the individual rate row applies to, when the label states one. */
  label?: string;
  condition?: string;
  referenceOnly: boolean;
}

const BASIS_LABEL = (r: LookupRateView): string =>
  r.rateBasis === "per_100L"
    ? "Per 100 L"
    : r.rateBasis === "per_hectare"
      ? "Per hectare"
      : "Label reference";

/** Every rate on a use, kept separate. /100 L and /ha both survive. */
export function useRateLines(use: WriteRegisteredUse): UseRateLine[] {
  const sel = selectRates(use);
  return sel.all.map((r) => ({
    text: r.text,
    basisLabel: BASIS_LABEL(r),
    label: r.label,
    condition: r.condition,
    referenceOnly: r.referenceOnly,
  }));
}


export interface GrapevineUseView {
  target: string;
  rates: UseRateLine[];
  hasUsableRate: boolean;
  conditions?: string;
  withholding: string;
  reEntry: string;
}

export const NOT_STATED = "Not stated";
export const NOT_RESOLVED = "Not resolved";

export function grapevineUseView(use: WriteRegisteredUse): GrapevineUseView {
  const rates = useRateLines(use);
  return {
    target: use.target_raw?.trim() || use.crop?.trim() || NOT_STATED,
    rates,
    hasUsableRate: rates.some((r) => !r.referenceOnly),
    conditions: use.restrictions?.trim() || undefined,
    withholding:
      withholdingDisplay(use.withholding_period_days ?? null, use.restrictions) ?? NOT_RESOLVED,
    reEntry:
      use.re_entry_period_hours == null
        ? NOT_RESOLVED
        : `${use.re_entry_period_hours} ${use.re_entry_period_hours === 1 ? "hour" : "hours"}`,
  };
}
