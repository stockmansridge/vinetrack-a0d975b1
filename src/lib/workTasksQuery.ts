// READ-ONLY query helper for work_tasks. No writes.
//
// Schema (docs/supabase-schema.md §3.13):
//   work_tasks: paddock_id, paddock_name, date, task_type, duration_hours,
//               resources jsonb, notes, is_archived, archived_at, archived_by,
//               is_finalized, finalized_at, finalized_by, plus standard sync
//               columns (id, vineyard_id, created_at, updated_at, deleted_at,
//               created_by, updated_by, client_updated_at, sync_version).
//
//   No status / priority / due_date / assigned_user columns exist on this table.
//
// Safe fetch: vineyard_id primary, paddock_id fallback merge (mirrors Pins).
import { supabase } from "@/integrations/ios-supabase/client";

export interface WorkTask {
  id: string;
  vineyard_id: string;
  paddock_id?: string | null;
  paddock_name?: string | null;
  date?: string | null;
  task_type?: string | null;
  duration_hours?: number | null;
  resources?: any;
  notes?: string | null;
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
    } else if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.warn("[work_tasks] paddock_id fallback query failed:", byPaddock.error.message);
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
    missingDate: tasks.filter((t) => !t.date).length,
    missingTaskType: tasks.filter((t) => !t.task_type).length,
  };
}
