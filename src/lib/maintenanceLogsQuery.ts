// Query + write helpers for `maintenance_logs` on the iOS Supabase project.
//
// Confirmed columns (probed against the iOS Supabase REST endpoint):
//   id, vineyard_id, item_name, hours, machine_hours, work_completed,
//   parts_used, parts_cost, labour_cost, date, photo_path,
//   is_archived, archived_at, archived_by,
//   is_finalized, finalized_at, finalized_by,
//   created_at, updated_at, deleted_at,
//   created_by, updated_by, client_updated_at, sync_version
//
// Not present yet: maintenance_type / task / category / status / notes /
// operator_id. These are intentionally omitted from the write form per the
// "cost fields only if already in schema; otherwise leave for later" rule.
//
// No soft-delete RPC for maintenance_logs is deployed on the iOS project,
// so soft-delete writes `deleted_at` directly.
import { supabase } from "@/integrations/ios-supabase/client";

export interface MaintenanceLog {
  id: string;
  vineyard_id: string;
  item_name?: string | null;
  hours?: number | null;
  machine_hours?: number | null;
  work_completed?: string | null;
  parts_used?: string | null;
  parts_cost?: number | null;
  labour_cost?: number | null;
  date?: string | null;
  photo_path?: string | null;
  is_archived?: boolean | null;
  archived_at?: string | null;
  archived_by?: string | null;
  is_finalized?: boolean | null;
  finalized_at?: string | null;
  finalized_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
}

export interface MaintenanceLogsQueryResult {
  logs: MaintenanceLog[];
  source: "vineyard_id" | "empty";
  vineyardCount: number;
  archivedExcluded: number;
  missingDate: number;
  missingItemName: number;
}

export async function fetchMaintenanceLogsForVineyard(
  vineyardId: string,
): Promise<MaintenanceLogsQueryResult> {
  const res = await supabase
    .from("maintenance_logs")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) throw res.error;

  const all = (res.data ?? []) as MaintenanceLog[];
  const logs = all.filter((l) => !l.is_archived);

  return {
    logs,
    source: all.length ? "vineyard_id" : "empty",
    vineyardCount: all.length,
    archivedExcluded: all.length - logs.length,
    missingDate: logs.filter((l) => !l.date).length,
    missingItemName: logs.filter((l) => !l.item_name).length,
  };
}

const nowIso = () => new Date().toISOString();

export interface MaintenanceLogWriteInput {
  vineyard_id: string;
  item_name: string;
  date: string;
  hours?: number | null;
  machine_hours?: number | null;
  work_completed?: string | null;
  parts_used?: string | null;
  parts_cost?: number | null;
  labour_cost?: number | null;
  is_finalized?: boolean | null;
  user_id: string | null;
}

export async function createMaintenanceLog(
  input: MaintenanceLogWriteInput,
): Promise<MaintenanceLog> {
  const ts = nowIso();
  const payload: Record<string, unknown> = {
    vineyard_id: input.vineyard_id,
    item_name: input.item_name,
    date: input.date,
    hours: input.hours ?? null,
    machine_hours: input.machine_hours ?? null,
    work_completed: input.work_completed ?? null,
    parts_used: input.parts_used ?? null,
    parts_cost: input.parts_cost ?? null,
    labour_cost: input.labour_cost ?? null,
    is_finalized: !!input.is_finalized,
    finalized_at: input.is_finalized ? ts : null,
    finalized_by: input.is_finalized ? input.user_id : null,
    is_archived: false,
    created_by: input.user_id,
    updated_by: input.user_id,
    client_updated_at: ts,
    sync_version: 1,
    deleted_at: null,
  };
  const { data, error } = await supabase
    .from("maintenance_logs")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as MaintenanceLog;
}

export interface UpdateMaintenanceLogInput extends Partial<MaintenanceLogWriteInput> {
  id: string;
  user_id: string | null;
  current_sync_version?: number | null;
  was_finalized?: boolean | null;
}

export async function updateMaintenanceLog(
  input: UpdateMaintenanceLogInput,
): Promise<MaintenanceLog> {
  const ts = nowIso();
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const patch: Record<string, unknown> = {
    updated_by: input.user_id,
    client_updated_at: ts,
    sync_version: nextVersion,
  };
  if (input.item_name !== undefined) patch.item_name = input.item_name;
  if (input.date !== undefined) patch.date = input.date;
  if (input.hours !== undefined) patch.hours = input.hours;
  if (input.machine_hours !== undefined) patch.machine_hours = input.machine_hours;
  if (input.work_completed !== undefined) patch.work_completed = input.work_completed;
  if (input.parts_used !== undefined) patch.parts_used = input.parts_used;
  if (input.parts_cost !== undefined) patch.parts_cost = input.parts_cost;
  if (input.labour_cost !== undefined) patch.labour_cost = input.labour_cost;
  if (input.is_finalized !== undefined) {
    patch.is_finalized = !!input.is_finalized;
    if (input.is_finalized && !input.was_finalized) {
      patch.finalized_at = ts;
      patch.finalized_by = input.user_id;
    } else if (!input.is_finalized && input.was_finalized) {
      patch.finalized_at = null;
      patch.finalized_by = null;
    }
  }
  const { data, error } = await supabase
    .from("maintenance_logs")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (error) throw error;
  return data as MaintenanceLog;
}

export async function softDeleteMaintenanceLog(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const ts = nowIso();
  const nextVersion = (currentSyncVersion ?? 0) + 1;
  const { error } = await supabase
    .from("maintenance_logs")
    .update({
      deleted_at: ts,
      updated_by: userId,
      client_updated_at: ts,
      sync_version: nextVersion,
    })
    .eq("id", id);
  if (error) throw error;
}

// Friendly error message for RLS-style failures.
export function describeWriteError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/row-level security|permission denied|RLS|42501/i.test(msg)) {
    return "You don't have permission to make this change. Only owners, managers, or supervisors can edit maintenance logs.";
  }
  return msg || "Something went wrong. Please try again.";
}
