import { describe, it, expect } from "vitest";
import {
  overlayAllocationsWithChemicalCost,
  overlaySprayReportCost,
  priceUsageLine,
  resolveChemicalCost,
  resolveTripChemicalCost,
  selectChemicalUsage,
  tankActualsComplete,
  toBaseQuantity,
  PARTIAL_CHEMICAL_WARNING,
  UNAVAILABLE_LABEL,
  type ChemicalUsageLine,
  type PlannedTank,
  type ActualTank,
  type ChemicalCostResult,
} from "@/lib/chemicalCostResolver";
import type { ChemicalSeasonPriceRow, SeasonPriceMap } from "@/lib/chemicalSeasonPricing";
import { computeTripCost } from "@/lib/tripCosting";
import { aggregateBy, buildUnifiedCostDataset } from "@/lib/unifiedCostDataset";
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";

const price = (id: string, over: Partial<ChemicalSeasonPriceRow> = {}): ChemicalSeasonPriceRow => ({
  saved_chemical_id: id,
  vintage: 2026,
  weighted_cost_per_base_unit: 0.02, // $/mL → $20/L
  base_unit: "mL",
  currency: "AUD",
  purchase_count: 1,
  total_quantity_base: 1000,
  total_purchase_cost: 20,
  pricing_basis: "season_weighted_purchase_average",
  warning: null,
  ...over,
});
const map = (...rows: ChemicalSeasonPriceRow[]): SeasonPriceMap => new Map(rows.map((r) => [r.saved_chemical_id, r]));
const line = (over: Partial<ChemicalUsageLine> = {}): ChemicalUsageLine => ({
  savedChemicalId: "c1", amount: 2, unit: "L", amountIsBase: false, usageKind: "planned", legacyCostPerUnit: null, ...over,
});
const unavailable = (id: string) => price(id, { pricing_basis: "season_purchase_cost_unavailable", weighted_cost_per_base_unit: null, base_unit: null });

describe("base-unit conversion", () => {
  it("10: L → mL", () => expect(priceUsageLine(line({ amount: 2, unit: "L" }), map(price("c1"))).cost).toBeCloseTo(40));
  it("10b: Litres token", () => expect(toBaseQuantity(1.5, "Litres")?.base).toBe(1500));
  it("11: mL stays mL", () => expect(priceUsageLine(line({ amount: 500, unit: "mL" }), map(price("c1"))).cost).toBeCloseTo(10));
  it("12: kg → g", () => {
    const p = map(price("c1", { base_unit: "g", weighted_cost_per_base_unit: 0.01 }));
    expect(priceUsageLine(line({ amount: 3, unit: "Kg" }), p).cost).toBeCloseTo(30);
  });
  it("13: g stays g", () => {
    const p = map(price("c1", { base_unit: "g", weighted_cost_per_base_unit: 0.01 }));
    expect(priceUsageLine(line({ amount: 250, unit: "g" }), p).cost).toBeCloseTo(2.5);
  });
  it("base-unit actuals are not re-multiplied", () => {
    expect(priceUsageLine(line({ amount: 2000, unit: "Litres", amountIsBase: true }), map(price("c1"))).cost).toBeCloseTo(40);
  });
});

describe("pricing precedence", () => {
  it("14: seasonal price wins over the line snapshot", () => {
    const r = priceUsageLine(line({ legacyCostPerUnit: 99 }), map(price("c1")));
    expect(r.pricingBasis).toBe("season_weighted_purchase_average");
    expect(r.cost).toBeCloseTo(40);
  });
  it("15/16/48/49: unavailable season cost may use a genuine historical snapshot, labelled", () => {
    const r = priceUsageLine(line({ legacyCostPerUnit: 15 }), map(unavailable("c1")));
    expect(r.cost).toBeCloseTo(30);
    expect(r.pricingBasis).toBe("legacy_stored_spray_snapshot");
  });
  for (const b of ["currency_conflict", "physical_dimension_conflict", "invalid_purchase_data"] as const) {
    it(`17-19/50: ${b} never falls back`, () => {
      const r = priceUsageLine(line({ legacyCostPerUnit: 15 }), map(price("c1", { pricing_basis: b })));
      expect(r.cost).toBeNull();
      expect(r.pricingBasis).toBe(b);
    });
  }
  it("physical unit mismatch is a conflict, not a price", () => {
    const r = priceUsageLine(line({ unit: "kg" }), map(price("c1")));
    expect(r.cost).toBeNull();
    expect(r.pricingBasis).toBe("physical_dimension_conflict");
  });
  it("23: a new line with costPerUnit = 0 is not a legacy $0 snapshot", () => {
    const res = resolveTripChemicalCost({
      sprayRecords: [{ trip_id: "t", tanks: [{ chemicals: [{ savedChemicalId: "c1", amount: 2, unit: "L", costPerUnit: 0 }] }] }],
      prices: map(unavailable("c1")),
    });
    expect(res.cost).toBeNull();
    expect(res.pricingBases).not.toContain("legacy_stored_spray_snapshot");
  });
  it("6: a valid $0 season price prices at $0", () => {
    expect(priceUsageLine(line(), map(price("c1", { weighted_cost_per_base_unit: 0 }))).cost).toBe(0);
  });
});

describe("20-22: Saved Chemical pricing and names are never a cost source", () => {
  const trip: any = { id: "t", start_time: null, end_time: null };
  const base = { trip, tractor: null, operatorCategories: [], members: [], fuelPurchases: [] };
  it("ignores saved_chemicals.purchase / price_per_pack and name matches", () => {
    const r = computeTripCost({
      ...base,
      sprayRecords: [{ trip_id: "t", tanks: [{ chemicals: [{ name: "Mancozeb", amount: 2, unit: "L" }] }] }],
      savedChemicals: [{ id: "c1", name: "Mancozeb", purchase: { costPerUnit: 50, price_per_pack: 500 } } as any],
      chemicalPricing: { prices: map(price("c1")) },
    });
    expect(r.chemicals.cost).toBeNull();
    expect(r.chemicals.status).toBe("unavailable");
  });
  it("prices by savedChemicalId via SQL 264", () => {
    const r = computeTripCost({
      ...base,
      sprayRecords: [{ trip_id: "t", tanks: [{ chemicals: [{ savedChemicalId: "c1", amount: 2, unit: "L" }] }] }],
      chemicalPricing: { prices: map(price("c1")) },
    });
    expect(r.chemicals.cost).toBeCloseTo(40);
    expect(r.chemicals.quantityBasis).toBe("estimated_planned");
    expect(r.chemicals.pricingBases).toEqual(["season_weighted_purchase_average"]);
  });
});

const planned: PlannedTank[] = [
  { tankNumber: 1, lines: [
    { plannedChemicalId: "p1", savedChemicalId: "c1", name: "A", unit: "Litres", amount: 2000, amountIsBase: true, legacyCostPerUnit: 10 },
    { plannedChemicalId: "p2", savedChemicalId: "c2", name: "B", unit: "Litres", amount: 1000, amountIsBase: true, legacyCostPerUnit: 10 },
  ] },
];
const ID = { vineyardId: "v", sprayRecordId: "r", tripId: "t", sessionsByTank: new Map([[1, new Set(["s1"])]]) };
const act = (lines: ActualTank["lines"]): ActualTank[] => [{
  tankNumber: 1, recorded: true, vineyardId: "v", sprayRecordId: "r", tripId: "t", tankSessionId: "s1", waterL: 500, lines,
}];
let alId = 0;
const al = (o: Partial<ActualTank["lines"][number]>) => ({
  id: `a${++alId}`, plannedChemicalId: null, savedChemicalId: null, replacesPlannedChemicalId: null, usageKind: "planned" as const,
  name: null, unit: "Litres", actualAmountBase: null, ...o,
});

describe("Tank Actuals", () => {
  const completeActuals = act([
    al({ plannedChemicalId: "p1", savedChemicalId: "c1", actualAmountBase: 3000 }),
    al({ savedChemicalId: "c3", replacesPlannedChemicalId: "p2", usageKind: "substitution", actualAmountBase: 900 }),
    al({ savedChemicalId: "c4", usageKind: "additional", actualAmountBase: 100 }),
  ]);
  it("24/26: complete actuals use actual quantities, not clamped to plan", () => {
    expect(tankActualsComplete(planned, completeActuals, ID)).toBe(true);
    const sel = selectChemicalUsage(planned, completeActuals, ID);
    expect(sel.quantityBasis).toBe("actual");
    expect(sel.lines.find((l) => l.savedChemicalId === "c1")?.amount).toBe(3000);
  });
  it("25: incomplete actuals use planned quantities", () => {
    const partial = act([al({ plannedChemicalId: "p1", savedChemicalId: "c1", actualAmountBase: 3000 })]);
    const sel = selectChemicalUsage(planned, partial, ID);
    expect(sel.quantityBasis).toBe("estimated_planned");
    expect(sel.lines.map((l) => l.amount)).toEqual([2000, 1000]);
  });
  it("27/28: substitute and additional use their own Saved Chemical IDs (no inherited snapshot)", () => {
    const sel = selectChemicalUsage(planned, completeActuals, ID);
    const sub = sel.lines.find((l) => l.usageKind === "substitution")!;
    const add = sel.lines.find((l) => l.usageKind === "additional")!;
    expect(sub.savedChemicalId).toBe("c3");
    expect(sub.legacyCostPerUnit).toBeNull();
    expect(add.savedChemicalId).toBe("c4");
    const res = resolveChemicalCost(sel.lines, map(price("c1"), price("c3", { weighted_cost_per_base_unit: 0.1 }), price("c4")), sel.quantityBasis);
    expect(res.cost).toBeCloseTo(3000 * 0.02 + 900 * 0.1 + 100 * 0.02);
  });
  it("29/30: unlinked actual product → incomplete, no name guess", () => {
    const acts = act([
      al({ plannedChemicalId: "p1", savedChemicalId: "c1", actualAmountBase: 2000 }),
      al({ plannedChemicalId: "p2", savedChemicalId: "c2", actualAmountBase: 1000 }),
      al({ savedChemicalId: null, name: "A", usageKind: "additional", actualAmountBase: 50 }),
    ]);
    const sel = selectChemicalUsage(planned, acts, ID);
    const res = resolveChemicalCost(sel.lines, map(price("c1"), price("c2")), sel.quantityBasis);
    expect(res.status).toBe("partial");
    expect(res.lines.find((l) => l.name === "A")?.cost).toBeNull();
    expect(res.cost).toBeCloseTo(60);
  });
});

describe("51/52: incomplete and mixed currency", () => {
  it("partial is marked partial with a warning", () => {
    const res = resolveChemicalCost([line(), line({ savedChemicalId: "cX" })], map(price("c1")), "actual");
    expect(res.status).toBe("partial");
    expect(res.cost).toBeCloseTo(40);
    expect(res.warnings).toContain(PARTIAL_CHEMICAL_WARNING);
  });
  it("mixed currencies are never summed", () => {
    const res = resolveChemicalCost([line(), line({ savedChemicalId: "c2" })], map(price("c1"), price("c2", { currency: "NZD" })), "actual");
    expect(res.cost).toBeNull();
    expect(res.mixedCurrency).toBe(true);
  });
});

const alloc = (id: string, area: number, over: Partial<TripCostAllocation> = {}): TripCostAllocation => ({
  id, vineyard_id: "v", trip_id: "t1", paddock_id: id, paddock_name: `Block ${id}`, variety: id === "A" ? "Shiraz" : "Merlot",
  season_year: 2026, allocation_area_ha: area, yield_tonnes: 10, labour_cost: 50, fuel_cost: 20, chemical_cost: 999,
  input_cost: 5, total_cost: 1074, trip_function: "spraying", ...over,
});
const result = (cost: number | null, status: ChemicalCostResult["status"] = "complete"): ChemicalCostResult => ({
  cost, currency: "AUD", status, quantityBasis: "actual", pricingBases: ["season_weighted_purchase_average"],
  lineCount: 1, resolvedLines: 1, incompleteLines: 0, mixedCurrency: false, warnings: [], lines: [],
});

describe("Cost Report overlay", () => {
  const stored = [alloc("A", 2), alloc("B", 1)];
  const snapshot = JSON.stringify(stored);
  const out = overlayAllocationsWithChemicalCost(stored, new Map([["t1", result(300)]]));
  it("31/37: replaces stored chemical with area shares", () => {
    expect(out[0].chemical_cost).toBeCloseTo(200);
    expect(out[1].chemical_cost).toBeCloseTo(100);
  });
  it("32-34: labour, fuel and input unchanged", () => {
    expect(out.map((o) => [o.labour_cost, o.fuel_cost, o.input_cost])).toEqual([[50, 20, 5], [50, 20, 5]]);
  });
  it("35: stored rows are not mutated", () => expect(JSON.stringify(stored)).toBe(snapshot));
  it("36: total = old total − old chemical + new share", () => expect(out[0].total_cost).toBeCloseTo(1074 - 999 + 200));
  it("38/39: no-area allocations use equal shares that sum to the trip total", () => {
    const eq = overlayAllocationsWithChemicalCost([alloc("A", 0), alloc("B", 0), alloc("C", 0)], new Map([["t1", result(300)]]));
    expect(eq.map((e) => e.chemical_cost)).toEqual([100, 100, 100]);
    expect(out.reduce((s, o) => s + (o.chemical_cost ?? 0), 0)).toBeCloseTo(300);
  });
  it("40/41: cost/ha and cost/tonne use the revised total", () => {
    expect(out[0].cost_per_ha).toBeCloseTo((1074 - 999 + 200) / 2);
    expect(out[0].cost_per_tonne).toBeCloseTo((1074 - 999 + 200) / 10);
  });
  it("42-46: Overview/Blocks/Varieties/Functions consume the overlaid dataset", () => {
    const ds = buildUnifiedCostDataset({ vineyardId: "v", tripAllocations: out });
    const total = ds.rows.reduce((s, r) => s + r.total_cost, 0);
    expect(total).toBeCloseTo(2 * (1074 - 999) + 300);
    expect(aggregateBy(ds.rows, (r) => r.block_name ?? "").find((b) => b.name === "Block A")?.total).toBeCloseTo(275);
    expect(aggregateBy(ds.rows, (r) => r.variety ?? "").find((b) => b.name === "Merlot")?.total).toBeCloseTo(175);
    expect(aggregateBy(ds.rows, (r) => r.function ?? "")[0].total).toBeCloseTo(450);
    expect(ds.rows.reduce((s, r) => s + r.chemical_cost, 0)).toBeCloseTo(300);
  });
  it("incomplete trip is flagged, never presented as complete", () => {
    const inc = overlayAllocationsWithChemicalCost(stored, new Map([["t1", result(null, "unavailable")]]));
    expect(inc[0].costing_status).toBe("incomplete");
    expect(inc[0].chemical_cost).toBe(0);
  });
});

describe("47: Spray Report PDF cost overlay", () => {
  const cost = { labourCost: 50, fuelCost: 20, chemicalCost: 999, totalCost: 1069 };
  it("replaces chemical + total, keeps labour/fuel, never mutates the payload cost", () => {
    const o = overlaySprayReportCost(cost, result(300));
    expect(o.chemicalCost).toBe(300);
    expect(o.totalCost).toBeCloseTo(370);
    expect(o.labourCost).toBe(50);
    expect(cost.chemicalCost).toBe(999);
    expect(o.chemicalPricingBasis).toBe("season_weighted_purchase_average");
  });
  it("unavailable renders Unavailable / incomplete, not old pricing", () => {
    const o = overlaySprayReportCost(cost, result(null, "unavailable"));
    expect(o.chemicalCost).toBe(UNAVAILABLE_LABEL);
    expect(o.totalCost).toBe(UNAVAILABLE_LABEL);
  });
});
