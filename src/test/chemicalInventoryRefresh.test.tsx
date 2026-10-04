import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ currentRole: "owner", selectedVineyardId: "v1", loading: false }) }));
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ChemicalInventoryPanel, allowedStockUnits, defaultStockUnit } from "@/components/chemicals/ChemicalInventoryPanel";

const none = { stock_status: "needs_opening_stock" };
const ten = { stock_status: "ok", current_quantity: 10, display_unit: "L", percent_remaining: 100 };
const setup = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ChemicalInventoryPanel savedChemicalId="s1" savedChemical={{ product_form: "liquid" }} /></QueryClientProvider>);
  return qc;
};
beforeEach(() => { rpc.mockReset(); toast.mockReset(); });

describe("inventory post-save refresh + default unit", () => {
  it("A/H. opening stock writes fresh summary into shared cache, toasts, disables while pending", async () => {
    let summaries = [none, ten];
    let resolveWrite: (v: any) => void = () => {};
    rpc.mockImplementation((name: string) => {
      if (name === "chemical_inventory_summary") return Promise.resolve({ data: summaries.shift() ?? ten, error: null });
      return new Promise((r) => { resolveWrite = r; });
    });
    const qc = setup();
    fireEvent.click(await screen.findByText("Set Opening Stock"));
    fireEvent.change(screen.getByLabelText("Current physical quantity"), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Save"));
    expect((await screen.findByText("Saving…")).closest("button")!.disabled).toBe(true);
    resolveWrite({ data: {}, error: null });
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Opening stock saved" }));
    expect((qc.getQueryData(["chem-inventory", "s1"]) as any).quantity).toBe(10);
    expect(screen.getByTestId("inventory-summary").textContent).toContain("10 L");
  });
  it("G. failed RPC keeps previous values and shows the actual error", async () => {
    rpc.mockImplementation((name: string) => name === "chemical_inventory_summary"
      ? Promise.resolve({ data: ten, error: null })
      : Promise.resolve({ data: null, error: { message: "Unit family mismatch" } }));
    setup();
    fireEvent.click(await screen.findByText("Record Purchase"));
    fireEvent.change(screen.getByLabelText("Container size"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Total purchase amount"), { target: { value: "50" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText(/Unit family mismatch/)).toBeTruthy();
    expect(screen.getByTestId("inventory-summary").textContent).toContain("10 L");
    expect(toast).not.toHaveBeenCalled();
  });
  it("C-F. default unit priority and unit family", () => {
    expect(defaultStockUnit(null, "solid")).toBe("kg");
    expect(defaultStockUnit(null, "liquid")).toBe("L");
    expect(defaultStockUnit("g", "liquid")).toBe("g");
    expect(defaultStockUnit("mL", "solid")).toBe("mL");
    expect(defaultStockUnit(null, null, "kg")).toBe("kg");
    expect(defaultStockUnit(null, "WG")).toBe("L");
    expect(allowedStockUnits("g")).toEqual(["kg", "g"]);
    expect(allowedStockUnits("mL")).toEqual(["L", "mL"]);
    expect(allowedStockUnits(null)).toHaveLength(4);
  });
});
