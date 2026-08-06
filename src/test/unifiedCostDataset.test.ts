// Cost Report unified dataset — pruning activity inclusion contract.
import { describe, it, expect } from "vitest";
import {
  buildUnifiedCostDataset,
  aggregateBy,
  parentActivityTotal,
} from "@/lib/unifiedCostDataset";
import { applyActivityAllocations, type BaseActivityRow } from "@/lib/pruningActivityQuery";

const VINEYARD = "v1";
const TASK = "task-1";

const baseRow = (over: Partial<BaseActivityRow>): BaseActivityRow => ({
  id: "x", entry: {} as any, activityId: "act-1", date: "2026-08-04",
  seasonYear: 2026, pruningSeasonId: "s1", hasSeasonLink: true,
  expectedSeasonYear: 2026, seasonIssues: [], seasonMismatch: false,
  sourcePlatform: null, vintageYear: 2027, paddockId: "p1", blockName: "Block",
  variety: "Cabernet Franc", worker: "Sam", method: "spur", rowNumbers: [1],
  rowsLabel: "1", rowCount: 1, quarters: 8, rowEquivalents: 2, vines: 100,
  labourHours: null, startTime: null, finishTime: null, durationMinutes: null,
  vinesPerHour: null, rowEqPerHour: null, workTaskId: TASK,
  workTaskLabel: "Pruning", workTaskMissing: false, activityTitle: null,
  workTaskStatus: "open", labourCost: null, hourlyRate: null, notes: "",
  createdById: null, createdAt: "2026-08-04T08:00:00Z", updatedAt: null,
  isReversed: false,
  isSkipped: false, ...over,
});

function twoBlockActivity(over: Partial<BaseActivityRow> = {}) {
  return applyActivityAllocations([
    baseRow({
      id: "alloc-a", paddockId: "p-cab", blockName: "Cab Franc W1",
      variety: "Cabernet Franc", rowEquivalents: 2,
      labourHours: 13, labourCost: 455, ...over,
    }),
    baseRow({
      id: "alloc-b", paddockId: "p-sb", blockName: "Sauv Blanc E2",
      variety: "Sauvignon Blanc", rowEquivalents: 0.5, ...over,
    }),
  ]);
}

const trip = (over: any = {}) => ({
  id: "trip-alloc-1", vineyard_id: VINEYARD, trip_id: "trip-1",
  paddock_id: "p-cab", paddock_name: "Cab Franc W1", variety: "Cabernet Franc",
  season_year: 2026, allocation_area_ha: 2, yield_tonnes: 4,
  labour_cost: 100, fuel_cost: 50, chemical_cost: 0, input_cost: 0,
  total_cost: 150, trip_function: "spray", costing_status: "complete",
  warnings: [], calculated_at: "2026-03-01T00:00:00Z", ...over,
});

describe("unified cost dataset — pruning allocations", () => {
  it("includes pruning costs under vintage 2027", () => {
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      pruningRows: twoBlockActivity(),
      tripAllocations: [trip()] as any,
    });
    expect(ds.vintageYears).toContain(2027);
    const v2027 = ds.rows.filter((r) => r.vintage_year === 2027);
    expect(v2027).toHaveLength(2);
    expect(v2027.reduce((s, r) => s + r.total_cost, 0)).toBeCloseTo(455, 6);
  });

  it("aggregates by block, variety and function Pruning", () => {
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, pruningRows: twoBlockActivity() });
    const byBlock = aggregateBy(ds.rows, (r) => r.block_name ?? "—");
    expect(byBlock.find((b) => b.name === "Cab Franc W1")!.total).toBe(364);
    expect(byBlock.find((b) => b.name === "Sauv Blanc E2")!.total).toBe(91);

    const byVariety = aggregateBy(ds.rows, (r) => r.variety ?? "Unassigned");
    expect(byVariety.find((b) => b.name === "Cabernet Franc")!.total).toBe(364);
    expect(byVariety.find((b) => b.name === "Sauvignon Blanc")!.total).toBe(91);

    const byFn = aggregateBy(ds.rows, (r) => r.function ?? "unknown");
    expect(byFn).toHaveLength(1);
    expect(byFn[0].name).toBe("pruning");
    expect(byFn[0].total).toBe(455);
  });

  it("reconciles allocations back to the parent activity total exactly once", () => {
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, pruningRows: twoBlockActivity() });
    expect(ds.rows.reduce((s, r) => s + r.total_cost, 0)).toBeCloseTo(455, 6);
    // Parent counted once, not per allocation.
    expect(parentActivityTotal(ds.rows)).toBe(455);
  });

  it("does not duplicate the cost through the linked Work Task", () => {
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, pruningRows: twoBlockActivity() });
    expect(ds.linkedWorkTaskIds.has(TASK)).toBe(true);
    expect(new Set(ds.rows.map((r) => r.dedup_key)).size).toBe(ds.rows.length);
    expect(ds.rows.every((r) => r.dedup_key.startsWith("pruning_activity:act-1:"))).toBe(true);
  });

  it("drops reversed activities from active totals", () => {
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      pruningRows: twoBlockActivity({ isReversed: true }),
    });
    expect(ds.rows).toHaveLength(0);
    expect(ds.rows.reduce((s, r) => s + r.total_cost, 0)).toBe(0);
  });

  it("keeps trip allocations alongside pruning without collision", () => {
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      pruningRows: twoBlockActivity(),
      tripAllocations: [trip()] as any,
    });
    expect(ds.rows).toHaveLength(3);
    expect(ds.rows.reduce((s, r) => s + r.total_cost, 0)).toBeCloseTo(605, 6);
    expect(ds.vintageYears).toEqual([2027, 2026]);
  });

  it("flags pruning activities whose labour cost cannot be resolved", () => {
    const rows = applyActivityAllocations([
      baseRow({ id: "solo", workTaskId: null, workTaskLabel: null, labourCost: null }),
    ]);
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, pruningRows: rows });
    expect(ds.rows[0].total_cost).toBe(0);
    expect(ds.rows[0].warnings.length).toBeGreaterThan(0);
  });
});
