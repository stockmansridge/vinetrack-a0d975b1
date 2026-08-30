// Vineyard-first Chemical Lookup scope rules.
//
// The Chemical Info Lookup exists for ONE outcome: confirm a registered
// product, read its GRAPEVINE label information, confirm the operational rate,
// and save something a grower can spray with. It is not an all-crop label
// browser.
//
// This module holds the pure rules for that scope:
//   * what is saved   — grapevine registered uses only
//   * what is shown   — grapevine uses only in the normal add / re-verify flow
//   * what is ready   — a chemical is spray-ready only with a confirmed rate
//   * duplicate names — the operator is asked before any lookup runs
//
// No network calls, no writes, no product-specific logic.

import { partitionRegisteredUses } from "@/lib/chemicalGrapevineUses";
import type {
  ChemicalIntelligenceDraft,
  WriteRegisteredUse,
} from "@/lib/chemicalIntelligenceWrite";
import type {
  PersistedDefaultRates,
  PersistedDefaultRateSelection,
} from "@/lib/chemicalDefaultRatesContract";

/* ------------------------------------------------------------- user messages */

/** Shown BEFORE the label read starts so the wait is never a mystery. */
export const LOOKUP_DURATION_NOTICE =
  "We're checking the official registration and reading the product label for grapevine uses and rates. This can take a few minutes.";

export const DUPLICATE_PROMPT_TITLE = "This chemical is already in your Chemical Store";
export const DUPLICATE_PROMPT_QUESTION =
  "Would you like VineTrack to check the official register for updates to this product?";
export const DUPLICATE_KEEP_LABEL = "No, keep it as it is";
export const DUPLICATE_CHECK_LABEL = "Yes, check for updates";

export const NO_GRAPEVINE_REGISTRATION_MESSAGE =
  "This product's label does not show a registered grapevine use. You can still save it for records, but VineTrack will not offer it as a ready-to-spray chemical.";

export const RATE_CONFIRMATION_REQUIRED_MESSAGE =
  "Confirm the rate you will use in your vineyard before saving. It can be a label rate, or your own amount inside the label range.";

export const DEFAULT_RATE_NO_LONGER_ON_LABEL_MESSAGE =
  "The rate you had saved is no longer on the current label. Confirm a rate again before using this chemical in a spray.";

/* ------------------------------------------------------------ name identity */

/** Case / whitespace / punctuation-insensitive product-name key. */
export function normaliseChemicalName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface SavedChemicalNameMatch {
  id: string;
  name?: string | null;
  deleted_at?: string | null;
}

/**
 * Exact (normalised) name match inside the CURRENT vineyard's saved chemicals.
 * Never a fuzzy/substring match — a near-name is a different product.
 */
export function findSavedChemicalByName<T extends SavedChemicalNameMatch>(
  saved: readonly T[],
  name: string | null | undefined,
): T | null {
  const key = normaliseChemicalName(name);
  if (!key) return null;
  return (
    saved.find((c) => !c.deleted_at && normaliseChemicalName(c.name) === key) ?? null
  );
}

/* ------------------------------------------------------------ grapevine scope */

/** True when at least one registered use on the label is a grapevine use. */
export function hasGrapevineRegistration(uses: readonly WriteRegisteredUse[]): boolean {
  return partitionRegisteredUses(uses as WriteRegisteredUse[]).grapevine.length > 0;
}

/** Grapevine registered uses only — the exact set the portal ever persists. */
export function grapevineOnlyUses(
  uses: readonly WriteRegisteredUse[],
): WriteRegisteredUse[] {
  return partitionRegisteredUses(uses as WriteRegisteredUse[]).grapevine;
}

/**
 * Project a draft down to vineyard scope before it is encoded for save.
 * Other-crop directions are dropped, never rewritten or merged. Everything
 * else on the draft (identity, chemistry, WHP/REI, sources) is untouched.
 */
export function grapevineOnlyDraft(
  draft: ChemicalIntelligenceDraft,
): ChemicalIntelligenceDraft {
  const grapevine = grapevineOnlyUses(draft.registeredUses);
  if (grapevine.length === draft.registeredUses.length) return draft;
  return { ...draft, registeredUses: grapevine };
}

/* -------------------------------------------------------------- spray-ready */

const hasSelection = (s: PersistedDefaultRateSelection | null | undefined): boolean =>
  !!s && (s.value != null || s.min_value != null || s.max_value != null);

/** A confirmed operational rate exists on at least one basis. */
export function hasConfirmedRate(defaults: PersistedDefaultRates | null): boolean {
  if (!defaults) return false;
  return hasSelection(defaults.per_hectare) || hasSelection(defaults.per_100_litres);
}

/**
 * Spray-ready = a registered grapevine use AND a confirmed operational rate.
 * A product with no grapevine registration can never become spray-ready
 * through this flow, whatever else the label contains.
 */
export function isSprayReady(input: {
  uses: readonly WriteRegisteredUse[];
  defaults: PersistedDefaultRates | null;
}): boolean {
  return hasGrapevineRegistration(input.uses) && hasConfirmedRate(input.defaults);
}

/* ------------------------------------------- re-verify rate survival check */

const rateIdsOf = (uses: readonly WriteRegisteredUse[]): Set<string> => {
  const out = new Set<string>();
  for (const u of uses) {
    for (const r of (u as any).rates ?? []) {
      const id = (r as any)?.rate_id;
      if (typeof id === "string" && id.trim()) out.add(id.trim());
    }
  }
  return out;
};

/**
 * After a label update, a saved default survives only when every rate identity
 * it cites is still present on the new label. When it is not, the operator must
 * confirm a rate again — the portal never silently re-points the default.
 */
export function defaultRateStillSupported(
  defaults: PersistedDefaultRates | null,
  uses: readonly WriteRegisteredUse[],
): boolean {
  if (!hasConfirmedRate(defaults)) return true;
  const available = rateIdsOf(grapevineOnlyUses(uses));
  const slots = [defaults!.per_hectare, defaults!.per_100_litres].filter(hasSelection);
  return slots.every((s) => {
    const ids = s!.rate_ids ?? [];
    // No cited identities: nothing to invalidate against.
    if (ids.length === 0) return true;
    return ids.every((id) => available.has(id));
  });
}
