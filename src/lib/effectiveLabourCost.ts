// SQL 189 — shared effective Work Task labour cost (CONSUMER ONLY).
//
// The backend is the single source of truth. The portal must not reinvent
// piece-rate costing per screen.
//
// Live contract (production VineTrack Supabase):
//   public.v_work_task_effective_labour_cost
//     work_task_id, vineyard_id, costing_method,
//     piece_rate_per_vine, piece_vine_count, piece_rate_total_cost,
//     labour_line_cost, effective_labour_cost, labour_cost_source
//
//   public.pruning_activity_allocation_export
//     activity_id, allocation_id, work_task_id, vineyard_id, paddock_id,
//     activity_date, season_year, vintage_year, is_skipped, row_equivalents,
//     activity_labour_hours, activity_labour_cost, activity_labour_cost_source,
//     activity_costing_method, activity_piece_rate_per_vine,
//     activity_piece_vine_count, allocation_share_of_row_equivalents,
//     allocation_share_labour_hours_informational, allocation_share_labour_cost
//
// RULES
//  - Prefer effective_labour_cost from the view/API.
//  - NULL means "no known cost" — never coerce to 0 for display.
//  - Never sum piece_rate_total_cost with labour lines.
//  - Historical piece-rate snapshots are authoritative; never recompute from
//    today's paddock rows.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { taskLabourCost, resolveCostingMethod, type CostingMethod } from "@/lib/pieceRateCosting";

export type LabourCostSource =
  | "piece_rate"
  | "labour_lines"
  | "none"
  | string;

export interface EffectiveLabourCostRow {
  work_task_id: string;
  vineyard_id: string | null;
  costing_method: string | null;
  piece_rate_per_vine: number | string | null;
  piece_vine_count: number | null;
  piece_rate_total_cost: number | string | null;
  labour_line_cost: number | string | null;
  effective_labour_cost: number | string | null;
  labour_cost_source: LabourCostSource | null;
}

export const EFFECTIVE_LABOUR_COST_VIEW = "v_work_task_effective_labour_cost";
export const PRUNING_ALLOCATION_EXPORT_VIEW = "pruning_activity_allocation_export";

const numOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Backend-first read. Returns an empty map (never throws) when the view is not
 * reachable for this user/project so callers fall back to the local helper.
 */
export async function fetchEffectiveLabourCosts(
  vineyardId: string,
): Promise<Map<string, EffectiveLabourCostRow>> {
  const { data, error } = await supabase
    .from(EFFECTIVE_LABOUR_COST_VIEW as any)
    .select(
      "work_task_id, vineyard_id, costing_method, piece_rate_per_vine, piece_vine_count, piece_rate_total_cost, labour_line_cost, effective_labour_cost, labour_cost_source",
    )
    .eq("vineyard_id", vineyardId);
  if (error) return new Map();
  const map = new Map<string, EffectiveLabourCostRow>();
  ((data ?? []) as unknown as EffectiveLabourCostRow[]).forEach((r) => {
    if (r?.work_task_id) map.set(r.work_task_id, r);
  });
  return map;
}

export function useEffectiveLabourCosts(vineyardId: string | null) {
  return useQuery({
    queryKey: ["work-task-effective-labour-cost", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchEffectiveLabourCosts(vineyardId!),
  });
}

export interface ResolvedLabourCost {
  /** Null means "no known cost" — display "—", never $0.00. */
  cost: number | null;
  source: LabourCostSource;
  costingMethod: CostingMethod;
  pieceRatePerVine: number | null;
  pieceVineCount: number | null;
  /** True when the value came from SQL 189 rather than the local fallback. */
  fromBackend: boolean;
}

/**
 * THE canonical answer to "what is this Work Task's labour cost?".
 *
 * Backend `effective_labour_cost` wins. When the view row is unavailable the
 * local SQL 188 helper reproduces the same rule from the task columns.
 */
export function resolveEffectiveLabourCost(
  task:
    | {
        costing_method?: string | null;
        piece_rate_total_cost?: number | string | null;
        piece_vine_count?: number | null;
        piece_rate_per_vine?: number | string | null;
      }
    | null
    | undefined,
  labourLineTotal: number | null,
  backend?: EffectiveLabourCostRow | null,
): ResolvedLabourCost {
  const method = resolveCostingMethod(
    backend?.costing_method != null ? { costing_method: backend.costing_method } : task,
  );
  const pieceRatePerVine =
    numOrNull(backend?.piece_rate_per_vine) ?? numOrNull(task?.piece_rate_per_vine);
  const pieceVineCount =
    numOrNull(backend?.piece_vine_count) ?? numOrNull(task?.piece_vine_count);

  if (backend) {
    const cost = numOrNull(backend.effective_labour_cost);
    return {
      cost,
      source: backend.labour_cost_source ?? (cost == null ? "none" : method),
      costingMethod: method,
      pieceRatePerVine,
      pieceVineCount,
      fromBackend: true,
    };
  }

  const cost = taskLabourCost(task, labourLineTotal);
  return {
    cost,
    source: cost == null ? "none" : method === "piece_rate" ? "piece_rate" : "labour_lines",
    costingMethod: method,
    pieceRatePerVine,
    pieceVineCount,
    fromBackend: false,
  };
}

/** Convenience: cost only, preserving the NULL / $0 distinction. */
export function effectiveLabourCostValue(
  task: Parameters<typeof resolveEffectiveLabourCost>[0],
  labourLineTotal: number | null,
  backend?: EffectiveLabourCostRow | null,
): number | null {
  return resolveEffectiveLabourCost(task, labourLineTotal, backend).cost;
}

/** Cost per vine using the HISTORICAL snapshot quantity, never live rows. */
export function effectiveCostPerVine(
  cost: number | null,
  snapshotVines: number | null | undefined,
): number | null {
  if (cost == null) return null;
  const v = Number(snapshotVines);
  if (!Number.isFinite(v) || v <= 0) return null;
  return cost / v;
}

export const labourCostSourceLabel = (s: LabourCostSource | null | undefined): string => {
  switch (s) {
    case "piece_rate":
      return "Piece rate snapshot";
    case "labour_lines":
      return "Labour lines";
    case "activity_hours":
      return "Activity hours × rate";
    case "none":
    case null:
    case undefined:
      return "Not costed";
    default:
      return String(s);
  }
};
