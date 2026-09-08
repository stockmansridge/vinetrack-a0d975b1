// Customer-facing wording for the Spray Report, plus the matching technical
// note that only verified system admins may see.
//
// Rule: anything a vineyard user reads must be practical and free of internal
// implementation language (team names, migration numbers, database tables,
// remote procedure names, "contract", "backend", "portal-only"). The technical
// explanation is not deleted — it moves into the system-admin diagnostics
// panel so support can still triage. Diagnostics never reach a customer PDF.

export interface SprayMessagePair {
  /** Shown to everyone. */
  customer: string;
  /** Shown only inside the system-admin diagnostics panel. */
  diagnostic: string;
}

export const ACTUALS_SAVE_FAILED: SprayMessagePair = {
  customer: "Your changes have not been saved. Please try again.",
  diagnostic: "correct_spray_tank_actual_v1 rejected or failed for at least one edited tank.",
};

export const ACTUALS_VERSION_CONFLICT: SprayMessagePair = {
  customer:
    "This spray was changed by someone else while you were editing. Reload the trip and re-enter your changes.",
  diagnostic:
    "SQLSTATE 40001 from correct_spray_tank_actual_v1: expected version no longer current; reload and reconcile.",
};

export const TRIP_METADATA_SAVE_FAILED: SprayMessagePair = {
  customer: "The trip details have not been saved. Please try again.",
  diagnostic: "correct_spray_trip_metadata_v1 rejected or failed.",
};

export const WEATHER_RECOVERY_UNAVAILABLE: SprayMessagePair = {
  customer:
    "Historical weather couldn't be retrieved just now. Recorded observations are unchanged.",
  diagnostic:
    "spray-weather-recovery function unavailable or errored; missing slots stay missing for retry and are never fabricated.",
};


/** A save that failed for an unknown reason. */
export const SAVE_FAILED_CUSTOMER =
  "Your changes have not been saved. Please try again.";

/**
 * Strip internal implementation language from an error before showing it to a
 * customer. When the message looks technical, the practical wording is used
 * instead and the raw text is left for diagnostics.
 */
const TECHNICAL_HINTS = [
  "rork",
  "lovable",
  "sql",
  "rpc",
  "supabase",
  "postgres",
  "row-level security",
  "row level security",
  "policy",
  "schema",
  "column",
  "table",
  "migration",
  "contract",
  "endpoint",
  "function ",
  "42501",
  "pgrst",
  "_v1(",
  "spray_tank_actuals",
  "trip_report_assets",
];

export function isTechnicalMessage(message: string): boolean {
  const m = message.toLowerCase();
  return TECHNICAL_HINTS.some((h) => m.includes(h));
}

export interface CustomerError {
  customer: string;
  diagnostic: string | null;
}

export function toCustomerError(
  message: string | null | undefined,
  fallback = SAVE_FAILED_CUSTOMER,
): CustomerError {
  const raw = (message ?? "").trim();
  if (!raw) return { customer: fallback, diagnostic: null };
  if (isTechnicalMessage(raw)) return { customer: fallback, diagnostic: raw };
  return { customer: raw, diagnostic: null };
}
