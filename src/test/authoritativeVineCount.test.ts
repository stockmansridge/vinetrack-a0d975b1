// SQL 263 / iOS / Android authoritative vine-count parity.
import { describe, it, expect, vi } from "vitest";

const insertSpy = vi.fn(async (_row: any) => ({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ insert: insertSpy }),
  },
}));

import { deriveMetrics } from "@/lib/paddockGeometry";
import {
  authoritativeVineCount,
  completeRowEffectiveVineCount,
  physicalCalculatedRowVineCount,
  physicalRowLengthMeters,
  polygonCentroidLatitude,
  summaryVineCount,
} from "@/lib/paddockRowVines";
import { toYieldBlockInfo, recordActualYield } from "@/lib/yieldReportsQuery";
import { effectivePruningVinesPerHa, buildBlockPrunedYieldTiles } from "@/lib/pruningYieldSummary";
import { summariseYieldSession } from "@/lib/yieldSessionSummary";
import { buildSeasonYieldEstimates, seasonVineCountBasisLabel } from "@/lib/seasonYieldContract";

const LAT = -34.28;
const DLAT = 250 / 111320; // 250 m north–south
const polygon = [
  { latitude: LAT, longitude: 140.6 },
  { latitude: LAT, longitude: 140.601 },
  { latitude: LAT + DLAT, longitude: 140.601 },
  { latitude: LAT + DLAT, longitude: 140.6 },
];
const row = (n: number, extra: Record<string, any> = {}) => ({
  id: `r${n}`,
  number: n,
  startPoint: { latitude: LAT, longitude: 140.6 + n * 0.00003 },
  endPoint: { latitude: LAT + DLAT, longitude: 140.6 + n * 0.00003 },
  ...extra,
});
const noGeom = (n: number, extra: Record<string, any> = {}) => ({ id: `r${n}`, number: n, ...extra });
const paddock = (rows: any[], extra: Record<string, any> = {}) => ({
  id: "p1",
  name: "Block 1",
  vine_spacing: 1.5,
  polygon_points: polygon,
  rows,
  ...extra,
});
const calcBlock = (p: any) => deriveMetrics(p).vineCount;
const show = (p: any) => summaryVineCount(p, calcBlock(p));
const rowCalc = (r: any) =>
  physicalCalculatedRowVineCount(r, 1.5, polygonCentroidLatitude(polygon))!;

describe("row calculation (mobile/SQL contract)", () => {
  it("uses 111,320 m/deg and half-away-from-zero rounding", () => {
    expect(physicalRowLengthMeters(row(1), polygonCentroidLatitude(polygon))).toBeCloseTo(250, 6);
    expect(rowCalc(row(1))).toBe(167); // 166.67 → 167
    expect(physicalCalculatedRowVineCount(row(1), 2, LAT)).toBe(125);
  });
  it("ignores row_length_overrides", () => {
    const p = paddock([row(1, { vineCountOverride: 10 }), row(2)], { row_length_overrides: { "2": 999 } });
    expect(completeRowEffectiveVineCount(p)).toBe(10 + 167);
  });
});

describe("authoritative count", () => {
  it("1 no override → existing calculated block count", () => {
    const p = paddock([row(1), row(2)]);
    expect(show(p)).toBe(calcBlock(p));
    expect(authoritativeVineCount(p, 42).source).toBe("fallback");
  });
  it("2 positive block override → block override", () => {
    expect(show(paddock([row(1)], { vine_count_override: 900 }))).toBe(900);
  });
  it("3 one manual row + calculable rows → complete row total", () => {
    expect(show(paddock([row(1, { vineCountOverride: 158 }), row(2), row(3)]))).toBe(158 + 167 + 167);
  });
  it("4 multiple manual rows → complete row total", () => {
    expect(show(paddock([row(1, { vineCountOverride: 10 }), row(2, { vineCountOverride: 20 }), row(3)]))).toBe(197);
  });
  it("5 block override + row overrides → block wins", () => {
    expect(show(paddock([row(1, { vineCountOverride: 10 })], { vine_count_override: 500 }))).toBe(500);
  });
  it("6 zero/negative block override ignored", () => {
    const rs = [row(1, { vineCountOverride: 10 }), row(2)];
    expect(show(paddock(rs, { vine_count_override: 0 }))).toBe(177);
    expect(show(paddock(rs, { vine_count_override: -5 }))).toBe(177);
  });
  it("7 invalid row override ignored", () => {
    for (const bad of [0, -3, 1.5, "12", null]) {
      const p = paddock([row(1, { vineCountOverride: bad }), row(2)]);
      expect(show(p)).toBe(calcBlock(p));
    }
  });
  it("8 clearing row overrides → fallback returns", () => {
    const p = paddock([row(1), row(2)]);
    expect(completeRowEffectiveVineCount(p)).toBeNull();
    expect(show(p)).toBe(calcBlock(p));
  });
});

describe("completeness", () => {
  const incomplete = paddock([row(1, { vineCountOverride: 158 }), row(2), noGeom(3)]);
  it("9 manual + uncalculable untouched row → row total rejected", () => {
    expect(completeRowEffectiveVineCount(incomplete)).toBeNull();
  });
  it("10 incomplete row total is not authoritative (never 158 + 167 + 0)", () => {
    expect(show(incomplete)).toBe(calcBlock(incomplete));
    expect(show(incomplete)).not.toBe(158 + 167);
    expect(authoritativeVineCount(incomplete, 1).source).toBe("fallback");
  });
  it("11 fixing the missing row → complete total authoritative again", () => {
    const fixed = paddock([row(1, { vineCountOverride: 158 }), row(2), row(3)]);
    expect(show(fixed)).toBe(158 + 167 + 167);
  });
  it("12 all rows manual → works without vine spacing", () => {
    const p = paddock([row(1, { vineCountOverride: 150 }), row(2, { vineCountOverride: 160 }), row(3, { vineCountOverride: 155 })], { vine_spacing: null });
    expect(show(p)).toBe(465);
  });
  it("13 all rows manual → works without row geometry", () => {
    const p = paddock([noGeom(1, { vineCountOverride: 150 }), noGeom(2, { vineCountOverride: 160 }), noGeom(3, { vineCountOverride: 155 })], { polygon_points: null });
    expect(show(p)).toBe(465);
  });
});

describe("yield", () => {
  const settings = (vinesPerHa: number) => ({
    id: "s1", vineyardId: "v", paddockId: "p1", pruneMethod: "spur", bunchesPerBud: 1, budsPerSpur: 2,
    spursPerVine: 10, budsPerCane: 0, canesPerVine: 0, vinesPerHa, bunchWeightGrams: 100,
  }) as any;

  it("14 Yield block query count = Block Overview count", () => {
    for (const p of [
      paddock([row(1), row(2)]),
      paddock([row(1, { vineCountOverride: 10 }), row(2)]),
      paddock([row(1)], { vine_count_override: 77 }),
      paddock([row(1, { vineCountOverride: 10 }), noGeom(2)]),
    ]) expect(toYieldBlockInfo(p).vineCount).toBe(show(p));
  });
  it("15 no physical override → saved Vines / Ha", () => {
    const b = toYieldBlockInfo(paddock([row(1), row(2)]));
    expect(b.physicalVineCount).toBeNull();
    expect(effectivePruningVinesPerHa({ savedVinesPerHa: 3000, physicalVineCount: b.physicalVineCount, areaHa: 2 })).toEqual({ vinesPerHa: 3000, source: "saved" });
  });
  it("16 block override supersedes saved Vines / Ha without deleting it", () => {
    const s = settings(3000);
    const b = { ...toYieldBlockInfo(paddock([row(1)], { vine_count_override: 4000 })), areaHa: 2 };
    expect(effectivePruningVinesPerHa({ savedVinesPerHa: s.vinesPerHa, physicalVineCount: b.physicalVineCount, areaHa: 2 }).vinesPerHa).toBe(2000);
    buildBlockPrunedYieldTiles([b], { p1: s });
    expect(s.vinesPerHa).toBe(3000);
  });
  it("17 complete row total supersedes saved Vines / Ha", () => {
    const b = toYieldBlockInfo(paddock([row(1, { vineCountOverride: 100 }), row(2)]));
    expect(b.physicalVineCount).toBe(267);
    const r = effectivePruningVinesPerHa({ savedVinesPerHa: 3000, physicalVineCount: b.physicalVineCount, areaHa: 0.5 });
    expect(r).toEqual({ vinesPerHa: 534, source: "physical_override" });
  });
  it("18 incomplete row total → saved Vines / Ha", () => {
    const b = toYieldBlockInfo(paddock([row(1, { vineCountOverride: 100 }), noGeom(2)]));
    expect(b.physicalVineCount).toBeNull();
    expect(effectivePruningVinesPerHa({ savedVinesPerHa: 3000, physicalVineCount: b.physicalVineCount, areaHa: 1 }).vinesPerHa).toBe(3000);
  });
  it("19 removing physical overrides reactivates saved Vines / Ha", () => {
    const before = toYieldBlockInfo(paddock([row(1)], { vine_count_override: 4000 }));
    const after = toYieldBlockInfo(paddock([row(1)], { vine_count_override: null }));
    expect(effectivePruningVinesPerHa({ savedVinesPerHa: 3000, physicalVineCount: before.physicalVineCount, areaHa: 2 }).source).toBe("physical_override");
    expect(effectivePruningVinesPerHa({ savedVinesPerHa: 3000, physicalVineCount: after.physicalVineCount, areaHa: 2 }).vinesPerHa).toBe(3000);
  });
  it("20 completed trip keeps its stored vine count", () => {
    const payload = {
      isCompleted: true,
      sampleSets: [{ paddockId: "p1", totalVines: 1234, sites: [{ bunchesPerVine: 10 }] }],
    };
    const s = summariseYieldSession(payload, { blocks: [{ id: "p1", vineCount: 9999 }] });
    expect(s.blocks[0].totalVines).toBe(1234);
    const live = summariseYieldSession({ sampleSets: [{ paddockId: "p1", sites: [{ bunchesPerVine: 10 }] }] }, { blocks: [{ id: "p1", vineCount: 9999 }] });
    expect(live.blocks[0].totalVines).toBe(9999);
  });
  it("21/22 new Actual Yield defaults vines to the authoritative count; tonnes untouched", async () => {
    const b = toYieldBlockInfo(paddock([row(1, { vineCountOverride: 100 }), row(2)]));
    await recordActualYield({
      vineyardId: "v", year: 2027, blockId: b.id, blockName: "Block 1", areaHectares: 1,
      vineCount: b.vineCount, varieties: [{ variety: "Shiraz", actualYieldTonnes: 12.345 }],
    } as any);
    const row0 = insertSpy.mock.calls[0][0];
    expect(row0.block_results[0].totalVines).toBe(267);
    expect(row0.block_results[0].actualYieldTonnes).toBe(12.345);
    expect(row0.total_yield_tonnes).toBe(12.345);
  });
  it("23 accepts row_effective_vine_count from backend source inputs", () => {
    const m = buildSeasonYieldEstimates({
      overview: {
        vineyard_id: "v", vintage: 2027, calculated_at: null,
        blocks: [{ paddock_id: "p1", block_name: "B", base_estimate_tonnes: 5, is_estimate_available: true,
          source_inputs: { vine_count: 465, vine_count_basis: "row_effective_vine_count" }, groups: [] }],
      } as any,
      applyDamage: false,
    });
    expect(m.blocks[0].sourceInputs?.vine_count).toBe(465);
    expect(m.blocks[0].sourceInputs?.vine_count_basis).toBe("row_effective_vine_count");
    expect(seasonVineCountBasisLabel("row_effective_vine_count")).toMatch(/Row vine counts/);
  });
});
