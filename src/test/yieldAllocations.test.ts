import { describe, it, expect } from "vitest";
import {
  buildAllocationUnits,
  matchAllocation,
  buildPlantingGroups,
  plantingGroupOptionLabel,
  plantingLabel,
  allocationLabel,
} from "@/lib/yieldAllocations";
import { buildYieldOverview } from "@/lib/yieldOverview";
import { aggregatePickingRecordsByPlanting } from "@/lib/pickingRecordsQuery";
import type { ResolvedAllocation } from "@/lib/varietyResolver";

const alloc = (
  over: Partial<ResolvedAllocation> & { raw?: any } = {},
): ResolvedAllocation => ({
  id: undefined,
  name: "Pinot Noir",
  percent: null,
  clone: null,
  rootstock: null,
  plantingYear: null,
  raw: {},
  resolved: true,
  resolverPath: "custom",
  ...over,
});

const pick = (over: any) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  vineyard_id: "v1",
  picked_at: "2026-03-01",
  vintage: 2026,
  paddock_id: "b1",
  paddock_name: "Stockman's Ridge",
  variety_id: null,
  variety_key: null,
  variety_name: "Pinot Noir",
  clone: null,
  weight_kg: 1000,
  sugar_value: null,
  sugar_unit: null,
  ph: null,
  ta_g_l: null,
  purpose: null,
  sold: null,
  sold_to: null,
  price_per_tonne: null,
  grape_value: null,
  notes: null,
  created_at: null,
  updated_at: null,
  created_by: null,
  ...over,
});

describe("allocation identity", () => {
  it("labels a planting from clone and rootstock", () => {
    expect(plantingLabel({ cloneLabel: "Clone 777", rootstockLabel: "101-14" })).toBe(
      "Clone 777 · 101-14",
    );
    expect(plantingLabel({ cloneLabel: null, rootstockLabel: null })).toBeNull();
    expect(
      allocationLabel({ variety: "Pinot Noir", cloneLabel: "Clone 667", rootstockLabel: null }),
    ).toBe("Pinot Noir · Clone 667");
  });

  it("apportions allocation hectares that sum back to the block area", () => {
    const units = buildAllocationUnits({
      blockId: "b1",
      areaHa: 1.8,
      allocations: [
        alloc({ clone: "Clone 777", percent: 50 }),
        alloc({ clone: "Clone 667", percent: 30 }),
        alloc({ clone: "Clone MV6", percent: 20 }),
      ],
    });
    units.map((u) => u.areaHa).forEach((v, i) => expect(v).toBeCloseTo([0.9, 0.54, 0.36][i], 6));
    expect(units.reduce((a, u) => a + (u.areaHa ?? 0), 0)).toBeCloseTo(1.8, 6);
    expect(new Set(units.map((u) => u.key)).size).toBe(3);
  });

  it("matches a pick to a single allocation of the variety", () => {
    const units = buildAllocationUnits({
      blockId: "b1",
      areaHa: 2,
      allocations: [alloc({ clone: "Clone 777" })],
    });
    expect(matchAllocation(units, "Pinot Noir", null).key).toBe(units[0].key);
  });

  it("separates same variety with different clones", () => {
    const units = buildAllocationUnits({
      blockId: "b1",
      areaHa: 1.8,
      allocations: [alloc({ clone: "Clone 777" }), alloc({ clone: "Clone 667" })],
    });
    expect(matchAllocation(units, "Pinot Noir", "Clone 777").key).toBe(units[0].key);
    expect(matchAllocation(units, "Pinot Noir", "Clone 667").key).toBe(units[1].key);
  });

  it("leaves same clone / different rootstock ambiguous rather than guessing", () => {
    const units = buildAllocationUnits({
      blockId: "b1",
      areaHa: 1.8,
      allocations: [
        alloc({ clone: "Clone 777", rootstock: "101-14" }),
        alloc({ clone: "Clone 777", rootstock: "Ramsey" }),
      ],
    });
    const m = matchAllocation(units, "Pinot Noir", "Clone 777");
    expect(m.key).toBeNull();
    expect(m.reason).toBe("ambiguous");
  });
});

describe("yield overview by allocation", () => {
  const units = buildAllocationUnits({
    blockId: "b1",
    areaHa: 1.8,
    allocations: [
      alloc({ clone: "Clone 777", rootstock: "101-14", percent: 50 }),
      alloc({ clone: "Clone 667", rootstock: "Ramsey", percent: 30 }),
      alloc({ clone: "Clone MV6", rootstock: "Own roots", percent: 20 }),
    ],
  });
  const blocks = [
    {
      id: "b1",
      name: "Stockman's Ridge",
      areaHa: 1.8,
      varieties: units.map((u) => ({
        name: u.variety,
        percent: u.percent,
        allocationKey: u.key,
        allocationId: u.id,
        cloneLabel: u.cloneLabel,
        rootstockLabel: u.rootstockLabel,
        areaHa: u.areaHa,
      })),
    },
  ];

  const records = [
    pick({ clone: "Clone 777", weight_kg: 2043 }),
    pick({ clone: "Clone 777", weight_kg: 2095 }),
    pick({ clone: "Clone 667", weight_kg: 1917 }),
    pick({ clone: "Clone 667", weight_kg: 669 }),
  ];

  const actuals = aggregatePickingRecordsByPlanting(records as any).map((a) => ({
    blockId: a.blockId,
    variety: a.variety,
    tonnes: a.tonnes,
    allocationKey: matchAllocation(units, a.variety, a.clone).key,
    source: a.source,
    pickCount: a.pickCount ?? null,
  }));

  it("does not duplicate actual yield across same-variety allocations", () => {
    const [card] = buildYieldOverview({
      blocks,
      estimatedByBlock: new Map([["b1", 9]]),
      actuals,
    });
    expect(card.varieties[0].actualTonnes).toBeCloseTo(4.138, 6);
    expect(card.varieties[1].actualTonnes).toBeCloseTo(2.586, 6);
    expect(card.varieties[2].actualTonnes).toBeNull();
    expect(card.varieties.map((v) => v.cloneLabel)).toEqual([
      "Clone 777",
      "Clone 667",
      "Clone MV6",
    ]);
  });

  it("allocation actuals sum to the block total", () => {
    const [card] = buildYieldOverview({
      blocks,
      estimatedByBlock: new Map([["b1", 9]]),
      actuals,
    });
    expect(card.actualTonnes).toBeCloseTo(6.724, 6);
    const sum = card.varieties.reduce((a, v) => a + (v.actualTonnes ?? 0), 0);
    expect(sum).toBeCloseTo(card.actualTonnes!, 6);
  });

  it("apportions estimates per allocation instead of repeating them", () => {
    const [card] = buildYieldOverview({
      blocks,
      estimatedByBlock: new Map([["b1", 10]]),
      actuals: [],
    });
    expect(card.varieties.map((v) => v.estimatedTonnes)).toEqual([5, 3, 2]);
    card.varieties.forEach((v, i) => expect(v.areaHa).toBeCloseTo([0.9, 0.54, 0.36][i], 6));
  });

  it("keeps a single-allocation block working unchanged", () => {
    const one = buildAllocationUnits({
      blockId: "b2",
      areaHa: 1,
      allocations: [alloc({ name: "Shiraz", percent: 100 })],
    });
    const [card] = buildYieldOverview({
      blocks: [
        {
          id: "b2",
          name: "Home",
          areaHa: 1,
          varieties: one.map((u) => ({
            name: u.variety,
            percent: u.percent,
            allocationKey: u.key,
            areaHa: u.areaHa,
          })),
        },
      ],
      estimatedByBlock: new Map([["b2", 4]]),
      actuals: [
        { blockId: "b2", variety: "Shiraz", tonnes: 3.2, source: "detailed", pickCount: 2 },
      ],
    });
    expect(card.varieties[0].actualTonnes).toBe(3.2);
    expect(card.actualTonnes).toBe(3.2);
  });

  it("reports ambiguous legacy harvest as unallocated, never duplicated", () => {
    const ambiguousUnits = buildAllocationUnits({
      blockId: "b3",
      areaHa: 2,
      allocations: [
        alloc({ clone: "Clone 777", rootstock: "101-14", percent: 50 }),
        alloc({ clone: "Clone 777", rootstock: "Ramsey", percent: 50 }),
      ],
    });
    const [card] = buildYieldOverview({
      blocks: [
        {
          id: "b3",
          name: "Ridge",
          areaHa: 2,
          varieties: ambiguousUnits.map((u) => ({
            name: u.variety,
            percent: u.percent,
            allocationKey: u.key,
            cloneLabel: u.cloneLabel,
            rootstockLabel: u.rootstockLabel,
            areaHa: u.areaHa,
          })),
        },
      ],
      estimatedByBlock: new Map(),
      actuals: [
        {
          blockId: "b3",
          variety: "Pinot Noir",
          tonnes: 5,
          allocationKey: matchAllocation(ambiguousUnits, "Pinot Noir", "Clone 777").key,
          source: "detailed",
          pickCount: 3,
        },
      ],
    });
    expect(card.varieties.every((v) => v.actualTonnes == null)).toBe(true);
    expect(card.unallocated).toHaveLength(1);
    expect(card.unallocated[0].actualTonnes).toBe(5);
    expect(card.actualTonnes).toBe(5);
  });
});

describe("planting groups", () => {
  const units = buildAllocationUnits({
    blockId: "b1",
    areaHa: 1.8,
    allocations: [
      { id: "a1", name: "Pinot Noir", clone: "777", rootstock: "Richter 110", percent: 30 } as any,
      { id: "a2", name: "Pinot Noir", clone: "667", rootstock: "Richter 110", percent: 30 } as any,
      { id: "a3", name: "Pinot Noir", clone: "777", rootstock: "Richter 110", percent: 40 } as any,
    ],
  });

  it("combines same variety + clone + rootstock sections and sums hectares", () => {
    const groups = buildPlantingGroups(units);
    expect(groups).toHaveLength(2);
    const g777 = groups[0];
    expect(g777.sectionCount).toBe(2);
    expect(g777.allocationIds).toEqual(["a1", "a3"]);
    expect(g777.areaHa).toBeCloseTo(1.26, 5);
    expect(groups[1].areaHa).toBeCloseTo(0.54, 5);
    expect((groups[0].areaHa ?? 0) + (groups[1].areaHa ?? 0)).toBeCloseTo(1.8, 5);
  });

  it("keeps different clone or rootstock separate", () => {
    const g = buildPlantingGroups(
      buildAllocationUnits({
        blockId: "b1",
        areaHa: 2,
        allocations: [
          { id: "x", name: "Pinot Noir", clone: "777", rootstock: "Richter 110" } as any,
          { id: "y", name: "Pinot Noir", clone: "777", rootstock: "101-14" } as any,
        ],
      }),
    );
    expect(g).toHaveLength(2);
  });

  it("resolves a member allocation id to its group", () => {
    const groups = buildPlantingGroups(units);
    expect(matchAllocation(groups, "Pinot Noir", null, { allocationId: "a3" }).key).toBe(
      groups[0].key,
    );
  });

  it("labels multi-section groups", () => {
    const groups = buildPlantingGroups(units);
    expect(plantingGroupOptionLabel(groups[0])).toContain("2 sections");
    expect(plantingGroupOptionLabel(groups[1])).not.toContain("sections");
  });
});
