// Chemical default rates — canonical backend contract + persisted contract.
//
// Gate D4B-P2A. This module owns TWO distinct vocabularies and never mixes
// them:
//
//  1. The BACKEND CANONICAL option set (`default_rate_options`) produced by
//     the `chemical-info-lookup` edge function. The backend is authoritative
//     for option construction: `option_key` and `rate_ids` are minted server
//     side and are passed through byte-for-byte. The portal never hashes,
//     groups, converts or repairs them.
//  2. The PERSISTED operator selection stored in
//     `saved_chemicals.default_rates` (SQL 214 / shared contract D3).
//
// Wire/persisted basis vocabulary is `per_hectare` | `per_100_litres`. The
// portal's display-side `RateBasis` uses `per_100L`; that mapping belongs at
// the presentation boundary only — nothing here ever rewrites the canonical
// basis token.
//
// There is NO `recommended` flag in the production backend contract, so none
// is modelled here. Recommendation is a later presentation concern.
//
// Legacy boundary: `src/lib/chemicalDefaultRates.ts` (`buildDefaultRateOptions`)
// is display-only until D4B-P2B. A persisted Selection may NEVER be derived
// from a portal-minted key such as `${basis}|${rate.text}`.

/* --------------------------------------------------------------- vocabulary */

export type CanonicalRateBasis = "per_hectare" | "per_100_litres";

export const CANONICAL_RATE_BASES: CanonicalRateBasis[] = [
  "per_hectare",
  "per_100_litres",
];

export const DEFAULT_OPTION_KEY_PREFIX = "default_option_v1_";
export const RATE_ID_PREFIX = "rate_v1_";

export type DefaultRateSelectionSource = "operator" | "recommended";

/* -------------------------------------------------- backend canonical option */

/** One backend-constructed operational default option. */
export interface CanonicalDefaultRateOption {
  option_key: string;
  rate_ids: string[];
  basis: CanonicalRateBasis;
  unit: string;
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  /** Optional backend DISPLAY metadata — passed through untouched. */
  direction_ids?: string[];
  targets?: string[];
  conditions?: string[];
  crops?: string[];
  condition_ambiguous?: boolean;
}

export interface CanonicalDefaultRateOptions {
  per_hectare: CanonicalDefaultRateOption[];
  per_100_litres: CanonicalDefaultRateOption[];
}

/* ------------------------------------------------------- persisted contract */

/** Exactly the shared D3 / SQL 214 selection shape. No portal-only fields. */
export interface PersistedDefaultRateSelection {
  option_key: string;
  rate_ids: string[];
  basis: CanonicalRateBasis;
  unit: string;
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  source: DefaultRateSelectionSource;
  selected_at: string;
  label_version: string | null;
}

export interface PersistedDefaultRates {
  version: 1;
  per_hectare: PersistedDefaultRateSelection | null;
  per_100_litres: PersistedDefaultRateSelection | null;
}

/* ------------------------------------------------------------------ helpers */

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const isCanonicalBasis = (v: unknown): v is CanonicalRateBasis =>
  v === "per_hectare" || v === "per_100_litres";

/** Numeric slot: a number passes through, explicit null/absent becomes null. */
function numOrNull(v: unknown): number | null | undefined {
  if (v == null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Non-empty string array, verbatim. */
function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item === "") return undefined;
    out.push(item);
  }
  return out;
}

function optionalStringArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  return stringArray(v);
}

/* --------------------------------------------- canonical option decoder */

/**
 * Decode ONE backend canonical option. Malformed input is rejected (null),
 * never repaired. No hashing, grouping, basis conversion or unit conversion.
 */
export function decodeCanonicalDefaultRateOption(
  value: unknown,
  expectedBasis?: CanonicalRateBasis,
): CanonicalDefaultRateOption | null {
  const o = rec(value);
  if (!o) return null;

  const optionKey = o.option_key;
  if (typeof optionKey !== "string" || !optionKey.startsWith(DEFAULT_OPTION_KEY_PREFIX)) {
    return null;
  }
  const rateIds = stringArray(o.rate_ids);
  if (!rateIds || rateIds.length === 0) return null;
  if (!rateIds.every((id) => id.startsWith(RATE_ID_PREFIX))) return null;

  if (!isCanonicalBasis(o.basis)) return null;
  if (expectedBasis && o.basis !== expectedBasis) return null;

  if (typeof o.unit !== "string" || o.unit === "") return null;

  const value_ = numOrNull(o.value);
  const min = numOrNull(o.min_value);
  const max = numOrNull(o.max_value);
  if (value_ === undefined || min === undefined || max === undefined) return null;
  // No scalar fallback and no range synthesis: an option with no number at all
  // is not an operational default.
  if (value_ === null && min === null && max === null) return null;

  const out: CanonicalDefaultRateOption = {
    option_key: optionKey,
    rate_ids: rateIds,
    basis: o.basis,
    unit: o.unit,
    value: value_,
    min_value: min,
    max_value: max,
  };

  const directionIds = optionalStringArray(o.direction_ids);
  if (directionIds) out.direction_ids = directionIds;
  const targets = optionalStringArray(o.targets);
  if (targets) out.targets = targets;
  const conditions = optionalStringArray(o.conditions);
  if (conditions) out.conditions = conditions;
  const crops = optionalStringArray(o.crops);
  if (crops) out.crops = crops;
  if (typeof o.condition_ambiguous === "boolean") {
    out.condition_ambiguous = o.condition_ambiguous;
  }
  return out;
}

/**
 * Decode the backend `default_rate_options` envelope. Returns null when the
 * backend did not send one (older deployments) — never a synthesised envelope.
 * Individual malformed options are dropped; the rest are preserved in server
 * order.
 */
export function decodeCanonicalDefaultRateOptions(
  value: unknown,
): CanonicalDefaultRateOptions | null {
  const o = rec(value);
  if (!o) return null;
  if (o.per_hectare === undefined && o.per_100_litres === undefined) return null;

  const decodeList = (raw: unknown, basis: CanonicalRateBasis) =>
    (Array.isArray(raw) ? raw : [])
      .map((item) => decodeCanonicalDefaultRateOption(item, basis))
      .filter((x): x is CanonicalDefaultRateOption => !!x);

  return {
    per_hectare: decodeList(o.per_hectare, "per_hectare"),
    per_100_litres: decodeList(o.per_100_litres, "per_100_litres"),
  };
}

/* ------------------------------------------------- persisted decoder (D3) */

function decodePersistedSelection(
  value: unknown,
  expectedBasis: CanonicalRateBasis,
): PersistedDefaultRateSelection | null {
  const o = rec(value);
  if (!o) return null;

  if (typeof o.option_key !== "string" || !o.option_key.startsWith(DEFAULT_OPTION_KEY_PREFIX)) {
    return null;
  }
  const rateIds = stringArray(o.rate_ids);
  if (!rateIds || rateIds.length === 0) return null;
  if (!rateIds.every((id) => id.startsWith(RATE_ID_PREFIX))) return null;

  if (!isCanonicalBasis(o.basis) || o.basis !== expectedBasis) return null;
  if (typeof o.unit !== "string" || o.unit === "") return null;

  const value_ = numOrNull(o.value);
  const min = numOrNull(o.min_value);
  const max = numOrNull(o.max_value);
  if (value_ === undefined || min === undefined || max === undefined) return null;

  if (o.source !== "operator" && o.source !== "recommended") return null;
  if (typeof o.selected_at !== "string" || o.selected_at === "") return null;
  if (o.label_version != null && typeof o.label_version !== "string") return null;

  return {
    option_key: o.option_key,
    rate_ids: rateIds,
    basis: o.basis,
    unit: o.unit,
    value: value_,
    min_value: min,
    max_value: max,
    source: o.source,
    selected_at: o.selected_at,
    label_version: (o.label_version as string | null | undefined) ?? null,
  };
}

/**
 * Decode `saved_chemicals.default_rates`.
 *
 * Fail-closed rules (shared D3 semantics):
 *  - non-object root -> null;
 *  - missing/unsupported version -> null;
 *  - a malformed basis slot becomes null WITHOUT discarding the other slot;
 *  - `option_key` must already be `default_option_v1_…`, `rate_ids` must
 *    already be `rate_v1_…` — never recomputed;
 *  - `source` must be operator | recommended;
 *  - no rate regrouping, no unit or basis conversion.
 *
 * Nothing is ever inferred from `rate_per_ha`, `unit`, `rates` or
 * `registered_uses`. An absent/null contract means "no persisted operational
 * default".
 */
export function decodePersistedDefaultRates(value: unknown): PersistedDefaultRates | null {
  const o = rec(value);
  if (!o) return null;
  if (o.version !== 1) return null;
  return {
    version: 1,
    per_hectare: decodePersistedSelection(o.per_hectare, "per_hectare"),
    per_100_litres: decodePersistedSelection(o.per_100_litres, "per_100_litres"),
  };
}
