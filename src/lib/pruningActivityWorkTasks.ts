// SQL 200 — Pruning Activity → 0..N Work Tasks.
//
// Canonical model (shared with Rork/iOS):
//   Pruning Activity = the operational record (what was pruned, where, when)
//   Work Task        = the completed COST record
//   One Activity     -> 0..N Work Tasks, linked by work_tasks.pruning_activity_id
//   Labour lines live ONLY inside Work Tasks.
//
// The portal therefore derives an activity's labour hours and cost purely from
// its linked Work Tasks. Legacy activity-owned labour
// (`pruning_entries.labour_hours` / `pruning_activity_labour_lines`) is still
// READ so historical records keep their numbers, but it is never written from
// here and it is ignored the moment a linked Work Task exists.
//
// NULL vs $0.00: "no known cost" must render "—", never $0.00.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import {
  fetchLabourLinesForTask, type WorkTask, type WorkTaskLabourLine,
} from "@/lib/workTasksQuery";
import {
  resolveEffectiveLabourCost, type EffectiveLabourCostRow,
} from "@/lib/effectiveLabourCost";
import { resolveCostingMethod } from "@/lib/pieceRateCosting";

export const WORK_TASK_ACTIVITY_COLUMN = "pruning_activity_id";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ maths

export interface LinkedWorkTaskSummary {
  taskId: string;
  task: WorkTask | null;
  /** Person-hours from the task's labour lines. Null = none recorded. */
  hours: number | null;
  /** Canonical labour cost (piece-rate snapshot wins). Null = unknown. */
  labourCost: number | null;
  /** Canonical total cost carried by this task for cost reporting. */
  totalCost: number | null;
  isPieceRate: boolean;
  lines: WorkTaskLabourLine[];
}

/** Person-hours + raw labour-line cost for one task. */
export function summariseTaskLabourLines(lines: WorkTaskLabourLine[] | null | undefined) {
  const active = (lines ?? []).filter((l) => !l.deleted_at);
  let hours = 0;
  let cost = 0;
  let rated = 0;
  active.forEach((l) => {
    const h = num(l.total_hours) ?? ((num(l.worker_count) ?? 0) * (num(l.hours_per_worker) ?? 0));
    hours += h;
    const lineCost = num(l.total_cost)
      ?? (num(l.hourly_rate) != null ? h * (num(l.hourly_rate) as number) : null);
    if (lineCost != null) { rated += 1; cost += lineCost; }
  });
  return {
    lines: active,
    hours: active.length ? round2(hours) : null,
    cost: rated ? round2(cost) : null,
  };
}

/** One linked Work Task, summarised with the canonical SQL 188/189 rules. */
export function summariseLinkedWorkTask(
  task: WorkTask | null,
  lines: WorkTaskLabourLine[] | null | undefined,
  backend?: EffectiveLabourCostRow | null,
  taskId?: string,
): LinkedWorkTaskSummary {
  const lineSummary = summariseTaskLabourLines(lines);
  const resolved = resolveEffectiveLabourCost(task, lineSummary.cost, backend ?? null);
  const isPieceRate = resolveCostingMethod(task) === "piece_rate";
  return {
    taskId: task?.id ?? taskId ?? "",
    task,
    hours: lineSummary.hours,
    labourCost: resolved.cost,
    totalCost: resolved.cost,
    isPieceRate,
    lines: lineSummary.lines,
  };
}

export interface WorkTaskAggregate {
  /** Σ labour hours across linked tasks. Null when nothing is recorded. */
  hours: number | null;
  /** Σ canonical task totals. Null when no linked task has a known cost. */
  cost: number | null;
  taskCount: number;
  costedTaskCount: number;
}

export const EMPTY_WORK_TASK_AGGREGATE: WorkTaskAggregate = {
  hours: null, cost: null, taskCount: 0, costedTaskCount: 0,
};

/**
 * Activity totals = Σ linked Work Tasks. Each task is counted EXACTLY ONCE,
 * even when several allocations or a legacy `work_task_id` point at it.
 */
export function aggregateLinkedWorkTasks(
  tasks: LinkedWorkTaskSummary[] | null | undefined,
): WorkTaskAggregate {
  const seen = new Set<string>();
  let hours = 0;
  let hourCount = 0;
  let cost = 0;
  let costed = 0;
  let count = 0;
  (tasks ?? []).forEach((t) => {
    const key = t.taskId || `anon:${count}`;
    if (seen.has(key)) return;
    seen.add(key);
    count += 1;
    if (t.hours != null) { hours += t.hours; hourCount += 1; }
    if (t.totalCost != null) { cost += t.totalCost; costed += 1; }
  });
  return {
    hours: hourCount ? round2(hours) : null,
    cost: costed ? round2(cost) : null,
    taskCount: count,
    costedTaskCount: costed,
  };
}

export type PruningActivityCostSource =
  | "work_tasks"
  | "legacy_activity"
  | "none";

export interface ResolvedActivityCost {
  hours: number | null;
  cost: number | null;
  source: PruningActivityCostSource;
  taskCount: number;
}

/**
 * THE contract: linked Work Tasks are the authority. Legacy activity labour is
 * only surfaced for activities that have NO linked Work Task at all.
 */
export function resolveActivityCostFromWorkTasks(input: {
  tasks?: WorkTaskAggregate | null;
  legacyHours?: number | null;
  legacyCost?: number | null;
  legacyRate?: number | null;
}): ResolvedActivityCost {
  const agg = input.tasks ?? EMPTY_WORK_TASK_AGGREGATE;
  if (agg.taskCount > 0) {
    return { hours: agg.hours, cost: agg.cost, source: "work_tasks", taskCount: agg.taskCount };
  }
  const legacyCost = input.legacyCost
    ?? (input.legacyHours != null && input.legacyRate != null
      ? round2(input.legacyHours * input.legacyRate)
      : null);
  if (input.legacyHours != null || legacyCost != null) {
    return {
      hours: input.legacyHours ?? null,
      cost: legacyCost,
      source: "legacy_activity",
      taskCount: 0,
    };
  }
  return { hours: null, cost: null, source: "none", taskCount: 0 };
}

// ------------------------------------------------------------------ reads

/** Tasks linked to ONE activity (SQL 200 link + the legacy activity column). */
export async function fetchWorkTasksForActivity(
  activityId: string | null,
  legacyTaskId?: string | null,
): Promise<WorkTask[]> {
  const out = new Map<string, WorkTask>();

  if (activityId) {
    const { data, error } = await supabase
      .from("work_tasks")
      .select("*")
      .eq(WORK_TASK_ACTIVITY_COLUMN as any, activityId)
      .is("deleted_at", null);
    if (error) throw error;
    ((data ?? []) as unknown as WorkTask[]).forEach((t) => out.set(t.id, t));
  }

  if (legacyTaskId && !out.has(legacyTaskId)) {
    const { data } = await supabase
      .from("work_tasks").select("*").eq("id", legacyTaskId).is("deleted_at", null).maybeSingle();
    if (data) out.set((data as any).id, data as unknown as WorkTask);
  }

  return Array.from(out.values()).sort((a, b) =>
    String(a.end_date ?? a.date ?? a.created_at ?? "").localeCompare(
      String(b.end_date ?? b.date ?? b.created_at ?? "")));
}

export interface ActivityWorkTasksResult {
  tasks: LinkedWorkTaskSummary[];
  totals: WorkTaskAggregate;
}

export async function fetchActivityWorkTaskSummaries(
  activityId: string | null,
  legacyTaskId?: string | null,
): Promise<ActivityWorkTasksResult> {
  const tasks = await fetchWorkTasksForActivity(activityId, legacyTaskId);
  const summaries = await Promise.all(
    tasks.map(async (t) => summariseLinkedWorkTask(t, await fetchLabourLinesForTask(t.id))),
  );
  return { tasks: summaries, totals: aggregateLinkedWorkTasks(summaries) };
}

export function useActivityWorkTasks(
  activityId: string | null,
  legacyTaskId?: string | null,
) {
  return useQuery({
    queryKey: ["pruning", "activity-work-tasks", activityId, legacyTaskId ?? null],
    enabled: !!activityId || !!legacyTaskId,
    queryFn: () => fetchActivityWorkTaskSummaries(activityId, legacyTaskId ?? null),
  });
}

/** activity id -> linked task ids, for the whole vineyard (report path). */
export async function fetchWorkTaskLinksForVineyard(
  vineyardId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("work_tasks")
    .select(`id, ${WORK_TASK_ACTIVITY_COLUMN}`)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  // Additive column: a project without SQL 200 must not break the report.
  if (error) return new Map();
  const map = new Map<string, string[]>();
  ((data ?? []) as any[]).forEach((r) => {
    const act = r?.[WORK_TASK_ACTIVITY_COLUMN];
    if (!act || !r?.id) return;
    const list = map.get(act);
    if (list) list.push(r.id);
    else map.set(act, [r.id]);
  });
  return map;
}

// ------------------------------------------------------------------ writes

/** Link an existing Work Task to a pruning activity (SQL 200). */
export async function linkWorkTaskToActivity(
  workTaskId: string,
  activityId: string,
): Promise<void> {
  const { error } = await supabase
    .from("work_tasks")
    .update({ [WORK_TASK_ACTIVITY_COLUMN]: activityId, client_updated_at: new Date().toISOString() } as any)
    .eq("id", workTaskId);
  if (error) throw error;
}

/** Unlink — the Work Task itself is left completely intact. */
export async function unlinkWorkTaskFromActivity(workTaskId: string): Promise<void> {
  const { error } = await supabase
    .from("work_tasks")
    .update({ [WORK_TASK_ACTIVITY_COLUMN]: null, client_updated_at: new Date().toISOString() } as any)
    .eq("id", workTaskId);
  if (error) throw error;
}
