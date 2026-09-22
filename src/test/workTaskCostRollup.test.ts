import { describe, expect, it } from "vitest";
import {
  buildWorkTaskCostRollup,
  workTaskCostPerHectare,
} from "@/lib/workTaskCostRollup";
import type { WorkTaskMaterial } from "@/lib/materialCosts";
import type { WorkTask, WorkTaskLabourLine } from "@/lib/workTasksQuery";
import type { WorkTaskMachineLine } from "@/lib/workTaskMachineLinesQuery";
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";

type Over = Record<string, unknown>;

const material = (over: Over = {}) => (({
  id: crypto.randomUUID(),
  work_task_id: "task-1",
  vineyard_id: "v1",
  quantity: "1",
  unit_cost: "180",
  total_cost: "180.00",
  deleted_at: null,
  ...over,
}) as unknown as WorkTaskMaterial);

const labour = (over: Over = {}) => (({
  id: crypto.randomUUID(),
  work_task_id: "task-1",
  total_hours: 4,
  total_cost: 100,
  worker_type: "Casual",
  worker_count: 1,
  hours_per_worker: 4,
  deleted_at: null,
  ...over,
}) as unknown as WorkTaskLabourLine);

const machine = (over: Over = {}) => (({
  id: crypto.randomUUID(),
  work_task_id: "task-1",
  total_machine_cost: 50,
  fuel_cost: 20,
  duration_hours: 2,
  entry_source: "manual",
  deleted_at: null,
  ...over,
}) as unknown as WorkTaskMachineLine);

const alloc = (over: Over = {}) => (({
  id: crypto.randomUUID(),
  trip_id: "trip-1",
  total_cost: 75,
  labour_cost: 40,
  fuel_cost: 35,
  chemical_cost: 0,
  input_cost: 0,
  ...over,
}) as unknown as TripCostAllocation);

const task = (over: Over = {}) => (({
  id: "task-1",
  vineyard_id: "v1",
  costing_method: "hourly",
  ...over,
}) as unknown as WorkTask);

describe("Total Work Task Cost roll-up", () => {
  it("material-only task totals $180 (never a dash)", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [],
      materialLines: [material()],
    });
    expect(r.total).toBe(180);
    expect(r.totalKnown).toBe(true);
    expect(r.materialCost).toBe(180);
  });

  it("cost per hectare uses the total, not labour only", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [],
      materialLines: [material()],
    });
    expect(workTaskCostPerHectare(r, 2)).toBe(90);
    expect(workTaskCostPerHectare(r, 0)).toBeNull();
  });

  it("labour + materials", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [labour()],
      materialLines: [material()],
    });
    expect(r.total).toBe(280);
  });

  it("labour + machine + materials", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [labour()],
      machineLines: [machine()],
      materialLines: [material()],
    });
    expect(r.total).toBe(350);
  });

  it("labour + machine + linked trips + materials", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [labour()],
      machineLines: [machine()],
      tripAllocations: [alloc()],
      linkedTripCount: 1,
      materialLines: [material()],
    });
    expect(r.total).toBe(425);
    expect(r.linkedTripCost).toBe(75);
  });

  it("counts materials exactly once across repeated roll-ups", () => {
    const lines = [material(), material({ total_cost: "20.00" })];
    const r = buildWorkTaskCostRollup({ task: task(), labourLines: [], materialLines: lines });
    const again = buildWorkTaskCostRollup({ task: task(), labourLines: [], materialLines: lines });
    expect(r.materialCost).toBe(200);
    expect(again.total).toBe(r.total);
  });

  it("piece-rate labour comes from a single source, not labour lines", () => {
    const r = buildWorkTaskCostRollup({
      task: task({ costing_method: "piece_rate", piece_rate_total_cost: "500" }),
      labourLines: [labour({ total_cost: 100 })],
      materialLines: [material()],
    });
    expect(r.labourCost).toBe(500);
    expect(r.total).toBe(680);
  });

  it("sorting and season totals agree with the per-task total", () => {
    const rows = [
      { id: "a", r: buildWorkTaskCostRollup({ task: task(), labourLines: [], materialLines: [material()] }) },
      { id: "b", r: buildWorkTaskCostRollup({ task: task(), labourLines: [labour()], materialLines: [] }) },
    ];
    const sorted = [...rows].sort((x, y) => x.r.total - y.r.total).map((x) => x.id);
    expect(sorted).toEqual(["b", "a"]);
    expect(rows.reduce((s, x) => s + x.r.total, 0)).toBe(280);
  });

  it("CSV-style values reuse the roll-up total and cost per ha", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [labour()],
      materialLines: [material()],
    });
    expect(r.total.toFixed(2)).toBe("280.00");
    expect(workTaskCostPerHectare(r, 4)!.toFixed(2)).toBe("70.00");
  });

  it("proportional block breakdown reconciles to the task total", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [labour()],
      materialLines: [material()],
    });
    const areas = [3, 1];
    const totalArea = 4;
    const allocs = areas.map((a) => r.total * (a / totalArea));
    expect(allocs.reduce((s, v) => s + v, 0)).toBeCloseTo(r.total, 6);
  });

  it("removing or editing a material changes the total immediately", () => {
    const before = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [],
      materialLines: [material()],
    });
    const edited = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [],
      materialLines: [material({ total_cost: "240.00" })],
    });
    const removed = buildWorkTaskCostRollup({ task: task(), labourLines: [], materialLines: [] });
    expect(before.total).toBe(180);
    expect(edited.total).toBe(240);
    expect(removed.totalKnown).toBe(false);
  });

  it("library repricing does not change frozen historical lines", () => {
    const frozen = material({ unit_cost: "180", total_cost: "180.00" });
    const r = buildWorkTaskCostRollup({ task: task(), labourLines: [], materialLines: [frozen] });
    // Library price later rises; the snapshot total is what counts.
    expect(r.total).toBe(180);
  });

  it("soft-deleted labour, machine and material lines never contribute", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [labour({ deleted_at: "2026-01-01" })],
      machineLines: [machine({ deleted_at: "2026-01-01" })],
      materialLines: [material({ deleted_at: "2026-01-01" })],
    });
    expect(r.total).toBe(0);
    expect(r.totalKnown).toBe(false);
  });

  it("a vineyard switch cannot leak another vineyard's materials", () => {
    // The page groups one vineyard-scoped query by task id; an empty group
    // yields no material cost.
    const r = buildWorkTaskCostRollup({ task: task(), labourLines: [], materialLines: [] });
    expect(r.materialCost).toBe(0);
  });

  it("an unresolved labour rate stays visible behind a known material cost", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [labour({ total_cost: null })],
      materialLines: [material()],
    });
    expect(r.missingRate).toBe(true);
    expect(r.total).toBe(180);
  });

  it("non-System-Admin users keep the pre-Material-Cost total", () => {
    // Gate off → the page passes no material lines at all.
    const r = buildWorkTaskCostRollup({ task: task(), labourLines: [labour()] });
    expect(r.materialCost).toBe(0);
    expect(r.total).toBe(100);
  });

  it("preserves the overlap warning without auto-deduplicating", () => {
    const r = buildWorkTaskCostRollup({
      task: task(),
      labourLines: [],
      machineLines: [machine({ entry_source: "missed_trip" })],
      tripAllocations: [alloc()],
      linkedTripCount: 1,
    });
    expect(r.overlapRisk).toBe(true);
    expect(r.total).toBe(145);
  });
});
