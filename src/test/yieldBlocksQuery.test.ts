// fetchYieldBlocks must read the shared paddocks contract for the active
// vineyard only, excluding soft-deleted blocks, and expose variety allocations.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: any = { calls: {}, rows: [] };

vi.mock("@/integrations/ios-supabase/client", () => {
  const builder: any = {
    select: (cols: string) => ((state.calls.select = cols), builder),
    eq: (col: string, val: string) => ((state.calls.eq = [col, val]), builder),
    is: (col: string, val: any) => ((state.calls.is = [col, val]), builder),
    order: async () => ({ data: state.rows, error: null }),
  };
  return {
    supabase: {
      from: (t: string) => ((state.calls.from = t), builder),
    },
  };
});

import { fetchYieldBlocks } from "@/lib/yieldReportsQuery";

describe("fetchYieldBlocks", () => {
  beforeEach(() => {
    state.calls = {};
    state.rows = [
      { id: "p1", name: "Block 7", variety_allocations: [{ variety: "Shiraz" }] },
    ];
  });

  it("queries active paddocks for the selected vineyard", async () => {
    await fetchYieldBlocks("v1");
    expect(state.calls.from).toBe("paddocks");
    expect(state.calls.eq).toEqual(["vineyard_id", "v1"]);
    expect(state.calls.is).toEqual(["deleted_at", null]);
  });

  it("does not select a non-existent `variety` column and returns allocations", async () => {
    const blocks = await fetchYieldBlocks("v1");
    expect(state.calls.select).toContain("variety_allocations");
    expect(state.calls.select).not.toMatch(/(^|,)\s*variety\s*(,|$)/);
    expect(blocks[0].varietyAllocations).toEqual([{ variety: "Shiraz" }]);
  });
});
