// READ-ONLY batch loader for spray_tank_actuals (financial overlay only).
// One chunked `trip_id IN (...)` query per batch of trips — never one query
// per trip and never one spray-report RPC per Cost Report row.
// Writes stay exclusively on `correct_spray_tank_actual_v1`.
import { supabase } from "@/integrations/ios-supabase/client";

const CHUNK = 150;

export interface TankActualsBatch {
  byTrip: Map<string, any[]>;
  /** Set when the rows could not be read; callers fall back to planned quantities. */
  error: string | null;
}

export async function fetchTankActualsForTrips(
  tripIds: ReadonlyArray<string>,
  client: any = supabase,
): Promise<TankActualsBatch> {
  const ids = Array.from(new Set(tripIds.filter(Boolean))).sort();
  const byTrip = new Map<string, any[]>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await client.from("spray_tank_actuals").select("*").in("trip_id", chunk);
    if (error) {
      console.warn("[spray_tank_actuals] batch read failed:", error.message);
      return { byTrip: new Map(), error: error.message ?? "read failed" };
    }
    for (const r of (data ?? []) as any[]) {
      if (!r?.trip_id || r.deleted_at) continue;
      const list = byTrip.get(r.trip_id) ?? [];
      list.push(r);
      byTrip.set(r.trip_id, list);
    }
  }
  return { byTrip, error: null };
}

export function tankActualsQueryKey(vineyardId: string | null | undefined, tripIds: ReadonlyArray<string>) {
  return ["spray-tank-actuals-batch", vineyardId ?? null, Array.from(new Set(tripIds)).sort().join(",")] as const;
}

export interface TripSessionInfo {
  id: string;
  vineyard_id: string | null;
  tank_sessions: unknown;
  start_time: string | null;
  created_at: string | null;
}

/** Trip identity + recorded tank sessions for Tank Actual session validation. */
export async function fetchTripSessionsForTrips(
  tripIds: ReadonlyArray<string>,
  client: any = supabase,
): Promise<Map<string, TripSessionInfo>> {
  const ids = Array.from(new Set(tripIds.filter(Boolean))).sort();
  const out = new Map<string, TripSessionInfo>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await client
      .from("trips")
      .select("id, vineyard_id, tank_sessions, start_time, created_at")
      .in("id", chunk);
    if (error) {
      console.warn("[trips] tank session read failed:", error.message);
      return new Map();
    }
    for (const r of (data ?? []) as any[]) if (r?.id) out.set(r.id, r as TripSessionInfo);
  }
  return out;
}
