import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ currentRole: "owner", selectedVineyardId: "v1", loading: false }) }));
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { parseInventorySummary, STOCK_STATE_LABEL, OPENING_STOCK_NOT_SET } from "@/lib/chemicalInventory";
import { ChemicalInventoryPanel, allowedStockUnits, defaultStockUnit } from "@/components/chemicals/ChemicalInventoryPanel";

const greenshield = { tracked: true, tracking_status: "ok", current_quantity: 30, display_unit: "L", percent_remaining: 100, latest_unit_cost: 10, currency: "AUD", latest_purchase_date: "2026-10-02", latest_batch_number: "15486", estimated_stock_value: 300 };

beforeEach(() => { rpc.mockReset(); toast.mockReset(); });

describe("tracking_status parser", () => {
  it.each([
    ["ok", "In stock"], ["low_stock", "Low stock"], ["out_of_stock", "Out of stock"], ["finished", "Finished"],
  ])("A-D. %s → %s", (status, label) => {
    const s = parseInventorySummary({ tracking_status: status, current_quantity: 1, display_unit: "L" });
    expect(s.state).toBe(status);
    expect(STOCK_STATE_LABEL[s.state!]).toBe(label);
  });
  it("E. needs_opening_stock", () => {
    const s = parseInventorySummary({ tracking_status: "needs_opening_stock" });
    expect(STOCK_STATE_LABEL[s.state!]).toBe(OPENING_STOCK_NOT_SET);
  });
  it("F. Greenshield (tracked + ok) never becomes Opening stock not set", async () => {
    const s = parseInventorySummary(greenshield);
    expect(s).toMatchObject({ state: "ok", tracked: true, quantity: 30, unit: "L", percent: 100, latestBatch: "15486", estimatedStockValue: 300 });
    rpc.mockResolvedValue({ data: greenshield, error: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChemicalInventoryPanel savedChemicalId="g" savedChemical={{ product_form: "solid" }} /></QueryClientProvider>);
    expect((await screen.findByTestId("inventory-summary")).textContent).toContain("30 L");
    expect(screen.queryByText("Set Opening Stock")).toBeNull();
  });
});

const ten = { tracking_status: "ok", current_quantity: 10, display_unit: "L", percent_remaining: 100 };
const setup = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ChemicalInventoryPanel savedChemicalId="s1" savedChemical={{ product_form: "liquid" }} /></QueryClientProvider>);
  return qc;
};

describe("post-save refresh", () => {
  it("G + I. purchase updates cached summary and history", async () => {
    let qty = 10;
    rpc.mockImplementation((name: string) => {
      if (name === "chemical_inventory_summary") return Promise.resolve({ data: { ...ten, current_quantity: qty }, error: null });
      if (/history/.test(name)) return Promise.resolve({ data: [{ id: "p1", purchase_date: "2026-10-02", quantity: 5 }], error: null });
      qty = 15; return Promise.resolve({ data: {}, error: null });
    });
    const qc = setup();
    fireEvent.click(await screen.findByText("Record Purchase"));
    fireEvent.change(screen.getByLabelText("Container size"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Total purchase amount"), { target: { value: "50" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Purchase recorded" }));
    expect((qc.getQueryData(["chem-inventory", "s1"]) as any).quantity).toBe(15);
    expect((qc.getQueryData(["chem-inventory-history", "s1"]) as any[])[0].id).toBe("p1");
  });
  it("H. stocktake updates cached summary", async () => {
    let qty = 10;
    rpc.mockImplementation((name: string) => {
      if (name === "chemical_inventory_summary") return Promise.resolve({ data: { ...ten, current_quantity: qty }, error: null });
      qty = 7; return Promise.resolve({ data: {}, error: null });
    });
    const qc = setup();
    fireEvent.click(await screen.findByText("Stocktake / Adjust"));
    fireEvent.change(screen.getByLabelText("Current physical quantity"), { target: { value: "7" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Stock adjusted" }));
    expect((qc.getQueryData(["chem-inventory", "s1"]) as any).quantity).toBe(7);
    expect(screen.getByTestId("inventory-summary").textContent).toContain("7 L");
  });
});

describe("units", () => {
  it("J. solid new inventory defaults kg", () => expect(defaultStockUnit(null, "solid", "Kg")).toBe("kg"));
  it("K. existing liquid inventory stays L for a solid chemical", () => {
    expect(defaultStockUnit("L", "solid", "Kg")).toBe("L");
    expect(allowedStockUnits("L")).toEqual(["L", "mL"]);
  });
});
