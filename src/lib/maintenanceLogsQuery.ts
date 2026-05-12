// READ-ONLY query helper for maintenance_logs. No writes.
//
// Schema (docs/supabase-schema.md §3.13):
//   maintenance_logs: item_name, hours, work_completed, parts_used,
//     parts_cost, labour_cost, date, photo_path
//     (storage bucket `vineyard-maintenance-photos`),
//     plus archive/finalize columns (is_archived, archived_at, archived_by,
//     is_finalized, finalized_at, finalized_by) and standard sync columns
//     (id, vineyard_id, created_at, updated_at, deleted_at, created_by,
//      updated_by, client_updated_at, sync_version).
//
//   No tractor_id / spray_equipment_id / paddock_id column — equipment
//   association is a free-text `item_name` only. Therefore the only safe
//   relationship is `vineyard_id` (no equipment-id fallback possible).
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
