// Best-effort count of pins associated with a trip.
//
// Strategy:
//  1. If trip.pin_ids has entries → use that length (authoritative when iOS
//     has stored explicit links).
//  2. Else, count pins in the same vineyard whose created_at falls inside
//     the trip's start/end window. If paddock_ids is populated, narrow the
//     window query to those paddocks.
//
// Read-only. Never mutates pins.
import { supabase } from "@/integrations/ios-supabase/client";
import type { Trip } from "./tripsQuery";

export async function countTripPins(t: Trip): Promise<number> {
  const explicit = Array.isArray(t.pin_ids) ? (t.pin_ids as unknown[]).length : 0;
  if (explicit > 0) return explicit;
  if (!t.vineyard_id || !t.start_time) return 0;
  const end = t.end_time ?? new Date().toISOString();
  try {
    let q = supabase
      .from("pins")
      .select("id", { count: "exact", head: true })
      .eq("vineyard_id", t.vineyard_id)
      .is("deleted_at", null)
      .gte("created_at", t.start_time)
      .lte("created_at", end);
    const padIds = Array.isArray(t.paddock_ids) ? (t.paddock_ids as string[]) : [];
    if (padIds.length) q = q.in("paddock_id", padIds);
    const { count, error } = await q;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
