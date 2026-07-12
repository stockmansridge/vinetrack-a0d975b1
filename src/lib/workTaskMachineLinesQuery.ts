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
  worker_type_id?: string | null;

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

// ------------------- Writes -------------------

const nowIso = () => new Date().toISOString();

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface WorkTaskMachineLineWriteInput {
  vineyard_id: string;
  work_task_id: string;
  work_date: string;
  equipment_source: WorkTaskMachineEquipmentSource;
  equipment_ref_id?: string | null;
  equipment_name_snapshot: string;
  operator_user_id?: string | null;
  worker_type_id?: string | null;
  duration_hours?: number | null;
  engine_hours_used?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  start_engine_hours?: number | null;
  end_engine_hours?: number | null;
  fuel_litres?: number | null;
  fuel_cost?: number | null;
  hourly_machine_rate?: number | null;
  total_machine_cost?: number | null;
  entry_source?: string | null;
  notes?: string | null;
  user_id?: string | null;
}

const toPayload = (i: WorkTaskMachineLineWriteInput) => ({
  vineyard_id: i.vineyard_id,
  work_task_id: i.work_task_id,
  work_date: i.work_date,
  equipment_source: i.equipment_source,
  equipment_ref_id: i.equipment_ref_id ?? null,
  equipment_name_snapshot: i.equipment_name_snapshot,
  operator_user_id: i.operator_user_id ?? null,
  worker_type_id: i.worker_type_id ?? null,
  duration_hours: num(i.duration_hours),
  engine_hours_used: num(i.engine_hours_used),
  start_time: i.start_time ?? null,
  end_time: i.end_time ?? null,
  start_engine_hours: num(i.start_engine_hours),
  end_engine_hours: num(i.end_engine_hours),
  fuel_litres: num(i.fuel_litres),
  fuel_cost: num(i.fuel_cost),
  hourly_machine_rate: num(i.hourly_machine_rate),
  total_machine_cost: num(i.total_machine_cost),
  entry_source: i.entry_source ?? "manual",
  notes: i.notes ?? null,
});

export async function createWorkTaskMachineLine(
  input: WorkTaskMachineLineWriteInput,
): Promise<WorkTaskMachineLine> {
  const ts = nowIso();
  const payload = {
    ...toPayload(input),
    deleted_at: null,
    client_updated_at: ts,
    sync_version: 1,
    created_by: input.user_id ?? null,
    updated_by: input.user_id ?? null,
  } as Record<string, unknown>;
  const { data, error } = await supabase
    .from("work_task_machine_lines")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkTaskMachineLine;
}

export interface UpdateWorkTaskMachineLineInput extends WorkTaskMachineLineWriteInput {
  id: string;
  current_sync_version?: number | null;
}

export async function updateWorkTaskMachineLine(
  input: UpdateWorkTaskMachineLineInput,
): Promise<WorkTaskMachineLine> {
  const ts = nowIso();
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const payload = {
    ...toPayload(input),
    client_updated_at: ts,
    sync_version: nextVersion,
    updated_by: input.user_id ?? null,
  } as Record<string, unknown>;
  const { data, error } = await supabase
    .from("work_task_machine_lines")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkTaskMachineLine;
}

/**
 * Soft-delete a machine line. Tries the dedicated RPC first (mirroring the
 * labour-line pattern); if the RPC is not deployed, falls back to a direct
 * UPDATE of deleted_at. RLS on the iOS project is the authority for whether
 * the calling user is permitted to do this.
 */
export async function softDeleteWorkTaskMachineLine(
  id: string,
  userId?: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const rpc = await supabase.rpc("soft_delete_work_task_machine_line", { p_id: id });
  if (!rpc.error) return;
  const ts = nowIso();
  const nextVersion = (currentSyncVersion ?? 0) + 1;
  const { error } = await supabase
    .from("work_task_machine_lines")
    .update({
      deleted_at: ts,
      client_updated_at: ts,
      sync_version: nextVersion,
      updated_by: userId ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}

export function describeMachineLineWriteError(err: unknown): string {
  const e = err as { message?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/row-level security|permission denied|RLS|42501/i.test(msg)) {
    return "You don't have permission to make this change. Only owners, managers, or supervisors can edit machine work.";
  }
  return msg || "Something went wrong. Please try again.";
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
