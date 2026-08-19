// Regression: block rows of a multi-block pruning activity must use their own
// allocated labour hours/cost for productivity and rate metrics.
import { describe, it, expect } from "vitest";
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
  worker: "Crew",
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
  isSkipped: false,
  ...over,
});

describe("multi-block pruning allocation metrics", () => {
  it("19 h / $665 across Pinot Gris and Sauv Blanc", () => {
    // Shares 46.2% / 53.8% -> row equivalents 6 / 6.987...
    const rows = applyActivityAllocations([
      baseRow({
        id: "pg", blockName: "Pinot Gris", variety: "Pinot Gris",
        rowEquivalents: 0.462, vines: 374,
        labourHours: 19, labourCost: 665, hourlyRate: 35,
        createdAt: "2026-07-01T08:00:00Z",
      }),
      baseRow({
        id: "sb", blockName: "Sauv Blanc", variety: "Sauvignon Blanc",
        rowEquivalents: 0.538, vines: 435,
        createdAt: "2026-07-01T08:05:00Z",
      }),
    ]);

    const pg = rows.find((r) => r.id === "pg")!;
    const sb = rows.find((r) => r.id === "sb")!;

    expect(pg.allocationShare).toBeCloseTo(0.462, 6);
    expect(sb.allocationShare).toBeCloseTo(0.538, 6);
    expect(pg.allocatedHours).toBe(8.78);
    expect(sb.allocatedHours).toBe(10.22);
    expect(pg.allocatedCost).toBeCloseTo(307.23, 2);
    expect(sb.allocatedCost).toBeCloseTo(357.77, 2);

    // Vines / hr uses the block's allocated hours, not the activity's 19 h.
    expect(pg.vinesPerHour!).toBeCloseTo(42.6, 1);
    expect(sb.vinesPerHour!).toBeCloseTo(42.6, 1);
    expect(sb.vinesPerHour!).toBeGreaterThan(40); // was 23 with activity hours

    // Rate / hr uses allocated cost / allocated hours.
    expect(pg.hourlyRate!).toBeCloseTo(35, 1);
    expect(sb.hourlyRate!).toBeCloseTo(35, 1);

    // Block rows sum back to the activity totals.
    expect(rows.reduce((s, r) => s + r.allocatedHours, 0)).toBeCloseTo(19, 10);
    expect(rows.reduce((s, r) => s + (r.allocatedCost ?? 0), 0)).toBeCloseTo(665, 10);
  });

  it("single-block activity keeps 100% of hours and cost", () => {
    const [row] = applyActivityAllocations([
      baseRow({ id: "only", vines: 400, rowEquivalents: 2, labourHours: 10, labourCost: 350 }),
    ]);
    expect(row.allocationShare).toBe(1);
    expect(row.allocatedHours).toBe(10);
    expect(row.allocatedCost).toBe(350);
    expect(row.vinesPerHour).toBe(40);
    expect(row.hourlyRate).toBe(35);
  });

  it("rounds cleanly across three blocks", () => {
    const rows = applyActivityAllocations([
      baseRow({ id: "a", blockName: "A", rowEquivalents: 1, vines: 100, labourHours: 10, labourCost: 100 }),
      baseRow({ id: "b", blockName: "B", rowEquivalents: 1, vines: 100, createdAt: "2026-07-01T08:01:00Z" }),
      baseRow({ id: "c", blockName: "C", rowEquivalents: 1, vines: 100, createdAt: "2026-07-01T08:02:00Z" }),
    ]);
    expect(rows.reduce((s, r) => s + r.allocatedHours, 0)).toBeCloseTo(10, 10);
    expect(rows.reduce((s, r) => s + (r.allocatedCost ?? 0), 0)).toBeCloseTo(100, 10);
    rows.forEach((r) => {
      expect(r.vinesPerHour!).toBeCloseTo(100 / r.allocatedHours, 6);
      expect(r.hourlyRate!).toBeCloseTo(10, 1);
    });
  });

  it("leaves rate and productivity null when the activity has no labour", () => {
    const rows = applyActivityAllocations([
      baseRow({ id: "n1", rowEquivalents: 1 }),
      baseRow({ id: "n2", rowEquivalents: 1, createdAt: "2026-07-01T09:00:00Z" }),
    ]);
    rows.forEach((r) => {
      expect(r.vinesPerHour).toBeNull();
      expect(r.hourlyRate).toBeNull();
    });
  });
});
