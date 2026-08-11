import { describe, it, expect } from "vitest";
import {
  aggregate,
  buildYieldFacts,
  byBlock,
  byVariety,
  pctChange,
  threeYearTrend,
} from "@/lib/yieldAnalytics";
import type { HistoricalBlockRow } from "@/lib/yieldReportsQuery";
import type { PickingYieldTotal } from "@/lib/pickingRecordsQuery";

const blocks = [
  { id: "b1", name: "Block One", areaHa: 10 },
  { id: "b2", name: "Block Two", areaHa: 5 },
];

const hist = (over: Partial<HistoricalBlockRow>): HistoricalBlockRow => ({
  recordId: "r",
  season: "2025",
  year: 2025,
  blockId: "b1",
  blockName: "Block One",
  variety: "Shiraz",
  areaHa: 10,
  yieldTonnes: 20,
  yieldPerHa: 2,
  archivedAt: null,
  ...over,
});

const pick = (over: Partial<PickingYieldTotal>): PickingYieldTotal => ({
  vineyard_id: "v",
  vintage: 2025,
  paddock_id: "b1",
  paddock_name: "Block One",
  variety_name: "Shiraz",
  pick_count: 2,
  total_weight_kg: 30000,
  actual_yield_tonnes: 30,
  first_picked_at: null,
  last_picked_at: null,
  total_grape_value: 60000,
  ...over,
});

describe("buildYieldFacts", () => {
  it("lets detailed picks supersede basic actuals for the same block+variety+vintage", () => {
    const facts = buildYieldFacts({
      historicalRows: [hist({})],
      pickingTotals: [pick({})],
      blocks,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].tonnes).toBe(30);
    expect(facts[0].source).toBe("detailed");
  });

  it("never double counts hectares when a block has multiple harvest records", () => {
    const facts = buildYieldFacts({
      historicalRows: [
        hist({ recordId: "r1", variety: "Shiraz", yieldTonnes: 20 }),
        hist({ recordId: "r2", variety: "Merlot", yieldTonnes: 20 }),
      ],
      pickingTotals: [],
      blocks,
    });
    const agg = aggregate(facts);
    expect(agg.tonnes).toBe(40);
    expect(agg.areaHa).toBe(10); // block area apportioned, not summed twice
    expect(agg.tonnesPerHa).toBe(4);
  });

  it("computes a tonnage-weighted average price, not an arithmetic mean", () => {
    const facts = buildYieldFacts({
      historicalRows: [],
      pickingTotals: [
        pick({ paddock_id: "b1", actual_yield_tonnes: 10, total_grape_value: 10000 }), // $1000/t
        pick({ paddock_id: "b2", paddock_name: "Block Two", actual_yield_tonnes: 90, total_grape_value: 180000 }), // $2000/t
      ],
      blocks,
    });
    const agg = aggregate(facts);
    expect(agg.tonnes).toBe(100);
    expect(agg.revenue).toBe(190000);
    expect(agg.pricePerTonne).toBe(1900); // weighted, not 1500
  });

  it("allocates block cost across varieties by tonnage share", () => {
    const facts = buildYieldFacts({
      historicalRows: [
        hist({ recordId: "r1", variety: "Shiraz", yieldTonnes: 30 }),
        hist({ recordId: "r2", variety: "Merlot", yieldTonnes: 10 }),
      ],
      pickingTotals: [],
      blocks,
      costRows: [{ vintage_year: 2025, block_id: "b1", variety: null, total_cost: 4000 }],
    });
    const shiraz = facts.find((f) => f.variety === "Shiraz")!;
    const merlot = facts.find((f) => f.variety === "Merlot")!;
    expect(shiraz.cost).toBe(3000);
    expect(merlot.cost).toBe(1000);
    expect(aggregate(facts).cost).toBe(4000);
  });

  it("leaves revenue and cost null when the data does not exist", () => {
    const agg = aggregate(buildYieldFacts({ historicalRows: [hist({})], pickingTotals: [], blocks }));
    expect(agg.revenue).toBeNull();
    expect(agg.cost).toBeNull();
    expect(agg.pricePerTonne).toBeNull();
    expect(agg.marginPerHa).toBeNull();
  });
});

describe("groupings and trends", () => {
  const facts = buildYieldFacts({
    historicalRows: [
      hist({ recordId: "a", year: 2023, season: "2023", yieldTonnes: 10 }),
      hist({ recordId: "b", year: 2024, season: "2024", yieldTonnes: 20 }),
      hist({ recordId: "c", year: 2025, season: "2025", yieldTonnes: 30 }),
    ],
    pickingTotals: [],
    blocks,
  });

  it("groups by block and variety", () => {
    expect(byBlock(facts.filter((f) => f.vintage === 2025))).toHaveLength(1);
    expect(byVariety(facts.filter((f) => f.vintage === 2025))[0].label).toBe("Shiraz");
  });

  it("suppresses a 3-year average with fewer than three vintages", () => {
    const two = threeYearTrend(
      [
        { vintage: 2024, value: 2 },
        { vintage: 2025, value: 3 },
      ],
      2025,
    );
    expect(two.threeYearAverage).toBeNull();
  });

  it("computes a 3-year average when three vintages exist", () => {
    const t = threeYearTrend(
      [
        { vintage: 2023, value: 1 },
        { vintage: 2024, value: 2 },
        { vintage: 2025, value: 3 },
      ],
      2025,
    );
    expect(t.threeYearAverage).toBe(2);
    expect(t.difference).toBe(1);
  });

  it("guards percentage change against a missing prior period", () => {
    expect(pctChange(10, null)).toBeNull();
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(11, 10)).toBeCloseTo(10);
  });
});
