// READ-ONLY query helper for trip_cost_allocations.
// Owner/manager only — gated by useCanSeeCosts() at the call sites and
// enforced by RLS on the iOS Supabase project.
// Only ACTIVE allocation rows (deleted_at IS NULL) are cost authority.
// Soft-deleted allocations are retained history: they must never enter
// totals and must never suppress an uncosted Trip presence row.
import { supabase } from "@/integrations/ios-supabase/client";

export interface TripCostAllocation {
  id: string;
  vineyard_id: string;
  trip_id: string | null;
  paddock_id: string | null;
  paddock_name?: string | null;
  variety?: string | null;
  season_year?: number | null;
  allocation_area_ha?: number | null;
  yield_tonnes?: number | null;
  labour_cost?: number | null;
  fuel_cost?: number | null;
  chemical_cost?: number | null;
  input_cost?: number | null;
  total_cost?: number | null;
  cost_per_ha?: number | null;
  cost_per_tonne?: number | null;
  trip_function?: string | null;
  costing_status?: string | null;
  warnings?: any;
  calculated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  // Optional source-trip metadata if exposed by the table:
  trip_updated_at?: string | null;
}

export async function fetchTripCostAllocationsForVineyard(
  vineyardId: string,
): Promise<TripCostAllocation[]> {
  const { data, error } = await supabase
    .from("trip_cost_allocations")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("calculated_at", { ascending: false, nullsFirst: false });
  if (error) {
    // RLS will return either an error or zero rows for non-owner/manager.
    // We swallow both into an empty list so the UI renders the "no access"
    // state via the permission gate rather than a crash.
    console.warn("[trip_cost_allocations] fetch failed:", error.message);
    return [];
  }
  const allocations = (data ?? []) as TripCostAllocation[];
  const tripIds = [...new Set(allocations.flatMap((row) => row.trip_id ? [row.trip_id] : []))];
  const activeTripIds = new Set<string>();
  // Retained allocations are evidence, not authority to keep a deleted trip
  // financially active. Read parent state without relying on a schema FK join.
  // Bound each request below the backend row limit, including multi-block trips.
  for (let offset = 0; offset < tripIds.length; offset += 200) {
    const { data: trips, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .in("id", tripIds.slice(offset, offset + 200))
      .is("deleted_at", null);
    if (tripError) {
      console.warn("[trip_cost_allocations] parent trip fetch failed:", tripError.message);
      return [];
    }
    for (const trip of trips ?? []) activeTripIds.add(trip.id);
  }
  // Preserve allocations without a parent reference; only referenced trips
  // require an active, visible parent. No retained rows are mutated.
  return allocations.filter((row) => !row.trip_id || activeTripIds.has(row.trip_id));
}
