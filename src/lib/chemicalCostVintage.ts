// Canonical vintage selection for SQL 264 chemical pricing.
//   1. trip_cost_allocations.season_year (canonical crop vintage)
//   2. fallback only: the trip's start/created instant resolved in the
//      VINEYARD's time zone (never browser-local time).
import { localDateOf } from "@/lib/workTaskCompletion";
import { vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";

/** Vintage of an instant, using the vineyard-local calendar date. */
export function vineyardLocalVintage(
  iso: string | null | undefined,
  month: number,
  day: number,
  timeZone: string | null | undefined,
): number | null {
  if (!iso) return null;
  const ymd = localDateOf(iso, timeZone);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  // A local-midnight Date of the vineyard calendar day: the browser's own
  // zone can no longer shift the day.
  return vintageForDate(new Date(y, m - 1, d, 12), month, day);
}

/** trip_id → canonical allocation season_year (first non-null). */
export function vintageByTripFromAllocations(
  allocations: ReadonlyArray<{ trip_id?: string | null; season_year?: number | null }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of allocations) {
    if (!a.trip_id || a.season_year == null || out.has(a.trip_id)) continue;
    const v = Number(a.season_year);
    if (Number.isFinite(v)) out.set(a.trip_id, v);
  }
  return out;
}

export function resolveTripVintage(
  trip: { id: string; start_time?: string | null; created_at?: string | null },
  opts: {
    vintageByTrip?: ReadonlyMap<string, number> | null;
    seasonStartMonth: number;
    seasonStartDay: number;
    timeZone: string | null | undefined;
  },
): number | null {
  const canonical = opts.vintageByTrip?.get(trip.id);
  if (canonical != null) return canonical;
  return vineyardLocalVintage(trip.start_time ?? trip.created_at ?? null, opts.seasonStartMonth, opts.seasonStartDay, opts.timeZone);
}
