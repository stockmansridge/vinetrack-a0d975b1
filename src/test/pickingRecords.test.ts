import { describe, expect, it } from "vitest";
import {
  aggregatePickingRecords,
  detailedActualsFromTotals,
  pickingKey,
  supersedeActualYield,
  type PickingRecord,
  type PickingYieldTotal,
} from "@/lib/pickingRecordsQuery";
import { resolveSugarUnit, sugarUnitSymbol } from "@/lib/vineyardRegionSettingsQuery";

const total = (o: Partial<PickingYieldTotal>): PickingYieldTotal => ({
  vineyard_id: "v1",
  vintage: 2026,
  paddock_id: "b1",
  paddock_name: "Block 1",
  variety_name: "Shiraz",
  pick_count: 2,
  total_weight_kg: 5000,
  actual_yield_tonnes: 5,
  first_picked_at: null,
  last_picked_at: null,
  total_grape_value: null,
  ...o,
});

describe("picking log aggregation", () => {
  it("converts server totals to tonnes", () => {
    const [d] = detailedActualsFromTotals([total({})]);
    expect(d.tonnes).toBe(5);
    expect(d.source).toBe("detailed");
  });

  it("falls back to weight when the view has no tonnes", () => {
    const [d] = detailedActualsFromTotals([total({ actual_yield_tonnes: null })]);
    expect(d.tonnes).toBe(5);
  });

  it("sums multiple picks for the same block, variety and vintage", () => {
    const rec = (id: string, kg: number): PickingRecord =>
      ({
        id,
        vineyard_id: "v1",
        picked_at: "2026-03-01",
        vintage: 2026,
        paddock_id: "b1",
        paddock_name: "Block 1",
        variety_name: "Shiraz",
        weight_kg: kg,
      } as PickingRecord);
    const [agg] = aggregatePickingRecords([rec("1", 1000), rec("2", 1500)]);
    expect(agg.tonnes).toBe(2.5);
  });
});

describe("detailed picks supersede basic actual yield", () => {
  const detailed = detailedActualsFromTotals([total({})]);

  it("drops the matching basic entry instead of adding to it", () => {
    const merged = supersedeActualYield(
      [{ blockId: "b1", variety: "Shiraz", vintage: 2026, tonnes: 9 }],
      detailed,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].tonnes).toBe(5);
    expect(merged[0].source).toBe("detailed");
  });

  it("keeps basic entries for other varieties and vintages", () => {
    const merged = supersedeActualYield(
      [
        { blockId: "b1", variety: "Merlot", vintage: 2026, tonnes: 3 },
        { blockId: "b1", variety: "Shiraz", vintage: 2025, tonnes: 4 },
      ],
      detailed,
    );
    expect(merged.map((m) => m.tonnes).sort()).toEqual([3, 4, 5]);
  });

  it("drops a variety-less basic entry when any pick exists for that block and vintage", () => {
    const merged = supersedeActualYield(
      [{ blockId: "b1", variety: null, vintage: 2026, tonnes: 12 }],
      detailed,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].tonnes).toBe(5);
  });

  it("keys case-insensitively", () => {
    expect(pickingKey("B1", " shiraz ", 2026)).toBe(pickingKey("b1", "Shiraz", 2026));
  });
});

describe("sugar measurement unit", () => {
  it("defaults to Baumé in AU/NZ and Brix elsewhere", () => {
    expect(resolveSugarUnit({ sugar_measurement_unit: null, country_code: "AU" })).toBe("baume");
    expect(resolveSugarUnit({ sugar_measurement_unit: null, country_code: "NZ" })).toBe("baume");
    expect(resolveSugarUnit({ sugar_measurement_unit: null, country_code: "US" })).toBe("brix");
  });

  it("honours an explicit vineyard override", () => {
    expect(resolveSugarUnit({ sugar_measurement_unit: "brix", country_code: "AU" })).toBe("brix");
  });

  it("labels historical values with their stored unit", () => {
    expect(sugarUnitSymbol("baume")).toBe("°Bé");
    expect(sugarUnitSymbol("brix")).toBe("°Bx");
  });
});

// --- Final UX refinements -------------------------------------------------
import { buildYieldOverview } from "@/lib/yieldOverview";
import { actualSourceLabel } from "@/pages/setup/YieldReportsPage";


describe("Actual yield source attribution", () => {
  const blocks = [{ id: "b1", name: "Block 1", varieties: [{ name: "Shiraz", percent: null }] }];

  it("labels detailed totals with the pick count", () => {
    const [card] = buildYieldOverview({
      blocks,
      estimatedByBlock: new Map(),
      actuals: [{ blockId: "b1", variety: "Shiraz", tonnes: 4, source: "detailed", pickCount: 3 }],
    });
    expect(card.actualSource).toBe("detailed");
    expect(card.actualPickCount).toBe(3);
    expect(actualSourceLabel(card.actualSource, card.actualPickCount)).toBe(
      "From 3 picking records",
    );
  });

  it("labels basic totals as manual", () => {
    const [card] = buildYieldOverview({
      blocks,
      estimatedByBlock: new Map(),
      actuals: [{ blockId: "b1", variety: "Shiraz", tonnes: 4, source: "basic" }],
    });
    expect(actualSourceLabel(card.actualSource, card.actualPickCount)).toBe("Manual actual yield");
  });
});

describe("Sugar unit resolution", () => {
  it("explicit vineyard preference always wins over the regional default", () => {
    expect(resolveSugarUnit({ country_code: "AU", sugar_measurement_unit: "brix" })).toBe("brix");
    expect(resolveSugarUnit({ country_code: "US", sugar_measurement_unit: "baume" })).toBe("baume");
  });

  it("falls back to the regional default only when unset", () => {
    expect(resolveSugarUnit({ country_code: "AU", sugar_measurement_unit: null })).toBe("baume");
    expect(resolveSugarUnit({ country_code: "US", sugar_measurement_unit: null })).toBe("brix");
  });
});
