import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";

let role: string | null = "owner";
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ currentRole: role, selectedVineyardId: "v1", loading: false }) }));
const isAdmin = vi.fn(() => ({ isAdmin: false, loading: false }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => isAdmin(), useIsSystemAdminRaw: () => isAdmin() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { ChemicalSectionNav } from "@/components/chemicals/ChemicalSectionNav";
import { buildPurchaseV2Args, canManageChemicalInventory, parseInventorySummary, parsePurchaseHistory } from "@/lib/chemicalInventory";
import { emptyPurchase } from "@/components/chemicals/ChemicalInventoryPanel";

const nav = () => render(<MemoryRouter><ChemicalSectionNav active="chemicals" onAddChemical={() => {}} /></MemoryRouter>);
beforeEach(() => isAdmin.mockReturnValue({ isAdmin: false, loading: false }));

describe("inventory access = vineyard Owner/Manager", () => {
  for (const r of ["owner", "manager"]) it(`${r} sees Inventory and Purchase`, () => {
    role = r; nav();
    expect(screen.getByText("Chemical Inventory")).toBeTruthy();
    expect(screen.getByText("Chemical Purchase")).toBeTruthy();
  });
  for (const r of ["supervisor", "operator"]) it(`${r} does not`, () => {
    role = r; nav();
    expect(screen.queryByText("Chemical Inventory")).toBeNull();
    expect(screen.queryByText("Chemical Purchase")).toBeNull();
  });
  it("System Admin status is not the permission source", () => {
    isAdmin.mockReturnValue({ isAdmin: true, loading: false });
    role = "operator"; nav();
    expect(screen.queryByText("Chemical Inventory")).toBeNull();
    expect(canManageChemicalInventory(null)).toBe(false);
    for (const p of ["src/pages/setup/ChemicalInventoryPage.tsx", "src/pages/setup/ChemicalPurchasePage.tsx", "src/components/chemicals/ChemicalSectionNav.tsx", "src/lib/chemicalInventory.ts"])
      expect(fs.readFileSync(p, "utf8")).not.toMatch(/useIsSystemAdmin|canUseInventoryPilot/);
  });
});

describe("traceability contract", () => {
  const box = { count: "2", size: "20", unit: "L" as const };
  it("maps batch/lot, batch date and serial", () => {
    const b = buildPurchaseV2Args("s1", { ...emptyPurchase("L"), total: "400", batch: " ABC123 ", batchDate: "2026-08-12", serialNumber: "XYZ987" }, box);
    if (!("args" in b)) throw new Error();
    expect(b.args).toMatchObject({ p_batch_number: "ABC123", p_batch_date: "2026-08-12", p_serial_number: "XYZ987", p_container_count: 2, p_container_size: 20, p_container_unit: "L", p_total_cost: 400 });
    expect("p_quantity" in b.args).toBe(false);
  });
  it("blank values are NULL, never empty strings; batch date never defaults", () => {
    expect(emptyPurchase().batchDate).toBe("");
    const b = buildPurchaseV2Args("s1", { ...emptyPurchase("L"), total: "1", serialNumber: "  " }, box);
    if (!("args" in b)) throw new Error();
    expect(b.args).toMatchObject({ p_batch_number: null, p_batch_date: null, p_serial_number: null });
  });
  it("history returns all three identifiers; legacy rows still parse", () => {
    const [a, old] = parsePurchaseHistory([
      { id: "n", purchase_date: "2026-09-01", quantity: 40, unit: "L", batch_number: "ABC123", batch_date: "2026-08-12", serial_number: "XYZ987" },
      { id: "o", purchase_date: "2026-01-01", quantity: 30, unit: "L" },
    ]);
    expect(a).toMatchObject({ batch: "ABC123", batchDate: "2026-08-12", serialNumber: "XYZ987" });
    expect(old).toMatchObject({ quantity: 30, batch: null, batchDate: null, serialNumber: null, containerCount: null });
  });
  it("summary exposes latest batch date and serial when present", () => {
    const s = parseInventorySummary({ tracking_status: "ok", current_quantity: 5, latest_batch_number: "ABC123", latest_batch_date: "2026-08-12", latest_serial_number: "XYZ987" });
    expect([s.latestBatch, s.latestBatchDate, s.latestSerial]).toEqual(["ABC123", "2026-08-12", "XYZ987"]);
    expect(parseInventorySummary({ tracking_status: "ok" }).latestSerial).toBeNull();
  });
});
