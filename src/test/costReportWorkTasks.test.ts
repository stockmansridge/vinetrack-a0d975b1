import { describe, expect, it } from "vitest";
import { aggregateBy, buildUnifiedCostDataset } from "@/lib/unifiedCostDataset";
import { buildWorkTaskCostRollup } from "@/lib/workTaskCostRollup";
import { distinctTripCount, resolveWorkTaskReportAllocation } from "@/lib/workTaskReportAllocation";
import { applyActivityAllocations, type BaseActivityRow } from "@/lib/pruningActivityQuery";
import type { WorkTask, WorkTaskPaddock, WorkTaskLabourLine } from "@/lib/workTasksQuery";
import type { WorkTaskMachineLine } from "@/lib/workTaskMachineLinesQuery";
import type { WorkTaskMaterial } from "@/lib/materialCosts";
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";

const vineyardId = "fe952afe-437f-4be7-8cbf-fdd8e630411c";
const task = (id = "t1", extra: Partial<WorkTask> = {}): WorkTask => ({ id, vineyard_id: vineyardId, paddock_id: "p1", vintage_year: 2027, task_type: "Shoot thinning", date: "2026-08-28", ...extra });
const labour = (id: string, cost: number, hours = 1): WorkTaskLabourLine => ({ id: `l-${id}`, vineyard_id: vineyardId, work_task_id: id, total_cost: cost, total_hours: hours });
const machine = (id: string, charge = 50, fuel = 20): WorkTaskMachineLine => ({ id: `m-${id}`, work_task_id: id, vineyard_id: vineyardId, total_machine_cost: charge, fuel_cost: fuel } as WorkTaskMachineLine);
const material = (id: string): WorkTaskMaterial => ({ id: `mat-${id}`, work_task_id: id, vineyard_id: vineyardId, total_cost: "180.00" } as WorkTaskMaterial);
const blocks = [{ id: "p1", name: "Shiraz", area_ha: 2 }, { id: "p2", name: "Cabernet", area_ha: 6 }];
const link = (id: string, pid: string, area: number | null = null): WorkTaskPaddock => ({ id: `${id}-${pid}`, work_task_id: id, vineyard_id: vineyardId, paddock_id: pid, area_ha: area } as WorkTaskPaddock);
function pruning(id = "t1", cost = 700) {
  return applyActivityAllocations([{
    id: "pruning-1", entry: {}, activityId: "activity-1", paddockId: "p1", blockName: "Shiraz", variety: "Shiraz",
    date: "2026-08-28", seasonYear: 2026, vintageYear: 2027, rowEquivalents: 4,
    labourHours: 20, labourCost: cost, workTaskId: id, workTaskLabel: "Pruning",
    isReversed: false, isSkipped: false, seasonIssues: [], worker: "Sam", vines: 999,
  } as BaseActivityRow]);
}
const trip = (id: string, pid = "p1"): TripCostAllocation => ({ id, vineyard_id: vineyardId, trip_id: "gps1", paddock_id: pid, total_cost: 75, labour_cost: 40, fuel_cost: 35, season_year: 2027 });
const total = (rows: { total_cost: number }[]) => rows.reduce((s, r) => s + r.total_cost, 0);

describe("central cost report Work Task regressions", () => {
  it("includes ordinary task functions and block costs", () => {
    const ds = buildUnifiedCostDataset({ vineyardId, blocks, workTasks: [{ task: task(), labourLines: [labour("t1", 4585)] }] });
    expect(total(ds.rows)).toBe(4585);
    expect(ds.rows[0]).toMatchObject({ source_type: "work_task", function: "shoot thinning", block_id: "p1", allocation_area_ha: 2, vintage_year: 2027 });
    expect(aggregateBy(ds.rows, (r) => r.function ?? "")[0].total).toBe(4585);
  });
  it("counts pruning labour once while retaining machine/fuel and frozen materials once", () => {
    const input = { task: task(), labourLines: [labour("t1", 700)], machineLines: [machine("t1")], materialLines: [material("t1")] };
    const ds = buildUnifiedCostDataset({ vineyardId, blocks, pruningRows: pruning(), workTasks: [input, input] });
    expect(total(ds.rows)).toBe(950);
    expect(ds.rows.reduce((s, r) => s + r.labour_cost, 0)).toBe(700);
    expect(ds.rows.reduce((s, r) => s + r.fuel_cost, 0)).toBe(20);
    expect(ds.rows.reduce((s, r) => s + r.other_cost, 0)).toBe(230);
    expect(ds.rows.reduce((s, r) => s + r.allocation_area_ha, 0)).toBe(2);
  });
  it("counts linked GPS allocations once and includes genuinely separate trips", () => {
    const gps = trip("a1");
    const input = { task: task(), labourLines: [labour("t1", 100)], tripAllocations: [gps], linkedTripCount: 1 };
    const ds = buildUnifiedCostDataset({ vineyardId, blocks, workTasks: [input], tripAllocations: [gps, gps, { ...trip("separate"), trip_id: "gps2" }] });
    expect(total(ds.rows)).toBe(buildWorkTaskCostRollup(input).total + 75);
    expect(distinctTripCount(ds.rows.filter((r) => r.source_type === "trip").map((r) => ({ trip_id: r.source_id })))).toBe(2);
  });
  it("does not suppress known task labour for an unresolved pruning cost", () => {
    const rows = pruning(); rows[0].allocatedCost = null;
    const ds = buildUnifiedCostDataset({ vineyardId, blocks, pruningRows: rows, workTasks: [{ task: task(), labourLines: [labour("t1", 700)] }] });
    expect(total(ds.rows)).toBe(700);
  });
  it("reconciles the owner supplied 28-task Vintage 2027 fixture, not fabricated live data", () => {
    const functions = ["Pruning", "Shoot thinning", "Removing Guards", "Wire Lifting", "Mulching"];
    const costs = [10678, 4585, 3465, 133, 76];
    const workTasks = Array.from({ length: 28 }, (_, i) => ({
      task: task(`t${i}`, { task_type: functions[i] ?? "Zero-cost task" }),
      labourLines: [labour(`t${i}`, costs[i] ?? 0, i === 0 ? 543.5 : 0)],
      machineLines: i === 4 ? [machine(`t${i}`, 0, 20.79)] : [],
    }));
    const ds = buildUnifiedCostDataset({ vineyardId, blocks, workTasks, pruningRows: pruning("t0", 10678) });
    expect(workTasks).toHaveLength(28);
    expect(workTasks.reduce((s, t) => s + buildWorkTaskCostRollup(t).labourHours, 0)).toBe(543.5);
    expect(ds.rows.reduce((s, r) => s + r.labour_cost, 0)).toBe(18937);
    expect(total(ds.rows)).toBeCloseTo(18957.79, 8);
    const byFunction = aggregateBy(ds.rows, (r) => r.function ?? "");
    expect(byFunction.find((r) => r.name === "mulching")?.total).toBe(96.79);
    expect(ds.rows.every((r) => r.vintage_year === 2027)).toBe(true);
  });
});

describe("shared report allocation evidence", () => {
  it("resolves polygon-only legacy block area and cost/ha, without using estimated vines", () => {
    const polygonBlock = { id: "p1", name: "Shiraz", polygon_points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }] };
    const r = resolveWorkTaskReportAllocation(task(), [link("t1", "p1")], [polygonBlock], pruning());
    expect(r.totalAreaHa).toBeCloseTo(1.2392029, 5);
    expect(700 / (r.totalAreaHa ?? 0)).toBeCloseTo(564.879, 2);
    expect(r.allocations[0].share).toBe(1);
    expect(r.warnings).toHaveLength(0);
  });
  it("preserves the saved 30 August area and $315 cost/ha", () => {
    const r = resolveWorkTaskReportAllocation(task("t1", { area_ha: 1.075619921875 }), [link("t1", "p1", 1.075619921875)], blocks, pruning());
    expect(r.totalAreaHa).toBe(1.075619921875);
    expect(315 / (r.totalAreaHa ?? 0)).toBeCloseTo(292.8543, 3);
  });
  it("uses canonical pruning shares for multi-block work and sums back to the exact task total", () => {
    const rows = pruning(); rows.push({ ...rows[0], id: "pruning-2", paddockId: "p2", rowEquivalents: 1, allocationShare: 0.2 });
    rows[0].allocationShare = 0.8;
    const r = resolveWorkTaskReportAllocation(task("t1", { area_ha: 3 }), [link("t1", "p1"), link("t1", "p2")], blocks, rows);
    expect(r.allocations.map((a) => a.share)).toEqual([0.8, 0.2]);
    expect(r.allocations.reduce((s, a) => s + 700 * a.share, 0)).toBe(700);
    expect(r.allocations.reduce((s, a) => s + (a.areaHa ?? 0), 0)).toBeCloseTo(3, 8);
  });
  it("normalises saved block shares even when task area differs", () => {
    const r = resolveWorkTaskReportAllocation(task("t1", { area_ha: 10 }), [link("t1", "p1", 2), link("t1", "p2", 6)], blocks);
    expect(r.allocations.map((a) => a.share)).toEqual([0.25, 0.75]);
    expect(r.allocations.reduce((s, a) => s + a.share * 100, 0)).toBe(100);
    expect(r.allocations.reduce((s, a) => s + (a.areaHa ?? 0), 0)).toBe(10);
  });
  it("retains an honest warning when row evidence cannot establish hectares", () => {
    const r = resolveWorkTaskReportAllocation(task(), [link("t1", "p1")], [], pruning());
    expect(r.totalAreaHa).toBeNull();
    expect(r.allocations).toEqual([{ blockId: "p1", share: 1, areaHa: null }]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("never silently drops cost or treats a partial block area sum as complete", () => {
    const r = resolveWorkTaskReportAllocation(task(), [link("t1", "p1", 2), link("t1", "p2")], []);
    expect(r.totalAreaHa).toBeNull();
    expect(r.allocations).toEqual([{ blockId: null, share: 1, areaHa: null }]);
  });
  it("counts multi-block trips by distinct IDs at every aggregation scope", () => {
    expect(distinctTripCount([trip("a1"), trip("a2", "p2"), { ...trip("a3"), trip_id: "gps2" }, { trip_id: null }])).toBe(2);
  });
});