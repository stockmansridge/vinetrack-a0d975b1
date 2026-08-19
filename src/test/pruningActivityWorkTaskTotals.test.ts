// SQL 200 — activity totals come from linked Work Tasks, split per block.
import { describe, it, expect } from "vitest";
import { aggregateLinkedWorkTasks, type LinkedWorkTaskSummary } from "@/lib/pruningActivityWorkTasks";
import { applyActivityAllocations, type BaseActivityRow } from "@/lib/pruningActivityQuery";

const task = (p: Partial<LinkedWorkTaskSummary>): LinkedWorkTaskSummary => ({
  taskId: crypto.randomUUID(), task: { id: "t" } as any,
  hours: 5, labourCost: 200, totalCost: 200, isPieceRate: false, lines: [], ...p,
});

const row = (o: Partial<BaseActivityRow>): BaseActivityRow => ({
  id: "x", entry: {} as any, activityId: "act-1", date: "2026-07-01", seasonYear: 2026,
  pruningSeasonId: "s1", hasSeasonLink: true, expectedSeasonYear: 2026, seasonIssues: [],
  seasonMismatch: false, sourcePlatform: null, vintageYear: 2027, paddockId: "p",
  blockName: "Block", variety: "—", worker: "Crew", method: "spur", rowNumbers: [1],
  rowsLabel: "1", rowCount: 1, quarters: 8, rowEquivalents: 1, vines: 100,
  labourHours: null, startTime: null, finishTime: null, durationMinutes: null,
  vinesPerHour: null, rowEqPerHour: null, workTaskId: null, workTaskLabel: null,
  workTaskMissing: false, activityTitle: null, workTaskStatus: null, labourCost: null,
  hourlyRate: null, notes: "", createdById: null, createdAt: "2026-07-01T08:00:00Z",
  updatedAt: null, isReversed: false, isSkipped: false, ...o,
});

describe("aggregateLinkedWorkTasks", () => {
  it("sums hours and cost across tasks, counting each task once", () => {
    const t = task({ taskId: "t1" });
    const a = aggregateLinkedWorkTasks([t, t, task({ taskId: "t2", hours: 3, totalCost: 90 })]);
    expect(a.taskCount).toBe(2);
    expect(a.hours).toBe(8);
    expect(a.cost).toBe(290);
  });

  it("reports unknown cost, never zero, when no task is costed", () => {
    const a = aggregateLinkedWorkTasks([task({ totalCost: null, labourCost: null })]);
    expect(a.cost).toBeNull();
    expect(a.hours).toBe(5);
  });

  it("is empty for an activity with no linked tasks", () => {
    expect(aggregateLinkedWorkTasks([]).taskCount).toBe(0);
    expect(aggregateLinkedWorkTasks([]).cost).toBeNull();
  });
});

describe("report rows use linked Work Task totals", () => {
  it("splits task hours and cost across blocks and ignores legacy labour", () => {
    const totals = aggregateLinkedWorkTasks([task({ hours: 10, totalCost: 350 })]);
    const rows = applyActivityAllocations(
      [
        row({ id: "a", rowEquivalents: 1, vines: 100, labourHours: 99, labourCost: 9999 }),
        row({ id: "b", rowEquivalents: 1, vines: 100, createdAt: "2026-07-01T08:05:00Z" }),
      ],
      null,
      new Map([["act-1", totals]]),
    );
    expect(rows.map((r) => r.allocatedHours)).toEqual([5, 5]);
    expect(rows.reduce((s, r) => s + (r.allocatedCost ?? 0), 0)).toBeCloseTo(350, 10);
    rows.forEach((r) => {
      expect(r.activityHours).toBe(10);
      expect(r.activityCost).toBe(350);
      expect(r.hourlyRate).toBeCloseTo(35, 6);
      expect(r.vinesPerHour).toBeCloseTo(20, 6);
    });
  });
});
