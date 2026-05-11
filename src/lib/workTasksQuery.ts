// Query + write helpers for work_tasks and work_task_labour_lines.
//
// The portal authenticates against the iOS Supabase project, so writes go
// through the same client used elsewhere. RLS on the iOS project is the
// source of truth for permissions.
import { supabase } from "@/integrations/ios-supabase/client";

export interface WorkTask {
  id: string;
  vineyard_id: string;
  paddock_id?: string | null;
  paddock_name?: string | null;
  date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  area_ha?: number | null;
  description?: string | null;
  status?: string | null;
  task_type?: string | null;
  duration_hours?: number | null;
  resources?: any;
  notes?: string | null;
  is_archived?: boolean | null;
  is_finalized?: boolean | null;
  finalized_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface WorkTaskLabourLine {
  id: string;
  work_task_id: string;
  vineyard_id: string;
  work_date?: string | null;
  operator_category_id?: string | null;
  worker_type?: string | null;
  worker_count?: number | null;
  hours_per_worker?: number | null;
  hourly_rate?: number | null;
  total_hours?: number | null;
  total_cost?: number | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface WorkTasksQueryResult {
  tasks: WorkTask[];
  source: "vineyard_id" | "paddock_id" | "merged" | "empty";
  vineyardCount: number;
  paddockFallbackCount: number;
  archivedExcluded: number;
  missingDate: number;
  missingTaskType: number;
}

export async function fetchWorkTasksForVineyard(
  vineyardId: string,
  paddockIds: string[],
): Promise<WorkTasksQueryResult> {
  const byVineyard = await supabase
    .from("work_tasks")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (byVineyard.error) throw byVineyard.error;

  const primary = (byVineyard.data ?? []) as WorkTask[];
  const ids = new Set(primary.map((t) => t.id));

  let merged: WorkTask[] = primary;
  let paddockFallbackCount = 0;
  let source: WorkTasksQueryResult["source"] = primary.length ? "vineyard_id" : "empty";

  if (paddockIds.length) {
    const byPaddock = await supabase
      .from("work_tasks")
      .select("*")
      .in("paddock_id", paddockIds)
      .is("deleted_at", null);
    if (!byPaddock.error) {
      const extras = ((byPaddock.data ?? []) as WorkTask[]).filter((t) => !ids.has(t.id));
      paddockFallbackCount = extras.length;
      if (extras.length) {
        merged = primary.concat(extras);
        source = primary.length ? "merged" : "paddock_id";
      }
    }
  }

  const beforeArchive = merged.length;
  const tasks = merged.filter((t) => !t.is_archived);

  return {
    tasks,
    source,
    vineyardCount: primary.length,
    paddockFallbackCount,
    archivedExcluded: beforeArchive - tasks.length,
    missingDate: tasks.filter((t) => !t.date && !t.start_date).length,
    missingTaskType: tasks.filter((t) => !t.task_type).length,
  };
}

export async function fetchLabourLinesForVineyard(
  vineyardId: string,
): Promise<WorkTaskLabourLine[]> {
  const { data, error } = await supabase
    .from("work_task_labour_lines")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as WorkTaskLabourLine[];
}

// ------------------- Writes -------------------

const nowIso = () => new Date().toISOString();

export interface UpsertWorkTaskInput {
  id?: string;
  vineyard_id: string;
  paddock_id?: string | null;
  paddock_name?: string | null;
  task_type?: string | null;
  status?: string | null;
  description?: string | null;
  notes?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  date?: string | null;
  area_ha?: number | null;
  duration_hours?: number | null;
  is_finalized?: boolean | null;
  user_id?: string | null;
  current_sync_version?: number | null;
}

export async function createWorkTask(input: UpsertWorkTaskInput): Promise<WorkTask> {
  // Keep `date` populated as fallback for older iOS clients.
  const fallbackDate = input.date ?? input.start_date ?? null;
  const payload: any = {
    vineyard_id: input.vineyard_id,
    paddock_id: input.paddock_id ?? null,
    paddock_name: input.paddock_name ?? null,
    task_type: input.task_type ?? null,
    status: input.status ?? null,
    description: input.description ?? "",
    notes: input.notes ?? "",
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    date: fallbackDate,
    area_ha: input.area_ha ?? null,
    duration_hours: input.duration_hours ?? 0,
    is_finalized: input.is_finalized ?? false,
    is_archived: false,
    deleted_at: null,
    client_updated_at: nowIso(),
    sync_version: 1,
    created_by: input.user_id ?? null,
    updated_by: input.user_id ?? null,
  };
  const { data, error } = await supabase
    .from("work_tasks")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkTask;
}

export async function updateWorkTask(input: UpsertWorkTaskInput): Promise<WorkTask> {
  if (!input.id) throw new Error("updateWorkTask requires an id");
  const fallbackDate = input.date ?? input.start_date ?? null;
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const payload: any = {
    paddock_id: input.paddock_id ?? null,
    paddock_name: input.paddock_name ?? null,
    task_type: input.task_type ?? null,
    status: input.status ?? null,
    description: input.description ?? "",
    notes: input.notes ?? "",
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    date: fallbackDate,
    area_ha: input.area_ha ?? null,
    duration_hours: input.duration_hours ?? 0,
    is_finalized: input.is_finalized ?? false,
    client_updated_at: nowIso(),
    sync_version: nextVersion,
    updated_by: input.user_id ?? null,
  };
  const { data, error } = await supabase
    .from("work_tasks")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkTask;
}

export interface UpsertLabourLineInput {
  id?: string;
  work_task_id: string;
  vineyard_id: string;
  work_date?: string | null;
  operator_category_id?: string | null;
  worker_type?: string | null;
  worker_count?: number | null;
  hours_per_worker?: number | null;
  hourly_rate?: number | null;
  notes?: string | null;
  user_id?: string | null;
  current_sync_version?: number | null;
}

const computeLineTotals = (i: UpsertLabourLineInput) => {
  const wc = Number(i.worker_count ?? 0) || 0;
  const hpw = Number(i.hours_per_worker ?? 0) || 0;
  const rate = i.hourly_rate == null ? null : Number(i.hourly_rate);
  const total_hours = wc * hpw;
  const total_cost = rate == null ? null : total_hours * rate;
  return { total_hours, total_cost };
};

export async function createLabourLine(input: UpsertLabourLineInput): Promise<WorkTaskLabourLine> {
  const { total_hours, total_cost } = computeLineTotals(input);
  const payload: any = {
    work_task_id: input.work_task_id,
    vineyard_id: input.vineyard_id,
    work_date: input.work_date ?? null,
    operator_category_id: input.operator_category_id ?? null,
    worker_type: input.worker_type ?? null,
    worker_count: input.worker_count ?? null,
    hours_per_worker: input.hours_per_worker ?? null,
    hourly_rate: input.hourly_rate ?? null,
    total_hours,
    total_cost,
    notes: input.notes ?? "",
    deleted_at: null,
    client_updated_at: nowIso(),
    sync_version: 1,
    created_by: input.user_id ?? null,
    updated_by: input.user_id ?? null,
  };
  const { data, error } = await supabase
    .from("work_task_labour_lines")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkTaskLabourLine;
}

export async function updateLabourLine(input: UpsertLabourLineInput): Promise<WorkTaskLabourLine> {
  if (!input.id) throw new Error("updateLabourLine requires an id");
  const { total_hours, total_cost } = computeLineTotals(input);
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const payload: any = {
    work_date: input.work_date ?? null,
    operator_category_id: input.operator_category_id ?? null,
    worker_type: input.worker_type ?? null,
    worker_count: input.worker_count ?? null,
    hours_per_worker: input.hours_per_worker ?? null,
    hourly_rate: input.hourly_rate ?? null,
    total_hours,
    total_cost,
    notes: input.notes ?? "",
    client_updated_at: nowIso(),
    sync_version: nextVersion,
    updated_by: input.user_id ?? null,
  };
  const { data, error } = await supabase
    .from("work_task_labour_lines")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkTaskLabourLine;
}

// ------------------- Work task paddocks (join table) -------------------

export interface WorkTaskPaddock {
  id: string;
  work_task_id: string;
  vineyard_id: string;
  paddock_id: string;
  area_ha?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export async function fetchWorkTaskPaddocksForVineyard(
  vineyardId: string,
): Promise<WorkTaskPaddock[]> {
  const { data, error } = await supabase
    .from("work_task_paddocks")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as WorkTaskPaddock[];
}

export interface PaddockSelection {
  paddock_id: string;
  area_ha: number | null;
}

/**
 * Reconciles the work_task_paddocks rows for a task to match the desired
 * selection. New paddocks are inserted, removed paddocks are soft-deleted via
 * RPC (falls back to UPDATE), and existing rows have their area refreshed.
 */
export async function syncWorkTaskPaddocks(params: {
  workTaskId: string;
  vineyardId: string;
  selections: PaddockSelection[];
  existing: WorkTaskPaddock[];
  userId?: string | null;
}): Promise<void> {
  const { workTaskId, vineyardId, selections, existing, userId } = params;
  const desired = new Map(selections.map((s) => [s.paddock_id, s]));
  const existingByPaddock = new Map(existing.map((r) => [r.paddock_id, r]));

  // Remove paddocks no longer selected (soft delete).
  for (const row of existing) {
    if (!desired.has(row.paddock_id)) {
      const rpc = await supabase.rpc("soft_delete_work_task_paddock", { p_id: row.id });
      if (rpc.error) {
        const { error } = await supabase
          .from("work_task_paddocks")
          .update({
            deleted_at: nowIso(),
            client_updated_at: nowIso(),
            sync_version: (row.sync_version ?? 0) + 1,
            updated_by: userId ?? null,
          })
          .eq("id", row.id);
        if (error) throw error;
      }
    }
  }

  // Insert new + update existing.
  for (const sel of selections) {
    const existingRow = existingByPaddock.get(sel.paddock_id);
    if (existingRow) {
      // Refresh area snapshot if changed.
      if ((existingRow.area_ha ?? null) !== (sel.area_ha ?? null)) {
        const { error } = await supabase
          .from("work_task_paddocks")
          .update({
            area_ha: sel.area_ha,
            client_updated_at: nowIso(),
            sync_version: (existingRow.sync_version ?? 0) + 1,
            updated_by: userId ?? null,
          })
          .eq("id", existingRow.id);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from("work_task_paddocks").insert({
        work_task_id: workTaskId,
        vineyard_id: vineyardId,
        paddock_id: sel.paddock_id,
        area_ha: sel.area_ha,
        deleted_at: null,
        client_updated_at: nowIso(),
        sync_version: 1,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      });
      if (error) throw error;
    }
  }
}

// ------------------- Labour lines -------------------

export async function softDeleteLabourLine(id: string, userId?: string | null): Promise<void> {
  // Prefer the dedicated RPC; fall back to a soft-delete UPDATE if it isn't deployed.
  const rpc = await supabase.rpc("soft_delete_work_task_labour_line", { p_id: id });
  if (!rpc.error) return;
  const { error } = await supabase
    .from("work_task_labour_lines")
    .update({
      deleted_at: nowIso(),
      client_updated_at: nowIso(),
      updated_by: userId ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}
