import { describe, it, expect } from "vitest";
import {
  buildBlockProductivity,
  buildDailyPruningSeries,
  overallVinesPerHour,
  rankBlocks,
} from "@/lib/pruningActivityCharts";
import { calculatePruningSummary } from "@/lib/pruningSummaryCalc";
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";

const row = (over: Partial<PruningActivityRow>): PruningActivityRow =>
  ({
    id: Math.random().toString(36).slice(2),
    groupKey: "g1",
    date: "2026-07-01",
    paddockId: "b1",
    blockName: "Block A",
    variety: "Shiraz",
    worker: "Crew",
    method: "Spur",
    rowNumbers: [],
    rowsLabel: "",
    rowCount: 0,
    quarters: 1,
    rowEquivalents: 0.25,
    vines: 100,
    allocationShare: 1,
    allocatedHours: 1,
    allocatedCost: 40,
    activityHours: 1,
    activityCost: 40,
    vinesPerHour: 100,
    isReversed: false,
    isSkipped: false,
    isPrimaryAllocation: true,
    ...over,
  }) as unknown as PruningActivityRow;

describe("pruning activity charts", () => {
  it("builds a daily series with cumulative totals", () => {
    const series = buildDailyPruningSeries([
      row({ date: "2026-07-02", vines: 200, allocatedHours: 2 }),
      row({ date: "2026-07-01", vines: 100, allocatedHours: 1 }),
      row({ date: "2026-07-01", vines: 50, allocatedHours: 1, paddockId: "b2", blockName: "Block B" }),
    ]);
    expect(series.map((p) => p.date)).toEqual(["2026-07-01", "2026-07-02"]);
    expect(series[0].vines).toBe(150);
    expect(series[0].hours).toBe(2);
    expect(series[0].vinesPerHour).toBe(75);
    expect(series[1].cumulativeVines).toBe(350);
    expect(series[1].cumulativeHours).toBe(4);
  });

  it("excludes reversed and skipped rows, matching the KPI contract", () => {
    const rows = [
      row({ vines: 100, allocatedHours: 1 }),
      row({ groupKey: "g2", vines: 999, allocatedHours: 9, isReversed: true }),
      row({ groupKey: "g3", vines: 500, allocatedHours: 5, isSkipped: true }),
    ];
    const series = buildDailyPruningSeries(rows);
    expect(series).toHaveLength(1);
    expect(series[0].vines).toBe(100);
    expect(overallVinesPerHour(rows)).toBe(100);
    expect(overallVinesPerHour(rows)).toBe(calculatePruningSummary(rows).vinesPerLabourHour);
  });

  it("never double-counts labour when an activity spans multiple blocks", () => {
    // One activity, two allocations, 4 person-hours split 50/50.
    const rows = [
      row({ groupKey: "gX", paddockId: "b1", blockName: "Block A", vines: 200, allocationShare: 0.5, allocatedHours: 2, allocatedCost: 50, activityHours: 4, activityCost: 100 }),
      row({ groupKey: "gX", paddockId: "b2", blockName: "Block B", vines: 200, allocationShare: 0.5, allocatedHours: 2, allocatedCost: 50, activityHours: 4, activityCost: 100, isPrimaryAllocation: false }),
    ];
    const summary = calculatePruningSummary(rows);
    const series = buildDailyPruningSeries(rows);
    expect(summary.labourHours).toBe(4);
    expect(series[0].hours).toBe(4);
    expect(series[0].cost).toBe(100);
    expect(series[0].vines).toBe(summary.vines);

    const blocks = buildBlockProductivity(rows);
    expect(blocks).toHaveLength(2);
    expect(blocks.reduce((s, b) => s + b.hours, 0)).toBe(4);
    expect(blocks[0].vinesPerHour).toBe(100);
    expect(blocks[0].costPerVine).toBe(0.25);
    expect(blocks[0].varieties).toEqual(["Shiraz"]);
  });

  it("ranks blocks high-to-low, and cost / vine low-to-high", () => {
    const points = buildBlockProductivity([
      row({ paddockId: "b1", blockName: "Block A", vines: 100, allocatedHours: 2, allocatedCost: 100 }),
      row({ groupKey: "g2", paddockId: "b2", blockName: "Block B", vines: 300, allocatedHours: 2, allocatedCost: 100 }),
    ]);
    expect(rankBlocks(points, "vinesPerHour").map((p) => p.block)).toEqual(["Block B", "Block A"]);
    expect(rankBlocks(points, "vines").map((p) => p.block)).toEqual(["Block B", "Block A"]);
    expect(rankBlocks(points, "costPerVine").map((p) => p.block)).toEqual(["Block B", "Block A"]);
  });

  it("returns an empty series when nothing matches", () => {
    expect(buildDailyPruningSeries([])).toEqual([]);
    expect(buildBlockProductivity([])).toEqual([]);
    expect(overallVinesPerHour([])).toBeNull();
  });
});
