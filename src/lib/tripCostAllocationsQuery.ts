// READ-ONLY query helper for trip_cost_allocations.
// Owner/manager only — gated by useCanSeeCosts() at the call sites and
// enforced by RLS on the iOS Supabase project.
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
    .order("calculated_at", { ascending: false, nullsFirst: false });
  if (error) {
    // RLS will return either an error or zero rows for non-owner/manager.
    // We swallow both into an empty list so the UI renders the "no access"
    // state via the permission gate rather than a crash.
    console.warn("[trip_cost_allocations] fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as TripCostAllocation[];
}
