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
  const errors: string[] = [];
  const safe = async (label: string, p: Promise<number>) => {
    try { return await p; } catch (e: any) { errors.push(`${label}: ${e?.message ?? e}`); return 0; }
  };

  const [
    trips, pins, sprayRecords, sprayJobs, workTasks,
    damageRecords, yieldRecords, yieldSessions,
  ] = await Promise.all([
    safe("trips", countTable("trips", "paddock_id", paddockId)),
    safe("pins", countTable("pins", "paddock_id", paddockId)),
    safe("spray_records", countTable("spray_records", "paddock_id", paddockId)),
    safe("spray_jobs", countTable("spray_job_paddocks", "paddock_id", paddockId)),
    safe("work_tasks", countTable("work_task_paddocks", "paddock_id", paddockId)),
    safe("damage_records", countTable("damage_records", "paddock_id", paddockId)),
    safe("yield_records", countTable("historical_yield_records", "paddock_id", paddockId)),
    safe("yield_sessions", countTable("yield_estimation_sessions", "paddock_id", paddockId)),
  ]);

  const total = trips + pins + sprayRecords + sprayJobs + workTasks +
    damageRecords + yieldRecords + yieldSessions;

  return { trips, pins, sprayRecords, sprayJobs, workTasks, damageRecords, yieldRecords, yieldSessions, total, errors };
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
  // Safety: refuse to hard-delete if any linked records exist. Callers
  // should already block via UI, but enforce here as defence in depth.
  const counts = await fetchLinkedRecordCounts(paddockId);
  if (counts.total > 0) {
    throw new Error(
      "This paddock has linked records and cannot be permanently deleted. Archive it instead."
    );
  }
  const { error } = await (supabase as any)
    .from("paddocks")
    .delete()
    .eq("id", paddockId);
  if (error) throw error;
}

// Archive = soft-delete (deleted_at). Hides from active selectors but
// historical records (trips, pins, yield, etc.) keep their paddock_id
// reference so reports continue to render correctly. iOS reads the same
// soft-delete flag.
export async function archivePaddock(paddockId: string) {
  const { error } = await (supabase as any)
    .from("paddocks")
    .update({
      deleted_at: new Date().toISOString(),
      client_updated_at: new Date().toISOString(),
    })
    .eq("id", paddockId);
  if (error) throw error;
}

export async function restorePaddock(paddockId: string) {
  const { error } = await (supabase as any)
    .from("paddocks")
    .update({
      deleted_at: null,
      client_updated_at: new Date().toISOString(),
    })
    .eq("id", paddockId);
  if (error) throw error;
}
