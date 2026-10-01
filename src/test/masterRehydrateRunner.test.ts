import { describe, it, expect } from "vitest";
import {
  runCatalogueRefresh, classifyRefreshOutcome, pendingIds, retryableRunIds,
  rehydratedQueueIds, batchQueueIds, isBatchComplete, REFRESH_ROW_STATUS_LABEL,
  type RefreshTraceEvent,
} from "@/lib/masterCatalogueRefresh";

const ids20 = Array.from({ length: 20 }, (_, i) => `r${i}`);

describe("real batch runner", () => {
  it("20 planned ids → 20 requests, trace ends with all rows", async () => {
    const calls: string[] = []; const trace: RefreshTraceEvent[] = [];
    const s = await runCatalogueRefresh({ ids: ids20, invoke: async (id) => { calls.push(id); return { outcome: "no_material_change" }; }, onTrace: (e) => trace.push(e) });
    expect(calls).toHaveLength(20);
    expect(Object.keys(s.rows)).toHaveLength(20);
    const end = trace.at(-1)!;
    expect(end).toMatchObject({ type: "end", planned: 20, queue: 20, rows: 20, pending: 0 });
    expect(trace.filter((e) => e.type === "worker_exit").every((e) => e.reason === "queue_empty")).toBe(true);
  });
  it("one failed request does not stop the other 19", async () => {
    const calls: string[] = [];
    const s = await runCatalogueRefresh({ ids: ids20, invoke: async (id) => { calls.push(id); if (id === "r3") throw new Error("boom"); return { outcome: "material_change", applied: true }; } });
    expect(calls).toHaveLength(20);
    expect(s.rows.r3.outcome).toBe("failed");
    expect(rehydratedQueueIds(s)).toHaveLength(19);
    expect(retryableRunIds(s)).toEqual(["r3"]);
  });
  it("a request that never returns times out and the batch continues", async () => {
    const s = await runCatalogueRefresh({ ids: ["a", "b", "c"], concurrency: 1, requestTimeoutMs: 20, invoke: (id) => id === "a" ? new Promise(() => {}) : Promise.resolve({ outcome: "no_material_change" }) });
    expect(s.rows.a.outcome).toBe("source_unavailable");
    expect(s.rows.c.outcome).toBe("no_material_change");
  });
  it("applied:false is not Rehydrated and stays retryable; applied:true is Rehydrated", async () => {
    expect(classifyRefreshOutcome({ outcome: "material_change", applied: false })).toBe("not_applied");
    expect(classifyRefreshOutcome({ outcome: "evidence_refreshed" })).toBe("not_applied");
    expect(classifyRefreshOutcome({ outcome: "material_change", applied: true })).toBe("material_change");
    expect(REFRESH_ROW_STATUS_LABEL.material_change).toBe("Rehydrated");
    expect(REFRESH_ROW_STATUS_LABEL.not_applied).not.toBe("Rehydrated");
    const s = await runCatalogueRefresh({ ids: ["custodia", "forte"], invoke: async (id) => ({ outcome: "material_change", applied: id === "forte" }) });
    expect(s.rows.custodia).toMatchObject({ outcome: "not_applied", applied: false });
    expect(rehydratedQueueIds(s)).toEqual(["forte"]);
    expect(retryableRunIds(s)).toEqual(["custodia"]);
    expect(pendingIds(s, s.planned)).toEqual(["custodia"]);
    expect(isBatchComplete(s)).toBe(false);
  });
  it("no_material_change counts as checked", async () => {
    const s = await runCatalogueRefresh({ ids: ["a"], invoke: async () => ({ outcome: "no_material_change" }) });
    expect(rehydratedQueueIds(s)).toEqual(["a"]);
    expect(isBatchComplete(s)).toBe(true);
  });
  it("persisted state includes every completed request with its attempt time", async () => {
    const snaps: number[] = []; let last: any;
    await runCatalogueRefresh({ ids: ids20, now: () => "2026-10-01T13:00:00Z", onProgress: (s) => { snaps.push(Object.keys(s.rows).length); last = JSON.parse(JSON.stringify(s)); }, invoke: async () => ({ outcome: "no_material_change" }) });
    expect(snaps.at(-1)).toBe(20);
    expect(Object.values(last.rows).every((r: any) => r.attemptedAt === "2026-10-01T13:00:00Z")).toBe(true);
  });
  it("batch filter reflects backend completion state", async () => {
    const s = await runCatalogueRefresh({ ids: ["a", "b", "c"], invoke: async (id) => id === "a" ? { outcome: "material_change", applied: true } : id === "b" ? { outcome: "material_change", applied: false } : { outcome: "conflict" } });
    expect(batchQueueIds(s)).toEqual(["a", "b", "c"]);
    expect(rehydratedQueueIds(s)).toEqual(["a", "c"]);
    expect(retryableRunIds(s)).toEqual(["b"]);
  });
});
