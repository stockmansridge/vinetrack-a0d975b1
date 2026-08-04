// Parent pruning activity contract (multi-block allocations) — SQL 166.
//
// MODEL
//   Parent activity  -> date, worker/crew, method, start/finish, labour
//                       hours, hourly rate, notes, linked Work Task.
//   Allocation (n)   -> block (paddock), season, vintage, rows/quarters,
//                       row equivalents, vines.
//
// The multi-block editor NEVER writes one legacy pruning entry per block.
// Everything goes through the parent-activity RPCs in
// `src/lib/pruningActivityApi.ts`:
//   record_pruning_activity(p_payload jsonb)
//   update_pruning_activity(p_activity_id, p_activity, p_allocations)
//   get_pruning_activity(p_activity_id)
//   list_pruning_activities(p_vineyard_id, p_include_reversed)
//   reverse_pruning_activity(p_activity_id, p_reason)

export interface AllocationQuarter {
  rowNumber: number;
  segmentNumber: number; // 1..4 — the exact numbering used by the quarter grid
  paddockRowId: string | null;
  rowLabel: string;
  /** Vines represented by this single quarter (row vines / 4). */
  vines?: number;
}

export interface BlockAllocationDraft {
  paddockId: string;
  paddockName: string;
  variety: string;
  /** Keyed `${rowNumber}:${quarter}` so selections survive block switching. */
  quarters: Record<string, AllocationQuarter>;
  /** Server-resolved once saved; null for a brand-new allocation. */
  seasonId: string | null;
  /** Server-resolved allocation id (edit mode). */
  allocationId?: string | null;
  seasonYear?: number | null;
  vintageYear?: number | null;
}

export interface PruningActivityDraft {
  activityId: string | null;
  entryDate: string;
  worker: string;
  method: string;
  labourHours: number | null;
  hourlyRate: number | null;
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

/** Estimated vines for an allocation — Σ per-quarter vine estimates. */
export function allocationVines(a: BlockAllocationDraft): number {
  return Math.max(
    0,
    Math.round(Object.values(a.quarters).reduce((s, q) => s + (q.vines ?? 0), 0)),
  );
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
    vines: allocations.reduce((s, a) => s + allocationVines(a), 0),
  };
}

/** Segment payload in the exact shape the RPCs expect. */
export function allocationSegments(a: BlockAllocationDraft) {
  return Object.values(a.quarters)
    .sort((x, y) => x.rowNumber - y.rowNumber || x.segmentNumber - y.segmentNumber)
    .map((q) => ({
      row: q.rowNumber,
      segment: q.segmentNumber,
      row_id: q.paddockRowId ?? null,
      label: q.rowLabel,
    }));
}

/** Activity-level object shared by the create payload and the update RPC. */
export function activityObject(draft: PruningActivityDraft, vineyardId: string, id: string) {
  return {
    id,
    vineyard_id: vineyardId,
    entry_date: draft.entryDate,
    worker_or_crew: draft.worker,
    method: draft.method,
    start_time: draft.startTime,
    finish_time: draft.finishTime,
    labour_hours: draft.labourHours,
    hourly_rate: draft.hourlyRate,
    notes: draft.notes ?? "",
    work_task_id: draft.workTaskId,
    client_updated_at: new Date().toISOString(),
  };
}

export function allocationObjects(draft: PruningActivityDraft) {
  // One object per block, deduped by paddock_id and never empty — the backend
  // enforces a unique (activity_id, block) constraint, so a repeated or empty
  // allocation would blow up the save.
  const byPaddock = new Map<string, ReturnType<typeof allocationSegments>>();
  Object.values(draft.allocations).forEach((a) => {
    const segments = allocationSegments(a);
    if (!segments.length) return;
    const existing = byPaddock.get(a.paddockId) ?? [];
    const merged = [...existing, ...segments];
    const seen = new Set<string>();
    byPaddock.set(
      a.paddockId,
      merged.filter((s) => {
        const k = `${s.row}:${s.segment}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    );
  });
  return Array.from(byPaddock.entries()).map(([paddock_id, segments]) => {
    const alloc = draft.allocations[paddock_id];
    return {
      paddock_id,
      segments,
      estimated_vines: alloc ? allocationVines(alloc) : 0,
    };
  });
}


/** Nested payload for `record_pruning_activity(p_payload jsonb)`. */
export function buildActivityPayload(draft: PruningActivityDraft, vineyardId: string, id: string) {
  return {
    activity: activityObject(draft, vineyardId, id),
    allocations: allocationObjects(draft),
  };
}

/**
 * SQL 166 is live: the multi-block parent-activity contract is the default
 * path for every visible "New Pruning Activity" action and for editing.
 */
export const PRUNING_ACTIVITY_CONTRACT_READY = true;
