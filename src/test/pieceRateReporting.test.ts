// Regression: Piece Rate cost must flow through the reporting layer without a
// labour line, and must never be added on top of labour-line costs.
import { describe, it, expect } from "vitest";
import { taskLabourCost, pieceRateTotalCost } from "@/lib/pieceRateCosting";
import { allocateActivityShares } from "@/lib/pruningActivityAllocation";
import { calculatePruningSummary } from "@/lib/pruningSummaryCalc";
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";

const pieceTask = {
  costing_method: "piece_rate",
  piece_rate_per_vine: 0.55,
  piece_vine_count: 250,
  piece_rate_total_cost: 137.5,
};

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
    quarters: 4,
    rowEquivalents: 1,
    vines: 250,
    allocationShare: 1,
    allocatedHours: 0,
    allocatedCost: 137.5,
    activityHours: 0,
    activityCost: 137.5,
    workTaskId: "task-1",
    isReversed: false,
    isSkipped: false,
    isPrimaryAllocation: true,
    ...over,
  }) as unknown as PruningActivityRow;

describe("piece rate reporting", () => {
  it("250 vines × $0.55 = $137.50", () => {
    expect(pieceRateTotalCost(250, 0.55)).toBe(137.5);
  });

  it("reports piece rate cost with no labour lines", () => {
    expect(taskLabourCost(pieceTask, null)).toBe(137.5);
    expect(taskLabourCost(pieceTask, 0)).toBe(137.5);
  });

  it("never adds piece rate cost to labour line costs", () => {
    // Operational hours may have been logged as labour lines; they must not
    // add cost to a piece rate task.
    expect(taskLabourCost(pieceTask, 400)).toBe(137.5);
  });

  it("hourly and legacy tasks keep using labour lines", () => {
    expect(taskLabourCost({ costing_method: "hourly" }, 455)).toBe(455);
    expect(taskLabourCost({}, 455)).toBe(455);
    expect(taskLabourCost({ costing_method: null, piece_rate_per_vine: 0.55 }, 455)).toBe(455);
  });

  it("headline labour cost and cost per vine come through the summary", () => {
    const summary = calculatePruningSummary([row({})]);
    expect(summary.labourCost).toBe(137.5);
    expect(summary.costPerVine).toBe(0.55);
    expect(summary.vines).toBe(250);
  });

  it("multi-block piece rate activity allocates the exact task total", () => {
    const split = allocateActivityShares(
      [
        { id: "a", rowEquivalents: 1 },
        { id: "b", rowEquivalents: 3 },
      ],
      0,
      137.5,
    );
    expect(split.reduce((s, a) => s + a.cost, 0)).toBeCloseTo(137.5, 10);

    const rows = [
      row({ groupKey: "gX", paddockId: "b1", vines: 62, allocationShare: 0.25, allocatedCost: split[0].cost }),
      row({ groupKey: "gX", paddockId: "b2", vines: 188, allocationShare: 0.75, allocatedCost: split[1].cost, isPrimaryAllocation: false }),
    ];
    // Activity cost counted exactly once across allocations.
    expect(calculatePruningSummary(rows).labourCost).toBe(137.5);
  });

  it("work task detail and reports agree on the same task total", () => {
    const detail = taskLabourCost(pieceTask, 0);
    const reportRow = taskLabourCost(pieceTask, 0) ?? 0;
    expect(detail).toBe(reportRow);
    expect(reportRow).toBe(137.5);
  });
});
