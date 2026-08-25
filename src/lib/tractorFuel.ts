// Portal-side fuel-rate rules for Tractors.
//
// SQL 209 intentionally stores an unset rate as NULL/0 — that convention is
// not changed here. This module is Portal validation + presentation only.
//
// Rules:
//  - NEW tractor: a fuel rate is REQUIRED and must be > 0. No default is
//    invented; the AI estimate is optional and must be explicitly accepted.
//  - EXISTING tractor with a stored rate of 0/unset: stays editable and may
//    remain unset — the grower is never forced to fabricate a rate to change
//    a name or model.
//  - EXISTING tractor with a configured rate > 0: normal editing.

export const FUEL_REQUIRED_NEW =
  "Fuel usage is required for a new tractor. Enter the rate in L/hr (or use the estimate).";
export const FUEL_MUST_BE_POSITIVE = "Fuel usage must be greater than 0 L/hr.";
export const FUEL_MAX = 1000;

export interface FuelValidationInput {
  /** Raw text from the input field. */
  raw: string;
  /** true when creating a new tractor. */
  isNew: boolean;
}

export interface FuelValidationResult {
  ok: boolean;
  /** Value to send to the RPC (null = unset). */
  value: number | null;
  error?: string;
}

export function validateTractorFuelUsage({
  raw,
  isNew,
}: FuelValidationInput): FuelValidationResult {
  const text = (raw ?? "").trim();

  if (text === "") {
    if (isNew) return { ok: false, value: null, error: FUEL_REQUIRED_NEW };
    return { ok: true, value: null };
  }

  const n = Number(text);
  if (!Number.isFinite(n)) {
    return { ok: false, value: null, error: "Fuel usage must be a number" };
  }
  if (n < 0) return { ok: false, value: null, error: "Fuel usage cannot be negative" };
  if (n > FUEL_MAX) {
    return { ok: false, value: null, error: `Fuel usage must be ≤ ${FUEL_MAX}` };
  }
  if (n === 0) {
    if (isNew) return { ok: false, value: null, error: FUEL_MUST_BE_POSITIVE };
    // Existing record: 0 means "unset" and is stored as-is.
    return { ok: true, value: 0 };
  }
  return { ok: true, value: n };
}

/** Stored 0 is treated as unset in presentation. */
export function isFuelUsageSet(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export const FUEL_NOT_SET_LABEL = "Fuel usage not set";

/** List / detail presentation for a stored rate. */
export function formatFuelUsage(value: number | null | undefined): string {
  return isFuelUsageSet(value) ? `${value} L/hr` : FUEL_NOT_SET_LABEL;
}

/** Edit-field value: blank for an existing 0-rate tractor. */
export function fuelUsageFieldValue(value: number | null | undefined): string {
  return isFuelUsageSet(value) ? String(value) : "";
}
