import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import {
  resolveBunchWeight,
  resolveBlockBunchWeight,
  canEditBunchWeights,
  type YieldBunchWeightRow,
} from "@/lib/yieldBunchWeights";
import { summariseYieldSession } from "@/lib/yieldSessionSummary";
import { buildBunchCountTrips, currentEstimatesByBlock } from "@/lib/bunchCountTrips";
import { resolveBlockEstimateSource } from "@/lib/yieldEstimateSource";
import { YIELD_TABS, initialYieldTab } from "@/lib/yieldTab";
import { allocationBlockLabel } from "@/components/yield/GrapeAllocationPanel";

vi.mock("@/lib/mapkit", () => ({ initMapKit: () => new Promise(() => {}) }));

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";
const row = (o: Partial<YieldBunchWeightRow>): YieldBunchWeightRow => ({
  id: "r",
  vineyard_id: "v1",
  paddock_id: null,
  variety_key: "shiraz",
  variety_name: "Shiraz",
  bunch_weight_grams: 120,
  updated_at: null,
  ...o,
});

describe("master bunch weight resolution", () => {
  it("variety master applies to blocks without an override", () => {
    const r = resolveBunchWeight([row({ id: "m" })], B1, "Shiraz");
    expect(r).toEqual({ grams: 120, source: "variety_default", recordId: "m" });
  });
  it("block override takes precedence over the variety master", () => {
    const rows = [row({ id: "m" }), row({ id: "o", paddock_id: B1, bunch_weight_grams: 95 })];
    expect(resolveBunchWeight(rows, B1, "Shiraz")).toEqual({ grams: 95, source: "block_override", recordId: "o" });
    expect(resolveBunchWeight(rows, B2, "Shiraz").source).toBe("variety_default");
  });
  it("missing master is explicitly not configured — never 150 g", () => {
    const r = resolveBunchWeight([], B1, "Shiraz");
    expect(r.grams).toBeNull();
    expect(r.source).toBe("not_configured");
    expect(resolveBlockBunchWeight([], B1, [{ name: "Shiraz" }]).grams).toBeNull();
  });
  it("mixed block needs every variety configured", () => {
    const rows = [row({}), row({ variety_key: "merlot", variety_name: "Merlot", bunch_weight_grams: 80 })];
    const v = [{ name: "Shiraz", percent: 50 }, { name: "Merlot", percent: 50 }];
    expect(resolveBlockBunchWeight(rows, B1, v).grams).toBe(100);
    expect(resolveBlockBunchWeight([row({})], B1, v).grams).toBeNull();
  });
  it("owner/manager/supervisor can edit", () => {
    expect(canEditBunchWeights("supervisor")).toBe(true);
    expect(canEditBunchWeights("operator")).toBe(false);
  });
});

const payload = {
  blockBunchWeightsKg: { [B1]: 0.2 },
  sampleSites: [
    { paddockId: B1, latitude: -34.1, longitude: 138.2, siteIndex: 1, bunchCountEntry: { bunchesPerVine: 20 } },
  ],
};
const blocks = [{ id: B1, name: "Block A", areaHa: 1, vineCount: 1000 }];

describe("current trip tonnes use the master weight", () => {
  it("master weight overrides the payload; payload kept as historical evidence", () => {
    const s = summariseYieldSession(payload, {
      blocks,
      bunchWeightFor: () => ({ grams: 100, source: "variety_default" }),
    });
    expect(s.blocks[0].bunchWeightKg).toBe(0.1);
    expect(s.blocks[0].recordedBunchWeightKg).toBe(0.2);
    expect(s.blocks[0].estimatedYieldTonnes).toBeCloseTo(2, 6);
  });
  it("no master → no tonnes", () => {
    const s = summariseYieldSession(payload, {
      blocks,
      bunchWeightFor: () => ({ grams: null, source: "not_configured" }),
    });
    expect(s.blocks[0].estimatedYieldTonnes).toBeNull();
  });
});

describe("Overview estimate source", () => {
  const session = (id: string, completed: boolean, date: string) => ({
    id,
    is_completed: completed,
    completed_at: completed ? date : null,
    session_created_at: date,
    payload,
  });
  const build = (list: any[], grams: number | null) =>
    currentEstimatesByBlock(
      buildBunchCountTrips(list, {
        blocks,
        vintageOf: () => 2027,
        bunchWeightFor: () => ({ grams, source: grams == null ? "not_configured" : "block_override" }),
      }),
      2027,
    );

  it("latest completed trip wins over pruning", () => {
    const est = build([session("a", true, "2026-12-01")], 100);
    const src = resolveBlockEstimateSource(est.get(B1), 9);
    expect(src.kind).toBe("yield_estimate_trip");
    expect(src.tonnes).toBeCloseTo(2, 6);
  });
  it("draft trips never affect the Overview", () => {
    const est = build([session("d", false, "2026-12-01")], 100);
    expect(est.size).toBe(0);
    const src = resolveBlockEstimateSource(est.get(B1), 9);
    expect(src).toMatchObject({ kind: "pruning_estimate", tonnes: 9 });
  });
  it("completed trip + missing weight shows trip source + weight required, not pruning", () => {
    const est = build([session("a", true, "2026-12-01")], null);
    const src = resolveBlockEstimateSource(est.get(B1), 9);
    expect(src).toMatchObject({ kind: "yield_estimate_trip", tonnes: null, unavailableReason: "bunch_weight_required" });
  });
});

describe("Bunch Weights tab", () => {
  const page = readFileSync("src/pages/setup/YieldReportsPage.tsx", "utf8");
  it("sits immediately after Yield Estimate Trips and deep links", () => {
    expect(YIELD_TABS.indexOf("bunch-weights")).toBe(YIELD_TABS.indexOf("sessions") + 1);
    expect(initialYieldTab("bunch-weights")).toBe("bunch-weights");
    const trips = page.indexOf("Yield Estimate Trips (");
    const bw = page.indexOf('value="bunch-weights">Bunch Weights');
    const actual = page.indexOf('value="historical"');
    expect(trips).toBeGreaterThan(0);
    expect(bw).toBeGreaterThan(trips);
    expect(bw).toBeLessThan(actual);
  });
  it("trip drawer is ~40vw on desktop", () => {
    expect(page).toContain("lg:w-[40vw]");
  });
});

describe("Overview card labels and trip map", () => {
  it("shows bunch weight + source labels", async () => {
    const { EstimateSourceLine } = await import("@/pages/setup/YieldReportsPage");
    render(
      <EstimateSourceLine
        source={{ kind: "yield_estimate_trip", tonnes: 2, unavailableReason: null, tripId: "a" }}
        weight={{ grams: 112, source: "block_override" }}
      />,
    );
    expect(screen.getByText("Yield Estimate Trip")).toBeTruthy();
    expect(screen.getByText("112 g")).toBeTruthy();
    expect(screen.getByText(/Block override/)).toBeTruthy();
  });
  it("shows Bunch weight not set and Pruning Estimate", async () => {
    const { EstimateSourceLine } = await import("@/pages/setup/YieldReportsPage");
    render(
      <EstimateSourceLine
        source={{ kind: "pruning_estimate", tonnes: 3, unavailableReason: null, tripId: null }}
        weight={{ grams: null, source: "not_configured" }}
      />,
    );
    expect(screen.getByText("Pruning Estimate")).toBeTruthy();
    expect(screen.getByText("Bunch weight not set")).toBeTruthy();
  });
  it("builds map markers from recorded sample coordinates and block outline", async () => {
    const { sessionSampleMapData } = await import("@/pages/setup/YieldReportsPage");
    const s = summariseYieldSession(payload, { blocks });
    const m = sessionSampleMapData(s, [
      { ...blocks[0], boundary: [[-34.1, 138.2], [-34.2, 138.2], [-34.2, 138.3]] },
    ]);
    expect(m.markers).toHaveLength(1);
    expect(m.markers[0]).toMatchObject({ lat: -34.1, lng: 138.2 });
    expect(m.boundaries).toHaveLength(1);
  });
});

describe("Grape Allocation Block column", () => {
  const names = new Map([[B1, "Block A"], [B2, "Block B"]]);
  it("lists multiple block names comma-separated", () => {
    expect(allocationBlockLabel([{ paddock_id: B1 }, { paddock_id: B2 }], names)).toBe("Block A, Block B");
  });
  it("vineyard-wide allocations show All blocks", () => {
    expect(allocationBlockLabel([], names)).toBe("All blocks");
  });
  it("table header includes Block after Variety", () => {
    const src = readFileSync("src/components/yield/GrapeAllocationPanel.tsx", "utf8");
    expect(src).toMatch(/<TableHead>Variety<\/TableHead>\s*<TableHead>Block<\/TableHead>/);
  });
});
