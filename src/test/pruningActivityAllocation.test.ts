// Regression: a two-block pruning activity must show informational allocated
// labour/cost on BOTH blocks, reconcile back to the parent totals, and never
// double-count report totals.
import { describe, it, expect } from "vitest";
import { allocateActivityShares } from "@/lib/pruningActivityAllocation";
import { applyActivityAllocations, type BaseActivityRow } from "@/lib/pruningActivityQuery";

const baseRow = (over: Partial<BaseActivityRow>): BaseActivityRow => ({
  id: "x",
  entry: {} as any,
  activityId: "act-1",
  date: "2026-07-01",
  seasonYear: 2026,
  pruningSeasonId: "s1",
  hasSeasonLink: true,
  expectedSeasonYear: 2026,
  seasonIssues: [],
  seasonMismatch: false,
  sourcePlatform: null,
  vintageYear: 2027,
  paddockId: "p",
  blockName: "Block",
  variety: "—",
  worker: "Sam",
  method: "spur",
  rowNumbers: [1],
  rowsLabel: "1",
  rowCount: 1,
  quarters: 8,
  rowEquivalents: 2,
  vines: 100,
  labourHours: null,
  startTime: null,
  finishTime: null,
  durationMinutes: null,
  vinesPerHour: null,
  rowEqPerHour: null,
  workTaskId: "task-1",
  workTaskLabel: "Pruning",
  workTaskMissing: false,
  activityTitle: null,

  workTaskStatus: "open",
  labourCost: null,
  hourlyRate: null,
  notes: "",
  createdById: null,
  createdAt: "2026-07-01T08:00:00Z",
  updatedAt: null,
  isReversed: false,
  ...over,
});

describe("pruning activity allocation", () => {
  it("splits 13 h / $455 across 2.00 and 0.50 row equivalents", () => {
    const split = allocateActivityShares(
      [
        { id: "primitivo", rowEquivalents: 2 },
        { id: "cab-franc", rowEquivalents: 0.5 },
      ],
      13,
      455,
    );
    expect(split.map((s) => s.hours)).toEqual([10.4, 2.6]);
    expect(split.map((s) => s.cost)).toEqual([364, 91]);
    expect(split.reduce((s, a) => s + a.hours, 0)).toBeCloseTo(13, 10);
    expect(split.reduce((s, a) => s + a.cost, 0)).toBeCloseTo(455, 10);
  });

  it("reconciles rounding remainders onto the largest allocation", () => {
    const split = allocateActivityShares(
      [
        { id: "a", rowEquivalents: 1 },
        { id: "b", rowEquivalents: 1 },
        { id: "c", rowEquivalents: 1 },
      ],
      10,
      100,
    );
    expect(split.reduce((s, a) => s + a.hours, 0)).toBeCloseTo(10, 10);
    expect(split.reduce((s, a) => s + a.cost, 0)).toBeCloseTo(100, 10);
  });

  it("gives both allocations of one activity labour and cost without double-counting", () => {
    const rows = applyActivityAllocations([
      baseRow({ id: "alloc-primary", blockName: "Primitivo", rowEquivalents: 2, labourHours: 13, labourCost: 455, hourlyRate: 35 }),
      baseRow({ id: "alloc-second", blockName: "Cabernet Franc", rowEquivalents: 0.5, labourHours: null, labourCost: null }),
    ]);

    // Both rows open the SAME parent activity editor.
    expect(new Set(rows.map((r) => r.activityId))).toEqual(new Set(["act-1"]));
    expect(new Set(rows.map((r) => r.groupKey)).size).toBe(1);
    rows.forEach((r) => expect(r.activityBlockCount).toBe(2));

    const primitivo = rows.find((r) => r.blockName === "Primitivo")!;
    const cab = rows.find((r) => r.blockName === "Cabernet Franc")!;

    expect(primitivo.allocatedHours).toBe(10.4);
    expect(primitivo.allocatedCost).toBe(364);
    expect(cab.allocatedHours).toBe(2.6);
    expect(cab.allocatedCost).toBe(91);

    // Parent totals ride along on every row but display once.
    expect(rows.every((r) => r.activityHours === 13 && r.activityCost === 455)).toBe(true);
    expect(rows.filter((r) => r.isPrimaryAllocation)).toHaveLength(1);

    // Report totals: allocated sums back to the parent, activity totals counted once.
    const allocatedHours = rows.reduce((s, r) => s + r.allocatedHours, 0);
    const allocatedCost = rows.reduce((s, r) => s + (r.allocatedCost ?? 0), 0);
    const seen = new Set<string>();
    let activityHours = 0;
    let activityCost = 0;
    rows.forEach((r) => {
      if (seen.has(r.groupKey)) return;
      seen.add(r.groupKey);
      activityHours += r.activityHours ?? 0;
      activityCost += r.activityCost ?? 0;
    });

    expect(allocatedHours).toBeCloseTo(13, 10);
    expect(allocatedCost).toBeCloseTo(455, 10);
    expect(activityHours).toBe(13);
    expect(activityCost).toBe(455);
    expect(activityHours).not.toBe(26);
    expect(activityCost).not.toBe(910);
  });
});
