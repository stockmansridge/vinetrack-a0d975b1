import { describe, it, expect } from "vitest";
import {
  buildAllocationRows,
  buildBlockBreakdown,
  blockChildLabel,
  totalsFromRows,
  varietyKeyOf,
  UNASSIGNED_BLOCK_KEY,
} from "@/lib/grapeAllocationModel";
import type { GrapeAllocation } from "@/lib/grapeAllocationsQuery";

const a = (o: Partial<GrapeAllocation>): GrapeAllocation => ({
  id: "a", vineyard_id: "v", vintage: 2027, variety_id: null, variety_key: null,
  variety_name: "Pinot Gris", allocation_type: "external", purchaser_id: null,
  purchaser_name: null, destination_name: null, contact_name: null, contact_email: null,
  contact_phone: null, contact_address: null, quantity_tonnes: 3, notes: null, blocks: [], ...o,
});

describe("grape allocation variety identity", () => {
  it("merges Pinot Gris / Grigio estimate with Pinot Gris allocation into one row", () => {
    const est = new Map([[varietyKeyOf("pinot gris / grigio"), 4.31]]);
    const rows = buildAllocationRows({ allocations: [a({})], estimatedByVariety: est });
    expect(rows).toHaveLength(1);
    expect(rows[0].variety).toBe("Pinot Gris");
    expect(rows[0].estimatedTonnes).toBe(4.31);
    expect(rows[0].allocatedTonnes).toBe(3);
    expect(rows[0].availableTonnes).toBeCloseTo(1.31, 9);
    expect(varietyKeyOf("Pinot Grigio")).toBe(varietyKeyOf("PINOT GRIS"));
  });

  it("shows canonical capitalised names for lowercase keys and does not merge distinct varieties", () => {
    const est = new Map([[varietyKeyOf("merlot"), 2], [varietyKeyOf("sauvignon blanc"), 5]]);
    const rows = buildAllocationRows({
      allocations: [a({ id: "s", variety_name: "Sauv Blanc", quantity_tonnes: 1 })],
      estimatedByVariety: est,
    });
    expect(rows.map((r) => r.variety)).toEqual(["Merlot", "Sauvignon Blanc"]);
    expect(varietyKeyOf("Pinot Noir")).not.toBe(varietyKeyOf("Pinot Gris"));
    expect(varietyKeyOf("My Field Blend")).not.toBe(varietyKeyOf("Field Blend"));
  });

  it("labels children with block names, Unknown or Unassigned — never the variety", () => {
    const names = new Map([["b7id", "B7"], ["pgid", "Pinot Gris"]]);
    const pg = varietyKeyOf("Pinot Gris");
    expect(blockChildLabel("B7ID", pg, names)).toEqual({ label: "B7", nameIsVariety: false });
    expect(blockChildLabel("pgid", pg, names)).toEqual({ label: "Pinot Gris", nameIsVariety: true });
    expect(blockChildLabel("missing", pg, names).label).toBe("Unknown block");
    expect(blockChildLabel(UNASSIGNED_BLOCK_KEY, pg, names).label).toBe("Unassigned block");
  });

  it("multi-block allocations across aliases reconcile with parent and vineyard totals", () => {
    const allocs = [
      a({ id: "1", variety_name: "Pinot Grigio", quantity_tonnes: 3, blocks: [{ paddock_id: "B7", quantity_tonnes: 1 }, { paddock_id: "B49", quantity_tonnes: 2 }] }),
      a({ id: "2", variety_name: "pinot gris", allocation_type: "own_use", quantity_tonnes: 1, blocks: [] }),
      a({ id: "3", variety_name: "Merlot", quantity_tonnes: 2, blocks: [{ paddock_id: "B7", quantity_tonnes: null }] }),
    ];
    const est = new Map([[varietyKeyOf("pinot gris / grigio"), 4.31], [varietyKeyOf("merlot"), 2]]);
    const rows = buildAllocationRows({ allocations: allocs, estimatedByVariety: est });
    const pg = rows.find((r) => r.variety === "Pinot Gris")!;
    expect(pg.allocatedTonnes).toBe(4);
    expect(pg.ownUseTonnes).toBe(1);
    const kids = buildBlockBreakdown({ allocations: allocs }).get(pg.varietyKey)!;
    expect(kids.reduce((s, k) => s + k.allocatedTonnes, 0)).toBe(pg.allocatedTonnes);
    expect(kids.map((k) => k.blockKey).sort()).toEqual(["__no_block__", "b49", "b7"]);
    const tot = totalsFromRows(rows);
    expect(tot.allocatedTonnes).toBe(6);
    expect(tot.estimatedTonnes).toBeCloseTo(6.31, 9);
  });
});
