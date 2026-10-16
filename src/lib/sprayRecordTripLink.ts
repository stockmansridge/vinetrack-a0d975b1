// Spray Records → canonical Trip drawer routing (read-only).
import { supabase } from "@/integrations/ios-supabase/client";
import type { Trip } from "@/lib/tripsQuery";
import { isManualSpraySource } from "@/components/spray/ManualEntryBadge";

/** Exact trip by id, scoped to the selected vineyard, not soft-deleted. */
export async function fetchLinkedTripForSprayRecord(
  tripId: string,
  vineyardId: string,
): Promise<Trip | null> {
  const { data, error } = await (supabase as any)
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Trip) ?? null;
}

export type SprayRecordEntrypoint = "none" | "pending" | "trip" | "record";

/**
 * Which drawer a clicked spray record opens.
 * - manual entries and records without a trip: dedicated Spray Record drawer;
 * - linked records with a valid trip in this vineyard: canonical Trip drawer;
 * - while that trip loads: nothing (no flash of the old drawer);
 * - linked but trip missing / out of scope / failed: Spray Record fallback.
 */
export function linkedSprayEntrypoint(input: {
  record: { trip_id?: string | null; entry_source?: string | null } | null;
  tripLoading: boolean;
  trip: { id: string } | null;
}): SprayRecordEntrypoint {
  const r = input.record;
  if (!r) return "none";
  if (!r.trip_id || isManualSpraySource(r.entry_source)) return "record";
  if (input.trip && input.trip.id === r.trip_id) return "trip";
  if (input.tripLoading) return "pending";
  return "record";
}
