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
  /** SQL 119: authoritative production/costing vintage for this task,
   *  resolved server-side from the vineyard's season settings. All linked
   *  cost lines (labour, machinery, trips) report under this value —
   *  never derive vintage from year(date) on the client. */
  vintage_year?: number | null;
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
  worker_type_id?: string | null;
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

/**
 * Short human-readable label for a work task, used in trip-facing chips and
 * other read-only references. Falls back gracefully when fields are sparse.
 */
export function workTaskShortLabel(
  task: Pick<WorkTask, "task_type" | "description" | "date" | "start_date"> | null | undefined,
): string {
  if (!task) return "";
  const tt = task.task_type?.trim();
  if (tt) return tt;
  const desc = task.description?.trim();
  if (desc) return desc.length > 40 ? desc.slice(0, 37) + "…" : desc;
  const d = task.start_date ?? task.date;
  if (d) return `Task on ${d}`;
  return "Task";
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
    ...(input.id ? { id: input.id } : {}),
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
  const query = input.id
    ? supabase.from("work_tasks").upsert(payload, { onConflict: "id" })
    : supabase.from("work_tasks").insert(payload);
  const { data, error } = await query.select("*").single();
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
  worker_type_id?: string | null;
  worker_type?: string | null;
  worker_count?: number | null;
  hours_per_worker?: number | null;
  hourly_rate?: number | null;
  notes?: string | null;
  user_id?: string | null;
  current_sync_version?: number | null;
}


export async function createLabourLine(input: UpsertLabourLineInput): Promise<WorkTaskLabourLine> {
  // total_hours and total_cost are generated columns on the iOS Supabase
  // project (computed from worker_count * hours_per_worker [* hourly_rate]),
  // so they must not appear in the insert payload.
  const payload: any = {
    ...(input.id ? { id: input.id } : {}),
    work_task_id: input.work_task_id,
    vineyard_id: input.vineyard_id,
    work_date: input.work_date ?? null,
    worker_type_id: input.worker_type_id ?? null,
    worker_type: input.worker_type ?? null,
    worker_count: input.worker_count ?? null,
    hours_per_worker: input.hours_per_worker ?? null,
    hourly_rate: input.hourly_rate ?? null,
    notes: input.notes ?? "",
    deleted_at: null,
    client_updated_at: nowIso(),
    sync_version: 1,
    created_by: input.user_id ?? null,
    updated_by: input.user_id ?? null,
  };
  const query = input.id
    ? supabase.from("work_task_labour_lines").upsert(payload, { onConflict: "id" })
    : supabase.from("work_task_labour_lines").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return data as WorkTaskLabourLine;
}

export async function updateLabourLine(input: UpsertLabourLineInput): Promise<WorkTaskLabourLine> {
  if (!input.id) throw new Error("updateLabourLine requires an id");
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  // total_hours and total_cost are generated columns; do not include them.
  const payload: any = {
    work_date: input.work_date ?? null,
    worker_type_id: input.worker_type_id ?? null,
    worker_type: input.worker_type ?? null,
    worker_count: input.worker_count ?? null,
    hours_per_worker: input.hours_per_worker ?? null,
    hourly_rate: input.hourly_rate ?? null,
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

// ------------------- Hard delete -------------------

export interface HardDeleteWorkTaskResult {
  via: "rpc" | "client_cascade";
  removed: {
    labour_lines: number;
    machine_lines: number;
    paddock_links: number;
    trips_unlinked: number;
  };
}

/**
 * Permanently deletes a work task and every child row that references it
 * (labour lines, machine/equipment + fuel lines, block links), and unlinks
 * any GPS trips that were attached to the task (trips themselves are
 * standalone GPS records and are preserved).
 *
 * Prefers an atomic server-side RPC (`hard_delete_work_task`) when deployed
 * on the iOS Supabase project; otherwise falls back to ordered client-side
 * deletes. RLS on the iOS project is the authority for whether the caller
 * is permitted to perform the delete.
 */
export async function hardDeleteWorkTask(
  workTaskId: string,
): Promise<HardDeleteWorkTaskResult> {
  // Try atomic RPC first.
  const rpc = await (supabase as any).rpc("hard_delete_work_task", {
    p_work_task_id: workTaskId,
  });
  if (!rpc.error) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    // Verify the RPC actually removed the row. Some deployments run the RPC as
    // SECURITY INVOKER, so a caller without delete privileges gets a silent
    // no-op (returns success + zero-filled row) instead of an error.
    await assertWorkTaskGone(workTaskId);
    return {
      via: "rpc",
      removed: {
        labour_lines: Number(row?.labour_lines ?? 0),
        machine_lines: Number(row?.machine_lines ?? 0),
        paddock_links: Number(row?.paddock_links ?? 0),
        trips_unlinked: Number(row?.trips_unlinked ?? 0),
      },
    };
  }

  // Fallback: sequential hard deletes. Children first, then task.
  const counts = { labour_lines: 0, machine_lines: 0, paddock_links: 0, trips_unlinked: 0 };

  const labour = await supabase
    .from("work_task_labour_lines")
    .delete({ count: "exact" })
    .eq("work_task_id", workTaskId);
  if (labour.error) throw labour.error;
  counts.labour_lines = labour.count ?? 0;

  const machine = await supabase
    .from("work_task_machine_lines")
    .delete({ count: "exact" })
    .eq("work_task_id", workTaskId);
  if (machine.error) throw machine.error;
  counts.machine_lines = machine.count ?? 0;

  const padLinks = await supabase
    .from("work_task_paddocks")
    .delete({ count: "exact" })
    .eq("work_task_id", workTaskId);
  if (padLinks.error) throw padLinks.error;
  counts.paddock_links = padLinks.count ?? 0;

  // Unlink any GPS trips that referenced this task. Trips themselves are
  // independent records and must not be deleted.
  const unlink = await supabase
    .from("trips")
    .update({ work_task_id: null, client_updated_at: nowIso() })
    .eq("work_task_id", workTaskId)
    .select("id");
  if (unlink.error) throw unlink.error;
  counts.trips_unlinked = unlink.data?.length ?? 0;

  const task = await supabase
    .from("work_tasks")
    .delete({ count: "exact" })
    .eq("id", workTaskId);
  if (task.error) throw task.error;

  // If the delete affected 0 rows, RLS most likely denied it silently. Verify
  // by re-reading and surface an error instead of a misleading success toast.
  if ((task.count ?? 0) === 0) {
    await assertWorkTaskGone(workTaskId);
  }

  return { via: "client_cascade", removed: counts };
}

async function assertWorkTaskGone(workTaskId: string): Promise<void> {
  const check = await supabase
    .from("work_tasks")
    .select("id,deleted_at")
    .eq("id", workTaskId)
    .maybeSingle();
  if (check.error) throw check.error;
  if (!check.data || check.data.deleted_at) return;

  // Hard delete was blocked by RLS (silent no-op). Fall back to a soft delete
  // so the task disappears from the portal + iOS lists, which all filter on
  // deleted_at IS NULL.
  const soft = await supabase
    .from("work_tasks")
    .update({ deleted_at: nowIso(), client_updated_at: nowIso() })
    .eq("id", workTaskId)
    .select("id");
  if (soft.error) throw soft.error;
  if (!soft.data || soft.data.length === 0) {
    throw new Error(
      "You don't have permission to delete this work task on this vineyard.",
    );
  }
}
