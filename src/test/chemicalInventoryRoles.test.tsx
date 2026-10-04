import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let role: string | null = "owner";
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ currentRole: role, selectedVineyardId: "v1" }) }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
const summary = {
  state: "ok", tracked: true, quantity: 30, unit: "L", percent: 100,
  latestUnitCost: 12.5, currency: "AUD", estimatedStockValue: 375, latestCostUnit: "L",
  latestPurchaseDate: "2026-09-01", latestBatch: "B1", latestBatchDate: "2026-08-01", latestSerial: "S1",
};
vi.mock("@/lib/chemicalInventory", async (orig) => {
  const m: any = await orig();
  return { ...m, fetchInventorySummary: vi.fn(async () => summary), fetchPurchaseHistory: vi.fn(async () => []),
    recordPurchaseV2: vi.fn(async () => ({})), markFinished: vi.fn(), recordStocktakeV2: vi.fn(), saveInventorySettings: vi.fn() };
});

import {
  canViewChemicalInventory, canRecordChemicalPurchase, canManageChemicalInventory, canViewChemicalInventoryCosts,
} from "@/lib/chemicalInventory";
import { ChemicalSectionNav } from "@/components/chemicals/ChemicalSectionNav";
import { ChemicalInventoryPanel } from "@/components/chemicals/ChemicalInventoryPanel";
import { canAccessRoute } from "@/lib/rolePermissions";

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

beforeEach(() => cleanup());

describe("Chemical Inventory role matrix", () => {
  it("helpers match SQL 262", () => {
    const m = (r: string | null) => [canViewChemicalInventory(r), canRecordChemicalPurchase(r), canManageChemicalInventory(r), canViewChemicalInventoryCosts(r)];
    expect(m("owner")).toEqual([true, true, true, true]);
    expect(m("manager")).toEqual([true, true, true, true]);
    expect(m("supervisor")).toEqual([true, true, false, false]);
    expect(m("operator")).toEqual([true, false, false, false]);
    expect(m(null)).toEqual([false, false, false, false]);
  });
  it("routes", () => {
    expect(canAccessRoute("/setup/chemicals/inventory", "operator")).toBe(true);
    expect(canAccessRoute("/setup/chemicals/purchases", "supervisor")).toBe(true);
    expect(canAccessRoute("/setup/chemicals/purchases", "operator")).toBe(false);
    expect(canAccessRoute("/setup/chemicals/inventory", null)).toBe(false);
  });
  it.each([["owner", true], ["manager", true], ["supervisor", true], ["operator", false]])("nav %s", (r, buy) => {
    role = r;
    wrap(<ChemicalSectionNav active="inventory" />);
    expect(screen.queryByTestId("chemical-inventory-link")).not.toBeNull();
    expect(!!screen.queryByTestId("chemical-purchase-link")).toBe(buy);
  });
  it("non-member with System Admin status sees nothing", () => {
    role = null;
    wrap(<ChemicalSectionNav active="chemicals" />);
    expect(screen.queryByTestId("chemical-inventory-link")).toBeNull();
    expect(screen.queryByTestId("chemical-purchase-link")).toBeNull();
  });
});

describe("panel actions and cost privacy", () => {
  const actions = ["Record Purchase", "Stocktake / Adjust", "Mark Finished", "Low stock settings"];
  it.each([
    ["owner", [true, true, true, true]],
    ["manager", [true, true, true, true]],
    ["supervisor", [true, false, false, false]],
    ["operator", [false, false, false, false]],
  ])("%s", async (r, expected) => {
    role = r;
    wrap(<ChemicalInventoryPanel savedChemicalId="c1" />);
    await screen.findByText("Purchase History");
    expect(actions.map((a) => !!screen.queryByText(a))).toEqual(expected);
    const costs = r === "owner" || r === "manager";
    expect(!!screen.queryByTestId("inventory-latest-price")).toBe(costs);
    expect(screen.getByTestId("inventory-latest-batch").textContent).toBe("B1");
    expect(screen.getByTestId("inventory-latest-serial").textContent).toBe("S1");
  });
});
