// Rate-gate safeguard (Android parity).
//
// A NEW registered lookup that returns no usable backend `default_rate_options`
// must never leave the operator with a disabled Save button and no way out.
// This module holds the PURE rules and copy for that recovery state.
//
// It mints nothing: no option_key, no rate_id, no direction_id. The structured
// save gate itself is untouched — Save stays disabled until the backend
// supplies canonical options and the operator confirms one.

import type { CanonicalDefaultRateOptions } from "@/lib/chemicalDefaultRatesContract";

export const MISSING_RATE_OPTIONS_MESSAGE =
  "VineTrack could not read a registered grapevine rate from this label, so this product cannot yet be added as a label-checked chemical.";

export const RETRY_LABEL_DETAILS_LABEL = "Retry label details";
export const OPEN_OFFICIAL_LABEL_LABEL = "Open official label";
export const ENTER_MANUALLY_LABEL = "Enter manually";
export const CHANGE_PRODUCT_LABEL = "Change product";

export const MANUAL_ENTRY_UNVERIFIED_MESSAGE =
  "Entering this chemical manually saves it as an unverified manual record, not a label-checked product.";

/** True when the backend supplied at least one canonical option on any basis. */
export function hasUsableRateOptions(
  options: CanonicalDefaultRateOptions | null | undefined,
): boolean {
  if (!options) return false;
  return (
    (options.per_hectare?.length ?? 0) > 0 || (options.per_100_litres?.length ?? 0) > 0
  );
}

/**
 * The recovery block is shown only where the save gate can actually strand the
 * operator: a NEW chemical, chosen through registered/master lookup, with a
 * grapevine registration but no usable canonical rate options.
 */
export function showMissingRateOptionsRecovery(args: {
  isExistingRecord: boolean;
  selectionMode: string;
  grapevineRegistered: boolean;
  options: CanonicalDefaultRateOptions | null | undefined;
}): boolean {
  if (args.isExistingRecord) return false;
  const lookup = args.selectionMode === "registered" || args.selectionMode === "master";
  if (!lookup) return false;
  if (!args.grapevineRegistered) return false;
  return !hasUsableRateOptions(args.options);
}
