import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ChemicalInventoryPanel } from "@/components/chemicals/ChemicalInventoryPanel";
import { buildPurchaseV2Args, buildStocktakeV2Args, parsePurchaseHistory, parseInventorySummary } from "@/lib/chemicalInventory";
import { emptyPurchase } from "@/components/chemicals/ChemicalInventoryPanel";

const none = { tracking_status: "needs_opening_stock" };
const setup = (chem: any) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ChemicalInventoryPanel savedChemicalId="s1" savedChemical={chem} /></QueryClientProvider>);
  return qc;
};
beforeEach(() => { rpc.mockReset(); toast.mockReset(); });

describe("inventory V2 container contract", () => {
  it("A. opening defaults to full container 1 × 20 L → 20 L, summary from backend", async () => {
    const summaries: any[] = [none, { tracking_status: "ok", current_quantity: 20, display_unit: "L", percent_remaining: 100 }];
    rpc.mockImplementation((name: string) => name === "chemical_inventory_summary"
      ? Promise.resolve({ data: summaries.shift() ?? null, error: null }) : Promise.resolve({ data: {}, error: null }));
    const qc = setup({ product_form: "liquid", pack_size: 20, pack_unit: "L" });
    fireEvent.click(await screen.findByText("Set Opening Stock"));
    expect((screen.getByLabelText("Current physical quantity") as HTMLInputElement).value).toBe("20");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Opening stock saved" }));
    const call = rpc.mock.calls.find((c) => c[0] === "chemical_inventory_record_stocktake_v2")!;
    expect(call[1]).toMatchObject({ p_current_quantity: 20, p_current_unit: "L", p_reason: "opening_stock", p_container_count: 1, p_container_size: 20, p_container_unit: "L" });
    expect((qc.getQueryData(["chem-inventory", "s1"]) as any).percent).toBe(100);
  });
  it("B. partly used 12 of 20 L sends 12 + capacity, never a percentage", () => {
    const b = buildStocktakeV2Args("s1", { quantity: "12", unit: "L", reason: "opening_stock", notes: "" }, { count: "1", size: "20", unit: "L" });
    if (!("args" in b)) throw new Error();
    expect(b.args).toMatchObject({ p_current_quantity: 12, p_container_size: 20, p_container_count: 1 });
    expect(Object.keys(b.args).some((k) => /percent/.test(k))).toBe(false);
    expect(parseInventorySummary({ tracking_status: "ok", current_quantity: 12, display_unit: "L", percent_remaining: 60 }).percent).toBe(60);
  });
  it("C. purchase 2 × 20 L sends containers, no p_quantity; history shows 2 × 20 L", () => {
    const b = buildPurchaseV2Args("s1", { ...emptyPurchase("L"), total: "400" }, { count: "2", size: "20", unit: "L" });
    if (!("args" in b)) throw new Error();
    expect(b.args).toMatchObject({ p_container_count: 2, p_container_size: 20, p_container_unit: "L", p_total_cost: 400 });
    expect("p_quantity" in b.args).toBe(false);
    const [h] = parsePurchaseHistory([{ id: "p", purchase_date: "2026-10-02", quantity: 40, unit: "L", container_count: 2, container_size: 20, container_unit: "L" }]);
    expect(h).toMatchObject({ quantity: 40, containerCount: 2, containerSize: 20, containerUnit: "L" });
  });
  it("D. 12/20 then 2 × 20 shows backend 52 L / 86.67%", () => {
    const s = parseInventorySummary({ tracking_status: "ok", current_quantity: 52, display_unit: "L", percent_remaining: 86.67 });
    expect(s.quantity).toBe(52); expect(s.percent).toBe(86.67);
  });
  it("E. solid 1 × 10 kg keeps mass family", () => {
    const b = buildPurchaseV2Args("s1", { ...emptyPurchase("kg"), total: "50" }, { count: "1", size: "10", unit: "kg" });
    if (!("args" in b)) throw new Error();
    expect(b.args.p_container_unit).toBe("kg");
  });
  it("F. backend capacity error is shown clearly", async () => {
    rpc.mockImplementation((name: string) => name === "chemical_inventory_summary"
      ? Promise.resolve({ data: none, error: null })
      : Promise.resolve({ data: null, error: { message: "Current quantity exceeds container capacity" } }));
    setup({ product_form: "liquid", pack_size: 20, pack_unit: "L" });
    fireEvent.click(await screen.findByText("Set Opening Stock"));
    fireEvent.change(screen.getByLabelText("Current physical quantity"), { target: { value: "30" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText(/exceeds container capacity/)).toBeTruthy();
    expect(toast).not.toHaveBeenCalled();
  });
  it("G. legacy purchase without container data keeps aggregate only", () => {
    const [h] = parsePurchaseHistory([{ id: "old", purchase_date: "2026-01-01", quantity: 30, unit: "L" }]);
    expect(h).toMatchObject({ quantity: 30, unit: "L", containerCount: null, containerSize: null });
  });
  it("H. purchase in the panel uses V2 and refreshes summary + history cache", async () => {
    const summaries: any[] = [{ tracking_status: "ok", current_quantity: 12, display_unit: "L", percent_remaining: 60 }, { tracking_status: "ok", current_quantity: 52, display_unit: "L", percent_remaining: 86.67 }];
    rpc.mockImplementation((name: string) => {
      if (name === "chemical_inventory_summary") return Promise.resolve({ data: summaries.shift() ?? null, error: null });
      if (name === "chemical_inventory_purchase_history_v2") return Promise.resolve({ data: [{ id: "n", quantity: 40, unit: "L", container_count: 2, container_size: 20, container_unit: "L" }], error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    const qc = setup({ product_form: "liquid", pack_size: 20, pack_unit: "L" });
    fireEvent.click(await screen.findByText("Record Purchase"));
    fireEvent.change(screen.getByLabelText("Number of containers"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Total purchase amount"), { target: { value: "400" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Purchase recorded" }));
    expect(rpc.mock.calls.some((c) => c[0] === "chemical_inventory_record_purchase_v2")).toBe(true);
    expect(rpc.mock.calls.some((c) => c[0] === "chemical_inventory_record_purchase")).toBe(false);
    expect(screen.getByTestId("inventory-summary").textContent).toContain("52 L");
    expect((qc.getQueryData(["chem-inventory-history", "s1"]) as any)[0].containerCount).toBe(2);
  });
});
