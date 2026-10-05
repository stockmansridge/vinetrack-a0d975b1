import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: any[] = [];
let existingAllocs: any[] = [];
const rpc = vi.fn(async (fn: string, args: any) => { calls.push(["rpc", fn, args]); return { error: null }; });
function from(table: string) {
  const chain: any = {
    _op: "select",
    upsert(p: any) { calls.push(["upsert", table, p]); chain._op = "upsert"; chain._p = p; return chain; },
    delete() { calls.push(["delete", table]); return chain; },
    select() { return chain; },
    eq() { return chain; },
    in() { return chain; },
    single: async () => ({ data: chain._p, error: null }),
    then(res: any) {
      const data = chain._op === "upsert" ? chain._p : existingAllocs;
      return Promise.resolve({ data, error: null }).then(res);
    },
  };
  return chain;
}
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => (rpc as any)(...a), from } }));

import { saveFertiliserRecord } from "@/lib/fertiliserRecordsQuery";
import { fertiliserPermissions } from "@/pages/tools/FertiliserCalculatorPage";

const base = {
  id: "rec", vineyard_id: "v", product_id: null, product_name: "X", form: "solid" as const,
  calculation_mode: "perHectare" as const, record_status: "planned" as const, application_date: "2026-10-01",
  block_names: [], total_area_ha: 1, total_vines: 0, application_rate: 1, application_rate_unit: "kg/ha",
  total_product_required: 1, product_unit: "kg", pack_size: null, pack_count: null, estimated_product_cost: null,
  labour_cost: null, machinery_cost: null, total_job_cost: null, notes: "", user_id: "u",
};
const alloc = (id: string) => ({ id, paddock_id: id, area_ha: 1, vine_count: 0, application_rate: 1, product_required: 1, allocated_cost: null });

beforeEach(() => { calls.length = 0; existingAllocs = []; });

describe("fertiliser persistence", () => {
  it("creates planned and completed records", async () => {
    await saveFertiliserRecord({ ...base, allocations: [alloc("a")] });
    await saveFertiliserRecord({ ...base, record_status: "completed", allocations: [] });
    const recs = calls.filter((c) => c[0] === "upsert" && c[1] === "fertiliser_records").map((c) => c[2].record_status);
    expect(recs).toEqual(["planned", "completed"]);
  });
  it("removes a deselected allocation via the live RPC, never direct DELETE, and upserts new ones", async () => {
    existingAllocs = [{ id: "a" }, { id: "b" }];
    await saveFertiliserRecord({ ...base, current_sync_version: 3, allocations: [alloc("a"), alloc("c")] });
    expect(calls.filter((c) => c[0] === "delete")).toEqual([]);
    expect(calls.filter((c) => c[0] === "rpc")).toEqual([["rpc", "delete_fertiliser_record_allocation", { p_id: "b" }]]);
    const up = calls.find((c) => c[0] === "upsert" && c[1] === "fertiliser_record_allocations")[2];
    expect(up.map((a: any) => a.id)).toEqual(["a", "c"]);
    const rec = calls.find((c) => c[1] === "fertiliser_records")[2];
    expect(rec.sync_version).toBe(4);
  });
  it("fails the save when the RPC fails", async () => {
    existingAllocs = [{ id: "b" }];
    rpc.mockResolvedValueOnce({ error: { message: "denied" } } as any);
    await expect(saveFertiliserRecord({ ...base, current_sync_version: 1, allocations: [] })).rejects.toBeTruthy();
  });
});

describe("fertiliser role matrix", () => {
  it.each([
    ["owner", true, true, true, true],
    ["manager", true, true, true, true],
    ["supervisor", true, true, false, false],
    ["operator", true, false, false, false],
  ])("%s", (role, write, del, costs, products) => {
    expect(fertiliserPermissions(role)).toEqual({ canWrite: write, canDelete: del, canSeeCosts: costs, canManageProducts: products });
  });
});
