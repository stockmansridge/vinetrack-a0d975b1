// sql/187 portal contract: Picking Log financial privacy, the
// latest-completed Bunch Count Trip estimate rule, damage adjustment and
// export gating.
import { describe, it, expect } from "vitest";
import {
  canSeePickingFinancials,
  isFinancialAccessDenied,
  mergePickingFinancials,
  pickingMoneyState,
  type PickingRecordFinancial,
} from "@/lib/pickingFinancials";
import {
  buildBunchCountTrips,
  currentEstimatesByBlock,
  currentTripIds,
  yieldVariance,
} from "@/lib/bunchCountTrips";
import { yieldAnalyticsColumns, yieldAnalyticsRows } from "@/lib/yieldAnalyticsExport";

const B1 = "11111111-1111-1111-1111-111111111111";

const rec = (over: any = {}) => ({ id: "p1", sold: true, ...over }) as any;

describe("Picking financial privacy (sql/187)", () => {
  it("allows only owner and manager", () => {
    expect(canSeePickingFinancials("owner")).toBe(true);
    expect(canSeePickingFinancials("manager")).toBe(true);
    expect(canSeePickingFinancials("supervisor")).toBe(false);
    expect(canSeePickingFinancials("operator")).toBe(false);
    expect(canSeePickingFinancials(null)).toBe(false);
  });

  it("treats 42501 as no access rather than an error", () => {
    expect(isFinancialAccessDenied({ code: "42501" })).toBe(true);
    expect(isFinancialAccessDenied({ message: "permission denied for table" })).toBe(true);
    expect(isFinancialAccessDenied({ code: "PGRST116" })).toBe(false);
  });

  it("leaves rows untouched for an unauthorised reader", () => {
    const out = mergePickingFinancials([rec()], { authorised: false, byId: new Map() });
    expect((out[0] as any).financial).toBeUndefined();
  });

  it("attaches money for an authorised reader", () => {
    const f: PickingRecordFinancial = {
      picking_record_id: "p1",
      sold_to: "Big Winery",
      price_per_tonne: 2000,
      grape_value: 2400,
    };
    const out = mergePickingFinancials([rec()], { authorised: true, byId: new Map([["p1", f]]) });
    expect(out[0].financial?.price_per_tonne).toBe(2000);
  });

  it("distinguishes no-permission, no-sale, no-data and recorded", () => {
    expect(pickingMoneyState(rec(), { authorised: false })).toBe("no-permission");
    expect(pickingMoneyState(rec({ sold: false }), { authorised: true })).toBe("no-sale");
    expect(pickingMoneyState(rec(), { authorised: true, financial: null })).toBe("no-data");
    expect(
      pickingMoneyState(rec(), {
        authorised: true,
        financial: { picking_record_id: "p1", sold_to: "X", price_per_tonne: 1, grape_value: 1 },
      }),
    ).toBe("recorded");
  });
});

// --- Bunch Count Trips ------------------------------------------------------

const blocks = [{ id: B1, name: "Block 7", areaHa: 2, vineCount: 1000 }] as any;

const payload = (bunches: number) => ({
  blocks: [
    {
      blockId: B1,
      blockName: "Block 7",
      areaHa: 2,
      totalVines: 1000,
      bunchWeightKg: 0.15,
      sites: [{ id: "s1", bunches, recorded: true }],
    },
  ],
});

const session = (id: string, date: string, completed: boolean, bunches: number, extra: any = {}) => ({
  id,
  is_completed: completed,
  completed_at: completed ? date : null,
  session_created_at: date,
  payload: { ...payload(bunches), ...extra },
});

const trips = (list: any[]) =>
  buildBunchCountTrips(list, { blocks, vintageOf: () => 2026 });

describe("Bunch Count Trip estimate selection", () => {
  it("the latest completed trip wins and trips are never summed", () => {
    const t = trips([
      session("old", "2026-01-01T00:00:00Z", true, 40),
      session("new", "2026-02-01T00:00:00Z", true, 20),
    ]);
    const est = currentEstimatesByBlock(t, 2026);
    const e = est.get(B1)!;
    expect(e.tripId).toBe("new");
    expect(e.recordedSites).toBe(1);
    // 20 bunches/vine × 1000 vines × 0.15 kg = 3 t (not 6 t, not an average).
    expect(e.baseTonnes).toBeCloseTo(3, 5);
  });

  it("ignores drafts entirely", () => {
    const t = trips([
      session("draft", "2026-03-01T00:00:00Z", false, 99),
      session("done", "2026-02-01T00:00:00Z", true, 20),
    ]);
    expect(currentEstimatesByBlock(t, 2026).get(B1)!.tripId).toBe("done");
  });

  it("only counts trips that recorded a sample in the block", () => {
    const empty = {
      id: "empty",
      is_completed: true,
      completed_at: "2026-04-01T00:00:00Z",
      session_created_at: "2026-04-01T00:00:00Z",
      payload: {
        blocks: [
          { blockId: B1, blockName: "Block 7", areaHa: 2, totalVines: 1000, bunchWeightKg: 0.15, sites: [] },
        ],
      },
    };
    const t = trips([empty, session("done", "2026-02-01T00:00:00Z", true, 20)]);
    expect(currentEstimatesByBlock(t, 2026).get(B1)!.tripId).toBe("done");
  });

  it("exposes the trips that currently provide an estimate", () => {
    const t = trips([
      session("new", "2026-02-01T00:00:00Z", true, 20),
      session("old", "2026-01-01T00:00:00Z", true, 40),
    ]);
    const ids = currentTripIds(currentEstimatesByBlock(t, 2026));
    expect(ids.has("new")).toBe(true);
    expect(ids.has("old")).toBe(false);
  });

  it("keeps the base observation recoverable when damage is applied", () => {
    const t = buildBunchCountTrips(
      [session("d", "2026-02-01T00:00:00Z", true, 20, { applyDamage: true })],
      { blocks, vintageOf: () => 2026, damageFactor: () => 0.5 },
    );
    const e = currentEstimatesByBlock(t, 2026).get(B1)!;
    expect(e.baseTonnes).toBeCloseTo(3, 5);
    expect(e.adjustedTonnes).toBeCloseTo(1.5, 5);
    expect(e.tonnes).toBeCloseTo(1.5, 5);
    expect(e.damageApplied).toBe(true);
  });

  it("shows the undamaged estimate when the trip opts out of damage", () => {
    const t = buildBunchCountTrips(
      [session("d", "2026-02-01T00:00:00Z", true, 20, { applyDamage: false })],
      { blocks, vintageOf: () => 2026, damageFactor: () => 0.5 },
    );
    const e = currentEstimatesByBlock(t, 2026).get(B1)!;
    expect(e.tonnes).toBeCloseTo(3, 5);
    expect(e.damageApplied).toBe(false);
  });

  it("records route reuse provenance", () => {
    const t = buildBunchCountTrips(
      [session("d", "2026-02-01T00:00:00Z", true, 20, { routeSourceSessionId: "old" })],
      { blocks, vintageOf: () => 2026 },
    );
    expect(t[0].routeReused).toBe(true);
    expect(t[0].routeSourceSessionId).toBe("old");
  });

  it("computes estimate-versus-actual variance", () => {
    expect(yieldVariance(10, 12)).toEqual({ difference: 2, percent: 20 });
    expect(yieldVariance(10, null)).toBeNull();
  });
});

describe("Yield Analytics export gating", () => {
  const fact: any = {
    vintage: 2026,
    blockName: "Block 7",
    variety: "Shiraz",
    areaHa: 2,
    tonnes: 10,
    revenue: 20000,
    pricedTonnes: 10,
    cost: 5000,
    source: "detailed",
  };

  it("omits every money column for an unauthorised export", () => {
    const cols = yieldAnalyticsColumns({ includeFinancials: false });
    for (const c of ["Sale $/tonne", "Grape revenue", "Revenue/sold ha", "Grape-sale margin", "Margin/sold ha"]) {
      expect(cols).not.toContain(c);
    }
    const [row] = yieldAnalyticsRows([fact], { includeFinancials: false });
    expect(row.length).toBe(cols.length);
    expect(row.join(",")).not.toContain("20000");
  });

  it("includes them for an authorised export", () => {
    expect(yieldAnalyticsColumns()).toContain("Grape revenue");
    const [row] = yieldAnalyticsRows([fact]);
    expect(row.length).toBe(yieldAnalyticsColumns().length);
  });
});
