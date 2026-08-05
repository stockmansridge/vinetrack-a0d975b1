// Shared pruning summary calculator.
//
// One authoritative set of formulas consumed by BOTH the Pruning Tracker and
// the Pruning Activity Report so the two pages can never drift apart.
//
// Rules of the contract:
//  - Reversed entries are always excluded from active totals.
//  - Vines come from the recorded per-allocation vine count.
//  - Labour hours and labour cost are properties of the PARENT activity,
//    not of an allocation. Each parent activity (or legacy entry) is counted
//    exactly once, so a two-block activity never doubles its labour.
//  - Linked Work Task labour lines are the authoritative person-hours source.
//    Legacy activity labour hours are used only when no labour lines exist,
//    and the result is flagged so the UI can label it as estimated.
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";

export interface PruningSummary {
  /** Distinct parent activities (legacy entries count as one activity each). */
  activities: number;
  /** Allocation rows included (block-level attribution rows). */
  allocations: number;
  /** Distinct blocks represented. */
  blocks: number;
  /** Vines pruned across the included allocations. */
  vines: number;
  /** Row equivalents completed across the included allocations. */
  rowEquivalents: number;
  /** Quarters completed across the included allocations. */
  quarters: number;
  /** Person-hours, each activity counted once. */
  labourHours: number;
  /** Labour cost, each activity / linked Work Task counted once. */
  labourCost: number;
  /** Vines ÷ person-hours. Null when there are no hours. */
  vinesPerLabourHour: number | null;
  /** Labour cost ÷ vines. Null when there are no vines. */
  costPerVine: number | null;
  /** Vines belonging to activities that actually carry a labour cost. */
  costedVines: number;
  /** True when any included hours came from a non person-hour fallback. */
  usesEstimatedHours: boolean;
  /** Reversed rows seen in the input (excluded from every figure above). */
  reversedCount: number;
}

export const EMPTY_PRUNING_SUMMARY: PruningSummary = {
  activities: 0, allocations: 0, blocks: 0, vines: 0, rowEquivalents: 0,
  quarters: 0, labourHours: 0, labourCost: 0, vinesPerLabourHour: null,
  costPerVine: null, costedVines: 0, usesEstimatedHours: false, reversedCount: 0,
};

/**
 * Calculates the shared pruning headline figures from allocation rows.
 * Pass the already-filtered rows (vineyard, season, dates, blocks, worker,
 * method); this function only applies the reversal rule.
 */
export function calculatePruningSummary(rows: PruningActivityRow[]): PruningSummary {
  const reversedCount = rows.filter((r) => r.isReversed).length;
  const active = rows.filter((r) => !r.isReversed);
  if (!active.length) return { ...EMPTY_PRUNING_SUMMARY, reversedCount };

  const blocks = new Set<string>();
  let vines = 0;
  let rowEquivalents = 0;
  let quarters = 0;

  active.forEach((r) => {
    blocks.add(r.paddockId);
    vines += r.vines;
    rowEquivalents += r.rowEquivalents;
    quarters += r.quarters;
  });

  // Parent-level labour: one entry per activity group.
  const seen = new Set<string>();
  let labourHours = 0;
  let labourCost = 0;
  let usesEstimatedHours = false;
  const costedGroups = new Set<string>();

  active.forEach((r) => {
    if (seen.has(r.groupKey)) return;
    seen.add(r.groupKey);
    const hours = r.activityHours ?? 0;
    labourHours += hours;
    if (hours > 0 && !r.workTaskId) usesEstimatedHours = true;
    const cost = r.activityCost ?? 0;
    labourCost += cost;
    if (cost > 0) costedGroups.add(r.groupKey);
  });

  const costedVines = active.reduce(
    (sum, r) => sum + (costedGroups.has(r.groupKey) ? r.vines : 0),
    0,
  );

  return {
    activities: seen.size,
    allocations: active.length,
    blocks: blocks.size,
    vines,
    rowEquivalents,
    quarters,
    labourHours,
    labourCost,
    vinesPerLabourHour: labourHours > 0 ? vines / labourHours : null,
    costPerVine: vines > 0 && labourCost > 0 ? labourCost / vines : null,
    costedVines,
    usesEstimatedHours,
    reversedCount,
  };
}

/** Season-scoped convenience wrapper used by the Pruning Tracker. */
export function calculateSeasonPruningSummary(
  rows: PruningActivityRow[],
  seasonYear: number | null,
): PruningSummary {
  const scoped = seasonYear == null
    ? rows
    : rows.filter((r) => r.hasSeasonLink && r.seasonYear === seasonYear);
  return calculatePruningSummary(scoped);
}
