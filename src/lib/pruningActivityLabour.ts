// SQL 190 — pruning activity labour lines.
//
// A pruning activity now owns N labour lines of its own
// (`public.pruning_activity_labour_lines`), mirroring the Work Task labour
// line model. Labour no longer has to be borrowed from a linked Work Task.
//
// Verified live contract (production VineTrack project):
//   table  public.pruning_activity_labour_lines
//     id, pruning_activity_id, vineyard_id, work_date, worker_type_id,
//     worker_type, worker_count, hours_per_worker, total_hours, hourly_rate,
//     total_cost, notes, created_by, created_at, updated_at, deleted_at
//   rpc    public.save_pruning_activity_labour_lines(p_activity_id, p_lines)
//            -> full replace of the activity's labour lines
//   rpc    public.pruning_activity_labour_lines_json(p_activity_id)
//   rpc    public.pruning_activity_effective_labour_cost(p_activity_id)
//
// COST PRECEDENCE (shared with iOS/Android, never re-invented per screen):
//   1. Piece-rate linked Work Task  -> the piece-rate snapshot total
//   2. The activity's own RATED labour lines
//   3. Linked hourly Work Task labour lines (SQL 189 effective cost)
//   4. Legacy scalar activity labour (labour_hours × hourly_rate)
//
// NULL vs $0.00: an activity that has labour lines but no rate on any of them
// has UNKNOWN cost. It must render "—", never $0.00.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

export const PRUNING_ACTIVITY_LABOUR_LINES_TABLE = "pruning_activity_labour_lines";

export interface PruningActivityLabourLine {
  id: string;
  pruning_activity_id: string;
  vineyard_id: string | null;
  work_date: string | null;
  worker_type_id: string | null;
  worker_type: string | null;
  worker_count: number | null;
  hours_per_worker: number | string | null;
  total_hours: number | string | null;
  hourly_rate: number | string | null;
  total_cost: number | string | null;
  notes: string | null;
  deleted_at?: string | null;
}

const LINE_COLUMNS =
  "id, pruning_activity_id, vineyard_id, work_date, worker_type_id, worker_type, " +
  "worker_count, hours_per_worker, total_hours, hourly_rate, total_cost, notes, deleted_at";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------------ reads

export async function fetchPruningActivityLabourLines(
  activityId: string,
): Promise<PruningActivityLabourLine[]> {
  const { data, error } = await supabase
    .from(PRUNING_ACTIVITY_LABOUR_LINES_TABLE as any)
    .select(LINE_COLUMNS)
    .eq("pruning_activity_id", activityId)
    .is("deleted_at", null)
    .order("work_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PruningActivityLabourLine[];
}

export function usePruningActivityLabourLines(activityId: string | null) {
  return useQuery({
    queryKey: ["pruning", "activity-labour-lines", activityId],
    enabled: !!activityId,
    queryFn: () => fetchPruningActivityLabourLines(activityId!),
  });
}

/** Every activity labour line in a vineyard, grouped by activity id. */
export async function fetchVineyardPruningLabourLines(
  vineyardId: string,
): Promise<Map<string, PruningActivityLabourLine[]>> {
  const { data, error } = await supabase
    .from(PRUNING_ACTIVITY_LABOUR_LINES_TABLE as any)
    .select(LINE_COLUMNS)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  // The table is additive; a project without SQL 190 must not break the report.
  if (error) return new Map();
  const map = new Map<string, PruningActivityLabourLine[]>();
  ((data ?? []) as unknown as PruningActivityLabourLine[]).forEach((l) => {
    if (!l?.pruning_activity_id) return;
    const list = map.get(l.pruning_activity_id);
    if (list) list.push(l);
    else map.set(l.pruning_activity_id, [l]);
  });
  return map;
}

// ------------------------------------------------------------------ writes

export interface PruningLabourLinePayload {
  id?: string | null;
  work_date: string | null;
  worker_type_id: string | null;
  worker_type: string | null;
  worker_count: number | null;
  hours_per_worker: number | null;
  hourly_rate: number | null;
  notes?: string | null;
}

/**
 * Full replace of an activity's labour lines. Always send the COMPLETE desired
 * array — omitted lines are removed by the backend.
 */
export async function savePruningActivityLabourLines(
  activityId: string,
  lines: PruningLabourLinePayload[],
): Promise<void> {
  const { error } = await (supabase as any).rpc("save_pruning_activity_labour_lines", {
    p_activity_id: activityId,
    p_lines: lines,
  });
  if (error) throw error;
}

// ------------------------------------------------------------------ maths

export interface PruningLabourSummary {
  /** Σ person-hours across the activity's own lines. */
  hours: number | null;
  /** Σ cost of RATED lines. Null when the activity has no rated line. */
  cost: number | null;
  lineCount: number;
  ratedLineCount: number;
}

export const EMPTY_PRUNING_LABOUR_SUMMARY: PruningLabourSummary = {
  hours: null, cost: null, lineCount: 0, ratedLineCount: 0,
};

/** Person-hours and cost of an activity's own labour lines. */
export function summarisePruningLabourLines(
  lines: PruningActivityLabourLine[] | null | undefined,
): PruningLabourSummary {
  const list = (lines ?? []).filter((l) => !l.deleted_at);
  if (!list.length) return EMPTY_PRUNING_LABOUR_SUMMARY;

  let hours = 0;
  let cost = 0;
  let rated = 0;
  list.forEach((l) => {
    const lineHours = num(l.total_hours)
      ?? ((num(l.worker_count) ?? 0) * (num(l.hours_per_worker) ?? 0));
    hours += lineHours;
    const rate = num(l.hourly_rate);
    if (rate == null) return;
    rated += 1;
    cost += num(l.total_cost) ?? Math.round(lineHours * rate * 100) / 100;
  });

  return {
    hours: Math.round(hours * 100) / 100,
    // No rated line => the cost is UNKNOWN, not zero.
    cost: rated ? Math.round(cost * 100) / 100 : null,
    lineCount: list.length,
    ratedLineCount: rated,
  };
}

export type PruningLabourSource =
  | "piece_rate"
  | "activity_labour_lines"
  | "work_task_labour_lines"
  | "legacy_activity"
  | "none";

export interface ResolvedPruningLabour {
  /** Null means "no known cost" — display "—", never $0.00. */
  cost: number | null;
  /** Null means "no known hours". */
  hours: number | null;
  costSource: PruningLabourSource;
  hoursSource: PruningLabourSource;
}

export interface PruningLabourInputs {
  /** Activity's own lines (already summarised). */
  activityLines?: PruningLabourSummary | null;
  /** Linked Work Task is costed by piece rate. */
  isPieceRate?: boolean;
  /** Piece-rate snapshot total, or the SQL 189 effective task cost. */
  taskCost?: number | null;
  /** Person-hours recorded on the linked Work Task's labour lines. */
  taskHours?: number | null;
  /** Legacy scalar activity labour. */
  legacyHours?: number | null;
  legacyRate?: number | null;
  legacyCost?: number | null;
}

/** THE canonical answer to "what labour does this pruning activity carry?". */
export function resolvePruningActivityLabour(
  input: PruningLabourInputs,
): ResolvedPruningLabour {
  const lines = input.activityLines ?? EMPTY_PRUNING_LABOUR_SUMMARY;
  const hasLines = lines.lineCount > 0;

  // ---- hours
  let hours: number | null = null;
  let hoursSource: PruningLabourSource = "none";
  if (hasLines && lines.hours != null) {
    hours = lines.hours;
    hoursSource = "activity_labour_lines";
  } else if (input.taskHours != null && input.taskHours > 0) {
    hours = input.taskHours;
    hoursSource = "work_task_labour_lines";
  } else if (input.legacyHours != null) {
    hours = input.legacyHours;
    hoursSource = "legacy_activity";
  }

  // ---- cost
  if (input.isPieceRate) {
    return { cost: input.taskCost ?? null, hours, costSource: "piece_rate", hoursSource };
  }
  if (hasLines) {
    // Lines exist: they are the answer, even when the answer is "unknown".
    return { cost: lines.cost, hours, costSource: "activity_labour_lines", hoursSource };
  }
  if (input.taskCost != null) {
    return { cost: input.taskCost, hours, costSource: "work_task_labour_lines", hoursSource };
  }
  const legacy = input.legacyCost
    ?? (input.legacyHours != null && input.legacyRate != null
      ? Math.round(input.legacyHours * input.legacyRate * 100) / 100
      : null);
  return {
    cost: legacy,
    hours,
    costSource: legacy == null ? "none" : "legacy_activity",
    hoursSource,
  };
}

/** Short, user-facing explanation of where a labour figure came from. */
export function labourSourceLabel(source: PruningLabourSource): string {
  switch (source) {
    case "piece_rate": return "Piece rate snapshot";
    case "activity_labour_lines": return "Activity labour";
    case "work_task_labour_lines": return "Work Task labour";
    case "legacy_activity": return "Legacy activity labour";
    default: return "No labour recorded";
  }
}
