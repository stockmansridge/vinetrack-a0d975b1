// Legacy `saved_chemicals.rate_per_ha` compatibility projection.
//
// `rate_per_ha` is a LEGACY scalar column shared with iOS/Android. It predates
// the structured rate contract (kind + basis + scalar-or-range + unit +
// provenance), which is now the single source of truth.
//
// Hard boundaries:
//   * A non-hectare rate (per 100 L, per 100 m, anything else) is NEVER
//     projected into `rate_per_ha`.
//   * No fabricated value is ever produced: not 0, not the minimum, not the
//     maximum, not a midpoint, and no unit/basis conversion.
//   * A per-hectare RANGE has no scalar in the contract, so it projects to
//     nothing.
//   * When there is no genuine per-hectare scalar the field is OMITTED from
//     the write payload (never sent as null) so the stored/legacy value or the
//     column default decides.

import type { PersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";
import { validateManualRate, type ManualRateDraft } from "@/lib/chemicalManualRate";

export interface LegacyRatePerHaInput {
  /** The legacy "Default rate" numeric field, as typed. Always per hectare. */
  typed?: string | number | null;
  /** Manual-rate recovery draft. Only a CONFIRMED draft may project. */
  manual?: ManualRateDraft | null;
  /** Persisted SQL 214 operator default rates. */
  defaults?: PersistedDefaultRates | null;
}

const positive = (n: unknown): number | undefined => {
  const v = typeof n === "string" ? (n.trim() === "" ? NaN : Number(n)) : Number(n);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

/**
 * Resolve the legacy per-hectare scalar for a write payload.
 * Returns `undefined` when the field must be omitted entirely.
 */
export function legacyRatePerHa(input: LegacyRatePerHaInput): number | undefined {
  const typed = positive(input.typed ?? null);
  if (typed !== undefined) return typed;

  const manual = input.manual;
  if (manual && manual.open && manual.confirmed && manual.basis === "per_hectare") {
    const v = validateManualRate(manual);
    // A range carries no contract-defined scalar — project nothing.
    if (v.ok && v.kind === "single" && v.value != null && v.value > 0) return v.value;
  }

  const perHa = input.defaults?.per_hectare ?? null;
  if (perHa && perHa.basis === "per_hectare") {
    const v = positive(perHa.value);
    if (v !== undefined) return v;
  }

  return undefined;
}

/** True when a Postgres error is the legacy NOT NULL constraint on the column. */
export function isLegacyRatePerHaViolation(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error ?? "");
  return /rate_per_ha/i.test(msg) && /not[- ]null/i.test(msg);
}

export const LEGACY_RATE_PER_HA_MESSAGE =
  "This rate is not a per-hectare rate, and the shared chemical database still " +
  "requires the legacy per-hectare value. VineTrack will not invent one. " +
  "Please report this product to support so the shared schema can be updated.";

/** Map a save error to an operator-readable message. */
export function describeSavedChemicalSaveError(error: unknown): string {
  if (isLegacyRatePerHaViolation(error)) return LEGACY_RATE_PER_HA_MESSAGE;
  return String((error as any)?.message ?? error ?? "Save failed");
}
