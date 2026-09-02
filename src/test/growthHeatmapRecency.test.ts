import { describe, expect, it } from "vitest";
import {
  RECENCY_MAX_AGE_DAYS,
  buildBlockHeat,
  buildHeatModel,
  isInfluencing,
  partitionByInfluence,
  recencyWeight,
  toObservations,
} from "@/lib/growthHeatmap";
import {
  GROWTH_PINS_OR_FILTER,
  applyGrowthPinsFilters,
} from "@/lib/growthStageRecordsQuery";
import type { GrowthStageRecord } from "@/lib/growthStageRecordsQuery";

const POLY = [
  { lat: -34.500, lng: 138.500 },
  { lat: -34.500, lng: 138.504 },
  { lat: -34.504, lng: 138.504 },
  { lat: -34.504, lng: 138.500 },
];

const rec = (o: Partial<GrowthStageRecord> & { id: string }): GrowthStageRecord =>
  ({
    vineyard_id: "v1",
    paddock_id: "A",
    latitude: -34.502,
    longitude: 138.502,
    growth_stage_code: "23",
    date: "2027-01-10",
    ...o,
  }) as GrowthStageRecord;

describe("recency ages to zero influence", () => {
  it("gives full influence on the observation date", () => {
    expect(recencyWeight(0)).toBe(1);
  });

  it("fades with the documented half-life", () => {
    expect(recencyWeight(21)).toBeLessThan(1);
    expect(recencyWeight(21)).toBeGreaterThan(recencyWeight(42));
  });

  it("reaches exactly zero at and beyond the maximum age", () => {
    expect(recencyWeight(RECENCY_MAX_AGE_DAYS)).toBe(0);
    expect(recencyWeight(RECENCY_MAX_AGE_DAYS + 30)).toBe(0);
    expect(recencyWeight(RECENCY_MAX_AGE_DAYS - 1)).toBeGreaterThan(0);
  });
});

describe("stale observations", () => {
  const obs = toObservations([
    rec({ id: "old", date: "2027-01-01" }),
    rec({ id: "new", date: "2027-05-01", latitude: -34.5025, longitude: 138.5025 }),
  ]);

  it("keeps stale pins visible but out of the heat surface", () => {
    const model = buildHeatModel({ observations: obs, blocks: [{ id: "A", name: "A", polygon: POLY }], atDateISO: "2027-05-02" });
    expect(model.qualifying.map((o) => o.id).sort()).toEqual(["new", "old"]);
    expect(model.influencing.map((o) => o.id)).toEqual(["new"]);
    expect(model.stale.map((o) => o.id)).toEqual(["old"]);
    const block = model.blocks[0];
    expect(block.observations).toHaveLength(2);
    expect(block.influencing).toHaveLength(1);
  });

  it("shows a stale block mode when nothing is current", () => {
    const heat = buildBlockHeat({
      paddockId: "A",
      paddockName: "A",
      polygon: POLY,
      observations: toObservations([rec({ id: "old", date: "2027-01-01" })]),
      atDateISO: "2027-06-01",
    });
    expect(heat.mode).toBe("stale");
    expect(heat.grid).toBeNull();
    expect(heat.observations).toHaveLength(1);
  });

  it("still influences playback near its own observation date", () => {
    const o = toObservations([rec({ id: "old", date: "2027-01-01" })]);
    expect(isInfluencing(o[0], "2027-01-05")).toBe(true);
    expect(partitionByInfluence(o, "2027-01-05").influencing).toHaveLength(1);
  });
});

describe("fallback pins query safety", () => {
  it("scopes vineyard and soft-delete around the grouped growth predicate", () => {
    const calls: [string, unknown[]][] = [];
    const q: any = {
      eq: (...a: unknown[]) => { calls.push(["eq", a]); return q; },
      is: (...a: unknown[]) => { calls.push(["is", a]); return q; },
      or: (...a: unknown[]) => { calls.push(["or", a]); return q; },
    };
    applyGrowthPinsFilters(q, "v1");
    expect(calls).toEqual([
      ["eq", ["vineyard_id", "v1"]],
      ["is", ["deleted_at", null]],
      ["or", [GROWTH_PINS_OR_FILTER]],
    ]);
    // Both growth branches live inside one OR group, so neither can escape the
    // vineyard or soft-delete scope.
    expect(GROWTH_PINS_OR_FILTER).toBe("mode.eq.Growth,growth_stage_code.not.is.null");
    expect(GROWTH_PINS_OR_FILTER).not.toContain("vineyard_id");
    expect(GROWTH_PINS_OR_FILTER).not.toContain("deleted_at");
  });
});
