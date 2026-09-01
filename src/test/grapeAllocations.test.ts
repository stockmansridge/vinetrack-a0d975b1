import { describe, it, expect } from "vitest";
import { buildAllocationRow } from "@/lib/grapeAllocationsQuery";
import { buildAllocationRows, totalsFromRows } from "@/lib/grapeAllocationModel";
import type { GrapeAllocation } from "@/lib/grapeAllocationsQuery";

const alloc = (over: Partial<GrapeAllocation>): GrapeAllocation => ({
  id: over.id ?? "a1",
  vineyard_id: "v1",
  vintage: 2026,
  variety_id: null,
  variety_key: null,
  variety_name: "Pinot Noir",
  allocation_type: "external",
  purchaser_id: null,
  purchaser_name: null,
  destination_name: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  contact_address: null,
  quantity_tonnes: 5,
  notes: null,
  blocks: [],
  ...over,
});

describe("allocation row contract (SQL 217)", () => {
  it("stores only own_use / external and strips purchaser, contact and price for own use", () => {
    const row = buildAllocationRow(
      {
        vineyardId: "v1",
        vintage: 2026,
        allocationType: "own_use",
        varietyName: "Shiraz",
        quantityTonnes: 3,
        destinationName: "Estate wine",
        purchaserName: "Should be ignored",
        contactEmail: "x@y.z",
        pricePerTonne: 2500,
      },
      "u1",
    );
    expect(row.allocation_type).toBe("own_use");
    expect(row.destination_name).toBe("Estate wine");
    expect(row.purchaser_name).toBeNull();
    expect(row.contact_email).toBeNull();
    expect(row).not.toHaveProperty("price_per_tonne");
  });

  it("sends price_per_tonne on the base row for external allocations (trigger routes it)", () => {
    const row = buildAllocationRow(
      {
        vineyardId: "v1",
        vintage: 2026,
        allocationType: "external",
        varietyName: "Pinot Noir",
        quantityTonnes: 10,
        purchaserName: "Big Winery",
        pricePerTonne: 2200,
      },
      "u1",
    );
    expect(row.allocation_type).toBe("external");
    expect(row.price_per_tonne).toBe(2200);
    expect(row.destination_name).toBeNull();
  });

  it("omits price entirely when none is supplied", () => {
    const row = buildAllocationRow(
      {
        vineyardId: "v1",
        vintage: 2026,
        allocationType: "external",
        quantityTonnes: 1,
        purchaserName: "W",
      },
      null,
    );
    expect(row).not.toHaveProperty("price_per_tonne");
  });
});

describe("allocation aggregation", () => {
  const estimated = new Map([
    ["pinot noir", 20],
    ["shiraz", 10],
  ]);

  it("splits own use and external and reports available tonnes", () => {
    const rows = buildAllocationRows({
      allocations: [
        alloc({ id: "a1", allocation_type: "own_use", quantity_tonnes: 4 }),
        alloc({ id: "a2", allocation_type: "external", quantity_tonnes: 6 }),
      ],
      estimatedByVariety: estimated,
      financials: null,
    });
    const pn = rows.find((r) => r.varietyKey === "pinot noir")!;
    expect(pn.ownUseTonnes).toBe(4);
    expect(pn.externalTonnes).toBe(6);
    expect(pn.allocatedTonnes).toBe(10);
    expect(pn.availableTonnes).toBe(10);
    expect(pn.contractedIncome).toBeNull();
  });

  it("reports over-allocation as a negative available figure", () => {
    const rows = buildAllocationRows({
      allocations: [alloc({ id: "a1", variety_name: "Shiraz", quantity_tonnes: 12 })],
      estimatedByVariety: estimated,
      financials: null,
    });
    expect(rows.find((r) => r.varietyKey === "shiraz")!.availableTonnes).toBe(-2);
  });

  it("hides all monetary data when financials are not supplied", () => {
    const rows = buildAllocationRows({
      allocations: [alloc({})],
      estimatedByVariety: estimated,
      financials: null,
    });
    expect(rows.every((r) => r.contractedIncome === null)).toBe(true);
    expect(totalsFromRows(rows).contractedIncome).toBeNull();
  });

  it("sums contracted income for owners and managers", () => {
    const rows = buildAllocationRows({
      allocations: [
        alloc({ id: "a1", quantity_tonnes: 5 }),
        alloc({ id: "a2", quantity_tonnes: 5 }),
      ],
      estimatedByVariety: estimated,
      financials: new Map([
        ["a1", { pricePerTonne: 2000, contractValue: 10000 }],
        ["a2", { pricePerTonne: 2000, contractValue: null }],
      ]),
    });
    expect(rows.find((r) => r.varietyKey === "pinot noir")!.contractedIncome).toBe(20000);
    expect(totalsFromRows(rows).contractedIncome).toBe(20000);
  });

  it("totals estimate, allocated and available across varieties", () => {
    const rows = buildAllocationRows({
      allocations: [alloc({ id: "a1", quantity_tonnes: 8 })],
      estimatedByVariety: estimated,
      financials: null,
    });
    const totals = totalsFromRows(rows);
    expect(totals.estimatedTonnes).toBe(30);
    expect(totals.allocatedTonnes).toBe(8);
    expect(totals.availableTonnes).toBe(22);
  });
});
