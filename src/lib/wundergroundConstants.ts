// Centralised constants for the Weather Underground integration.
//
// The wunderground-proxy edge function action strings live here so they can
// be updated in one place if the iOS Supabase function contract changes.
export const WU_PROXY_ACTIONS = {
  /** Find nearest WU PWS to a lat/lon. */
  findNearby: "find_nearby",
  /** Fetch + write WU rainfall for a list of explicit dates. */
  backfillDates: "backfill_dates",
  /** Legacy server-driven 14-day backfill (kept as a fallback). */
  backfillLegacy: "backfill",
} as const;

export const WU_PROVIDER = "wunderground" as const;

export const WU_DEFAULT_BACKFILL_DAYS = 14;
