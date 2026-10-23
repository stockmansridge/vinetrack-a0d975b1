// Read-only report allocation. Stored task/link areas win; mapped block area
// uses the same deriveMetrics fallback as the Work Task drawer. Pruning shares
// reuse the canonical activity allocation shares, never estimated vine counts.
import { deriveMetrics } from "@/lib/paddockGeometry";
import type { WorkTask, WorkTaskPaddock } from "@/lib/workTasksQuery";
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";
import { allocateActivityShares } from "@/lib/pruningActivityAllocation";

export interface ReportBlock {
  id: string;
  name: string | null;
  area_ha?: number | null;
  [key: string]: unknown;
}
export interface ReportAllocation {
  blockId: string | null;
  share: number;
  areaHa: number | null;
}
export interface TaskReportAllocation {
  totalAreaHa: number | null;
  allocations: ReportAllocation[];
  basis: string;
  warnings: string[];
}
const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
export function reportBlockArea(block: ReportBlock | undefined): number | null {
  if (!block) return null;
  return positive(block.area_ha) ?? positive(deriveMetrics(block).areaHa);
}
export function pruningTaskIds(row: PruningActivityRow): string[] {
  return [...new Set([row.workTaskId, ...(row.linkedWorkTaskIds ?? [])].filter((id): id is string => !!id))];
}

export function resolveWorkTaskReportAllocation(
  task: WorkTask,
  links: ReadonlyArray<WorkTaskPaddock>,
  blocks: ReadonlyArray<ReportBlock>,
  pruningRows: ReadonlyArray<PruningActivityRow> = [],
): TaskReportAllocation {
  const activeLinks = links.filter((l) => !l.deleted_at && l.work_task_id === task.id);
  const pruning = pruningRows.filter((p) => !p.isReversed && !p.isSkipped && pruningTaskIds(p).includes(task.id));
  const ids = [...new Set([
    ...activeLinks.map((l) => l.paddock_id),
    ...(task.paddock_id ? [task.paddock_id] : []),
    ...pruning.map((p) => p.paddockId),
  ])];
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const areas = ids.map((id) => positive(activeLinks.find((l) => l.paddock_id === id)?.area_ha) ?? reportBlockArea(blockMap.get(id)));
  const storedTotal = positive(task.area_ha);
  const linkAreas = ids.map((id) => positive(activeLinks.find((l) => l.paddock_id === id)?.area_ha));
  // A partial sum must never masquerade as a complete task area.
  const allLinksKnown = ids.length > 0 && linkAreas.every((a) => a != null);
  const allBlocksKnown = ids.length > 0 && areas.every((a) => a != null);
  const totalAreaHa = storedTotal ?? (allLinksKnown ? linkAreas.reduce<number>((s, a) => s + (a ?? 0), 0) : null)
    ?? (allBlocksKnown ? areas.reduce<number>((s, a) => s + (a ?? 0), 0) : null);
  const weights = new Map<string, number>();
  // Reuse the established allocation engine, including server shares. Several
  // activities on a task are weighted by their recorded total row equivalents.
  const groups = new Map<string, PruningActivityRow[]>();
  for (const p of pruning) {
    const group = groups.get(p.groupKey) ?? [];
    if (!group.some((r) => r.id === p.id)) group.push(p);
    groups.set(p.groupKey, group);
  }
  for (const group of groups.values()) {
    const rowEq = group.reduce((s, p) => s + Math.max(0, p.rowEquivalents), 0);
    const shares = allocateActivityShares(group.map((p) => ({ id: p.id, rowEquivalents: p.rowEquivalents, serverShare: p.allocationShare })), null, null);
    group.forEach((p, i) => weights.set(p.paddockId, (weights.get(p.paddockId) ?? 0) + rowEq * shares[i].share));
  }
  const rowTotal = ids.reduce((s, id) => s + (weights.get(id) ?? 0), 0);
  const hasPruningShares = ids.length > 0 && rowTotal > 0 && ids.every((id) => (weights.get(id) ?? 0) > 0);
  const areaTotal = areas.reduce<number>((s, a) => s + (a ?? 0), 0);
  const warnings: string[] = [];
  if (totalAreaHa == null) warnings.push("Allocated area is unavailable: no complete saved area or mapped block area is recorded.");
  let basis = storedTotal ? "task_area" : allLinksKnown ? "saved_block_area" : "mapped_block_area";
  if (!ids.length || (!hasPruningShares && !allBlocksKnown && ids.length > 1)) {
    warnings.push("Block cost share is unavailable: record complete block areas or pruning allocations.");
    return { totalAreaHa, allocations: [{ blockId: null, share: 1, areaHa: totalAreaHa }], basis: "unallocated", warnings };
  }
  if (hasPruningShares) basis += ":pruning_row_equivalents";
  const allocations = ids.map((id, i) => {
    const share = ids.length === 1 ? 1 : hasPruningShares ? (weights.get(id) ?? 0) / rowTotal : (areas[i] ?? 0) / areaTotal;
    // Without a task snapshot, preserve each block's own resolved area. With
    // a snapshot, apportion that exact total by the same cost-share weights.
    return { blockId: id, share, areaHa: storedTotal ? storedTotal * share : areas[i] };
  });
  return { totalAreaHa, allocations, basis, warnings };
}

export function distinctTripCount(rows: ReadonlyArray<{ trip_id?: string | null }>): number {
  return new Set(rows.map((r) => r.trip_id).filter((id): id is string => !!id)).size;
}