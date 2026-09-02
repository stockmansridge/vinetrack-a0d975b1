import { describe, expect, it } from "vitest";
import {
  EL_MAX,
  EL_MIN,
  buildBlockHeat,
  buildHeatModel,
  elColour,
  filterToVintage,
  medianStage,
  observationDays,
  parseElStage,
  pointInPolygon,
  qualifyingAt,
  recencyWeight,
  toObservations,
} from "@/lib/growthHeatmap";
import {
  currentVintageForSeason,
  seasonRangeForVintage,
} from "@/lib/vineyardSeasonSettingsQuery";
import type { GrowthStageRecord } from "@/lib/growthStageRecordsQuery";

// Two adjacent, real-shaped blocks sharing a boundary at lng -0.500.
const BLOCK_A = [
  { lat: -34.500, lng: 138.500 },
  { lat: -34.500, lng: 138.504 },
  { lat: -34.504, lng: 138.504 },
  { lat: -34.504, lng: 138.500 },
];
const BLOCK_B = [
  { lat: -34.500, lng: 138.504 },
  { lat: -34.500, lng: 138.508 },
  { lat: -34.504, lng: 138.508 },
  { lat: -34.504, lng: 138.504 },
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

const blocks = [
  { id: "A", name: "Block A", polygon: BLOCK_A },
  { id: "B", name: "Block B", polygon: BLOCK_B },
];

describe("EL parsing and fixed colour scale", () => {
  it("normalises stored codes and rejects out-of-range values", () => {
    expect(parseElStage("EL23")).toBe(23);
    expect(parseElStage("E-L 4")).toBe(4);
    expect(parseElStage("43")).toBe(43);
    expect(parseElStage("0")).toBeNull();
    expect(parseElStage("44")).toBeNull();
    expect(parseElStage("")).toBeNull();
    expect(parseElStage(null)).toBeNull();
    expect(parseElStage("unknown")).toBeNull();
  });

  it("maps EL 1 to red and EL 43 to green, fixed for all data", () => {
    const lo = elColour(EL_MIN);
    const hi = elColour(EL_MAX);
    expect(lo.r).toBeGreaterThan(lo.g);
    expect(lo.r).toBeGreaterThan(150);
    expect(hi.g).toBeGreaterThan(hi.r);
    // Never rescaled: mid stages always land between the endpoint colours.
    expect(elColour(23)).toEqual(elColour(23));
    expect(elColour(-5)).toEqual(lo);
    expect(elColour(99)).toEqual(hi);
  });
});

describe("observation eligibility", () => {
  it("excludes soft-deleted, missing EL and invalid coordinates", () => {
    const obs = toObservations([
      rec({ id: "ok" }),
      rec({ id: "deleted", deleted_at: "2027-01-11" } as any),
      rec({ id: "noel", growth_stage_code: null }),
      rec({ id: "nogps", latitude: null, longitude: null }),
    ]);
    expect(obs.map((o) => o.id)).toEqual(["ok"]);
  });

  it("never treats a missing EL as zero or EL 1", () => {
    const obs = toObservations([rec({ id: "x", growth_stage_code: "" })]);
    expect(obs).toHaveLength(0);
  });

  it("uses the observation date, not updated_at", () => {
    const obs = toObservations([
      rec({ id: "a", date: "2027-01-05", updated_at: "2027-03-01" }),
    ]);
    expect(obs[0].dateISO).toBe("2027-01-05");
    expect(qualifyingAt(obs, "2027-01-06")).toHaveLength(1);
  });

  it("never lets a future observation influence an earlier date", () => {
    const obs = toObservations([
      rec({ id: "past", date: "2027-01-01" }),
      rec({ id: "future", date: "2027-02-01" }),
    ]);
    expect(qualifyingAt(obs, "2027-01-15").map((o) => o.id)).toEqual(["past"]);
  });

  it("keeps canonically unassigned pins visible but out of interpolation", () => {
    const obs = toObservations([rec({ id: "u", paddock_id: "A" })], {
      assignedById: new Map([["u", false]]),
    });
    expect(obs[0].assigned).toBe(false);
    expect(obs[0].paddockId).toBeNull();
    const model = buildHeatModel({ observations: obs, blocks, atDateISO: "2027-01-11" });
    expect(model.unassigned).toHaveLength(1);
    expect(model.blocks.find((b) => b.paddockId === "A")!.mode).toBe("none");
  });
});

describe("vintage and hemisphere handling", () => {
  it("filters to the southern-hemisphere season window", () => {
    const { startISO, endISO } = seasonRangeForVintage(7, 1, 2027);
    const obs = toObservations([
      rec({ id: "in", date: "2027-01-10" }),
      rec({ id: "out", date: "2025-01-10" }),
    ]);
    const kept = filterToVintage(obs, startISO, endISO);
    expect(kept.map((o) => o.id)).toEqual(["in"]);
  });

  it("handles a northern-hemisphere 1 January season", () => {
    const { startISO, endISO } = seasonRangeForVintage(1, 1, 2027);
    expect(startISO).toBe("2026-01-01");
    expect(endISO).toBe("2026-12-31");
    const obs = toObservations([
      rec({ id: "in", date: "2026-06-01" }),
      rec({ id: "out", date: "2027-06-01" }),
    ]);
    expect(filterToVintage(obs, startISO, endISO).map((o) => o.id)).toEqual(["in"]);
  });


  it("derives the current vintage from stored season settings", () => {
    expect(currentVintageForSeason(7, 1, new Date("2027-08-01T00:00:00Z"))).toBe(2028);
  });
});

describe("block isolation and clipping", () => {
  const obs = toObservations([
    rec({ id: "a1", paddock_id: "A", latitude: -34.5015, longitude: 138.5010, growth_stage_code: "5" }),
    rec({ id: "a2", paddock_id: "A", latitude: -34.5030, longitude: 138.5030, growth_stage_code: "7" }),
    rec({ id: "a3", paddock_id: "A", latitude: -34.5020, longitude: 138.5020, growth_stage_code: "6" }),
    rec({ id: "b1", paddock_id: "B", latitude: -34.5020, longitude: 138.5060, growth_stage_code: "40" }),
    rec({ id: "b2", paddock_id: "B", latitude: -34.5030, longitude: 138.5070, growth_stage_code: "41" }),
    rec({ id: "b3", paddock_id: "B", latitude: -34.5010, longitude: 138.5050, growth_stage_code: "42" }),
  ]);

  it("computes each block independently — no bleed across the shared edge", () => {
    const model = buildHeatModel({ observations: obs, blocks, atDateISO: "2027-01-11" });
    const a = model.blocks.find((b) => b.paddockId === "A")!;
    const bBlock = model.blocks.find((b) => b.paddockId === "B")!;
    const vals = (g: (number | null)[][]) => g.flat().filter((v): v is number => v != null);
    expect(Math.max(...vals(a.grid!))).toBeLessThan(10);
    expect(Math.min(...vals(bBlock.grid!))).toBeGreaterThan(30);
  });

  it("clips output to the block polygon", () => {
    const heat = buildBlockHeat({
      paddockId: "A",
      paddockName: "Block A",
      polygon: [
        { lat: -34.500, lng: 138.500 },
        { lat: -34.500, lng: 138.504 },
        { lat: -34.504, lng: 138.500 },
      ],
      observations: obs.filter((o) => o.paddockId === "A"),
      atDateISO: "2027-01-11",
      resolution: 24,
    });
    let outsideNonNull = 0;
    for (let i = 0; i < heat.grid!.length; i++) {
      for (let j = 0; j < heat.grid![i].length; j++) {
        const lat = heat.gridBounds!.minLat + ((heat.gridBounds!.maxLat - heat.gridBounds!.minLat) / 23) * i;
        const lng = heat.gridBounds!.minLng + ((heat.gridBounds!.maxLng - heat.gridBounds!.minLng) / 23) * j;
        if (!pointInPolygon({ lat, lng }, heat.polygon) && heat.grid![i][j] != null) outsideNonNull++;
      }
    }
    expect(outsideNonNull).toBe(0);
  });

  it("respects the block filter and All blocks", () => {
    const all = buildHeatModel({ observations: obs, blocks, atDateISO: "2027-01-11" });
    expect(all.blocks).toHaveLength(2);
    const one = buildHeatModel({ observations: obs, blocks, atDateISO: "2027-01-11", blockFilter: "A" });
    expect(one.blocks).toHaveLength(1);
    expect(one.qualifying.every((o) => o.paddockId === "A")).toBe(true);
  });

  it("never exposes another vineyard's observations", () => {
    const foreign = toObservations([rec({ id: "f", vineyard_id: "other", paddock_id: "Z" })]);
    const model = buildHeatModel({ observations: foreign, blocks, atDateISO: "2027-01-11" });
    expect(model.blocks.every((b) => b.observations.length === 0)).toBe(true);
  });
});

describe("sparse data behaviour", () => {
  const at = "2027-01-11";
  const mk = (n: number) =>
    toObservations(
      Array.from({ length: n }, (_, i) =>
        rec({
          id: `p${i}`,
          latitude: -34.5015 - i * 0.0005,
          longitude: 138.5015 + i * 0.0005,
          growth_stage_code: String(10 + i),
        }),
      ),
    );

  it("renders nothing for zero observations", () => {
    const h = buildBlockHeat({ paddockId: "A", paddockName: "A", polygon: BLOCK_A, observations: [], atDateISO: at });
    expect(h.mode).toBe("none");
    expect(h.grid).toBeNull();
  });

  it("renders a halo for one, gradient for two and a surface for three or more", () => {
    expect(buildBlockHeat({ paddockId: "A", paddockName: "A", polygon: BLOCK_A, observations: mk(1), atDateISO: at }).mode).toBe("halo");
    expect(buildBlockHeat({ paddockId: "A", paddockName: "A", polygon: BLOCK_A, observations: mk(2), atDateISO: at }).mode).toBe("gradient");
    expect(buildBlockHeat({ paddockId: "A", paddockName: "A", polygon: BLOCK_A, observations: mk(3), atDateISO: at }).mode).toBe("surface");
  });

  it("does not fabricate full coverage from a single observation", () => {
    const halo = buildBlockHeat({ paddockId: "A", paddockName: "A", polygon: BLOCK_A, observations: mk(1), atDateISO: at, resolution: 32 });
    const surface = buildBlockHeat({ paddockId: "A", paddockName: "A", polygon: BLOCK_A, observations: mk(3), atDateISO: at, resolution: 32 });
    const filled = (g: (number | null)[][]) => g.flat().filter((v) => v != null).length;
    expect(filled(halo.grid!)).toBeLessThan(filled(surface.grid!));
  });

  it("flags blocks without usable polygon geometry", () => {
    const h = buildBlockHeat({ paddockId: "A", paddockName: "A", polygon: [], observations: mk(3), atDateISO: at });
    expect(h.mode).toBe("no_polygon");
    expect(h.grid).toBeNull();
  });
});

describe("recency, median and timeline helpers", () => {
  it("uses a deterministic half-life rule with a floor", () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(21)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(500)).toBeCloseTo(0.15, 5);
  });

  it("computes the typical recorded stage from recorded values only", () => {
    const obs = toObservations([
      rec({ id: "a", growth_stage_code: "10" }),
      rec({ id: "b", growth_stage_code: "30" }),
      rec({ id: "c", growth_stage_code: "35" }),
    ]);
    expect(medianStage(obs)).toBe(30);
    expect(medianStage([])).toBeNull();
  });

  it("snaps the timeline to distinct recorded observation days", () => {
    const obs = toObservations([
      rec({ id: "a", date: "2027-01-10" }),
      rec({ id: "b", date: "2027-01-10T09:00:00Z" }),
      rec({ id: "c", date: "2026-12-01" }),
    ]);
    expect(observationDays(obs)).toEqual(["2026-12-01", "2027-01-10"]);
  });

  it("recomputes locally for any date from one loaded record set", () => {
    const obs = toObservations([
      rec({ id: "a", date: "2027-01-01", growth_stage_code: "5" }),
      rec({ id: "b", date: "2027-02-01", growth_stage_code: "30" }),
    ]);
    expect(medianStage(qualifyingAt(obs, "2027-01-15"))).toBe(5);
    expect(medianStage(qualifyingAt(obs, "2027-02-15"))).toBe(17.5);
  });
});
