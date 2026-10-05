import { describe, it, expect } from "vitest";
import {
  matchCompleteTankActuals,
  resolveTripChemicalCost,
  selectChemicalUsage,
  tankActualsComplete,
  overlayAllocationsWithChemicalCost,
  type ActualTank,
  type PlannedTank,
  type TankActualIdentity,
} from "@/lib/chemicalCostResolver";
import type { ChemicalSeasonPriceRow, SeasonPriceMap } from "@/lib/chemicalSeasonPricing";
import { resolveTripVintage, vineyardLocalVintage, vintageByTripFromAllocations } from "@/lib/chemicalCostVintage";
import { chemicalSetupState, CHEMICAL_SETUP_COPY } from "@/components/cost/CostingSetupWizard";
import { buildWorkTaskCostRollup } from "@/lib/workTaskCostRollup";
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";
import { readFileSync } from "node:fs";

const ID: TankActualIdentity = {
  vineyardId: "v", sprayRecordId: "r", tripId: "t",
  sessionsByTank: new Map([[1, new Set(["s1"])], [2, new Set(["s2"])]]),
};
const planned: PlannedTank[] = [{ tankNumber: 1, lines: [
  { plannedChemicalId: "p1", savedChemicalId: "c1", name: "A", unit: "Litres", amount: 2000, amountIsBase: true, legacyCostPerUnit: null },
  { plannedChemicalId: "p2", savedChemicalId: "c2", name: "B", unit: "Litres", amount: 1000, amountIsBase: true, legacyCostPerUnit: null },
] }];
let n = 0;
const line = (o: Partial<ActualTank["lines"][number]>) => ({
  id: `l${++n}`, plannedChemicalId: null, savedChemicalId: null, replacesPlannedChemicalId: null,
  usageKind: "planned" as const, name: null, unit: "Litres", actualAmountBase: 0, ...o,
});
const tank = (o: Partial<ActualTank> = {}): ActualTank => ({
  tankNumber: 1, recorded: true, vineyardId: "v", sprayRecordId: "r", tripId: "t", tankSessionId: "s1", waterL: 500,
  lines: [
    line({ plannedChemicalId: "p1", savedChemicalId: "c1", actualAmountBase: 2500 }),
    line({ plannedChemicalId: "p2", savedChemicalId: "c2", actualAmountBase: 900 }),
  ],
  ...o,
});

describe("Tank Actual parity (areSprayTankActualsComplete)", () => {
  it("correct session accepted; actual quantities uncapped", () => {
    expect(tankActualsComplete(planned, [tank()], ID)).toBe(true);
    const sel = selectChemicalUsage(planned, [tank()], ID);
    expect(sel.quantityBasis).toBe("actual");
    expect(sel.lines[0].amount).toBe(2500);
  });
  it("wrong session rejected → planned fallback", () => {
    expect(tankActualsComplete(planned, [tank({ tankSessionId: "s2" })], ID)).toBe(false);
    expect(selectChemicalUsage(planned, [tank({ tankSessionId: "s2" })], ID).quantityBasis).toBe("estimated_planned");
  });
  it("missing session id rejected", () => expect(tankActualsComplete(planned, [tank({ tankSessionId: null })], ID)).toBe(false));
  it("wrong vineyard / record / trip rejected", () => {
    expect(tankActualsComplete(planned, [tank({ vineyardId: "x" })], ID)).toBe(false);
    expect(tankActualsComplete(planned, [tank({ sprayRecordId: "x" })], ID)).toBe(false);
    expect(tankActualsComplete(planned, [tank({ tripId: "x" })], ID)).toBe(false);
  });
  it("extra unexpected tank/session rejected", () => {
    expect(tankActualsComplete(planned, [tank(), tank({ tankNumber: 2, tankSessionId: "s2" })], ID)).toBe(false);
  });
  it("two actuals for one tank are ambiguous", () => {
    expect(tankActualsComplete(planned, [tank(), tank()], ID)).toBe(false);
  });
  it("missing / negative / non-finite water rejected", () => {
    expect(tankActualsComplete(planned, [tank({ waterL: null })], ID)).toBe(false);
    expect(tankActualsComplete(planned, [tank({ waterL: -1 })], ID)).toBe(false);
    expect(tankActualsComplete(planned, [tank({ waterL: Number.NaN })], ID)).toBe(false);
  });
  it("zero water accepted", () => expect(tankActualsComplete(planned, [tank({ waterL: 0 })], ID)).toBe(true));
  it("duplicate actual chemical ids rejected", () => {
    const t = tank({ lines: [
      line({ id: "dup", plannedChemicalId: "p1", actualAmountBase: 1 }),
      line({ id: "dup", plannedChemicalId: "p2", actualAmountBase: 1 }),
    ] });
    expect(tankActualsComplete(planned, [t], ID)).toBe(false);
  });
  it("duplicate planned ids rejected", () => {
    const dupPlan: PlannedTank[] = [{ tankNumber: 1, lines: [planned[0].lines[0], planned[0].lines[0]] }];
    expect(tankActualsComplete(dupPlan, [tank({ lines: [line({ plannedChemicalId: "p1" })] })], ID)).toBe(false);
  });
  it("ambiguous direct lines rejected", () => {
    const t = tank({ lines: [
      line({ plannedChemicalId: "p1", actualAmountBase: 1 }),
      line({ plannedChemicalId: "p1", actualAmountBase: 1 }),
      line({ plannedChemicalId: "p2", actualAmountBase: 1 }),
    ] });
    expect(tankActualsComplete(planned, [t], ID)).toBe(false);
  });
  it("planned id with replaces set is an invalid association", () => {
    const t = tank({ lines: [
      line({ plannedChemicalId: "p1", replacesPlannedChemicalId: "p2", actualAmountBase: 1 }),
      line({ plannedChemicalId: "p2", actualAmountBase: 1 }),
    ] });
    expect(tankActualsComplete(planned, [t], ID)).toBe(false);
  });
  it("unknown planned / replaced id rejected", () => {
    expect(tankActualsComplete(planned, [tank({ lines: [...tank().lines, line({ plannedChemicalId: "pX" })] })], ID)).toBe(false);
    expect(tankActualsComplete(planned, [tank({ lines: [...tank().lines, line({ replacesPlannedChemicalId: "pX" })] })], ID)).toBe(false);
  });
  it("negative or missing amount rejected", () => {
    expect(tankActualsComplete(planned, [tank({ lines: [line({ plannedChemicalId: "p1", actualAmountBase: -1 }), line({ plannedChemicalId: "p2" })] })], ID)).toBe(false);
    expect(tankActualsComplete(planned, [tank({ lines: [line({ plannedChemicalId: "p1", actualAmountBase: null }), line({ plannedChemicalId: "p2" })] })], ID)).toBe(false);
  });
  it("substitution with zero direct line accepted", () => {
    const t = tank({ lines: [
      line({ plannedChemicalId: "p1", actualAmountBase: 2000 }),
      line({ plannedChemicalId: "p2", actualAmountBase: 0 }),
      line({ replacesPlannedChemicalId: "p2", savedChemicalId: "c9", actualAmountBase: 800 }),
    ] });
    expect(tankActualsComplete(planned, [t], ID)).toBe(true);
  });
  it("substitution without any direct line accepted", () => {
    const t = tank({ lines: [
      line({ plannedChemicalId: "p1", actualAmountBase: 2000 }),
      line({ replacesPlannedChemicalId: "p2", savedChemicalId: "c9", actualAmountBase: 800 }),
    ] });
    expect(tankActualsComplete(planned, [t], ID)).toBe(true);
  });
  it("substitution with non-zero direct line rejected", () => {
    const t = tank({ lines: [
      line({ plannedChemicalId: "p1", actualAmountBase: 2000 }),
      line({ plannedChemicalId: "p2", actualAmountBase: 5 }),
      line({ replacesPlannedChemicalId: "p2", savedChemicalId: "c9", actualAmountBase: 800 }),
    ] });
    expect(tankActualsComplete(planned, [t], ID)).toBe(false);
  });
  it("two substitutions rejected", () => {
    const t = tank({ lines: [
      line({ plannedChemicalId: "p1", actualAmountBase: 2000 }),
      line({ replacesPlannedChemicalId: "p2", savedChemicalId: "c8", actualAmountBase: 1 }),
      line({ replacesPlannedChemicalId: "p2", savedChemicalId: "c9", actualAmountBase: 1 }),
    ] });
    expect(tankActualsComplete(planned, [t], ID)).toBe(false);
  });
  it("additional line (no planned, no replaces) accepted", () => {
    expect(tankActualsComplete(planned, [tank({ lines: [...tank().lines, line({ savedChemicalId: "c7", actualAmountBase: 3 })] })], ID)).toBe(true);
  });
  it("plan-less record is never complete solely from an actual row", () => {
    expect(matchCompleteTankActuals([], [tank()], ID)).toBeNull();
    expect(selectChemicalUsage([], [tank()], ID).quantityBasis).toBe("estimated_planned");
  });
  it("trip-level: session ids come from trip.tank_sessions", () => {
    const price: ChemicalSeasonPriceRow = {
      saved_chemical_id: "c1", vintage: 2026, weighted_cost_per_base_unit: 0.01, base_unit: "mL", currency: "AUD",
      purchase_count: 1, total_quantity_base: 1, total_purchase_cost: 1, pricing_basis: "season_weighted_purchase_average", warning: null,
    };
    const prices: SeasonPriceMap = new Map([["c1", price]]);
    const rec = { id: "r", trip_id: "t", vineyard_id: "v", tanks: [{ tankNumber: 1, chemicals: [{ id: "p1", savedChemicalId: "c1", amountBase: 1000, unit: "Litres" }] }] };
    const row = { vineyard_id: "v", spray_record_id: "r", trip_id: "t", tank_session_id: "s1", tank_number: 1, water_volume_l: 400,
      chemicals: [{ id: "x1", plannedChemicalId: "p1", savedChemicalId: "c1", actualAmountBase: 3000, unit: "Litres" }] };
    const ok = resolveTripChemicalCost({ trip: { id: "t", vineyard_id: "v", tank_sessions: [{ id: "s1", tankNumber: 1 }] }, sprayRecords: [rec], tankActualRows: [row], prices });
    expect(ok.quantityBasis).toBe("actual");
    expect(ok.cost).toBeCloseTo(30);
    const bad = resolveTripChemicalCost({ trip: { id: "t", vineyard_id: "v", tank_sessions: [{ id: "OTHER", tankNumber: 1 }] }, sprayRecords: [rec], tankActualRows: [row], prices });
    expect(bad.quantityBasis).toBe("estimated_planned");
    expect(bad.cost).toBeCloseTo(10);
  });
});

describe("canonical vintage", () => {
  it("Cost Reports use allocation season_year", () => {
    const m = vintageByTripFromAllocations([{ trip_id: "t", season_year: 2025 }, { trip_id: "t", season_year: 2030 }]);
    expect(resolveTripVintage({ id: "t", start_time: "2026-09-01T00:00:00Z" }, { vintageByTrip: m, seasonStartMonth: 7, seasonStartDay: 1, timeZone: "UTC" })).toBe(2025);
  });
  it("browser time zone cannot change the allocation vintage", () => {
    const m = new Map([["t", 2026]]);
    const tzs = ["Pacific/Kiritimati", "Pacific/Pago_Pago"];
    const out = tzs.map((tz) => resolveTripVintage({ id: "t", start_time: "2026-06-30T12:30:00Z" }, { vintageByTrip: m, seasonStartMonth: 7, seasonStartDay: 1, timeZone: tz }));
    expect(out).toEqual([2026, 2026]);
  });
  it("fallback uses the vineyard-local season boundary", () => {
    // 30 Jun 14:30 UTC = 1 Jul 00:30 in Sydney (AEST) → next vintage.
    const iso = "2026-06-30T14:30:00Z";
    expect(vineyardLocalVintage(iso, 7, 1, "Australia/Sydney")).not.toBe(vineyardLocalVintage(iso, 7, 1, "America/Los_Angeles"));
    expect(vineyardLocalVintage(iso, 7, 1, "Australia/Sydney")).toBe(vineyardLocalVintage("2026-07-01T02:00:00Z", 7, 1, "UTC"));
  });
});

describe("Work Task linked-trip overlay", () => {
  const alloc = (o: Partial<TripCostAllocation>): TripCostAllocation => ({
    id: "a1", trip_id: "t", labour_cost: 100, fuel_cost: 20, chemical_cost: 50, input_cost: 5, total_cost: 175,
    allocation_area_ha: 2, season_year: 2026, ...o,
  } as any);
  const res: any = { status: "complete", cost: 80, warnings: [], quantityBasis: "actual", pricingBases: [], currency: "AUD" };
  it("adjusts total by the chemical delta only; labour/fuel/input unchanged", () => {
    const [o] = overlayAllocationsWithChemicalCost([alloc({})], new Map([["t", res]]));
    expect(o.chemical_cost).toBe(80);
    expect(o.total_cost).toBe(205);
    expect([o.labour_cost, o.fuel_cost, o.input_cost]).toEqual([100, 20, 5]);
  });
  it("stored allocation rows are not mutated", () => {
    const a = alloc({});
    overlayAllocationsWithChemicalCost([a], new Map([["t", res]]));
    expect(a.total_cost).toBe(175);
  });
  it("Work Task page feeds the shared overlay (table/detail/CSV share allocByTripId)", () => {
    const src = readFileSync("src/pages/reports/WorkTaskReportsPage.tsx", "utf8");
    expect(src).toContain("useChemicalAllocationOverlay(");
    expect(src).toContain("allocOverlay.rows.forEach");
    expect(src).not.toMatch(/\(allocQ\.data \?\? \[\]\)\.forEach/);
    void buildWorkTaskCostRollup;
  });
});

describe("Costing Setup", () => {
  it("no saved chemicals", () => expect(chemicalSetupState(0, 0).detail).toBe(CHEMICAL_SETUP_COPY.none));
  it("no purchases warns", () => expect(chemicalSetupState(3, 0)).toEqual({ state: "warn", detail: CHEMICAL_SETUP_COPY.noPurchases }));
  it("purchase history is ready", () => expect(chemicalSetupState(3, 1)).toEqual({ state: "ok", detail: CHEMICAL_SETUP_COPY.ready }));
  it("no saved_chemicals.purchase readiness check; link to Chemical Purchase", () => {
    const src = readFileSync("src/components/cost/CostingSetupWizard.tsx", "utf8");
    expect(src).not.toMatch(/select\("id, purchase"/);
    expect(src).not.toContain("savedChemicalsWithPurchase");
    expect(src).toContain('href: "/setup/chemicals/purchases"');
  });
  it("overlay hook only fetches for cost-permitted roles", () => {
    const src = readFileSync("src/lib/useChemicalAllocationOverlay.ts", "utf8");
    expect(src).toMatch(/const enabled = !!vineyardId && canSeeCosts/);
  });
});
