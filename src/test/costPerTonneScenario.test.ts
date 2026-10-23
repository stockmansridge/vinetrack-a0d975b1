// Estimated Yield scenario tab: default tonnes come from the canonical
// seasonal estimate, user overrides replace them in memory only, reset
// restores the estimate, and variety rows reconcile to the block rows.
import { describe, it, expect } from "vitest";
import {
  buildBlockScenarioRows,
  buildVarietyScenarioRows,
  scenarioTotals,
  effectiveBlockTonnes,
} from "@/lib/costPerTonneScenario";
import type { SeasonYieldBlockEstimate } from "@/lib/seasonYieldContract";

const block = (over: Partial<SeasonYieldBlockEstimate>): SeasonYieldBlockEstimate => ({
  paddockId: "b1",
  blockName: "Block 1",
  areaHa: 2,
  baseTonnes: 10,
  tonnes: 10,
  damageLossPct: 0,
  damageRecordCount: 0,
  damageApplied: false,
  isAvailable: true,
  isComplete: true,
  warnings: [],
  estimateSource: "pruning_calculator",
  calculatedAt: null,
  sourceInputs: null,
  groups: [],
  ...over,
});

const shirazCabBlock = block({
  paddockId: "b1",
  tonnes: 10,
  groups: [
    {
      varietyKey: "shiraz", varietyName: "Shiraz", clone: null, rootstock: null,
      plantingGroupKey: "pg-1", allocationIds: [], allocationPercent: 60,
      baseTonnes: 6, tonnes: 6, isAvailable: true, warnings: [],
    },
    {
      varietyKey: "cabernet franc", varietyName: "Cabernet Franc", clone: null, rootstock: null,
      plantingGroupKey: "pg-2", allocationIds: [], allocationPercent: 40,
      baseTonnes: 4, tonnes: 4, isAvailable: true, warnings: [],
    },
  ],
});

describe("buildBlockScenarioRows", () => {
  it("defaults to the canonical estimate and computes cost per tonne", () => {
    const rows = buildBlockScenarioRows(
      [block({ paddockId: "b1", tonnes: 10 })],
      new Map([["b1", 5000]]),
      new Map(),
    );
    expect(rows[0].tonnes).toBe(10);
    expect(rows[0].estimateTonnes).toBe(10);
    expect(rows[0].isOverridden).toBe(false);
    expect(rows[0].costPerTonne).toBe(500);
  });

  it("applies a user override and reset (empty overrides) restores the estimate", () => {
    const blocks = [block({ paddockId: "b1", tonnes: 10 })];
    const cost = new Map([["b1", 5000]]);
    const overridden = buildBlockScenarioRows(blocks, cost, new Map([["b1", 20]]));
    expect(overridden[0].tonnes).toBe(20);
    expect(overridden[0].isOverridden).toBe(true);
    expect(overridden[0].costPerTonne).toBe(250);
    const reset = buildBlockScenarioRows(blocks, cost, new Map());
    expect(reset[0].tonnes).toBe(10);
    expect(reset[0].isOverridden).toBe(false);
  });

  it("never reports an unknown estimate as zero — cost/t stays blank until tonnes are entered", () => {
    const blocks = [block({ paddockId: "b1", tonnes: null, baseTonnes: null, isAvailable: false })];
    const cost = new Map([["b1", 5000]]);
    const rows = buildBlockScenarioRows(blocks, cost, new Map());
    expect(rows[0].tonnes).toBeNull();
    expect(rows[0].costPerTonne).toBeNull();
    const withOverride = buildBlockScenarioRows(blocks, cost, new Map([["b1", 8]]));
    expect(withOverride[0].costPerTonne).toBe(625);
  });

  it("rejects negative or non-finite overrides and falls back to the estimate", () => {
    const b = block({ paddockId: "b1", tonnes: 10 });
    expect(effectiveBlockTonnes(b, new Map([["b1", -5]]))).toEqual({ tonnes: 10, isOverridden: false });
    expect(effectiveBlockTonnes(b, new Map([["b1", NaN]]))).toEqual({ tonnes: 10, isOverridden: false });
  });

  it("shows cost without a cost per tonne when the block has no cost rows", () => {
    const rows = buildBlockScenarioRows([block({ paddockId: "b1", tonnes: 10 })], new Map(), new Map());
    expect(rows[0].totalCost).toBeNull();
    expect(rows[0].costPerTonne).toBeNull();
  });
});

describe("buildVarietyScenarioRows", () => {
  it("splits edited block tonnes across plantings so varieties reconcile to the block", () => {
    const rows = buildVarietyScenarioRows(
      [shirazCabBlock],
      new Map([["shiraz", 3000], ["cabernet franc", 2000]]),
      new Map([["b1", 20]]),
    );
    const shiraz = rows.find((r) => r.varietyKey === "shiraz")!;
    const cab = rows.find((r) => r.varietyKey === "cabernet franc")!;
    expect(shiraz.tonnes).toBeCloseTo(12, 6);
    expect(cab.tonnes).toBeCloseTo(8, 6);
    expect(shiraz.costPerTonne).toBeCloseTo(250, 6);
    expect(cab.costPerTonne).toBeCloseTo(250, 6);
    expect((shiraz.tonnes ?? 0) + (cab.tonnes ?? 0)).toBeCloseTo(20, 6);
  });

  it("marks a variety partial while any contributing planting lacks tonnes", () => {
    const unknownBlock = block({
      paddockId: "b2", blockName: "Block 2", tonnes: null, baseTonnes: null, isAvailable: false,
      groups: [
        {
          varietyKey: "shiraz", varietyName: "Shiraz", clone: null, rootstock: null,
          plantingGroupKey: "pg-3", allocationIds: [], allocationPercent: 100,
          baseTonnes: null, tonnes: null, isAvailable: false, warnings: ["missing_vine_count"],
        },
      ],
    });
    const rows = buildVarietyScenarioRows([shirazCabBlock, unknownBlock], new Map(), new Map());
    const shiraz = rows.find((r) => r.varietyKey === "shiraz")!;
    expect(shiraz.tonnes).toBeNull();
    expect(shiraz.knownTonnes).toBeCloseTo(6, 6);
    expect(shiraz.costPerTonne).toBeNull();
  });
});

describe("scenarioTotals", () => {
  it("sums known tonnes and costs and divides for the overall cost per tonne", () => {
    const rows = buildBlockScenarioRows(
      [
        block({ paddockId: "b1", tonnes: 10 }),
        block({ paddockId: "b2", blockName: "Block 2", tonnes: null, baseTonnes: null, isAvailable: false }),
      ],
      new Map([["b1", 5000], ["b2", 3000]]),
      new Map(),
    );
    const t = scenarioTotals(rows);
    expect(t.totalCost).toBe(8000);
    expect(t.totalTonnes).toBe(10);
    expect(t.blocksWithTonnes).toBe(1);
    expect(t.blocksTotal).toBe(2);
    expect(t.costPerTonne).toBe(800);
  });

  it("reports no overall cost per tonne when no block has tonnes", () => {
    const t = scenarioTotals(
      buildBlockScenarioRows(
        [block({ paddockId: "b1", tonnes: null, baseTonnes: null, isAvailable: false })],
        new Map([["b1", 5000]]),
        new Map(),
      ),
    );
    expect(t.costPerTonne).toBeNull();
  });
});
