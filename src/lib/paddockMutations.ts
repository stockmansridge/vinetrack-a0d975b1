// Paddock update + archive/delete helpers.
//
// Delete/archive/restore and reference counts must go through the shared
// backend RPCs so Lovable and iOS follow the same permissions and rules.

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
      "This block has linked records and cannot be permanently deleted. Archive it instead."
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
