// Piece-rate pruning costing — SQL 188 contract (CONSUMER ONLY).
//
// Rork/VineTrack mobile + SQL 188 are the source of truth. The portal never
// creates, renames or duplicates these fields.
//
// Fields consumed (public.work_tasks):
//   costing_method        text  not null default 'hourly'  ('hourly'|'piece_rate')
//   piece_rate_per_vine   numeric(12,4) null
//   piece_vine_count      integer null            -- HISTORICAL SNAPSHOT
//   piece_rate_total_cost numeric(14,2) GENERATED -- round(count * rate, 2)
//
// Snapshot detail (public.work_task_piece_rate_rows):
//   work_task_id, vineyard_id, paddock_id, paddock_row_id, row_number,
//   vine_count, soft-delete + sync columns.
//
// READING RULE (never sum the two):
//   costing_method = 'hourly'     -> labour cost = SUM(work_task_labour_lines.total_cost)
//   costing_method = 'piece_rate' -> labour cost = work_tasks.piece_rate_total_cost
//
// LEGACY: a task with no/unknown costing_method resolves to 'hourly'. Piece
// rate is NEVER inferred from the presence of a rate.
//
// HISTORICAL PROTECTION: piece_rate_total_cost is generated from the snapshot
// columns only. The portal must display the snapshot, never recompute a saved
// job from today's paddocks.rows.

export type CostingMethod = "hourly" | "piece_rate";

export const COSTING_METHOD_HOURLY: CostingMethod = "hourly";
export const COSTING_METHOD_PIECE_RATE: CostingMethod = "piece_rate";

/** Legacy-safe read of the costing switch. Anything unknown => hourly. */
export function resolveCostingMethod(task: { costing_method?: string | null } | null | undefined): CostingMethod {
  return task?.costing_method === "piece_rate" ? "piece_rate" : "hourly";
}

export const costingMethodLabel = (m: CostingMethod) => (m === "piece_rate" ? "Piece Rate" : "Hourly");

/**
 * round(vineCount * ratePerVine, 2) with Postgres NUMERIC semantics
 * (half away from zero), computed in integer arithmetic so no binary
 * floating-point drift can occur.
 *
 * 2238 vines x $1.27 = $2842.26 exactly.
 */
export function pieceRateTotalCost(
  vineCount: number | null | undefined,
  ratePerVine: number | null | undefined,
): number | null {
  if (vineCount == null || ratePerVine == null) return null;
  const vines = Number(vineCount);
  const rate = Number(ratePerVine);
  if (!Number.isFinite(vines) || !Number.isFinite(rate)) return null;
  if (vines < 0 || rate < 0) return null;
  // piece_rate_per_vine is numeric(12,4): scale the rate to whole 1/10000ths.
  const rate4 = Math.round(rate * 10000);
  const wholeVines = Math.round(vines);
  // Product is in 1/10000 dollars; convert to cents with half-up rounding.
  const tenThousandths = wholeVines * rate4;
  const cents = Math.floor((tenThousandths + 50) / 100);
  return cents / 100;
}

/**
 * THE labour cost of a task. Exactly one of the two totals applies; they are
 * never summed.
 */
export function taskLabourCost(
  task: {
    costing_method?: string | null;
    piece_rate_total_cost?: number | string | null;
    piece_vine_count?: number | null;
    piece_rate_per_vine?: number | string | null;
  } | null | undefined,
  hourlyLabourLineTotal: number | null,
): number | null {
  if (resolveCostingMethod(task) === "piece_rate") {
    // Prefer the generated column; fall back to the snapshot columns only when
    // the generated value has not been read back yet.
    if (task?.piece_rate_total_cost != null) return Number(task.piece_rate_total_cost);
    return pieceRateTotalCost(
      task?.piece_vine_count ?? null,
      task?.piece_rate_per_vine != null ? Number(task.piece_rate_per_vine) : null,
    );
  }
  return hourlyLabourLineTotal;
}

/** Cost per hectare for display. Null when area is unknown or zero. */
export function costPerHectare(cost: number | null, areaHa: number | null | undefined): number | null {
  if (cost == null) return null;
  const a = Number(areaHa);
  if (!Number.isFinite(a) || a <= 0) return null;
  return Math.round((cost / a) * 100) / 100;
}

export interface PieceRateRowSnapshot {
  paddock_id: string;
  paddock_row_id: string | null;
  row_number: number | null;
  vine_count: number;
}

/** Snapshot vine quantity = Σ per-row snapshot vine counts. */
export function snapshotVineCount(rows: PieceRateRowSnapshot[]): number {
  return rows.reduce((s, r) => s + (Number(r.vine_count) || 0), 0);
}
