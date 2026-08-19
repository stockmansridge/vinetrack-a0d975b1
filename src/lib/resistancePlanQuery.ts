// Stage 4 — reads and writes for `public.resistance_plans` (SQL 196).
//
// Every mutation goes through the shared SQL 198 revision-write helper
// (Stage 2A): a stale save raises an explicit revision conflict and NEVER
// overwrites the newer server row.
//
// Deletion is SOFT and server-owned: `soft_delete_resistance_plan(p_id)` /
// `restore_resistance_plan(p_id)`. The portal does not hard-delete plans,
// because mobile expects soft-deleted rows to remain syncable.
import { supabase } from "@/integrations/ios-supabase/client";
import { revisionWrite } from "@/lib/revisionWrite";
import {
  newPositionId,
  planFromRow,
  planWritePayload,
  type ResistancePlan,
} from "@/lib/resistancePlanContract";

const COLUMNS = "*";

export async function fetchResistancePlans(vineyardId: string): Promise<ResistancePlan[]> {
  const { data, error } = await supabase
    .from("resistance_plans")
    .select(COLUMNS)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => planFromRow(r));
}

/** Open by STABLE plan ID. Never by season + disease. */
export async function fetchResistancePlan(planId: string): Promise<ResistancePlan | null> {
  const { data, error } = await supabase
    .from("resistance_plans")
    .select(COLUMNS)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  return data ? planFromRow(data as any) : null;
}

export async function createResistancePlan(plan: ResistancePlan): Promise<ResistancePlan> {
  const row = await revisionWrite<Record<string, any>>({
    payload: planWritePayload(plan),
    baseRevision: null,
    run: async (payload) => {
      const { data, error } = await supabase
        .from("resistance_plans")
        .insert(payload)
        .select(COLUMNS)
        .maybeSingle();
      return { data: data as Record<string, any> | null, error };
    },
  });
  return planFromRow(row);
}

/** Save an existing plan against the revision it was loaded at. */
export async function saveResistancePlan(plan: ResistancePlan): Promise<ResistancePlan> {
  const row = await revisionWrite<Record<string, any>>({
    payload: planWritePayload(plan),
    baseRevision: plan.serverRevision,
    refetch: async () => {
      const latest = await fetchResistancePlan(plan.id);
      return latest as unknown as Record<string, any> | null;
    },
    run: async (payload) => {
      const { data, error } = await supabase
        .from("resistance_plans")
        .update(payload)
        .eq("id", plan.id)
        .select(COLUMNS)
        .maybeSingle();
      return { data: data as Record<string, any> | null, error };
    },
  });
  return planFromRow(row);
}

export async function softDeleteResistancePlan(planId: string): Promise<void> {
  const { error } = await supabase.rpc("soft_delete_resistance_plan", { p_id: planId });
  if (error) throw error;
}

export async function restoreResistancePlan(planId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_resistance_plan", { p_id: planId });
  if (error) throw error;
}

/**
 * A duplicate is a NEW plan: new plan ID (server generated), new stable
 * position IDs, and no revision metadata carried across.
 */
export function duplicatePlanDraft(plan: ResistancePlan): ResistancePlan {
  return {
    ...plan,
    id: "",
    positions: plan.positions.map((p, i) => ({ ...p, id: newPositionId(), sequence: i + 1 })),
    createdAt: null,
    updatedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    clientUpdatedAt: null,
    serverRevision: null,
  };
}
