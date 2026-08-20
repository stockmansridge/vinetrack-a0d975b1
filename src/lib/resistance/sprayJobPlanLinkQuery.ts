// Stage 5C — SQL 201 helper reads. Kept apart from the pure link module so
// the contract logic stays free of any client dependency.
import { supabase } from "@/integrations/ios-supabase/client";
import {
  normaliseLinkState,
  type PlanLinkState,
  type PositionCoverage,
} from "./sprayJobPlanLink";

const uniqStrings = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const item of list) {
    const str = typeof item === "string" ? item : item == null ? "" : String(item);
    if (str && !out.includes(str)) out.push(str);
  }
  return out;
};

/** SQL 201 helper `spray_job_resistance_link_state(p_job_id uuid)`. */
export async function fetchSprayJobLinkState(jobId: string): Promise<PlanLinkState | null> {
  const { data, error } = await (supabase as any).rpc("spray_job_resistance_link_state", {
    p_job_id: jobId,
  });
  if (error) return null;
  const first = Array.isArray(data) ? data[0] : data;
  return normaliseLinkState(first);
}

/** SQL 201 `resistance_position_spray_job_ids(p_plan_id, p_position_id)`. */
export async function fetchPositionSprayJobIds(
  planId: string,
  positionId: string,
): Promise<string[]> {
  const { data, error } = await (supabase as any).rpc("resistance_position_spray_job_ids", {
    p_plan_id: planId,
    p_position_id: positionId,
  });
  if (error) throw error;
  if (Array.isArray(data)) {
    return uniqStrings(
      data.map((row: any) =>
        typeof row === "string" ? row : row?.spray_job_id ?? row?.id ?? null,
      ),
    );
  }
  return [];
}

/** SQL 201 `resistance_position_coverage(p_plan_id, p_position_id)`. */
export async function fetchPositionCoverage(
  planId: string,
  positionId: string,
): Promise<PositionCoverage> {
  const { data, error } = await (supabase as any).rpc("resistance_position_coverage", {
    p_plan_id: planId,
    p_position_id: positionId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  const ids = await fetchPositionSprayJobIds(planId, positionId).catch(() => []);
  return {
    sprayJobIds: ids,
    proposedBlockIds: uniqStrings((row as any).proposed_paddock_ids ?? (row as any).proposed_block_ids),
    completedBlockIds: uniqStrings((row as any).completed_block_ids),
  };
}


/** Every Spray Job created from a plan position (one position → many jobs). */
export async function fetchSprayJobsForPosition(
  planId: string,
  positionId: string,
) {
  const { data, error } = await supabase
    .from("spray_jobs")
    .select("*")
    .eq("resistance_plan_id", planId)
    .eq("resistance_position_id", positionId)
    .is("deleted_at", null)
    .order("planned_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any[];
}
