// Pure aggregation helpers for the Pruning Activity Report charts.
//
// Contract (must match calculatePruningSummary):
//  - Reversed and skipped allocations are excluded.
//  - Labour hours / cost belong to the PARENT activity. Allocation rows carry
//    the activity's split (allocatedHours / allocatedCost), so summing the
//    allocation-level values reproduces the activity total exactly once — a
//    multi-block activity is never double-counted.
//  - Vines use the same recorded per-allocation vine counts as the KPIs.
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";

export interface DailyPruningPoint {
  date: string;
  label: string;
  vines: number;
  hours: number;
  cost: number;
  vinesPerHour: number | null;
  cumulativeVines: number;
  cumulativeHours: number;
}

export interface BlockProductivityPoint {
  paddockId: string;
  block: string;
  varieties: string[];
  vines: number;
  hours: number;
  cost: number;
  vinesPerHour: number | null;
  costPerVine: number | null;
}

/** Rows that contribute to any chart figure. */
export function chartableRows(rows: PruningActivityRow[]): PruningActivityRow[] {
  return rows.filter((r) => !r.isReversed && !r.isSkipped);
}

function dayKey(value: string | null): string | null {
  if (!value) return null;
  const raw = String(value);
  const iso = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function shortLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Daily series ordered oldest → newest, with running cumulative totals. */
export function buildDailyPruningSeries(rows: PruningActivityRow[]): DailyPruningPoint[] {
  const map = new Map<string, { vines: number; hours: number; cost: number }>();
  chartableRows(rows).forEach((r) => {
    const key = dayKey(r.date);
    if (!key) return;
    const bucket = map.get(key) ?? { vines: 0, hours: 0, cost: 0 };
    bucket.vines += r.vines;
    bucket.hours += r.allocatedHours ?? 0;
    bucket.cost += r.allocatedCost ?? 0;
    map.set(key, bucket);
  });

  let cumulativeVines = 0;
  let cumulativeHours = 0;
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => {
      cumulativeVines += b.vines;
      cumulativeHours += b.hours;
      return {
        date,
        label: shortLabel(date),
        vines: Math.round(b.vines * 100) / 100,
        hours: Math.round(b.hours * 100) / 100,
        cost: Math.round(b.cost * 100) / 100,
        vinesPerHour: b.hours > 0 ? b.vines / b.hours : null,
        cumulativeVines: Math.round(cumulativeVines * 100) / 100,
        cumulativeHours: Math.round(cumulativeHours * 100) / 100,
      };
    });
}

/** Per-block aggregates for the productivity bar chart. */
export function buildBlockProductivity(rows: PruningActivityRow[]): BlockProductivityPoint[] {
  const map = new Map<
    string,
    { block: string; varieties: Set<string>; vines: number; hours: number; cost: number }
  >();
  chartableRows(rows).forEach((r) => {
    const entry =
      map.get(r.paddockId) ??
      { block: r.blockName, varieties: new Set<string>(), vines: 0, hours: 0, cost: 0 };
    if (r.variety && r.variety !== "—") entry.varieties.add(r.variety);
    entry.vines += r.vines;
    entry.hours += r.allocatedHours ?? 0;
    entry.cost += r.allocatedCost ?? 0;
    map.set(r.paddockId, entry);
  });

  return Array.from(map.entries()).map(([paddockId, e]) => ({
    paddockId,
    block: e.block,
    varieties: Array.from(e.varieties).sort((a, b) => a.localeCompare(b)),
    vines: e.vines,
    hours: Math.round(e.hours * 100) / 100,
    cost: Math.round(e.cost * 100) / 100,
    vinesPerHour: e.hours > 0 ? e.vines / e.hours : null,
    costPerVine: e.vines > 0 && e.cost > 0 ? e.cost / e.vines : null,
  }));
}

export type BlockMetric = "vinesPerHour" | "vines" | "hours" | "costPerVine";

/** Ranked blocks for a metric. Cost / vine ranks cheapest first; everything
 *  else ranks highest first. Blocks with no value for the metric drop out. */
export function rankBlocks(
  points: BlockProductivityPoint[],
  metric: BlockMetric,
): BlockProductivityPoint[] {
  const value = (p: BlockProductivityPoint) => p[metric];
  const withValue = points.filter((p) => {
    const v = value(p);
    return typeof v === "number" && Number.isFinite(v) && v > 0;
  });
  const ascending = metric === "costPerVine";
  return withValue.sort((a, b) => {
    const av = (value(a) as number) ?? 0;
    const bv = (value(b) as number) ?? 0;
    return ascending ? av - bv : bv - av;
  });
}

/** Overall vines / labour hour across the filtered set — the reference line. */
export function overallVinesPerHour(rows: PruningActivityRow[]): number | null {
  let vines = 0;
  let hours = 0;
  chartableRows(rows).forEach((r) => {
    vines += r.vines;
    hours += r.allocatedHours ?? 0;
  });
  return hours > 0 ? vines / hours : null;
}
