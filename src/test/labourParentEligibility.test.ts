import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkTask, WorkTaskLabourLine } from "@/lib/workTasksQuery";

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, calls: [] as { table: string; filters: [string, string, unknown][] }[], rpc: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  rpc: state.rpc,
  from: (table: string) => {
    const filters: [string, string, unknown][] = [];
    state.calls.push({ table, filters });
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push(["eq", key, value]); return chain; },
      is: (key: string, value: unknown) => { filters.push(["is", key, value]); return chain; },
      in: (key: string, value: unknown[]) => { filters.push(["in", key, value]); return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, data: (state.tables[table] ?? []).filter((row) => filters.every(([op, key, value]) => op === "in" ? (value as unknown[]).includes(row[key]) : (row[key] ?? null) === value)) }).then(resolve),
    };
    return chain;
  },
} }));

import { fetchLabourLinesForVineyard, fetchLabourLinesForVineyardAudit, fetchLabourLineParentsForAudit, fetchWorkTasksByIds, softDeleteLabourLine } from "@/lib/workTasksQuery";
import { fetchEffectiveLabourCosts } from "@/lib/effectiveLabourCost";
import { classifyLabourLine, labourReviewSummary } from "@/lib/labourLineEligibility";
import { buildWorkTaskCostRollup } from "@/lib/workTaskCostRollup";
import { buildUnifiedCostDataset } from "@/lib/unifiedCostDataset";

const active: WorkTask = { id: "t1", vineyard_id: "v1", paddock_id: "b1", deleted_at: null, costing_method: "hourly" };
const deleted: WorkTask = { ...active, id: "td", deleted_at: "2026-10-20" };
const line: WorkTaskLabourLine = { id: "l1", vineyard_id: "v1", work_task_id: "t1", total_hours: 13, total_cost: 455, deleted_at: null };
beforeEach(() => {
  state.calls = [];
  state.tables = {
    work_tasks: [{ ...active }, { ...deleted }],
    work_task_labour_lines: [{ ...line }, { ...line, id: "ld", work_task_id: "td", total_hours: 53, total_cost: 1795 }, { ...line, id: "lm", work_task_id: "missing" }, { ...line, id: "removed", deleted_at: "2026-10-22" }, { ...line, id: "other", vineyard_id: "v2" }],
    v_work_task_effective_labour_cost: ["t1", "td", "missing"].map((work_task_id) => ({ work_task_id, vineyard_id: "v1", effective_labour_cost: work_task_id === "t1" ? 455 : 1795, costing_method: "hourly", labour_cost_source: "labour_lines" })),
  };
});

describe("Canonical labour parent eligibility", () => {
  it.each([
    [line, active, "ACTIVE_VALID"],
    [{ ...line, work_task_id: "td" }, deleted, "PARENT_DELETED"],
    [line, undefined, "PARENT_MISSING"],
    [{ ...line, deleted_at: "2026-10-20" }, active, "LABOUR_DELETED"],
  ] as const)("classifies labour by its actual parent and deletion evidence", (child, parent, status) => {
    expect(classifyLabourLine(child, parent)).toBe(status);
  });
  it("normal reads exclude deleted/missing parents, deleted children and other vineyards", async () => {
    expect(await fetchLabourLinesForVineyard("v1")).toEqual([line]);
  });
  it("audit reads retain review children and deleted parent details without weakening normal task queries", async () => {
    expect((await fetchLabourLinesForVineyardAudit("v1")).map((row) => row.id)).toEqual(["l1", "ld", "lm"]);
    expect(await fetchLabourLineParentsForAudit("v1", ["t1", "td", "missing"])).toEqual([active, deleted]);
    expect(await fetchLabourLineParentsForAudit("v2", ["t1", "td"])).toEqual([]);
    expect(await fetchWorkTasksByIds(["t1", "td"])).toEqual([active]);
  });
  it("rejects deleted and missing task IDs from SQL 189's effective-cost map", async () => {
    const map = await fetchEffectiveLabourCosts("v1");
    expect([...map.keys()]).toEqual(["t1"]);
    expect(map.get("t1")?.effective_labour_cost).toBe(455);
  });
  it("Work Task Reports aggregate inputs cannot retain deleted-parent labour or backend cost", async () => {
    const lines = await fetchLabourLinesForVineyard("v1");
    const costs = await fetchEffectiveLabourCosts("v1");
    const tasks = await fetchWorkTasksByIds(["t1", "td", "missing"]);
    const totals = tasks.map((task) => buildWorkTaskCostRollup({ task, labourLines: lines.filter((l) => l.work_task_id === task.id), effectiveLabourCost: costs.get(task.id) }));
    expect(totals.reduce((sum, row) => sum + row.labourHours, 0)).toBe(13);
    expect(totals.reduce((sum, row) => sum + row.total, 0)).toBe(455);
  });
  it("Vineyard Costings' actual dataset excludes deleted task costs even with stale child and effective rows", async () => {
    const lines = await fetchLabourLinesForVineyard("v1");
    const costs = await fetchEffectiveLabourCosts("v1");
    const tasks = await fetchWorkTasksByIds(["t1", "td", "missing"]);
    const dataset = buildUnifiedCostDataset({
      vineyardId: "v1", blocks: [{ id: "b1", name: "Shiraz", area_ha: 1 }],
      workTasks: [
        ...tasks.map((task) => ({ task, labourLines: lines.filter((l) => l.work_task_id === task.id), effectiveLabourCost: costs.get(task.id) })),
        { task: deleted, labourLines: [{ ...line, work_task_id: "td", total_cost: 1795 }], effectiveLabourCost: { work_task_id: "td", vineyard_id: "v1", effective_labour_cost: 1795, costing_method: "hourly", piece_rate_per_vine: null, piece_vine_count: null, piece_rate_total_cost: null, labour_line_cost: 1795, labour_cost_source: "labour_lines" } },
      ],
    });
    expect(dataset.rows.reduce((sum, row) => sum + row.total_cost, 0)).toBe(455);
    expect(dataset.rows.map((row) => row.source_id)).toEqual(["t1"]);
  });
  it("matches the supplied Stockman's 39 active / 5 review / 53 hours / $1,795 excluded fixture", () => {
    const rows = [
      ...Array.from({ length: 39 }, (_, i) => ({ line: { ...line, id: `a${i}` }, status: classifyLabourLine(line, active) })),
      ...Array.from({ length: 5 }, (_, i) => { const child = { ...line, id: `d${i}`, work_task_id: "td", total_hours: i === 0 ? 13 : 10, total_cost: 359 }; return { line: child, status: classifyLabourLine(child, deleted) }; }),
    ];
    expect(labourReviewSummary(rows)).toEqual({ activeCount: 39, reviewCount: 5, excludedHours: 53, excludedCost: 1795, costComplete: true });
  });
  it("Remove still uses the canonical soft-delete RPC and never a hard delete", async () => {
    state.rpc.mockResolvedValue({ error: null });
    await softDeleteLabourLine("ld", "user1");
    expect(state.rpc).toHaveBeenCalledWith("soft_delete_work_task_labour_line", { p_id: "ld" });
    expect(state.calls).toEqual([]);
  });
});