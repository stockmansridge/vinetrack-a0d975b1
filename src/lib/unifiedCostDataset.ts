// Unified cost dataset for the central Cost Report.
//
// The Cost Report historically read ONLY `trip_cost_allocations`, so operational
// costs recorded outside a field trip (notably pruning activity labour) never
// appeared. This module normalises every supported cost source into one
// contract so the report can aggregate by vintage, block, variety and function.
//
// Contract (one row = one allocation of cost to a block):
//   source_type, source_id, allocation_id, dedup_key, vineyard_id,
//   activity_date, vintage_year, operation_year, block_id/name, variety,
//   function, labour/fuel/chemical/input/other/total cost, allocation_basis,
//   warning_code(s), status.
//
// Deduplication contract
// ----------------------
// The same pruning labour can be represented three ways: the linked Work Task,
// the parent pruning activity, and the per-block pruning allocations. The
// authoritative inclusion path for the Cost Report is the ALLOCATION rows:
//   * block/variety/function costing uses the reconciled allocated cost
//     (row-equivalent share) produced by `pruningActivityAllocation.ts`;
//   * the parent activity cost is counted once (allocations sum back to it);
//   * work tasks consumed by a pruning activity are recorded in
//     `linkedWorkTaskIds` so no other source may import them again.
//
// Vintage is the primary crop-cost grouping. `vintage_year` is discovered
// dynamically from the included rows — never hard-coded, never derived only
// from field trips.
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";

export type CostSourceType = "trip" | "pruning_activity";

export interface UnifiedCostRow {
  // --- identity / provenance ---
  source_type: CostSourceType;
  source_id: string | null;
  allocation_id: string;
  /** Unique inclusion key, e.g. `pruning_activity:{activity_id}:{allocation_id}` */
  dedup_key: string;
  vineyard_id: string;

  // --- time ---
  activity_date: string | null;
  /** Crop year the cost belongs to (primary grouping). */
  vintage_year: number | null;
  /** Calendar/operation year the work happened in (secondary filter). */
  operation_year: number | null;

  // --- dimensions ---
  block_id: string | null;
  block_name: string | null;
  variety: string | null;
  function: string | null;
  worker: string | null;
  work_task_id: string | null;

  // --- measures ---
  allocation_area_ha: number;
  yield_tonnes: number;
  labour_cost: number;
  fuel_cost: number;
  chemical_cost: number;
  input_cost: number;
  other_cost: number;
  total_cost: number;

  /** Parent totals — informational, counted once per parent. */
  parent_labour_hours: number | null;
  parent_total_cost: number | null;
  allocated_labour_hours: number | null;

  // --- context ---
  row_equivalents: number | null;
  vines: number | null;
  allocation_basis: string;
  warnings: string[];
  status: string | null;
  reversed: boolean;
  /** Original source record, for drill-downs. */
  raw: unknown;
}

export interface UnifiedCostDataset {
  rows: UnifiedCostRow[];
  /** Work Task ids already accounted for through another source. */
  linkedWorkTaskIds: Set<string>;
  /** All vintage years discovered across included sources, newest first. */
  vintageYears: number[];
  /** All operation (calendar) years discovered, newest first. */
  operationYears: number[];
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const yearOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const y = Number(String(iso).slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
};

export function warningsToList(w: unknown): string[] {
  if (!w) return [];
  if (Array.isArray(w)) return w.map(String).filter(Boolean);
  if (typeof w === "string") return w ? [w] : [];
  if (typeof w === "object") return Object.values(w as object).map(String).filter(Boolean);
  return [];
}

export function pruningDedupKey(activityId: string | null, allocationId: string): string {
  return `pruning_activity:${activityId ?? allocationId}:${allocationId}`;
}

/** Map one trip_cost_allocations row onto the unified contract. */
export function tripAllocationToUnified(t: TripCostAllocation): UnifiedCostRow {
  const date = t.calculated_at ?? t.created_at ?? null;
  return {
    source_type: "trip",
    source_id: t.trip_id ?? null,
    allocation_id: t.id,
    dedup_key: `trip:${t.trip_id ?? "none"}:${t.id}`,
    vineyard_id: t.vineyard_id,
    activity_date: date,
    // Trip costing already stores the crop season on the allocation.
    vintage_year: t.season_year ?? null,
    operation_year: yearOf(date) ?? t.season_year ?? null,
    block_id: t.paddock_id ?? null,
    block_name: t.paddock_name ?? null,
    variety: t.variety ?? null,
    function: t.trip_function ?? null,
    worker: null,
    work_task_id: null,
    allocation_area_ha: num(t.allocation_area_ha),
    yield_tonnes: num(t.yield_tonnes),
    labour_cost: num(t.labour_cost),
    fuel_cost: num(t.fuel_cost),
    chemical_cost: num(t.chemical_cost),
    input_cost: num(t.input_cost),
    other_cost: 0,
    total_cost: num(t.total_cost),
    parent_labour_hours: null,
    parent_total_cost: num(t.total_cost),
    allocated_labour_hours: null,
    row_equivalents: null,
    vines: null,
    allocation_basis: "trip_area",
    warnings: warningsToList(t.warnings),
    status: t.costing_status ?? null,
    reversed: false,
    raw: t,
  };
}

/**
 * Map one pruning activity allocation onto the unified contract.
 * Uses the reconciled per-block allocated labour cost, so the allocations of a
 * multi-block activity sum back exactly to the parent activity cost.
 */
export function pruningRowToUnified(
  r: PruningActivityRow,
  vineyardId: string,
): UnifiedCostRow {
  const cost = r.allocatedCost ?? 0;
  const warnings: string[] = [];
  if (r.allocatedCost == null) {
    warnings.push("Pruning activity has no resolvable labour cost (no linked Work Task labour line).");
  }
  if (r.workTaskMissing) warnings.push("Linked work task no longer exists.");

  return {
    source_type: "pruning_activity",
    source_id: r.activityId ?? r.id,
    allocation_id: r.id,
    dedup_key: pruningDedupKey(r.activityId, r.id),
    vineyard_id: vineyardId,
    activity_date: r.date,
    vintage_year: r.vintageYear ?? (r.seasonYear != null ? r.seasonYear + 1 : null),
    operation_year: r.seasonYear ?? yearOf(r.date),
    block_id: r.paddockId ?? null,
    block_name: r.blockName ?? null,
    variety: r.variety && r.variety !== "—" ? r.variety : null,
    function: "pruning",
    worker: r.worker && r.worker !== "—" ? r.worker : null,
    work_task_id: r.workTaskId ?? null,
    allocation_area_ha: 0,
    yield_tonnes: 0,
    labour_cost: cost,
    fuel_cost: 0,
    chemical_cost: 0,
    input_cost: 0,
    other_cost: 0,
    total_cost: cost,
    parent_labour_hours: r.activityHours,
    parent_total_cost: r.activityCost,
    allocated_labour_hours: r.allocatedHours,
    row_equivalents: r.rowEquivalents,
    vines: r.vines,
    allocation_basis: "pruning_row_equivalent_share",
    warnings,
    status: r.isReversed ? "reversed" : (r.workTaskId ? "costed" : "uncosted"),
    reversed: r.isReversed,
    raw: r,
  };
}

export interface BuildUnifiedCostArgs {
  vineyardId: string;
  tripAllocations?: TripCostAllocation[];
  pruningRows?: PruningActivityRow[];
  /** Include reversed pruning activities (default false). */
  includeReversed?: boolean;
}

/**
 * Union every supported cost source into one normalised, de-duplicated dataset.
 */
export function buildUnifiedCostDataset({
  vineyardId,
  tripAllocations = [],
  pruningRows = [],
  includeReversed = false,
}: BuildUnifiedCostArgs): UnifiedCostDataset {
  const rows: UnifiedCostRow[] = [];
  const seen = new Set<string>();
  const linkedWorkTaskIds = new Set<string>();

  // 1) Pruning allocations first — they own their linked Work Task cost.
  for (const p of pruningRows) {
    if (p.isReversed && !includeReversed) continue;
    const row = pruningRowToUnified(p, vineyardId);
    if (seen.has(row.dedup_key)) continue;
    seen.add(row.dedup_key);
    if (p.workTaskId) linkedWorkTaskIds.add(p.workTaskId);
    rows.push(row);
  }

  // 2) Trip allocations. A trip whose cost is already claimed by a pruning
  //    activity's Work Task must not be imported a second time.
  for (const t of tripAllocations) {
    const row = tripAllocationToUnified(t);
    if (seen.has(row.dedup_key)) continue;
    seen.add(row.dedup_key);
    rows.push(row);
  }

  const vintageYears = Array.from(
    new Set(rows.map((r) => r.vintage_year).filter((v): v is number => v != null)),
  ).sort((a, b) => b - a);
  const operationYears = Array.from(
    new Set(rows.map((r) => r.operation_year).filter((v): v is number => v != null)),
  ).sort((a, b) => b - a);

  return { rows, linkedWorkTaskIds, vintageYears, operationYears };
}

/** Sum of parent activity costs, counted once per parent activity. */
export function parentActivityTotal(rows: UnifiedCostRow[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const key = `${r.source_type}:${r.source_id ?? r.allocation_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += r.parent_total_cost ?? r.total_cost;
  }
  return total;
}

/** Generic aggregation helper (block / variety / function). */
export function aggregateBy(
  rows: UnifiedCostRow[],
  key: (r: UnifiedCostRow) => string,
): Array<{ name: string; total: number; area: number; yieldT: number; count: number }> {
  const map = new Map<string, { name: string; total: number; area: number; yieldT: number; count: number }>();
  for (const r of rows) {
    const k = key(r);
    let b = map.get(k);
    if (!b) { b = { name: k, total: 0, area: 0, yieldT: 0, count: 0 }; map.set(k, b); }
    b.total += r.total_cost;
    b.area += r.allocation_area_ha;
    b.yieldT += r.yield_tonnes;
    b.count += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
