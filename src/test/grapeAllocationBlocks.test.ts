import { describe, it, expect } from "vitest";
import { buildBlockBreakdown, buildAllocationRows, UNASSIGNED_BLOCK_KEY } from "@/lib/grapeAllocationModel";
import type { GrapeAllocation } from "@/lib/grapeAllocationsQuery";

const a = (o: Partial<GrapeAllocation>): GrapeAllocation => ({
  id: "a", vineyard_id: "v", vintage: 2026, variety_id: null, variety_key: null,
  variety_name: "Pinot Gris", allocation_type: "external", purchaser_id: null,
  purchaser_name: null, destination_name: null, contact_name: null, contact_email: null,
  contact_phone: null, contact_address: null, quantity_tonnes: 5, notes: null, blocks: [], ...o,
});
const sum = (rows: { allocatedTonnes: number }[]) => rows.reduce((s, r) => s + r.allocatedTonnes, 0);

describe("block breakdown under each variety", () => {
  it("puts a single-block allocation on that block with its id for Edit", () => {
    const m = buildBlockBreakdown({
      allocations: [a({ id: "x", blocks: [{ paddock_id: "B7", quantity_tonnes: null }] })],
      estimatedByBlockVariety: new Map([["b7|pinot gris", 8]]),
    });
    const [r] = m.get("pinot gris")!;
    expect(r.blockKey).toBe("b7");
    expect(r.externalTonnes).toBe(5);
    expect(r.availableTonnes).toBe(3);
    expect(r.allocationIds).toEqual(["x"]);
  });

  it("sums several allocations on one block and splits one allocation across blocks without double counting", () => {
    const allocs = [
      a({ id: "1", allocation_type: "own_use", quantity_tonnes: 2, blocks: [{ paddock_id: "b1", quantity_tonnes: 2 }] }),
      a({ id: "2", quantity_tonnes: 6, blocks: [{ paddock_id: "b1", quantity_tonnes: 1 }, { paddock_id: "b2", quantity_tonnes: 4 }] }),
    ];
    const kids = buildBlockBreakdown({ allocations: allocs }).get("pinot gris")!;
    const b1 = kids.find((k) => k.blockKey === "b1")!;
    expect(b1.ownUseTonnes).toBe(2);
    expect(b1.externalTonnes).toBe(1);
    expect(b1.allocationIds).toEqual(["1", "2"]);
    expect(kids.find((k) => k.blockKey === UNASSIGNED_BLOCK_KEY)!.allocatedTonnes).toBe(1);
    const parent = buildAllocationRows({ allocations: allocs, estimatedByVariety: new Map() })[0];
    expect(sum(kids)).toBe(parent.allocatedTonnes);
  });

  it("keeps unknown block estimate unknown and blockless allocations under No block", () => {
    const kids = buildBlockBreakdown({ allocations: [a({ blocks: [] })] }).get("pinot gris")!;
    expect(kids).toHaveLength(1);
    expect(kids[0].blockKey).toBe(UNASSIGNED_BLOCK_KEY);
    expect(kids[0].estimatedTonnes).toBeNull();
    expect(kids[0].availableTonnes).toBeNull();
  });
});
