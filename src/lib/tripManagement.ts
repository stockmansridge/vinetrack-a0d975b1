import { supabase } from "@/integrations/ios-supabase/client";
import type { Trip } from "@/lib/tripsQuery";

export const STALE_TRIP_END_BLOCKER = "Safe ending needs a verified server action that checks device sync, spray occurrences and tank work, and records an audit entry. This is not available in Portal yet.";
export type TripServerStatus = "active" | "paused" | "completed" | "removed" | "inconsistent";
export interface TripManagementSnapshot {
  trip: Trip;
  role: string;
  canWrite: boolean;
}
export function tripServerStatus(trip: Trip): TripServerStatus {
  if (trip.deleted_at) return "removed";
  if (typeof trip.is_active !== "boolean" || typeof trip.is_paused !== "boolean") return "inconsistent";
  const ended = !!trip.end_time && Number.isFinite(Date.parse(trip.end_time));
  if ((trip.end_time && !ended) || (ended && (trip.is_active || trip.is_paused))) return "inconsistent";
  if (trip.is_active) return trip.is_paused ? "paused" : "active";
  if (trip.is_paused) return "paused";
  return ended ? "completed" : "inconsistent";
}
export function mayDeleteConfirmedTrip(snapshot: TripManagementSnapshot): boolean {
  return snapshot.canWrite && ["owner", "manager", "supervisor"].includes(snapshot.role)
    && tripServerStatus(snapshot.trip) === "completed"
    && snapshot.trip.is_filling_tank === false
    && Number.isSafeInteger(snapshot.trip.sync_version) && Number(snapshot.trip.sync_version) >= 0;
}

/** Exact selected-vineyard reads only; cached list/fallback rows are not lifecycle authority. */
export async function fetchTripManagementSnapshot(vineyardId: string, tripId: string, userId: string): Promise<TripManagementSnapshot> {
  const [tripResult, memberResult, accessResult] = await Promise.all([
    supabase.from("trips").select("id,vineyard_id,is_active,is_paused,end_time,deleted_at,sync_version,updated_at,is_filling_tank").eq("vineyard_id", vineyardId).eq("id", tripId).single(),
    supabase.from("vineyard_members").select("vineyard_id,user_id,role").eq("vineyard_id", vineyardId).eq("user_id", userId).single(),
    supabase.rpc("get_my_vineyard_access", { p_vineyard_id: vineyardId }),
  ]);
  if (tripResult.error || memberResult.error || accessResult.error) throw new Error("Could not verify current Trip status and vineyard permissions.");
  const trip = tripResult.data as Trip | null;
  const member = memberResult.data;
  const access = Array.isArray(accessResult.data) ? accessResult.data[0] : accessResult.data;
  const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
  if (!trip || !same(trip.id, tripId) || !same(trip.vineyard_id, vineyardId)
    || !member || !same(member.vineyard_id, vineyardId) || !same(member.user_id, userId)
    || typeof member.role !== "string" || !access || !same(access.vineyard_id, vineyardId)
    || access.membership_role !== member.role || typeof access.can_enter_vineyard !== "boolean") {
    throw new Error("Trip status or vineyard permissions could not be confirmed.");
  }
  return { trip, role: member.role, canWrite: access.can_enter_vineyard === true && access.can_write !== false };
}