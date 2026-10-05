import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: any[] = [];
function from(table: string) {
  const chain: any = {
    _op: "select",
    upsert(p: any) { calls.push([table, p]); chain._op = "upsert"; chain._p = p; return chain; },
    select() { return chain; }, eq() { return chain; },
    single: async () => ({ data: chain._p, error: null }),
    then(res: any) { return Promise.resolve({ data: chain._op === "upsert" ? chain._p : [], error: null }).then(res); },
  };
  return chain;
}
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: async () => ({ error: null }), from } }));

import { saveFertiliserRecord } from "@/lib/fertiliserRecordsQuery";
import { vineCountBasisForSave, resolveVineBasis, VINE_COUNT_BASIS_PERSISTED, type BasisBlock } from "@/lib/fertiliserVineBasis";

const base: any = {
  id: "rec", vineyard_id: "v", product_id: null, product_name: "X", form: "solid", calculation_mode: "perVine",
  record_status: "planned", application_date: "2026-10-01", block_names: [], total_area_ha: 1, total_vines: 0,
  application_rate: 1, application_rate_unit: "g/vine", total_product_required: 1, product_unit: "kg",
  pack_size: null, pack_count: null, estimated_product_cost: null, labour_cost: null, machinery_cost: null,
  total_job_cost: null, notes: "", user_id: "u", allocations: [],
};
const saved = async (basis: any) => {
  const { record } = await saveFertiliserRecord({ ...base, vine_count_basis: basis });
  return { payload: calls.find((c) => c[0] === "fertiliser_records")[1], record };
};
const blk = (id: string): BasisBlock => ({ id, name: id, areaHa: 1, vineCount: 4100, actualVineCount: 4200,
  actualVineCountSource: "block_override", assumedFullVineCount: 5000, assumedFullReason: null });

beforeEach(() => { calls.length = 0; });

describe("vine_count_basis persistence", () => {
  it("gate is on", () => expect(VINE_COUNT_BASIS_PERSISTED).toBe(true));
  it.each(["actual", "assumed_full", "manual"] as const)("%s write/read", async (b) => {
    const mode = b === "manual" ? 0 : 1;
    const v = vineCountBasisForSave({ mode: "perVine", selectedBlockCount: mode, basis: b === "manual" ? "actual" : b, isEdit: false });
    expect(v).toBe(b);
    const { payload, record } = await saved(v);
    expect(payload.vine_count_basis).toBe(b);
    expect(record.vine_count_basis).toBe(b);
  });
  it("legacy NULL opens as snapshot with stored counts, no recalculation", () => {
    const r = resolveVineBasis([blk("A")], "perVine", "snapshot", new Set(["A"]));
    expect(r.blocks[0].vineCount).toBe(4100);
    expect(r.issues).toEqual([]);
  });
  it("editing a legacy snapshot without choosing a basis leaves the column untouched", async () => {
    const v = vineCountBasisForSave({ mode: "perVine", selectedBlockCount: 1, basis: "snapshot", isEdit: true });
    expect(v).toBeUndefined();
    const { payload } = await saved(v);
    expect("vine_count_basis" in payload).toBe(false);
  });
  it("stored actual still opens on stored counts (provenance only)", () => {
    expect(resolveVineBasis([blk("A")], "perVine", "snapshot", new Set(["A"])).blocks[0].vineCount).toBe(4100);
  });
  it("changing basis intentionally recalculates and saves it", async () => {
    expect(resolveVineBasis([blk("A")], "perVine", "assumed_full").blocks[0].vineCount).toBe(5000);
    const v = vineCountBasisForSave({ mode: "perVine", selectedBlockCount: 1, basis: "assumed_full", isEdit: true });
    expect((await saved(v)).payload.vine_count_basis).toBe("assumed_full");
  });
  it("duplicate snapshot inherits source basis; legacy source stays NULL", () => {
    expect(vineCountBasisForSave({ mode: "perVine", selectedBlockCount: 1, basis: "snapshot", isEdit: false, sourceBasis: "actual" })).toBe("actual");
    expect(vineCountBasisForSave({ mode: "perVine", selectedBlockCount: 1, basis: "snapshot", isEdit: false, sourceBasis: null })).toBeNull();
  });
  it("Per Hectare never writes a basis", () => {
    expect(vineCountBasisForSave({ mode: "perHectare", selectedBlockCount: 2, basis: "actual", isEdit: false })).toBeUndefined();
  });
});
