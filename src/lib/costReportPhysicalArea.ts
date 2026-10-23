// Headline scope only: operational/allocation areas are never denominators.
import { reportBlockArea, type ReportBlock } from "@/lib/workTaskReportAllocation";
import { resolvePaddockAllocations, type GrapeVarietyMap } from "@/lib/varietyResolver";

interface PhysicalScope {
  blockNames?: readonly string[];
  variety?: string;
  varietyMap: GrapeVarietyMap;
}
export interface PhysicalCostArea {
  areaHa: number | null;
  blockIds: string[];
  warnings: string[];
}

export function resolveCostReportPhysicalArea(
  blocks: readonly ReportBlock[] | undefined,
  scope: PhysicalScope,
): PhysicalCostArea {
  const warnings: string[] = [];
  const blockIds: string[] = [];
  const unique = new Map((blocks ?? []).map((b) => [b.id, b]));
  const selected = [...unique.values()].filter((b) => !scope.blockNames || scope.blockNames.includes(b.name ?? ""));
  if (blocks == null) warnings.push("Physical block areas could not be loaded.");
  if (scope.blockNames?.some((name) => !selected.some((b) => b.name === name))) {
    warnings.push("A selected block's physical area could not be found.");
  }
  let total = 0;
  for (const block of selected) {
    let share = 1;
    if (scope.variety) {
      const allocations = resolvePaddockAllocations(block.variety_allocations, scope.varietyMap);
      // A primary-variety label on a cost row is not proof of physical share.
      // Require a complete, resolved percentage partition; never normalise it.
      const complete = allocations.length > 0 && allocations.every((a) =>
        a.resolved && a.percent != null && Number.isFinite(a.percent) && a.percent >= 0 && a.percent <= 100,
      ) && Math.abs(allocations.reduce((s, a) => s + (a.percent ?? 0), 0) - 100) < 0.000001;
      if (!complete) {
        warnings.push(`${block.name ?? block.id}: physical area for the selected variety cannot be reliably determined.`);
        continue;
      }
      share = allocations.filter((a) => a.name?.toLowerCase() === scope.variety?.toLowerCase())
        .reduce((s, a) => s + (a.percent ?? 0), 0) / 100;
      if (share === 0) continue;
    }
    blockIds.push(block.id);
    const area = reportBlockArea(block);
    if (area == null) warnings.push(`${block.name ?? block.id}: physical block area is unavailable.`);
    else total += area * share;
  }
  if (!blockIds.length && !warnings.length) warnings.push("No physical block area is available for the current scope.");
  return { areaHa: warnings.length || total <= 0 ? null : total, blockIds, warnings };
}

export function headlineCostMetrics(
  rows: readonly { total_cost?: number | null; allocation_area_ha?: number | null }[],
  physical: PhysicalCostArea,
) {
  const total = rows.reduce((s, r) => s + Number(r.total_cost ?? 0), 0);
  const treatedArea = rows.reduce((s, r) => s + Number(r.allocation_area_ha ?? 0), 0);
  return { total, treatedArea, costPerHa: physical.areaHa != null && physical.areaHa > 0 ? total / physical.areaHa : null };
}