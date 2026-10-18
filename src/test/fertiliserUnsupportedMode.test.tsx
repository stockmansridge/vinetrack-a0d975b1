// Regression tests for the standalone read-only guard: records whose
// calculation_mode the Portal does not implement (nutrientTarget, fertigation,
// or anything unknown) must stay visible, display their real mode, show stored
// values verbatim, and never be reinterpreted as perHectare, recalculated,
// duplicated, or written back through the calculator save path.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import {
  calculationModeLabel,
  isSupportedCalculationMode,
  UNSUPPORTED_MODE_NOTICE,
} from "@/lib/fertiliserCalc";

const h = vi.hoisted(() => ({
  records: [] as any[],
  saves: [] as any[],
  fetchAllocCalls: [] as string[],
}));

vi.mock("@/integrations/ios-supabase/client", () => {
  const rows: Record<string, any[]> = { paddocks: [], saved_chemicals: [] };
  const from = (t: string) => {
    const c: any = { select: () => c, eq: () => c, is: () => c, order: () => c, in: () => c,
      then: (r: any) => Promise.resolve({ data: rows[t] ?? [], error: null }).then(r) };
    return c;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: "v1", memberships: [{ vineyard_id: "v1", role: "owner" }], currentRole: "owner" }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toasts: [] }) }));
vi.mock("@/lib/chemicalInventory", () => ({ fetchInventorySummary: async () => null }));
vi.mock("@/lib/chemicalSeasonPricing", () => ({ fetchChemicalSeasonPrices: async () => new Map(), seasonPriceQueryKey: () => ["sp"] }));
vi.mock("@/lib/workTasksQuery", () => ({
  createLabourLine: vi.fn(), createWorkTask: vi.fn(), fetchWorkTaskPaddocksForVineyard: vi.fn(async () => []), syncWorkTaskPaddocks: vi.fn(),
}));
vi.mock("@/lib/fertiliserRecordsQuery", () => ({
  fetchFertiliserRecords: async () => h.records,
  fetchFertiliserAllocations: async (id: string) => { h.fetchAllocCalls.push(id); return []; },
  saveFertiliserRecord: async (input: any) => { h.saves.push(input); return { record: { ...input }, allocations: [] }; },
  softDeleteFertiliserRecord: vi.fn(),
}));
vi.mock("@/components/PageHead", () => ({ PageHead: () => null }));

import FertiliserCalculatorPage from "@/pages/tools/FertiliserCalculatorPage";

const BASE = {
  vineyard_id: "v1", product_id: null, form: "liquid", record_status: "completed",
  application_date: "2026-09-15", block_names: ["Block A"], total_area_ha: 2, total_vines: 4000,
  application_rate: 12.5, application_rate_unit: "mL/vine", total_product_required: 50,
  product_unit: "L", pack_size: 20, pack_count: 2.5, estimated_product_cost: 300,
  labour_cost: null, machinery_cost: null, total_job_cost: 300, notes: "made on iPhone",
  created_by: "u1", updated_by: "u1", created_at: "", updated_at: "", deleted_at: null,
  client_updated_at: null, sync_version: 1,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><FertiliserCalculatorPage /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => { h.records = []; h.saves = []; h.fetchAllocCalls = []; });

describe("mode helpers", () => {
  it("only perHectare and perVine are supported", () => {
    expect(isSupportedCalculationMode("perHectare")).toBe(true);
    expect(isSupportedCalculationMode("perVine")).toBe(true);
    expect(isSupportedCalculationMode("nutrientTarget")).toBe(false);
    expect(isSupportedCalculationMode("fertigation")).toBe(false);
    expect(isSupportedCalculationMode("somethingNew")).toBe(false);
    expect(isSupportedCalculationMode(null)).toBe(false);
  });
  it("labels show the actual mode, never Per hectare for unsupported modes", () => {
    expect(calculationModeLabel("perHectare")).toBe("Per hectare");
    expect(calculationModeLabel("perVine")).toBe("Per vine");
    expect(calculationModeLabel("nutrientTarget")).toBe("Target nutrient");
    expect(calculationModeLabel("fertigation")).toBe("Fertigation");
    expect(calculationModeLabel("somethingNew")).toBe("Unknown (somethingNew)");
  });
});

describe("records list with an unsupported-mode record", () => {
  it("stays visible, shows its real mode and stored rate verbatim, and disables Duplicate", async () => {
    h.records = [{ ...BASE, id: "nt-1", product_name: "NitroPlus", calculation_mode: "nutrientTarget" }];
    renderPage();
    const row = (await screen.findByText("NitroPlus")).closest("tr")!;
    // Real mode shown — never "Per hectare".
    expect(within(row).getByText(/Target nutrient/)).toBeTruthy();
    expect(within(row).queryByText(/Per hectare/)).toBeNull();
    // Stored rate + unit verbatim (no per-hectare unit conversion).
    expect(within(row).getByText("12.5 mL/vine")).toBeTruthy();
    // Duplicate is disabled; view (pencil) remains available.
    expect((within(row).getByTitle(/Duplication unavailable/).closest("button")!).disabled).toBe(true);
    expect((within(row).getByTitle(/View \(read-only/).closest("button")!).disabled).toBe(false);
  });

  it("a perHectare record is unchanged: label, converted rate, enabled actions", async () => {
    h.records = [{ ...BASE, id: "ph-1", product_name: "Urea", form: "solid", calculation_mode: "perHectare", application_rate: 50, application_rate_unit: "kg/ha" }];
    renderPage();
    const row = (await screen.findByText("Urea")).closest("tr")!;
    expect(within(row).getByText(/Per hectare/)).toBeTruthy();
    expect(within(row).getByText(/50 kg\/ha/)).toBeTruthy();
    expect((within(row).getByTitle("Duplicate").closest("button")!).disabled).toBe(false);
    expect((within(row).getByTitle("Edit").closest("button")!).disabled).toBe(false);
  });
});

describe("opening an unsupported record", () => {
  it("shows a read-only view with the notice and stored values, and never saves", async () => {
    h.records = [{ ...BASE, id: "nt-1", product_name: "NitroPlus", calculation_mode: "nutrientTarget" }];
    renderPage();
    const viewBtn = await screen.findByTitle(/View \(read-only/);
    fireEvent.click(viewBtn);
    const dialog = await screen.findByRole("dialog");
    // Notice shown twice (description + alert), text exact.
    expect(within(dialog).getAllByText(new RegExp(UNSUPPORTED_MODE_NOTICE.slice(0, 30))).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Fertiliser Record (read-only)")).toBeTruthy();
    // Stored values verbatim.
    expect(within(dialog).getByText("NitroPlus")).toBeTruthy();
    expect(within(dialog).getByText("Target nutrient")).toBeTruthy();
    expect(within(dialog).getByText("12.5 mL/vine")).toBeTruthy();
    expect(within(dialog).getByText("50 L")).toBeTruthy();
    expect(within(dialog).getByText("made on iPhone")).toBeTruthy();
    // No save / status / recalculation controls.
    expect(within(dialog).queryByText("Save changes")).toBeNull();
    expect(within(dialog).queryByText("Mark Completed")).toBeNull();
    expect(within(dialog).queryByText("Save as Planned")).toBeNull();
    expect(h.saves).toHaveLength(0);
  });

  it("fertigation and unknown modes are equally read-only", async () => {
    for (const mode of ["fertigation", "futureModeX"]) {
      h.records = [{ ...BASE, id: `m-${mode}`, product_name: `P-${mode}`, calculation_mode: mode }];
      const { unmount } = renderPage();
      fireEvent.click(await screen.findByTitle(/View \(read-only/));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(calculationModeLabel(mode))).toBeTruthy();
      expect(within(dialog).queryByText("Save changes")).toBeNull();
      unmount();
    }
    expect(h.saves).toHaveLength(0);
  });
});
