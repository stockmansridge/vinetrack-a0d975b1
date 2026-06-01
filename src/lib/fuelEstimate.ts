// Phase 3 — Fuel allocation estimate, mirrored from iOS.
//
// Calculation rules (must stay in sync with iOS):
//   1) If trip.start_engine_hours and trip.end_engine_hours are present
//      and end > start:
//        basis = "engine_hours"
//        engineHourDelta = end - start
//        litres = engineHourDelta * tractor.fuel_usage_l_per_hour
//   2) Otherwise:
//        basis = "trip_duration"
//        activeHours = trip duration excluding pause/resume windows
//        litres = activeHours * tractor.fuel_usage_l_per_hour
//   3) cost = litres * weighted fuel cost/L from fuel_purchases (if available).
//   4) If tractor.fuel_usage_l_per_hour is missing/zero → "Fuel rate missing"
//      and litres/cost are null.
//   5) If cost/L unavailable → litres still shown, cost null.
//
// This module does NOT write anywhere. iOS owns persistence.
import type { Trip } from "@/lib/tripsQuery";
import type { FuelPurchase } from "@/lib/fuelPurchasesQuery";
import type { TractorLite } from "@/lib/tripCosting";
import { weightedFuelCostPerLitre } from "@/lib/tripCosting";

export type FuelBasis = "engine_hours" | "trip_duration" | "unavailable";

export interface FuelEstimate {
  basis: FuelBasis;
  basisLabel: string;
  engineHourDelta: number | null;
  activeHours: number | null;
  litresPerHour: number | null;
  litres: number | null;
  costPerLitre: number | null;
  cost: number | null;
  /** True when tractor.fuel_usage_l_per_hour is missing or zero. */
  rateMissing: boolean;
  /** True when cost/L could not be derived. */
  costUnavailable: boolean;
  warnings: string[];
}

/** Active milliseconds excluding pause/resume windows. */
export function tripActiveMs(trip: Trip): number | null {
  if (!trip.start_time || !trip.end_time) return null;
  const start = new Date(trip.start_time).getTime();
  const end = new Date(trip.end_time).getTime();
  if (!isFinite(start) || !isFinite(end) || end <= start) return null;
  let ms = end - start;
  const pauses = (trip.pause_timestamps as any) ?? [];
  const resumes = (trip.resume_timestamps as any) ?? [];
  if (Array.isArray(pauses) && Array.isArray(resumes)) {
    const n = Math.min(pauses.length, resumes.length);
    for (let i = 0; i < n; i++) {
      const p = new Date(pauses[i]).getTime();
      const r = new Date(resumes[i]).getTime();
      if (isFinite(p) && isFinite(r) && r > p) ms -= r - p;
    }
  }
  return Math.max(0, ms);
}

function tripActiveHours(trip: Trip): number | null {
  const ms = tripActiveMs(trip);
  return ms == null ? null : ms / 3_600_000;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export function computeFuelEstimate(
  trip: Trip,
  tractor: TractorLite | null | undefined,
  fuelPurchases: FuelPurchase[] | null | undefined,
): FuelEstimate {
  const warnings: string[] = [];

  const startEh = num((trip as any).start_engine_hours);
  const endEh = num((trip as any).end_engine_hours);
  const hasStart = startEh != null;
  const hasEnd = endEh != null;
  const engineValid = hasStart && hasEnd && (endEh as number) > (startEh as number);
  const engineProvidedButInvalid = (hasStart || hasEnd) && !engineValid;

  let basis: FuelBasis;
  let engineHourDelta: number | null = null;
  let activeHours: number | null = tripActiveHours(trip);

  if (engineValid) {
    basis = "engine_hours";
    engineHourDelta = (endEh as number) - (startEh as number);
  } else {
    basis = "trip_duration";
    if (engineProvidedButInvalid) {
      warnings.push("Engine hours invalid — falling back to trip duration.");
    }
    if (activeHours == null) {
      basis = "unavailable";
      warnings.push("Trip has no completed start/finish time — fuel estimate unavailable.");
    }
  }

  const lph = num(tractor?.fuel_usage_l_per_hour);
  const rateMissing = !tractor || lph == null || lph <= 0;
  if (!tractor) {
    warnings.push("No tractor linked to this trip — fuel estimate unavailable.");
  } else if (rateMissing) {
    warnings.push("Fuel rate missing on linked tractor (L/hr).");
  }

  let litres: number | null = null;
  if (!rateMissing && basis === "engine_hours" && engineHourDelta != null) {
    litres = engineHourDelta * (lph as number);
  } else if (!rateMissing && basis === "trip_duration" && activeHours != null) {
    litres = activeHours * (lph as number);
  }

  const cpl = fuelPurchases && fuelPurchases.length ? weightedFuelCostPerLitre(fuelPurchases) : null;
  const costUnavailable = cpl == null;
  if (litres != null && costUnavailable) {
    warnings.push("Fuel cost/L unavailable — no fuel purchases on file.");
  }
  const cost = litres != null && cpl != null ? litres * cpl : null;

  const basisLabel =
    basis === "engine_hours" ? "Engine hours" :
    basis === "trip_duration" ? "Trip duration" : "Unavailable";

  return {
    basis,
    basisLabel,
    engineHourDelta,
    activeHours,
    litresPerHour: lph,
    litres,
    costPerLitre: cpl,
    cost,
    rateMissing,
    costUnavailable,
    warnings,
  };
}

export function fmtLitres(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(1)} L`;
}

export function fmtLitresPerHour(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(2)} L/hr`;
}

export function fmtEngineHours(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(2)} hr`;
}
