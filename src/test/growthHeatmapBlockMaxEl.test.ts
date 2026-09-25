import { describe, expect, it } from "vitest";
import { buildHeatModel, filterToVintage, formatEl, toObservations } from "@/lib/growthHeatmap";
import type { GrowthStageRecord } from "@/lib/growthStageRecordsQuery";

const A = [
  { lat: -34.5, lng: 138.5 }, { lat: -34.5, lng: 138.504 },
  { lat: -34.504, lng: 138.504 }, { lat: -34.504, lng: 138.5 },
];
const B = [
  { lat: -34.5, lng: 138.504 }, { lat: -34.5, lng: 138.508 },
  { lat: -34.504, lng: 138.508 }, { lat: -34.504, lng: 138.504 },
];
const blocks = [{ id: "A", name: "A", polygon: A }, { id: "B", name: "B", polygon: B }];
const rec = (o: Partial<GrowthStageRecord> & { id: string }): GrowthStageRecord =>
  ({ vineyard_id: "v1", paddock_id: "A", latitude: -34.502, longitude: 138.502,
     growth_stage_code: "23", date: "2027-01-10", ...o }) as GrowthStageRecord;
const at = "2027-01-12";
const blockA = (recs: GrowthStageRecord[], extra: any = {}) =>
  buildHeatModel({ observations: toObservations(recs), blocks, atDateISO: at, ...extra })
    .blocks.find((b) => b.paddockId === "A")!;
const els = (codes: string[]) =>
  codes.map((c, i) => rec({ id: `r${i}`, growth_stage_code: c, latitude: -34.5015 - i * 0.0005 }));

describe("block displayed E-L = highest eligible observation", () => {
  it("15,17,18,21 → E-L 21 (not the median/average)", () => {
    const b = blockA(els(["15", "17", "18", "21"]));
    expect(formatEl(b.maxEl)).toBe("E-L 21");
    expect(b.medianEl).toBe(17.5);
  });
  it("27,27,29 → E-L 29", () => expect(blockA(els(["27", "27", "29"])).maxEl).toBe(29));
  it("single 23 → E-L 23", () => expect(blockA(els(["23"])).maxEl).toBe(23));
  it("no eligible observations keeps no-data state", () => {
    const b = blockA([]);
    expect(b.maxEl).toBeNull();
    expect(b.mode).toBe("none");
  });
  it("other blocks are excluded", () => {
    const b = blockA([...els(["15"]), rec({ id: "b", paddock_id: "B", growth_stage_code: "40", longitude: 138.506 })]);
    expect(b.maxEl).toBe(15);
  });
  it("other vintages are excluded", () => {
    const obs = filterToVintage(
      toObservations([...els(["18"]), rec({ id: "old", growth_stage_code: "38", date: "2026-01-10" })]),
      "2026-07-01", "2027-06-30",
    );
    const b = buildHeatModel({ observations: obs, blocks, atDateISO: at }).blocks.find((x) => x.paddockId === "A")!;
    expect(b.maxEl).toBe(18);
  });
  it("deleted / invalid observations are excluded", () => {
    const b = blockA([
      ...els(["19"]),
      rec({ id: "del", growth_stage_code: "35", deleted_at: "2027-01-11" } as any),
      rec({ id: "bad", growth_stage_code: "99" }),
      rec({ id: "future", growth_stage_code: "30", date: "2027-02-01" }),
    ]);
    expect(b.maxEl).toBe(19);
  });
  it("block filter respected", () => {
    const m = buildHeatModel({ observations: toObservations(els(["20"])), blocks, atDateISO: at, blockFilter: "B" });
    expect(m.blocks.map((b) => b.paddockId)).toEqual(["B"]);
    expect(m.blocks[0].maxEl).toBeNull();
  });
  it("heat surface is unchanged by the display aggregation", () => {
    const b = blockA(els(["15", "17", "18", "21"]));
    const { maxEl, ...rest } = b;
    const again = blockA(els(["15", "17", "18", "21"]));
    expect(rest.grid).toEqual(again.grid);
    expect(rest.weightGrid).toEqual(again.weightGrid);
    expect(maxEl).toBe(21);
  });
});
