import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const inv = vi.hoisted(() => ({ summary: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/chemicalInventory", async (orig) => {
  const real: any = await orig();
  return { ...real, fetchInventorySummary: inv.summary, fetchPurchaseHistory: inv.history };
});

import { ChemicalInventorySummaryCard } from "@/components/chemicals/ChemicalInventorySummaryCard";
import { omitLegacyPurchaseFields, suggestPurchaseContainer } from "@/lib/chemicalPurchaseAuthority";

const read = (p: string) => readFileSync(p, "utf8");
const editor = read("src/components/chemicals/ChemicalEditorSheet.tsx");
const list = read("src/pages/setup/SavedChemicalsPage.tsx");
const purchasePage = read("src/pages/setup/ChemicalPurchasePage.tsx");

const SUMMARY = {
  state: "ok", quantity: 40, unit: "L", latestUnitCost: 12.5, latestCostUnit: "L", currency: "AUD",
  latestPurchaseDate: "2026-09-01", latestBatch: "LOT-77", latestBatchDate: "2026-06-15", latestSerial: "SN-9",
};
const HISTORY = [{ id: "p1", containerCount: 2, containerSize: 20, containerUnit: "L", supplier: "Elders", reference: "INV-1", expiry: null }];

function show(role: string | null, id: string | null = "chem-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ChemicalInventorySummaryCard savedChemicalId={id} role={role as any} /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { inv.summary.mockReset().mockResolvedValue(SUMMARY); inv.history.mockReset().mockResolvedValue(HISTORY); });

describe("Edit Chemical no longer owns purchasing", () => {
  it("1–2. no editable pack price fields and no local cost calculation", () => {
    expect(editor).not.toMatch(/Pack price|Purchase &amp; pricing|packPriceStr|computedCost|price \/ size/);
  });
  it("3–4. an unrelated edit omits (never nulls) legacy purchase data", () => {
    const out = omitLegacyPurchaseFields({ name: "X", purchase: { costPerUnit: 5 }, pack_size: 20, price_per_pack: 100, pack_unit: "L" });
    expect(out).toEqual({ name: "X" });
    expect("purchase" in out).toBe(false);
    expect(editor).toContain("...omitLegacyPurchaseFields(form)");
    expect(editor).not.toMatch(/purchase:\s*(canSeeCosts|null)/);
  });
  it("11. new unsaved chemicals show a message and fetch/create nothing", () => {
    show("owner", null);
    expect(screen.getByText(/Save the chemical first/)).toBeTruthy();
    expect(inv.summary).not.toHaveBeenCalled();
  });
});

describe("Inventory & purchase summary", () => {
  it("5, 7, 8. reads fetchInventorySummary for date, batch, production date, serial", async () => {
    show("owner");
    await screen.findByText("LOT-77");
    expect(inv.summary).toHaveBeenCalledWith("chem-1");
    expect(screen.getByText("SN-9")).toBeTruthy();
    expect(screen.getByText("Production / Batch date")).toBeTruthy();
    expect(screen.getByText("Latest purchase")).toBeTruthy();
    expect(screen.getByText("2 × 20 L")).toBeTruthy();
  });
  it("6. owner/manager see cost", async () => {
    show("manager");
    await screen.findByText("Latest unit cost");
  });
  it("9. supervisor can Record Purchase but sees no cost", async () => {
    show("supervisor");
    await screen.findByText("LOT-77");
    expect(screen.queryByText("Latest unit cost")).toBeNull();
    expect(screen.getByRole("link", { name: "Record Purchase" }).getAttribute("href")).toBe("/setup/chemicals/purchases?chemical=chem-1");
  });
  it("10. operator sees no cost and no purchase action", async () => {
    show("operator");
    await screen.findByText("LOT-77");
    expect(screen.queryByText("Latest unit cost")).toBeNull();
    expect(screen.queryByRole("link", { name: "Record Purchase" })).toBeNull();
    expect(screen.getByRole("link", { name: "View Inventory" })).toBeTruthy();
  });
});

describe("Chemicals list and Purchase page", () => {
  it("12. Cost column no longer reads savedChemical.purchase", () => {
    expect(list).not.toMatch(/purchaseCostPerUnit|c\.purchase/);
  });
  it("13. no per-row inventory queries in the Chemicals table", () => {
    expect(list).not.toMatch(/fetchInventorySummary|chem-inventory/);
  });
  it("14. purchase write path is unchanged", () => {
    expect(purchasePage).toContain("recordPurchaseV2(chemId, purchase, effectiveBox)");
    expect(editor).not.toMatch(/recordPurchase/);
  });
  it("latest purchase container seeds new purchases, legacy pack is fallback", () => {
    expect(suggestPurchaseContainer({ containerSize: 20, containerUnit: "L" }, { pack_size: 5, pack_unit: "L" })).toEqual({ size: 20, unit: "L" });
    expect(suggestPurchaseContainer(null, { pack_size: 5, pack_unit: "kg" })).toEqual({ size: 5, unit: "kg" });
    expect(suggestPurchaseContainer(null, null)).toEqual({ size: null, unit: null });
  });
});
