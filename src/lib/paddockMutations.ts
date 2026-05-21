// Paddock update + hard delete helpers.
//
// Hard delete is owner/manager only and is intended for paddocks created
// in error or for test purposes. Before deleting we attempt to count any
// rows linked to the paddock. If linked records exist, the caller should
// surface a strong warning (or block) rather than silently cascade.
//
// Tables checked (best-effort — non-existing tables are ignored):
//   trips, pins, spray_records, spray_job_paddocks, work_task_paddocks,
//   damage_records, historical_yield_records, yield_estimation_sessions.
// Soil profiles are stored via RPC (paddock_soil_profiles) and are
// considered setup, not historical data.

import { supabase } from "@/integrations/ios-supabase/client";

export interface LinkedCounts {
  trips: number;
  pins: number;
  sprayRecords: number;
  sprayJobs: number;
  workTasks: number;
  damageRecords: number;
  yieldRecords: number;
  yieldSessions: number;
  total: number;
  errors: string[];
}

async function countTable(table: string, column: string, paddockId: string): Promise<number> {
  try {
    const { count, error } = await (supabase as any)
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, paddockId);
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchLinkedRecordCounts(paddockId: string): Promise<LinkedCounts> {
  const rpc = await (supabase as any).rpc("paddock_reference_counts", {
    p_paddock_id: paddockId,
  });

  if (rpc?.error) {
    throw rpc.error;
  }

  const row = Array.isArray(rpc?.data) ? rpc.data[0] : rpc?.data;
  const trips = Number(row?.trips ?? 0);
  const pins = Number(row?.pins ?? 0);
  const sprayRecords = Number(row?.spray_records ?? row?.sprayRecords ?? 0);
  const sprayJobs = Number(row?.spray_jobs ?? row?.sprayJobs ?? 0);
  const workTasks = Number(row?.work_tasks ?? row?.workTasks ?? 0);
  const damageRecords = Number(row?.damage_records ?? row?.damageRecords ?? 0);
  const yieldRecords = Number(row?.yield_records ?? row?.yieldRecords ?? 0);
  const yieldSessions = Number(row?.yield_sessions ?? row?.yieldSessions ?? 0);
  const total = Number(
    row?.total ??
    trips + pins + sprayRecords + sprayJobs + workTasks + damageRecords + yieldRecords + yieldSessions,
  );

  return {
    trips,
    pins,
    sprayRecords,
    sprayJobs,
    workTasks,
    damageRecords,
    yieldRecords,
    yieldSessions,
    total,
    errors: [],
  };
}

export async function updatePaddock(paddockId: string, patch: Record<string, any>) {
  const { data, error } = await (supabase as any)
    .from("paddocks")
    .update({ ...patch, client_updated_at: new Date().toISOString() })
    .eq("id", paddockId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function hardDeletePaddock(paddockId: string) {
  const counts = await fetchLinkedRecordCounts(paddockId);
  if (counts.total > 0) {
    throw new Error(
      "This paddock has linked records and cannot be permanently deleted. Archive it instead."
    );
  }

  const rpc = await (supabase as any).rpc("hard_delete_paddock", {
    p_paddock_id: paddockId,
  });
  if (rpc?.error) throw rpc.error;
}

// Archive = soft-delete (deleted_at). Hides from active selectors but
// historical records (trips, pins, yield, etc.) keep their paddock_id
// reference so reports continue to render correctly. iOS reads the same
// soft-delete flag.
export async function archivePaddock(paddockId: string) {
  const rpc = await (supabase as any).rpc("soft_delete_paddock", {
    p_paddock_id: paddockId,
  });
  if (rpc?.error) throw rpc.error;
}

export async function restorePaddock(paddockId: string) {
  const rpc = await (supabase as any).rpc("restore_paddock", {
    p_paddock_id: paddockId,
  });
  if (rpc?.error) throw rpc.error;
}
