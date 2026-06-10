// Read-only query helper + types for `work_task_machine_lines`
// (added by Rork SQL 103).
//
// Stage 2A scope: data layer only. No writes, no UI editor. A machine line
// represents a manually-entered machine usage record attached to a work
// task — distinct from GPS-tracked trips (which now link back via
// trips.work_task_id, SQL 102).
//
// Equipment identity follows the same migration-safe pattern used by
// maintenance_logs and spray_records: a polymorphic source key plus a
// nullable ref id, with a text snapshot fallback for free-text or
// unresolved references.
import { supabase } from "@/integrations/ios-supabase/client";

export type WorkTaskMachineEquipmentSource =
  | "vineyard_machine"
  | "tractor"
  | "spray_equipment"
  | "equipment_item"
  | "free_text";

export interface WorkTaskMachineLine {
  id: string;
  vineyard_id: string;
  work_task_id: string;
  work_date?: string | null;

  // Equipment identity (migration-safe).
  equipment_source?: WorkTaskMachineEquipmentSource | string | null;
  equipment_ref_id?: string | null;
  equipment_name_snapshot?: string | null;

  // Operator (optional; either user FK or category bucket).
  operator_user_id?: string | null;
  operator_category_id?: string | null;

  // Time / engine hours.
  duration_hours?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  start_engine_hours?: number | null;
  end_engine_hours?: number | null;
  engine_hours_used?: number | null;

  // Fuel + cost.
  fuel_litres?: number | null;
  fuel_cost?: number | null;
  hourly_machine_rate?: number | null;
  total_machine_cost?: number | null;

  // Provenance + notes.
  entry_source?: string | null;
  notes?: string | null;

  // Sync columns.
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
}

/**
 * Fetch non-deleted machine lines for a vineyard. The table may be empty
 * (Stage 2A — Rork has only just shipped SQL 103), and callers must treat
 * an empty array as the normal case.
 */
export async function fetchWorkTaskMachineLinesForVineyard(
  vineyardId: string,
): Promise<WorkTaskMachineLine[]> {
  const { data, error } = await supabase
    .from("work_task_machine_lines")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) {
    // If the table isn't visible yet (e.g. PostgREST cache), degrade to empty
    // rather than breaking the work tasks page.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[work_task_machine_lines] fetch failed:", error.message);
    }
    return [];
  }
  return (data ?? []) as WorkTaskMachineLine[];
}

// ------------------- Equipment name resolver -------------------

export interface MachineLineEquipmentLookups {
  machines?: ReadonlyArray<{ id: string; name?: string | null }> | null;
  tractors?: ReadonlyArray<{ id: string; name?: string | null }> | null;
  sprayEquipment?: ReadonlyArray<{ id: string; name?: string | null }> | null;
  equipmentItems?: ReadonlyArray<{ id: string; name?: string | null }> | null;
}

function findName(
  rows: ReadonlyArray<{ id: string; name?: string | null }> | null | undefined,
  id: string | null | undefined,
): string | null {
  if (!id || !rows) return null;
  const hit = rows.find((r) => r.id === id);
  const n = hit?.name?.trim();
  return n ? n : null;
}

/**
 * Resolve the display name for a machine line, mirroring the maintenance_logs
 * resolver pattern. Priority:
 *   equipment_source = vineyard_machine → vineyard_machines.name
 *   equipment_source = tractor          → tractors.name
 *   equipment_source = spray_equipment  → spray_equipment.name
 *   equipment_source = equipment_item   → equipment_items.name
 *   anything else / unresolved          → equipment_name_snapshot
 */
export function resolveMachineLineEquipmentName(
  line: Pick<
    WorkTaskMachineLine,
    "equipment_source" | "equipment_ref_id" | "equipment_name_snapshot"
  >,
  lookups: MachineLineEquipmentLookups,
): string | null {
  const src = (line.equipment_source ?? "").toString();
  const refId = line.equipment_ref_id ?? null;
  let resolved: string | null = null;
  switch (src) {
    case "vineyard_machine":
      resolved = findName(lookups.machines, refId);
      break;
    case "tractor":
      resolved = findName(lookups.tractors, refId);
      break;
    case "spray_equipment":
      resolved = findName(lookups.sprayEquipment, refId);
      break;
    case "equipment_item":
      resolved = findName(lookups.equipmentItems, refId);
      break;
    default:
      resolved = null;
  }
  if (resolved) return resolved;
  const snap = line.equipment_name_snapshot?.trim();
  return snap ? snap : null;
}
