// Parent pruning activity contract (multi-block allocations).
//
// AGREED MODEL (awaiting the shared backend RPC):
//   Parent activity  -> date, worker/crew, method, start/finish, labour
//                       hours, notes, linked Work Task, cost.
//   Allocation (n)   -> block (paddock), season, vintage, rows/quarters,
//                       row equivalents, vines.
//
// The legacy RPCs (`record_pruning_entry` / `update_pruning_entry`) are
// strictly ONE block per entry. We deliberately do NOT emulate a parent
// activity by fanning out multiple legacy calls — labour and duration would
// be duplicated or arbitrarily split. Everything below is the portal-side
// shape and the readiness gate; flip `PRUNING_ACTIVITY_CONTRACT_READY` (and
// implement `saveActivity`) when the shared endpoint lands.

export interface AllocationQuarter {
  rowNumber: number;
  segmentNumber: number; // 1..4
  paddockRowId: string | null;
  rowLabel: string;
}

export interface BlockAllocationDraft {
  paddockId: string;
  paddockName: string;
  variety: string;
  /** Keyed `${rowNumber}:${quarter}` so selections survive block switching. */
  quarters: Record<string, AllocationQuarter>;
  /** Server-resolved once saved; null for a brand-new allocation. */
  seasonId: string | null;
}

export interface PruningActivityDraft {
  activityId: string | null;
  entryDate: string;
  worker: string;
  method: string;
  labourHours: number | null;
  startTime: string | null;
  finishTime: string | null;
  notes: string;
  workTaskId: string | null;
  /** Allocation state keyed by block id. */
  allocations: Record<string, BlockAllocationDraft>;
}

export const allocationKey = (rowNumber: number, quarter: number) => `${rowNumber}:${quarter}`;

export function allocationQuarterCount(a: BlockAllocationDraft): number {
  return Object.keys(a.quarters).length;
}

export function allocationRowEquivalents(a: BlockAllocationDraft): number {
  return allocationQuarterCount(a) / 4;
}

/** Compact "rows 38–39" style summary for an allocation. */
export function allocationRowSummary(a: BlockAllocationDraft): string {
  const rows = Array.from(new Set(Object.values(a.quarters).map((q) => q.rowNumber))).sort((x, y) => x - y);
  if (!rows.length) return "No rows selected";
  const parts: string[] = [];
  let start = rows[0];
  let prev = rows[0];
  for (const n of rows.slice(1)) {
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `${rows.length === 1 ? "row" : "rows"} ${parts.join(", ")}`;
}

export function activityTotals(draft: PruningActivityDraft) {
  const allocations = Object.values(draft.allocations);
  const quarters = allocations.reduce((s, a) => s + allocationQuarterCount(a), 0);
  return {
    blocks: allocations.length,
    quarters,
    rowEquivalents: quarters / 4,
  };
}

/**
 * Readiness gate. Stays false until the shared parent-activity endpoint is
 * deployed on the VineTrack backend. While false the portal keeps using the
 * existing single-block Record Pruning dialog; the multi-block editor is
 * reachable only for preview/testing.
 */
export const PRUNING_ACTIVITY_CONTRACT_READY = false;
