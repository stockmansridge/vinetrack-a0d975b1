import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";

vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ currentRole: "owner" }) }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));

import { ChemicalSectionNav, CHEMICAL_NAV_ITEMS } from "@/components/chemicals/ChemicalSectionNav";
import { containerTotal, defaultContainer, formatContainers, CONTAINER_BACKEND_SUPPORTED } from "@/lib/chemicalContainers";
import { purchaseFromContainers, emptyPurchase, defaultStockUnit } from "@/components/chemicals/ChemicalInventoryPanel";
import { buildPurchaseArgs } from "@/lib/chemicalInventory";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("shared Chemicals nav", () => {
  it("1-3. used by all three pages, never duplicated", () => {
    expect(read("src/pages/setup/SavedChemicalsPage.tsx")).toContain('<ChemicalSectionNav active="chemicals"');
    expect(read("src/pages/setup/ChemicalInventoryPage.tsx")).toContain('<ChemicalSectionNav active="inventory"');
    expect(read("src/pages/setup/ChemicalPurchasePage.tsx")).toContain('<ChemicalSectionNav active="purchases"');
    expect(read("src/App.tsx")).toContain('path="/setup/chemicals/purchases"');
  });
  it("4, 6, 7. order and links (destinations only, strong active state)", () => {
    render(<MemoryRouter><ChemicalSectionNav active="inventory" onAddChemical={() => {}} /></MemoryRouter>);
    expect(screen.getByText("Chemical tools")).toBeTruthy();
    const nav = screen.getByTestId("chemical-section-nav");
    const labels = Array.from(nav.querySelectorAll("a,button")).map((e) => e.textContent);
    expect(labels).toEqual([...CHEMICAL_NAV_ITEMS]);
    expect(nav.textContent).not.toContain("Add Chemical");
    const inv = screen.getByText("Chemical Inventory").closest("a")!;
    expect(inv.getAttribute("href")).toBe("/setup/chemicals/inventory");
    expect(inv.getAttribute("aria-current")).toBe("page");
    expect(inv.className).toContain("bg-primary");
    expect(inv.className).toContain("text-primary-foreground");
    expect(screen.getByText("Chemical Purchase").closest("a")!.getAttribute("href")).toBe("/setup/chemicals/purchases");
  });
  it("5. Add Chemical action still opens the existing Chemical Search, outside the nav", () => {
    const add = vi.fn();
    render(<MemoryRouter><ChemicalSectionNav active="chemicals" onAddChemical={add} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Add Chemical"));
    expect(add).toHaveBeenCalled();
    expect(read("src/pages/setup/SavedChemicalsPage.tsx")).toContain("onAddChemical={() => setSearchOpen(true)}");
    expect(read("src/pages/setup/SavedChemicalsPage.tsx")).toContain("ADD_CHEMICAL_PARAM");
  });
  it("5b. no Add Chemical on pages without the action", () => {
    render(<MemoryRouter><ChemicalSectionNav active="purchases" /></MemoryRouter>);
    expect(screen.queryByText("Add Chemical")).toBeNull();
  });
  it("8. no duplicate header buttons", () => {
    const page = read("src/pages/setup/SavedChemicalsPage.tsx");
    expect(page).not.toMatch(/<Plus className="h-4 w-4 mr-1" \/> Add Chemical/);
    expect(page).not.toContain('data-testid="chemical-inventory-link"');
  });
});

describe("container model", () => {
  it("9. count defaults to 1, size from pack size", () => {
    expect(defaultContainer(20, "L", "L")).toEqual({ count: "1", size: "20", unit: "L" });
    expect(defaultContainer(null, null, "kg")).toEqual({ count: "1", size: "", unit: "kg" });
  });
  it("10-11. solid and liquid defaults", () => {
    expect(defaultStockUnit(null, "solid")).toBe("kg");
    expect(defaultStockUnit(null, "liquid")).toBe("L");
  });
  it("12. total preview", () => {
    expect(containerTotal({ count: "2", size: "20" })).toBe(40);
    expect(containerTotal({ count: "3", size: "20" })).toBe(60);
    expect(formatContainers({ count: "2", size: "20", unit: "L" })).toBe("2 × 20 L = 40 L total");
  });
  it("13. opening stock separates capacity from current amount", () => {
    const panel = read("src/components/chemicals/ChemicalInventoryPanel.tsx");
    expect(panel).toContain('data-testid="opening-capacity"');
    expect(panel).toContain("Current physical quantity");
  });
  it("14-15. container support is live (V2 contract)", () => {
    expect(CONTAINER_BACKEND_SUPPORTED).toBe(true);
    expect(read("src/pages/setup/ChemicalPurchasePage.tsx")).toContain("recordPurchaseV2");
  });
});
