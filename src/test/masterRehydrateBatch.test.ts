import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_BATCH_SIZE, DEFAULT_REFRESH_CONCURRENCY, batchQueueIds, isBatchComplete,
  masterRefreshRequestBody, newRefreshRunState, pendingIds, recordRow, resumableState,
  runCatalogueRefresh, selectNextBatch, compareEvidenceAge, type EvidenceAgeRow,
} from "@/lib/masterCatalogueRefresh";

const cand = (id: string, extra: Partial<EvidenceAgeRow> = {}): EvidenceAgeRow => ({
  id, review_status: "candidate", retrieved_at: "2026-01-01T00:00:00Z", ...extra,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => cand(`m${String(i).padStart(3, "0")}`));

describe("Master rehydration — controlled batches", () => {
  it("1. default batch holds at most 20 candidates", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(20);
    expect(selectNextBatch(many(404))).toHaveLength(20);
    expect(selectNextBatch(many(404), { size: 9999 })).toHaveLength(50);
  });
  it("2. approved and retired excluded", () => {
    const ids = selectNextBatch([cand("a", { review_status: "approved" }), cand("b", { review_status: "retired" }), cand("c")]);
    expect(ids).toEqual(["c"]);
  });
  it("3. null retrieved_at first; 4. oldest before newer", () => {
    const ids = selectNextBatch([
      cand("new", { retrieved_at: "2026-09-01T00:00:00Z" }),
      cand("old", { retrieved_at: "2025-01-01T00:00:00Z" }),
      cand("never", { retrieved_at: null }),
    ]);
    expect(ids).toEqual(["never", "old", "new"]);
  });
  it("5. stable deterministic fallback ordering", () => {
    const rows = [
      cand("z", { retrieved_at: null, verified_at: null, updated_at: "2026-02-01", registered_product_name: "B" }),
      cand("y", { retrieved_at: null, verified_at: "2026-01-01", updated_at: "2025-01-01" }),
      cand("x", { retrieved_at: null, verified_at: null, updated_at: "2026-01-01", registered_product_name: "Z" }),
      cand("w", { retrieved_at: null, verified_at: null, updated_at: "2026-02-01", registered_product_name: "A" }),
    ];
    const a = [...rows].sort(compareEvidenceAge).map((r) => r.id);
    const b = [...rows].reverse().sort(compareEvidenceAge).map((r) => r.id);
    expect(a).toEqual(["x", "w", "z", "y"]);
    expect(b).toEqual(a);
  });
  it("6. never more than 2 in flight", async () => {
    expect(DEFAULT_REFRESH_CONCURRENCY).toBe(2);
    let inFlight = 0, peak = 0;
    await runCatalogueRefresh({
      ids: ["a", "b", "c", "d", "e", "f"], concurrency: 10,
      invoke: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; return { outcome: "no_material_change" }; },
    });
    expect(peak).toBe(2);
  });
  it("7. unfinished batch resumes its exact planned ids", () => {
    let s = newRefreshRunState(["a", "b", "c"], "t0", 20);
    s = recordRow(s, "a", "material_change", "t1");
    const r = resumableState(JSON.parse(JSON.stringify(s)), ["x", "a", "y"])!;
    expect(r.planned).toEqual(["a", "b", "c"]);
    expect(r.batchSize).toBe(20);
  });
  it("8. a completed batch does not continue into the next", async () => {
    const calls: string[] = [];
    const s = await runCatalogueRefresh({ ids: ["a", "b"], invoke: async (id) => { calls.push(id); return { outcome: "no_material_change" }; } });
    expect(calls.sort()).toEqual(["a", "b"]);
    expect(isBatchComplete(s)).toBe(true);
  });
  it("9. next batch is recalculated from fresh rows", () => {
    const first = selectNextBatch(many(30), { size: 10 });
    const fresh = many(30).map((r) => first.includes(r.id) ? { ...r, retrieved_at: "2026-10-01T00:00:00Z" } : r);
    const next = selectNextBatch(fresh, { size: 10 });
    expect(next.some((id) => first.includes(id))).toBe(false);
    expect(next).toEqual(many(30).slice(10, 20).map((r) => r.id));
  });
  it("10. Rehydrated this batch contains only batch ids", () => {
    let s = newRefreshRunState(["a", "b"], "t0");
    s = recordRow(s, "a", "conflict", "t1");
    s = recordRow(s, "b", "failed", "t1");
    expect(batchQueueIds(s)).toEqual(["a", "b"]);
  });
  it("11. completed rows not retried; 12. failed/unavailable retryable", async () => {
    let s = newRefreshRunState(["a", "b", "c", "d", "e", "f", "g"], "t0");
    for (const [id, o] of [["a", "material_change"], ["b", "evidence_refreshed"], ["c", "no_material_change"], ["d", "conflict"], ["e", "skipped"], ["f", "failed"], ["g", "source_unavailable"]] as const) s = recordRow(s, id, o, "t1");
    expect(pendingIds(s, s.planned)).toEqual(["f", "g"]);
    const calls: string[] = [];
    await runCatalogueRefresh({ ids: s.planned, initialState: s, invoke: async (id) => { calls.push(id); return { outcome: "no_material_change" }; } });
    expect(calls.sort()).toEqual(["f", "g"]);
  });
  it("13. 5 consecutive provider failures pause the batch", async () => {
    const calls: string[] = [];
    const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const s = await runCatalogueRefresh({ ids, concurrency: 1, invoke: async (id) => { calls.push(id); throw new Error("503 unavailable"); } });
    expect(calls).toHaveLength(5);
    expect(s.paused).toBe(true);
    expect(isBatchComplete(s)).toBe(false);
  });
  it("14. master_refresh body unchanged", () => {
    const b = masterRefreshRequestBody("id-1", "corr");
    expect(b).toMatchObject({ action: "master_refresh", masterChemicalId: "id-1", master_chemical_id: "id-1", apply: true });
    expect(b).not.toHaveProperty("country");
    expect(b).not.toHaveProperty("country_code");
    expect(b).not.toHaveProperty("review_status");
    expect(b).not.toHaveProperty("target_review_status");
  });
  it("15. nothing is approved automatically", () => {
    for (const f of ["src/lib/masterCatalogueRefresh.ts", "src/components/chemicals/MasterCatalogueRefreshDialog.tsx"]) {
      const code = readFileSync(f, "utf8");
      expect(code).not.toMatch(/setMasterReviewStatus|master_review_apply|"approved"/);
    }
  });
});
