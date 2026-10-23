import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";

const state = vi.hoisted(() => ({
  allocations: [] as TripCostAllocation[],
  parents: [] as { id: string; deleted_at: string | null }[],
  calls: [] as { table: string; ids: string[]; activeOnly: boolean; vineyard: string | null }[],
  parentError: false,
}));

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, ids: [] as string[], activeOnly: false, vineyard: null as string | null };
      state.calls.push(call);
      const result = () => table === "trip_cost_allocations"
        ? { data: state.allocations.filter((row) => row.vineyard_id === call.vineyard && (!call.activeOnly || row.deleted_at == null)), error: null }
        : {
          data: state.parents.filter((row) => call.ids.includes(row.id) && (!call.activeOnly || row.deleted_at === null)).map(({ id }) => ({ id })),
          error: state.parentError ? { message: "Permission denied" } : null,
        };
      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => { call.vineyard = value; return builder; },
        in: (_column: string, ids: string[]) => { call.ids = ids; return builder; },
        is: (column: string, value: unknown) => { call.activeOnly = column === "deleted_at" && value === null; return builder; },
        order: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  },
}));

import { fetchTripCostAllocationsForVineyard } from "@/lib/tripCostAllocationsQuery";
import { buildUnifiedCostDataset } from "@/lib/unifiedCostDataset";
import { buildWorkTaskCostRollup } from "@/lib/workTaskCostRollup";

const vineyard = "fe952afe-437f-4be7-8cbf-fdd8e630411c";
const allocation = (id: string, tripId: string | null, total: number | null, deleted_at: string | null = null): TripCostAllocation => ({
  id, vineyard_id: vineyard, trip_id: tripId, paddock_id: null, season_year: 2027, total_cost: total, deleted_at,
});

const completedTrip = (id: string) => ({
  id, vineyard_id: vineyard, paddock_id: null, paddock_ids: [], paddock_name: null,
  trip_function: "spraying", person_name: "Sam",
  start_time: "2026-09-23T01:00:00Z", end_time: "2026-09-23T03:00:00Z",
  is_active: false, deleted_at: null,
});

beforeEach(() => {
  state.calls = [];
  state.parentError = false;
  state.allocations = [
    allocation("7577ff60-1656-4773-8014-f08de5978b8a", "1423c592-a4ee-4b9e-ab58-30edc7101b8d", 0.43),
    allocation("946015f8-fdcb-4b41-8682-7d890468eac9", "a373b464-4b5f-4e45-82d1-7d8e6213aad4", 0.39),
    allocation("active", "a3d88bdb-a9a4-497d-9a5c-7d14166ddc04", null),
  ];
  state.parents = [
    { id: "1423c592-a4ee-4b9e-ab58-30edc7101b8d", deleted_at: "2026-10-08T01:34:19.019541Z" },
    { id: "a373b464-4b5f-4e45-82d1-7d8e6213aad4", deleted_at: "2026-10-08T01:35:52.336131Z" },
    { id: "a3d88bdb-a9a4-497d-9a5c-7d14166ddc04", deleted_at: null },
  ];
});

describe("active-parent trip allocation reporting", () => {
  it("excludes both owner-reported soft-deleted trips without changing retained rows", async () => {
    const original = structuredClone(state.allocations);
    expect((await fetchTripCostAllocationsForVineyard(vineyard)).map((row) => row.id)).toEqual(["active"]);
    expect(state.allocations).toEqual(original);
    expect(state.calls[1].activeOnly).toBe(true);
  });

  it("preserves every allocation and cost of a live multi-block trip", async () => {
    state.allocations = [allocation("a", "live", 25), allocation("b", "live", 50)];
    state.parents = [{ id: "live", deleted_at: null }];
    expect(await fetchTripCostAllocationsForVineyard(vineyard)).toEqual(state.allocations);
    expect(state.calls[1].ids).toEqual(["live"]);
  });

  it("does not reinstate deleted GPS cost through the Work Task rollup or central report", async () => {
    const tripAllocations = await fetchTripCostAllocationsForVineyard(vineyard);
    const input = {
      task: { id: "task", vineyard_id: vineyard, vintage_year: 2027, task_type: "Shoot thinning", date: "2026-08-28", costing_method: null },
      labourLines: [{ id: "labour", vineyard_id: vineyard, work_task_id: "task", total_cost: 18937 }],
      machineLines: [{ id: "machine", vineyard_id: vineyard, work_task_id: "task", total_machine_cost: 0, fuel_cost: 20.79 }],
      tripAllocations,
    };
    expect(buildWorkTaskCostRollup(input).total).toBe(18957.79);
    const dataset = buildUnifiedCostDataset({ vineyardId: vineyard, workTasks: [input], tripAllocations });
    expect(dataset.rows.reduce((sum, row) => sum + row.total_cost, 0)).toBe(18957.79);
  });

  it("retains parentless allocations and excludes an unavailable referenced parent", async () => {
    state.allocations = [allocation("parentless", null, 12), allocation("missing", "missing", 9)];
    expect((await fetchTripCostAllocationsForVineyard(vineyard)).map((row) => row.id)).toEqual(["parentless"]);
  });

  it("fails closed if parent state cannot be read", async () => {
    state.parentError = true;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchTripCostAllocationsForVineyard(vineyard)).toEqual([]);
    warning.mockRestore();
  });

  it("bounds parent reads without losing active allocations across batches", async () => {
    state.parents = Array.from({ length: 405 }, (_, i) => ({ id: `trip-${i}`, deleted_at: null }));
    state.allocations = state.parents.map((row, i) => allocation(`a-${i}`, row.id, 1));
    expect(await fetchTripCostAllocationsForVineyard(vineyard)).toHaveLength(405);
    expect(state.calls.filter((call) => call.table === "trips").map((call) => call.ids.length)).toEqual([200, 200, 5]);
  });
});