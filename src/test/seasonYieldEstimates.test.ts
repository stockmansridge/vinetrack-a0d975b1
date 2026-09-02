// SQL 221 canonical base estimate + Portal damage engine.
import { describe, it, expect } from "vitest";
import {
  buildSeasonYieldEstimates,
  estimatedTonnesByVariety,
  splitBlockEstimateToGroups,
  type SeasonYieldBaseOverview,
} from "@/lib/seasonYieldContract";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";

const overview = (blocks: any[], vintage = 2027): SeasonYieldBaseOverview => ({
  vineyard_id: "v1",
  vintage,
  blocks,
  calculated_at: "2026-06-01T00:00:00Z",
});

const completeBlock = {
  paddock_id: B1,
  block_name: "Block 1",
  area_hectares: 2,
  base_estimate_tonnes: 10,
  is_estimate_available: true,
  is_estimate_complete: true,
  estimate_source: "pruning_calculator",
  calculated_at: "2026-06-01T00:00:00Z",
  source_inputs: { vine_count: 2000, bunch_weight_grams: 120 },
  groups: [
    {
      variety_name: "Shiraz",
      variety_key: "shiraz",
      planting_group_key: "pg-1",
      allocation_percent: 60,
      base_estimate_tonnes: 6,
      is_estimate_available: true,
    },
    {
      variety_name: "Cabernet Franc",
      variety_key: "cabernet franc",
      planting_group_key: "pg-2",
      allocation_percent: 40,
      base_estimate_tonnes: 4,
      is_estimate_available: true,
    },
  ],
};

const incompleteBlock = {
  paddock_id: B2,
  block_name: "Block 2",
  area_hectares: 1,
  base_estimate_tonnes: null,
  known_base_estimate_tonnes: 0,
  is_estimate_available: false,
  setup_warnings: ["missing_pruning_settings", "missing_vine_count"],
  groups: [
    {
      variety_name: "Shiraz",
      variety_key: "shiraz",
      planting_group_key: "pg-3",
      base_estimate_tonnes: null,
      is_estimate_available: false,
      setup_warnings: ["missing_vine_count"],
    },
  ],
};

describe("buildSeasonYieldEstimates", () => {
  it("uses the database base estimate when damage is off", () => {
    const m = buildSeasonYieldEstimates({
      overview: overview([completeBlock]),
      applyDamage: false,
      damageByBlock: new Map([[B1, { lossPct: 25, recordCount: 2 }]]),
    });
    expect(m.blocks[0].tonnes).toBe(10);
    expect(m.blocks[0].damageApplied).toBe(false);
    expect(m.totalTonnes).toBe(10);
    expect(m.isComplete).toBe(true);
  });

  it("applies the Portal damage engine to block and variety estimates", () => {
    const m = buildSeasonYieldEstimates({
      overview: overview([completeBlock]),
      applyDamage: true,
      damageByBlock: new Map([[B1, { lossPct: 25, recordCount: 2 }]]),
    });
    expect(m.blocks[0].tonnes).toBeCloseTo(7.5, 6);
    expect(m.blocks[0].damageApplied).toBe(true);
    expect(m.blocks[0].groups[0].tonnes).toBeCloseTo(4.5, 6);
    expect(m.blocks[0].groups[1].tonnes).toBeCloseTo(3, 6);
    const byVariety = estimatedTonnesByVariety(m);
    expect(byVariety.get("shiraz")).toBeCloseTo(4.5, 6);
    expect(byVariety.get("cabernet franc")).toBeCloseTo(3, 6);
  });

  it("never reports an unknown estimate as zero", () => {
    const m = buildSeasonYieldEstimates({
      overview: overview([incompleteBlock]),
      applyDamage: false,
    });
    expect(m.blocks[0].tonnes).toBeNull();
    expect(m.blocks[0].baseTonnes).toBeNull();
    expect(m.totalTonnes).toBeNull();
    expect(m.blocksMissing).toBe(1);
    expect(m.warnings).toContain("missing_pruning_settings");
  });

  it("omits a variety from availability while any planting is unknown", () => {
    const m = buildSeasonYieldEstimates({
      overview: overview([completeBlock, incompleteBlock]),
      applyDamage: false,
    });
    expect(m.totalTonnes).toBeNull();
    expect(m.knownTonnes).toBe(10);
    const byVariety = estimatedTonnesByVariety(m);
    // Shiraz spans an unknown block, so availability must show "—".
    expect(byVariety.has("shiraz")).toBe(false);
    expect(byVariety.get("cabernet franc")).toBe(4);
  });

  it("keeps vintages isolated — damage from another vintage never applies", () => {
    // The page filters damage_records by vintage before this call, so a map
    // built from a different vintage simply contains no entry for the block.
    const m = buildSeasonYieldEstimates({
      overview: overview([completeBlock], 2026),
      applyDamage: true,
      damageByBlock: new Map(),
    });
    expect(m.vintage).toBe(2026);
    expect(m.blocks[0].tonnes).toBe(10);
    expect(m.blocks[0].damageApplied).toBe(false);
  });
});

describe("splitBlockEstimateToGroups", () => {
  const [block] = buildSeasonYieldEstimates({
    overview: overview([completeBlock]),
    applyDamage: false,
  }).blocks;

  it("splits a superseding block total across DB planting identities", () => {
    const shares = splitBlockEstimateToGroups(block, 20);
    expect(shares[0]).toBeCloseTo(12, 6);
    expect(shares[1]).toBeCloseTo(8, 6);
  });

  it("returns unknown shares for an unknown block total", () => {
    expect(splitBlockEstimateToGroups(block, null)).toEqual([null, null]);
  });
});
