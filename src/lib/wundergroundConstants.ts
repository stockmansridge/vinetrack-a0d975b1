// Centralised constants for the Weather Underground integration.
//
// Nearby station search is handled by the dedicated
// `weather-nearby-stations` edge function on the iOS Supabase project
// (it serves all weather providers), not by `wunderground-proxy`.
// `wunderground-proxy` only handles WU-specific actions like rainfall
// backfill. Keeping the function names + action strings here means we
// can update them in one place if the iOS contract changes.
export const WU_PROXY_FUNCTION = "wunderground-proxy" as const;
export const WU_NEARBY_FUNCTION = "weather-nearby-stations" as const;

export const WU_PROXY_ACTIONS = {
  /** Fetch + write WU rainfall for a list of explicit dates. */
  backfillDates: "backfill_dates",
  /** Legacy server-driven 14-day backfill (kept as a fallback). */
  backfillLegacy: "backfill",
  /**
   * Fetch the station's CURRENT observation and write it to
   * vineyard_weather_observations (source = wunderground_pws).
   * The edge function resolves the configured station itself.
   */
  current: "current",
} as const;

export const WU_PROVIDER = "wunderground" as const;

export const WU_DEFAULT_BACKFILL_DAYS = 14;
