import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: () => ({ select: async () => ({ data: [], error: null }) }) } }));

import {
  MARK_FINISHED_CONFIRM, OPENING_STOCK_NOT_SET, buildAddToVineyardArgs, buildPurchaseArgs, canUseInventoryPilot, isPendingCatalogueReview,
  isV3Addable, parseCategoryRows, parseInventorySummary, parsePurchaseHistory, setV3ProductCategory, v3CategoryLabel, v3EntryBadge, addV3ToVineyard,
} from "@/lib/chemicalInventory";
import { ChemicalInventoryPanel, InventorySummaryView } from "@/components/chemicals/ChemicalInventoryPanel";
import { RateOptionCard } from "@/components/chemicals/V3ReviewData";

const weedmaster = { product_category: "Herbicide (Group 9)", product_category_key: "herbicide" };
const cats = parseCategoryRows([{ category_key: "herbicide", display_name: "Herbicide", sort_order: 3 }, { category_key: "fungicide", display_name: "Fungicide", sort_order: 1 }]);
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => rpc.mockReset());

describe("V3 category", () => {
  it("1. uses product_category_key as authority", () => {
    expect(v3CategoryLabel({ product_category: "Herbicide (Group 9)" }, cats)).toBeNull();
    expect(v3CategoryLabel({ product_category_key: "fungicide", product_category: "Herbicide" }, cats)).toBe("Fungicide");
  });
  it("2. Weedmaster displays Herbicide, not the raw free text", () => {
    expect(v3CategoryLabel(weedmaster, cats)).toBe("Herbicide");
  });
  it("3. correction uses the shared vocabulary and the RPC", async () => {
    expect(cats.map((c) => c.key)).toEqual(["fungicide", "herbicide"]);
    rpc.mockResolvedValue({ data: null, error: null });
    await setV3ProductCategory("rev1", "fungicide");
    expect(rpc).toHaveBeenCalledWith("chemical_v3_set_product_category", { p_revision_id: "rev1", p_category_key: "fungicide" });
    expect(fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8")).toContain("fetchProductCategories");
  });
});

describe("Add to vineyard", () => {
  it("4-6. pending_review, needs_attention and approved can be added", () => {
    for (const s of ["pending_review", "needs_attention", "approved"]) expect(isV3Addable(s)).toBe(true);
    expect(isV3Addable("rejected")).toBe(false);
  });
  it("7. candidate is visibly marked pending", () => {
    expect(isPendingCatalogueReview("pending_review")).toBe(true);
    expect(isPendingCatalogueReview("approved")).toBe(false);
    expect(v3EntryBadge({ entry_source: "chemical_v3_candidate" })?.label).toBe("Pending review");
    expect(v3EntryBadge({ entry_source: "chemical_v3_catalogue" })?.label).not.toMatch(/pending/i);
  });
  it("8. opening stock is optional and reused is reported", async () => {
    const b = buildAddToVineyardArgs({ revisionId: "r", vineyardId: "v", quantity: "", unit: "L" });
    expect("args" in b && b.args).toEqual({ p_revision_id: "r", p_vineyard_id: "v", p_opening_quantity: null, p_opening_unit: null });
    rpc.mockResolvedValue({ data: { reused: true, saved_chemical_id: "s1" }, error: null });
    expect(await addV3ToVineyard({ revisionId: "r", vineyardId: "v", quantity: "5", unit: "kg" })).toEqual({ reused: true, savedChemicalId: "s1" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_opening_quantity: 5, p_opening_unit: "kg" });
  });
});

describe("Inventory", () => {
  it("9. purchase sends quantity + total, no unit cost", () => {
    const b = buildPurchaseArgs("s", { date: "2026-09-18", quantity: "20", unit: "L", total: "340", currency: "AUD", batch: "ABC123", supplier: "", reference: "", expiry: "", notes: "" });
    if (!("args" in b)) throw new Error("expected args");
    expect(b.args).toMatchObject({ p_quantity: 20, p_total_cost: 340, p_batch_number: "ABC123", p_supplier: null });
    expect(Object.keys(b.args).some((k) => /unit_cost|per_unit/.test(k))).toBe(false);
  });
  it("10. summary renders gauge", () => {
    render(<InventorySummaryView s={parseInventorySummary({ stock_status: "ok", current_quantity: 12.4, display_unit: "L", percent_remaining: 62 })} />);
    expect(screen.getByTestId("inventory-gauge").textContent).toContain("62%");
    expect(screen.getByTestId("inventory-summary").textContent).toContain("12.4 L");
  });
  it("11. needs_opening_stock never shows zero", () => {
    const s = parseInventorySummary({ stock_status: "needs_opening_stock", current_quantity: 0, percent_remaining: 0 });
    expect(s.quantity).toBeNull();
    render(<InventorySummaryView s={s} />);
    expect(screen.getByTestId("inventory-unknown").textContent).toBe(OPENING_STOCK_NOT_SET);
    expect(screen.queryByTestId("inventory-gauge")).toBeNull();
  });
  it("12. purchase history keeps every row, newest first", () => {
    const h = parsePurchaseHistory([{ id: "a", purchase_date: "2026-01-01", quantity: 10 }, { id: "b", purchase_date: "2026-09-18", quantity: 20 }, { id: "c", purchase_date: "2026-01-01", quantity: 10 }]);
    expect(h.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
  it("13 + 14. Mark Finished confirmation and latest price from summary", async () => {
    rpc.mockResolvedValue({ data: { stock_status: "ok", current_quantity: 12.4, display_unit: "L", percent_remaining: 62, latest_unit_cost: 17, latest_currency: "AUD", latest_batch_number: "ABC123" }, error: null });
    wrap(<ChemicalInventoryPanel savedChemicalId="s1" />);
    expect((await screen.findByTestId("inventory-latest-price")).textContent).toMatch(/17\.00 \/ L/);
    expect(rpc).toHaveBeenCalledWith("chemical_inventory_summary", { p_saved_chemical_id: "s1" });
    fireEvent.click(screen.getByText("Mark Finished"));
    expect((await screen.findByTestId("finish-confirm")).textContent).toBe(MARK_FINISHED_CONFIRM);
  });
  it("15. low stock states render", () => {
    const labels: Record<string, string> = { ok: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock", finished: "Finished" };
    for (const [state, label] of Object.entries(labels)) {
      const { unmount } = render(<InventorySummaryView s={parseInventorySummary({ stock_status: state, current_quantity: 1, display_unit: "L", percent_remaining: 10 })} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });
});

describe("Gate, compact display, V1/V2 untouched", () => {
  it("16. non-System-Admin sees no pilot controls", () => {
    expect(canUseInventoryPilot(false)).toBe(false);
    const page = fs.readFileSync("src/pages/setup/SavedChemicalsPage.tsx", "utf8");
    expect(page).toContain("canUseInventoryPilot(isSystemAdmin)");
    expect(page).toMatch(/\{inventoryPilot && \(\s*<Sheet/);
    const lab = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
    expect((lab.match(/canUseInventoryPilot\(isAdmin\) && revi?s?I?d?/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("17 + 18. long application text and restrictions collapsed by default", () => {
    const { container } = render(<RateOptionCard option={{ min_value: 3, max_value: 6, unit: "L/ha", targets: ["Phalaris"], methods: ["Boom"], application_directions: "Apply in 50 to 150 L water per hectare using a boom", condition: "Do not apply in wind" }} />);
    expect(container.textContent).toContain("3–6 L/ha");
    expect(container.textContent).toContain("Phalaris");
    expect(container.textContent).not.toContain("Apply in 50 to 150 L");
    expect(container.textContent).not.toContain("Do not apply in wind");
  });
});
