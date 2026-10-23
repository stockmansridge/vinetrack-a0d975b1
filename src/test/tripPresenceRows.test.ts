// Cost Report — completed-Trip presence rows (uncosted trips).
//
// Contract: Trip EXISTENCE/counts come from active completed Trips, while
// trip_cost_allocations remains the authority for cost. A completed Trip with
// no active saved allocation enters the unified dataset as a zero-cost,
// zero-area "uncosted" presence row — never inventing dollars.
import { describe, it, expect } from "vitest";
import {
  buildUnifiedCostDataset,
  tripPresenceRows,
  tripBlockIds,
  isCompletedTrip,
  TRIP_PRESENCE_WARNING,
} from "@/lib/unifiedCostDataset";
import type { Trip } from "@/lib/tripsQuery";
import type { ReportBlock } from "@/lib/workTaskReportAllocation";

const VINEYARD = "v1";
// Season boundary: 1 July (Vintage 2027 = 1 Jul 2026 – 30 Jun 2027).
const SEASON = { month: 7, day: 1 };

const BLOCKS: ReportBlock[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Shiraz W1" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Cab Franc E2" },
];

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  vineyard_id: VINEYARD,
  paddock_id: BLOCKS[0].id,
  paddock_ids: [BLOCKS[0].id],
  paddock_name: "Shiraz W1",
  trip_function: "mulching",
  person_name: "Sam",
  start_time: "2026-09-08T01:00:00Z",
  end_time: "2026-09-08T03:00:00Z",
  is_active: false,
  deleted_at: null,
  ...over,
});

const allocation = (over: any = {}) => ({
  id: "alloc-1", vineyard_id: VINEYARD, trip_id: trip().id,
  paddock_id: BLOCKS[0].id, paddock_name: "Shiraz W1", variety: "Shiraz",
  season_year: 2027, allocation_area_ha: 1.5, yield_tonnes: 0,
  labour_cost: 40, fuel_cost: 30, chemical_cost: 0, input_cost: 0,
  total_cost: 70, trip_function: "mulching", costing_status: "complete",
  warnings: [], calculated_at: "2026-09-08T04:00:00Z", ...over,
});

const presenceOf = (ds: ReturnType<typeof buildUnifiedCostDataset>, tripId: string) =>
  ds.rows.filter((r) => r.source_type === "trip" && r.source_id === tripId && r.status === "uncosted");

describe("trip presence rows — uncosted completed Trips", () => {
  it("1. completed Trip with no saved allocation is included once as presence", () => {
    const t = trip();
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, trips: [t], blocks: BLOCKS, seasonStart: SEASON });
    const rows = presenceOf(ds, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].warnings).toContain(TRIP_PRESENCE_WARNING);
    expect(rows[0].function).toBe("mulching");
    expect(rows[0].worker).toBe("Sam");
    expect(rows[0].block_name).toBe("Shiraz W1");
  });

  it("2. completed Trip with saved allocations gets no presence duplicate", () => {
    const t = trip();
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD, trips: [t], tripAllocations: [allocation()], blocks: BLOCKS, seasonStart: SEASON,
    });
    expect(presenceOf(ds, t.id)).toHaveLength(0);
    expect(ds.rows.filter((r) => r.source_id === t.id)).toHaveLength(1);
  });

  it("3. one missing-allocation Trip with 8 block ids => 8 zero-cost rows, distinct Trip count 1", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `33333333-3333-3333-3333-33333333333${i}`);
    const t = trip({ paddock_ids: ids, paddock_id: null });
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, trips: [t], blocks: [], seasonStart: SEASON });
    const rows = presenceOf(ds, t.id);
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.total_cost === 0 && r.allocation_area_ha === 0)).toBe(true);
    expect(new Set(rows.map((r) => r.source_id)).size).toBe(1);
  });

  it("4. active / in-progress Trip is not included", () => {
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      trips: [trip({ is_active: true, end_time: null }), trip({ id: "b", end_time: null, is_active: false })],
      blocks: BLOCKS, seasonStart: SEASON,
    });
    expect(ds.rows).toHaveLength(0);
  });

  it("5. deleted Trip is not included", () => {
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      trips: [trip({ deleted_at: "2026-09-09T00:00:00Z" })],
      blocks: BLOCKS, seasonStart: SEASON,
    });
    expect(ds.rows).toHaveLength(0);
  });

  it("6. presence rows add $0 cost and 0 treated area", () => {
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      trips: [trip()],
      tripAllocations: [allocation({ trip_id: "other-trip", id: "alloc-2" })],
      blocks: BLOCKS, seasonStart: SEASON,
    });
    expect(ds.rows.reduce((s, r) => s + r.total_cost, 0)).toBeCloseTo(70, 6);
    expect(ds.rows.reduce((s, r) => s + r.allocation_area_ha, 0)).toBeCloseTo(1.5, 6);
  });

  it("7. function aggregation: $97 Work Task + uncosted Mulching Trip => $97, trip present", () => {
    const task: any = {
      id: "task-1", vineyard_id: VINEYARD, task_type: "Mulching",
      start_date: "2026-09-08", date: "2026-09-08", status: "completed",
      deleted_at: null, paddock_name: "Shiraz W1",
    };
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      trips: [trip()],
      blocks: BLOCKS, seasonStart: SEASON,
      workTasks: [{
        task, vintageYear: 2027,
        labourLines: [], machineLines: [], materialLines: [],
        effectiveLabourCost: { effectiveCost: 97, labourHours: 2, source: "lines" } as any,
      }],
      taskPaddocks: [{ work_task_id: "task-1", paddock_id: BLOCKS[0].id } as any],
    });
    const mulching = ds.rows.filter((r) => r.function === "mulching");
    const total = mulching.reduce((s, r) => s + r.total_cost, 0);
    expect(total).toBeCloseTo(97, 6);
    const tripIds = new Set(mulching.filter((r) => r.source_type === "trip").map((r) => r.source_id));
    expect(tripIds.size).toBe(1);
  });

  it("8. two Spray Trips, one costed + one uncosted => 2 distinct trips, cost unchanged", () => {
    const costed = trip({ id: "spray-costed", trip_function: "spraying" });
    const uncosted = trip({ id: "spray-uncosted", trip_function: "spraying", start_time: "2026-09-23T01:00:00Z", end_time: "2026-09-23T03:00:00Z" });
    const ds = buildUnifiedCostDataset({
      vineyardId: VINEYARD,
      trips: [costed, uncosted],
      tripAllocations: [allocation({ trip_id: "spray-costed", trip_function: "spraying", total_cost: 210 })],
      blocks: BLOCKS, seasonStart: SEASON,
    });
    const spray = ds.rows.filter((r) => r.function === "spraying");
    expect(new Set(spray.map((r) => r.source_id)).size).toBe(2);
    expect(spray.reduce((s, r) => s + r.total_cost, 0)).toBeCloseTo(210, 6);
  });

  it("9. vintage derived from the vineyard season boundary (1 July)", () => {
    const before = trip({ id: "t-jun", start_time: "2026-06-30T01:00:00Z", end_time: "2026-06-30T03:00:00Z" });
    const after = trip({ id: "t-jul", start_time: "2026-07-01T01:00:00Z", end_time: "2026-07-01T03:00:00Z" });
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, trips: [before, after], blocks: BLOCKS, seasonStart: SEASON });
    expect(presenceOf(ds, "t-jun")[0].vintage_year).toBe(2026);
    expect(presenceOf(ds, "t-jul")[0].vintage_year).toBe(2027);
    expect(presenceOf(ds, "t-jul")[0].operation_year).toBe(2026);
  });

  it("10. presence rows carry block/function/status dimensions for filters", () => {
    const t = trip({ trip_function: null });
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, trips: [t], blocks: BLOCKS, seasonStart: SEASON });
    const row = presenceOf(ds, t.id)[0];
    expect(row.block_id).toBe(BLOCKS[0].id);
    expect(row.function).toBe("unknown"); // null function stays Unknown — never guessed from the title
    expect(row.status).toBe("uncosted");
    expect(ds.vintageYears).toContain(2027);
  });

  it("11. trip_cost_allocations-only behaviour is unchanged when no trips are passed", () => {
    const ds = buildUnifiedCostDataset({ vineyardId: VINEYARD, tripAllocations: [allocation()] });
    expect(ds.rows).toHaveLength(1);
    expect(ds.rows[0].total_cost).toBe(70);
    expect(ds.rows[0].status).toBe("complete");
  });

  it("falls back to scalar paddock_id and to one unallocated row", () => {
    const scalar = trip({ paddock_ids: null, paddock_id: BLOCKS[1].id });
    expect(tripBlockIds(scalar)).toEqual([BLOCKS[1].id]);
    const none = trip({ paddock_ids: null, paddock_id: null, paddock_name: "Legacy name" });
    const rows = tripPresenceRows(none, VINEYARD, BLOCKS, SEASON);
    expect(rows).toHaveLength(1);
    expect(rows[0].block_id).toBeNull();
    expect(rows[0].block_name).toBe("Legacy name");
  });

  it("normalises UUID case and dedupes repeated block ids", () => {
    const t = trip({ paddock_ids: [BLOCKS[0].id.toUpperCase(), BLOCKS[0].id], paddock_id: null });
    expect(tripBlockIds(t)).toEqual([BLOCKS[0].id]);
  });

  it("isCompletedTrip requires an end_time and not-active flag", () => {
    expect(isCompletedTrip(trip())).toBe(true);
    expect(isCompletedTrip(trip({ is_active: true }))).toBe(false);
    expect(isCompletedTrip(trip({ end_time: null }))).toBe(false);
  });
});
