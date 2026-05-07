// READ-ONLY query helper for trips. No writes.
//
// Schema (docs/supabase-schema.md §3.9):
//   trips: paddock_id, paddock_ids jsonb, paddock_name, tracking_pattern,
//     start_time, end_time, is_active, is_paused, total_distance,
//     current_path_distance, current_row_number, next_row_number,
//     sequence_index, row_sequence jsonb, path_points jsonb,
//     completed_paths jsonb, skipped_paths jsonb, pin_ids jsonb,
//     tank_sessions jsonb, active_tank_number, total_tanks,
//     pause_timestamps jsonb, resume_timestamps jsonb, is_filling_tank,
//     filling_tank_number, person_name, plus standard sync columns
//     (id, vineyard_id, created_at, updated_at, deleted_at,
//      created_by, updated_by, client_updated_at, sync_version).
//
//   No tractor_id / spray_equipment_id / operator user FK
//   (person_name is free text). No archive flag (only deleted_at).
import { supabase } from "@/integrations/ios-supabase/client";

export interface Trip {
  id: string;
  vineyard_id: string;
  paddock_id?: string | null;
  paddock_ids?: any;
  paddock_name?: string | null;
  tracking_pattern?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_active?: boolean | null;
  is_paused?: boolean | null;
  total_distance?: number | null;
  current_path_distance?: number | null;
  current_row_number?: number | null;
  next_row_number?: number | null;
  sequence_index?: number | null;
  row_sequence?: any;
  path_points?: any;
  completed_paths?: any;
  skipped_paths?: any;
  pin_ids?: any;
  tank_sessions?: any;
  active_tank_number?: number | null;
  total_tanks?: number | null;
  pause_timestamps?: any;
  resume_timestamps?: any;
  is_filling_tank?: boolean | null;
  filling_tank_number?: number | null;
  person_name?: string | null;
  trip_function?: string | null;
  trip_title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface TripsQueryResult {
  trips: Trip[];
  source: "vineyard_id" | "paddock_id" | "paddock_ids_jsonb" | "merged" | "empty";
  vineyardCount: number;
  paddockFallbackCount: number;
  paddockJsonbFallbackCount: number;
  deletedExcluded: number;
  missingStart: number;
  missingPaddock: number;
}

export async function fetchTripsForVineyard(
  vineyardId: string,
  paddockIds: string[],
): Promise<TripsQueryResult> {
  // 1) Primary: vineyard_id direct match.
  const byVineyard = await supabase
    .from("trips")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (byVineyard.error) throw byVineyard.error;

  const primary = (byVineyard.data ?? []) as Trip[];
  const ids = new Set(primary.map((t) => t.id));
  let merged: Trip[] = primary;
  let paddockFallbackCount = 0;
  let paddockJsonbFallbackCount = 0;
  let source: TripsQueryResult["source"] = primary.length ? "vineyard_id" : "empty";

  if (paddockIds.length) {
    // 2) Fallback: scalar paddock_id in this vineyard's paddocks.
    const byPaddock = await supabase
      .from("trips")
      .select("*")
      .in("paddock_id", paddockIds)
      .is("deleted_at", null);
    if (!byPaddock.error) {
      const extras = ((byPaddock.data ?? []) as Trip[]).filter((t) => !ids.has(t.id));
      paddockFallbackCount = extras.length;
      extras.forEach((t) => ids.add(t.id));
      if (extras.length) {
        merged = merged.concat(extras);
        source = primary.length ? "merged" : "paddock_id";
      }
    } else if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[trips] paddock_id fallback failed:", byPaddock.error.message);
    }

    // 3) Fallback: jsonb paddock_ids array contains any of this vineyard's paddocks.
    // Build OR of cs.[<uuid>] filters (jsonb contains array element).
    const orExpr = paddockIds
      .map((pid) => `paddock_ids.cs.["${pid}"]`)
      .join(",");
    const byJsonb = await supabase
      .from("trips")
      .select("*")
      .or(orExpr)
      .is("deleted_at", null);
    if (!byJsonb.error) {
      const extras = ((byJsonb.data ?? []) as Trip[]).filter((t) => !ids.has(t.id));
      paddockJsonbFallbackCount = extras.length;
      if (extras.length) {
        merged = merged.concat(extras);
        source = merged.length === extras.length ? "paddock_ids_jsonb" : "merged";
      }
    } else if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[trips] paddock_ids jsonb fallback failed:", byJsonb.error.message);
    }
  }

  return {
    trips: merged,
    source,
    vineyardCount: primary.length,
    paddockFallbackCount,
    paddockJsonbFallbackCount,
    deletedExcluded: 0,
    missingStart: merged.filter((t) => !t.start_time).length,
    missingPaddock: merged.filter((t) => !t.paddock_id && !t.paddock_name).length,
  };
}

