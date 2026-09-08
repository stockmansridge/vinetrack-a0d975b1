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

export const ACTUALS_SAVE_UNAVAILABLE: SprayMessagePair = {
  customer:
    "Editing actual quantities is temporarily unavailable. Your changes have not been saved.",
  diagnostic:
    "No actual-usage saver is configured: the shared spray_tank_actuals save path (atomic quantity + audit-history write) has not been wired into the portal yet.",
};

export const SPRAY_UNIT_EDIT_UNAVAILABLE: SprayMessagePair = {
  customer: "The spray unit can't be changed here yet.",
  diagnostic:
    "Spray unit lives on spray_records.spray_equipment_id; no shared spray-record correction path is available to the portal.",
};

export const TRIP_FUEL_RATE_UNAVAILABLE: SprayMessagePair = {
  customer:
    "A fuel rate just for this trip can't be set yet — the machine's usual rate is used.",
  diagnostic:
    "No per-trip fuel override column exists on trips (e.g. fuel_usage_l_per_hour_override) and mobile sync support is required before one can be written.",
};

export const WEATHER_RECOVERY_UNAVAILABLE: SprayMessagePair = {
  customer:
    "Retrieving historical weather isn't available yet. Recorded observations are unchanged.",
  diagnostic:
    "No authorised weather-recovery action is exposed to the portal; observations must not be fabricated or written directly.",
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
