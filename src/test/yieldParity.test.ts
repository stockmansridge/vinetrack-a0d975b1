import { describe, expect, it } from "vitest";
import {
  budsPerVine,
  calculatePruningYield,
  blockEstimate,
} from "@/lib/pruningYieldFormula";
import { summariseYieldSession } from "@/lib/yieldSessionSummary";
import { extractHistoricalBlockRows } from "@/lib/yieldReportsQuery";

describe("pruning yield formula (iOS parity)", () => {
  it("derives buds per vine by method", () => {
    const base = { budsPerSpur: 2, spursPerVine: 6, budsPerCane: 10, canesPerVine: 4 };
    expect(budsPerVine({ method: "spur", ...base })).toBe(12);
    expect(budsPerVine({ method: "cane", ...base })).toBe(40);
  });

  it("matches the mobile spur calculation end to end", () => {
    const r = calculatePruningYield({
      method: "spur",
      bunchesPerBud: 1.5,
      budsPerSpur: 2,
      spursPerVine: 6,
      budsPerCane: 10,
      canesPerVine: 4,
      vinesPerHa: 2000,
      bunchWeightGrams: 120,
      areaHectares: 3,
    });
    expect(r.budsPerVine).toBe(12);
    expect(r.bunchesPerHa).toBe(36000);
    expect(r.yieldKgPerHa).toBeCloseTo(4320, 6);
    expect(r.yieldTonnesPerHa).toBeCloseTo(4.32, 6);
    expect(r.totalTonnes).toBeCloseTo(12.96, 6);
  });

  it("returns no block total without an area", () => {
    const r = calculatePruningYield({
      method: "cane",
      bunchesPerBud: 1.5,
      budsPerSpur: 2,
      spursPerVine: 6,
      budsPerCane: 10,
      canesPerVine: 4,
      vinesPerHa: 2000,
      bunchWeightGrams: 120,
      areaHectares: 0,
    });
    expect(r.totalTonnes).toBeNull();
  });

  it("computes block estimates from samples", () => {
    const e = blockEstimate({
      totalVines: 1000,
      averageBunchesPerVine: 25,
      bunchWeightKg: 0.15,
      damageFactor: 1,
    });
    expect(e.totalBunches).toBe(25000);
    expect(e.estimatedYieldTonnes).toBeCloseTo(3.75, 6);
  });
});

describe("yield estimation session parser", () => {
  const blockId = "11111111-1111-1111-1111-111111111111";
  const canonical = {
    selectedPaddockIds: [blockId],
    samplesPerHectare: 20,
    blockBunchWeightsKg: { [blockId]: 0.2 },
    sampleSites: [
      {
        paddockId: blockId,
        paddockName: "Block A",
        rowNumber: 3,
        siteIndex: 1,
        latitude: -34.1,
        longitude: 138.2,
        bunchCountEntry: { bunchesPerVine: 20, recordedAt: "2026-01-05T00:00:00Z", recordedBy: "Sam" },
      },
      {
        paddockId: blockId,
        rowNumber: 8,
        siteIndex: 2,
        bunchCountEntry: { bunchesPerVine: 30, recordedAt: "2026-01-05T00:10:00Z", recordedBy: "Sam" },
      },
      { paddockId: blockId, rowNumber: 12, siteIndex: 3 },
    ],
  };

  it("groups the canonical mobile payload and computes tonnage", () => {
    const s = summariseYieldSession(canonical, {
      blocks: [{ id: blockId, name: "Block A", areaHa: 2, vineCount: 1000 }],
    });
    expect(s.blocks).toHaveLength(1);
    const b = s.blocks[0];
    expect(b.siteCount).toBe(3);
    expect(b.recordedCount).toBe(2);
    expect(b.avgBunchesPerVine).toBe(25);
    expect(b.bunchWeightKg).toBe(0.2);
    expect(b.bunchWeightIsDefault).toBe(false);
    expect(b.totalBunches).toBe(25000);
    expect(b.estimatedYieldTonnes).toBeCloseTo(5, 6);
    expect(s.totalEstTonnes).toBeCloseTo(5, 6);
    expect(s.samplesPerHectare).toBe(20);
  });

  it("falls back to the legacy flat bunch weight and defaults", () => {
    const s = summariseYieldSession(
      { ...canonical, blockBunchWeightsKg: undefined, averageBunchWeightKg: 0.18 },
      { blocks: [{ id: blockId, name: "Block A", areaHa: 2, vineCount: 1000 }] },
    );
    expect(s.blocks[0].bunchWeightKg).toBe(0.18);

    const d = summariseYieldSession(
      { ...canonical, blockBunchWeightsKg: undefined },
      { blocks: [{ id: blockId, name: "Block A", areaHa: 2, vineCount: 1000 }] },
    );
    expect(d.blocks[0].bunchWeightKg).toBe(0.15);
    expect(d.blocks[0].bunchWeightIsDefault).toBe(true);
  });

  it("reports missing vine counts instead of guessing", () => {
    const s = summariseYieldSession(canonical, { blocks: [{ id: blockId, name: "Block A" }] });
    expect(s.blocks[0].estimatedYieldTonnes).toBeNull();
    expect(s.missing.vines).toBe(true);
    expect(s.totalEstTonnes).toBeNull();
  });

  it("still parses the legacy nested sampleSets shape", () => {
    const s = summariseYieldSession(
      {
        sampleSets: [
          {
            paddockId: blockId,
            paddockName: "Block A",
            avgBunchWeightKg: 0.2,
            sites: [{ vineNumber: 1, bunchCount: 20 }, { vineNumber: 2, bunchCount: 30 }],
          },
        ],
      },
      { blocks: [{ id: blockId, name: "Block A", areaHa: 2, vineCount: 1000 }] },
    );
    expect(s.blocks[0].avgBunchesPerVine).toBe(25);
    expect(s.blocks[0].estimatedYieldTonnes).toBeCloseTo(5, 6);
  });
});

describe("historical block rows", () => {
  it("flattens block_results for multi-vintage comparison", () => {
    const rows = extractHistoricalBlockRows([
      {
        id: "r1",
        vineyard_id: "v1",
        season: "2025/26",
        year: 2026,
        total_yield_tonnes: 12,
        total_area_hectares: 3,
        block_results: [
          { paddockId: "b1", paddockName: "Block A", areaHectares: 2, actualYieldTonnes: 8 },
          { paddockId: "b2", paddockName: "Block B", areaHectares: 1, yieldTonnes: 4 },
        ],
      },
    ] as any);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ blockName: "Block A", yieldTonnes: 8, yieldPerHa: 4 });
    expect(rows[1]).toMatchObject({ blockName: "Block B", yieldTonnes: 4, yieldPerHa: 4 });
  });

  it("falls back to record totals when there are no block results", () => {
    const rows = extractHistoricalBlockRows([
      { id: "r2", vineyard_id: "v1", year: 2025, total_yield_tonnes: 5, total_area_hectares: 2 },
    ] as any);
    expect(rows[0]).toMatchObject({ season: "2025", blockName: "All blocks", yieldPerHa: 2.5 });
  });
});
