import { describe, expect, it } from "vitest";
import fixture from "@/test/fixtures/elRipenessHeatmapFixture.json";
import {
  buildExpected,
  exclusionReason,
  round,
} from "../../scripts/elHeatmapHandoff";
import {
  buildHeatModel,
  heatPoints,
  maxInfluenceDeg,
  polygonBounds,
  polygonDiagonalDeg,
  sampleHeatAt,
} from "@/lib/growthHeatmap";
import { filterToVintage, toObservations } from "@/lib/growthHeatmap";
import { seasonRangeForVintage } from "@/lib/vineyardSeasonSettingsQuery";

const expected = buildExpected(fixture as any);
const byDate = (d: string) => expected.per_date.find((p: any) => p.date === d)!;
const sample = (d: string, id: string) =>
  byDate(d).sample_points.find((s: any) => s.id === id)!;

describe("handoff generator uses full precision for calculations", () => {
  it("publishes the full-precision influence radius alongside the rounded display value", () => {
    const blockC = byDate("2026-01-21").blocks.find((b: any) => b.paddock_id === "BLOCK_C")!;
    expect(blockC.max_influence_deg).toBe(round(blockC.max_influence_deg_full_precision!));
    // The display value really is lossy — proving it must never drive maths.
    expect(blockC.max_influence_deg).not.toBe(blockC.max_influence_deg_full_precision);
  });

  it("regenerates the previously-rounded sample weights from full precision", () => {
    const vy: any = (fixture as any).vineyard;
    const assignedById = new Map<string, boolean>(
      (fixture as any).observations.map((o: any) => [o.id, !!o.placement?.is_location_assigned]),
    );
    const obs = toObservations(
      (fixture as any).observations.filter((o: any) => o.vineyard_id === vy.id),
      { assignedById },
    );
    const season = seasonRangeForVintage(vy.season_start_month, vy.season_start_day, 2026);
    const seasonObs = filterToVintage(obs, season.startISO, season.endISO);
    const blocks = (fixture as any).blocks.map((b: any) => ({
      id: b.id,
      name: b.name,
      polygon: b.polygon_points ?? [],
    }));

    const cases = [
      { date: "2026-01-21", id: "sp-C-near", block: "BLOCK_C" },
      { date: "2026-01-25", id: "sp-B-centre", block: "BLOCK_B" },
      { date: "2026-01-25", id: "sp-B-near-shared-edge", block: "BLOCK_B" },
    ];

    for (const c of cases) {
      const model = buildHeatModel({ observations: seasonObs, blocks, atDateISO: c.date });
      const block = model.blocks.find((b) => b.paddockId === c.block)!;
      const sp = (fixture as any).sample_points.find((s: any) => s.id === c.id)!;
      const diagFull = polygonDiagonalDeg(polygonBounds(block.polygon));
      const full = sampleHeatAt(
        sp.lat,
        sp.lng,
        heatPoints(block.influencing, c.date),
        maxInfluenceDeg(diagFull, block.mode),
      );
      const rounded = sampleHeatAt(
        sp.lat,
        sp.lng,
        heatPoints(block.influencing, c.date),
        round(maxInfluenceDeg(diagFull, block.mode)),
      );
      const published = sample(c.date, c.id);
      expect(published.cell_weight_full_precision).toBe(full.weight);
      expect(published.cell_weight).toBe(round(full.weight!));
      // The old defect: generating from the rounded radius gives a different
      // weight, so a rounded value must never be fed back in.
      expect(rounded.weight).not.toBe(full.weight);
    }
  });

  it("keeps display rounding out of the calculation path", () => {
    const sp = sample("2026-01-25", "sp-A-mid");
    expect(sp.idw_el).toBe(round(sp.idw_el_full_precision!));
    expect(sp.alpha_float).toBe(round(sp.alpha_0_255 / 255));
  });
});

describe("exclusion classification", () => {
  it("labels other-vineyard fixture records wrong_vineyard, not a date error", () => {
    const north = expected.observation_normalisation.filter((o: any) =>
      o.id.includes("north"),
    );
    expect(north.map((o: any) => o.excluded_reason)).toEqual([
      "wrong_vineyard",
      "wrong_vineyard",
    ]);
    expect(exclusionReason({ vineyard_id: "vy-fixture-north" }, "vy-fixture-south")).toBe(
      "wrong_vineyard",
    );
  });

  it("assigns northern Vintages with the 1 January calendar-year rule", () => {
    const n1 = expected.observation_normalisation.find((o: any) => o.id === "obs-n1-north")!;
    const n2 = expected.observation_normalisation.find((o: any) => o.id === "obs-n2-north")!;
    expect(n1.vintage).toBe(2026); // 2026-01-01
    expect(n2.vintage).toBe(2025); // 2025-12-31
  });
});
