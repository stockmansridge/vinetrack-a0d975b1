import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tasks: [] as { id: string; costing_method: string }[] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: { queryFn: () => Promise<unknown> }) => options }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const data = table === "work_tasks" ? state.tasks : table === "pruning_entries" ? [{ id: "e1", vineyard_id: "v1", work_task_id: "t1", paddock_id: "b1", entry_date: "2026-10-23", row_equivalents_completed: 1 }] : table === "work_task_labour_lines" ? [{ work_task_id: "t1", total_hours: 53, total_cost: 1795 }] : [];
    const chain = { select: () => chain, eq: () => chain, is: () => chain, order: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return chain;
  },
} }));
vi.mock("@/lib/effectiveLabourCost", async (original) => ({
  ...await original<typeof import("@/lib/effectiveLabourCost")>(),
  // Deliberately stale view row: the pruning task gate must also protect this path.
  fetchEffectiveLabourCosts: async () => new Map([["t1", { work_task_id: "t1", effective_labour_cost: 1795, costing_method: "hourly", labour_cost_source: "labour_lines" }]]),
}));
vi.mock("@/lib/pruningActivityWorkTasks", async (original) => ({ ...await original<typeof import("@/lib/pruningActivityWorkTasks")>(), fetchWorkTaskLinksForVineyard: async () => new Map() }));
vi.mock("@/lib/pruningActivityLabour", async (original) => ({ ...await original<typeof import("@/lib/pruningActivityLabour")>(), fetchVineyardPruningLabourLines: async () => new Map() }));
import { usePruningActivity } from "@/lib/pruningActivityQuery";

beforeEach(() => { state.tasks = []; });
it("pruning reports cannot revive deleted/missing parent costs from child lines or a stale effective map", async () => {
  const query = usePruningActivity("v1") as unknown as { queryFn: () => Promise<{ labourCost: number | null; allocatedCost: number | null; allocatedHours: number }[]> };
  const rows = await query.queryFn();
  expect(rows).toHaveLength(1);
  expect(rows[0].labourCost).toBeNull();
  expect(rows[0].allocatedCost).toBeNull();
  expect(rows[0].allocatedHours).toBe(0);
});
it("pruning retains the unchanged effective cost for a readable active task", async () => {
  state.tasks = [{ id: "t1", costing_method: "hourly" }];
  const query = usePruningActivity("v1") as unknown as { queryFn: () => Promise<{ labourCost: number | null; allocatedCost: number | null }[]> };
  const rows = await query.queryFn();
  expect(rows[0].labourCost).toBe(1795);
  expect(rows[0].allocatedCost).toBe(1795);
});