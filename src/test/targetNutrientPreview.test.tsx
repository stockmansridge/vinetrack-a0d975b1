// Target Nutrient (Preview) UI gating + safety:
// - The mode is selectable ONLY by System Admins.
// - Preview never saves: no Save/Mark Completed, mutation refuses.
// - Persisted nutrientTarget records still hit the read-only guard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ isAdmin: false, saves: [] as any[], products: [] as any[] }));

vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: h.isAdmin, loading: false }),
}));
vi.mock("@/integrations/ios-supabase/client", () => {
  const from = (t: string) => {
    const c: any = { select: () => c, eq: () => c, is: () => c, order: () => c, in: () => c,
      then: (r: any) => Promise.resolve({ data: t === "saved_chemicals" ? h.products : [], error: null }).then(r) };
    return c;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toasts: [] }) }));
vi.mock("@/lib/chemicalInventory", () => ({ fetchInventorySummary: async () => null }));
vi.mock("@/lib/chemicalSeasonPricing", () => ({ fetchChemicalSeasonPrices: async () => new Map(), seasonPriceQueryKey: () => ["sp"] }));
vi.mock("@/lib/vineyardSeasonSettingsQuery", () => ({
  fetchVineyardSeasonSettings: async () => ({ season_start_month: 7, season_start_day: 1 }),
  SEASON_DEFAULTS: { season_start_month: 7, season_start_day: 1 },
}));
vi.mock("@/lib/workTasksQuery", () => ({
  createLabourLine: vi.fn(), createWorkTask: vi.fn(), fetchWorkTaskPaddocksForVineyard: vi.fn(async () => []), syncWorkTaskPaddocks: vi.fn(),
}));
vi.mock("@/lib/fertiliserRecordsQuery", () => ({
  fetchFertiliserAllocations: async () => [],
  saveFertiliserRecord: async (input: any) => { h.saves.push(input); return { record: { ...input }, allocations: [] }; },
}));

import FertiliserCalculatorDialog from "@/components/fertiliser/FertiliserCalculatorDialog";

const PADDOCKS = [
  { id: "p1", name: "Block A", areaHa: 2, vineCount: 4000, actualVineCount: 4000, actualVineCountSource: "manual" as any, assumedFullVineCount: 4000, assumedFullReason: null },
];

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FertiliserCalculatorDialog open onOpenChange={() => {}} vineyardId="v1" paddocks={PADDOCKS} role="owner" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openModeMenu() {
  const triggers = screen.getAllByRole("combobox");
  fireEvent.pointerDown(triggers[0]); // Calculation mode select is first
  fireEvent.keyDown(triggers[0], { key: "ArrowDown" });
  await waitFor(() => screen.getByRole("listbox"));
}

describe("Target Nutrient (Preview) gating", () => {
  beforeEach(() => { h.isAdmin = false; h.saves = []; h.products = []; });

  async function startTarget() {
    h.isAdmin = true;
    renderDialog();
    await openModeMenu();
    fireEvent.click(screen.getByRole("option", { name: /Target Nutrient \(Preview\)/i }));
  }

  async function choose(label: string, name: RegExp) {
    const trigger = screen.getByRole("combobox", { name: label });
    fireEvent.pointerDown(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => screen.getByRole("listbox"));
    fireEvent.click(screen.getByRole("option", { name }));
  }

  it("immediately recalculates editable percentages with manual counts and blocks", async () => {
    await startTarget();
    fireEvent.change(screen.getByLabelText("Nutrient percent"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Target quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Vine count"), { target: { value: "1000" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("12.5 g/vine");
    expect(screen.getByLabelText("Total product result").textContent).toBe("12.5 kg");
    fireEvent.change(screen.getByLabelText("Nutrient percent"), { target: { value: "20" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("10 g/vine");
    fireEvent.click(screen.getByLabelText("Select Block A"));
    expect(screen.getByLabelText("Total product result").textContent).toBe("40 kg");
    expect(h.saves).toEqual([]);
  });

  it("uses existing manual area for kg actual nutrient/ha", async () => {
    await startTarget();
    await choose("Target basis", /kg \/ hectare/);
    fireEvent.change(screen.getByLabelText("Nutrient percent"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Target quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Treated area ha"), { target: { value: "3" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("12.5 kg/ha");
    expect(screen.getByLabelText("Total product result").textContent).toBe("37.5 kg");
  });

  it("blocks unknown legacy bases and oxide values for actual nutrient targets", async () => {
    h.products = [{ id: "legacy", name: "Legacy product", nitrogen_percent: 16, analysis_basis: "oxide", product_form: "solid", product_category: "granularFertiliser" }];
    await startTarget();
    fireEvent.click(await screen.findByRole("button", { name: /Legacy product/ }));
    expect(screen.getByLabelText("Nutrient percent")).toHaveProperty("value", "");
    fireEvent.change(screen.getByLabelText("Nutrient percent"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Target quantity"), { target: { value: "2" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("—");
    await choose("Analysis basis", /Oxide/);
    await choose("Concentration basis", /w\/w/);
    expect(screen.getByLabelText("Product rate result").textContent).toBe("—");
    await choose("Analysis basis", /Elemental/);
    expect(screen.getByLabelText("Product rate result").textContent).toBe("12.5 g/vine");
    fireEvent.change(screen.getByLabelText("Nutrient percent"), { target: { value: "140" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("—");
    expect(h.saves).toEqual([]);
  });

  it("requires documented density for w/w liquids, not w/v", async () => {
    await startTarget();
    fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));
    const form = screen.getAllByRole("combobox")[0];
    fireEvent.pointerDown(form); fireEvent.keyDown(form, { key: "ArrowDown" });
    await waitFor(() => screen.getByRole("listbox"));
    fireEvent.click(screen.getByRole("option", { name: "Liquid" }));
    fireEvent.change(screen.getByLabelText("Nutrient percent"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Target quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Product density"), { target: { value: "1.25" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("—");
    fireEvent.change(screen.getByLabelText("Density source"), { target: { value: "Technical sheet" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("10 mL/vine");
    await choose("Concentration basis", /w\/v/);
    expect(screen.getByLabelText("Product rate result").textContent).toBe("12.5 mL/vine");
  });

  it("does not offer the mode to ordinary users", async () => {
    renderDialog();
    await openModeMenu();
    expect(screen.queryByRole("option", { name: /Target Nutrient/i })).toBeNull();
  });

  it("offers the mode to System Admins and shows the preview panel", async () => {
    h.isAdmin = true;
    renderDialog();
    await openModeMenu();
    fireEvent.click(screen.getByRole("option", { name: /Target Nutrient \(Preview\)/i }));
    expect(screen.getByLabelText("Target nutrient settings")).toBeTruthy();
    expect(screen.getByText(/Preview mode — saving is disabled/)).toBeTruthy();
  });

  it("never exposes Save or Mark Completed in preview mode", async () => {
    h.isAdmin = true;
    renderDialog();
    await openModeMenu();
    fireEvent.click(screen.getByRole("option", { name: /Target Nutrient \(Preview\)/i }));
    for (const label of ["Save as Planned", "Record as Completed", "Save changes", "Mark Completed"]) {
      const btn = screen.queryByRole("button", { name: label });
      if (btn) expect(btn).toHaveProperty("disabled", true);
    }
    expect(h.saves).toEqual([]);
  });

  it("has no duplicate nutrient editor — one nutrient input, no Add nutrient", async () => {
    await startTarget();
    expect(screen.queryByRole("button", { name: /Add nutrient/i })).toBeNull();
    expect(screen.queryByText(/Product analysis \(local preview\)/i)).toBeNull();
    expect(screen.getAllByLabelText("Nutrient percent")).toHaveLength(1);
    expect(screen.getAllByRole("combobox", { name: "Target nutrient" })).toHaveLength(1);
  });

  it("keeps a typed percentage and target when the nutrient changes", async () => {
    await startTarget();
    fireEvent.change(screen.getByLabelText("Nutrient percent"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Target quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Vine count"), { target: { value: "1000" } });
    expect(screen.getByLabelText("Product rate result").textContent).toBe("12.5 g/vine");
    await choose("Target nutrient", /K — Potassium/);
    expect(screen.getByLabelText("Nutrient percent")).toHaveProperty("value", "16");
    expect(screen.getByLabelText("Target quantity")).toHaveProperty("value", "2");
    expect(screen.getByLabelText("Product rate result").textContent).toBe("12.5 g/vine");
  });

  it("shows the live result immediately after the core inputs, before blocks", async () => {
    await startTarget();
    const results = screen.getByLabelText("Target nutrient results");
    const blocks = screen.getByText("Blocks (optional)");
    expect(results.compareDocumentPosition(blocks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains analysis and concentration basis under the Analysis details toggle", async () => {
    await startTarget();
    fireEvent.click(screen.getByText("Analysis details"));
    expect(screen.getByText(/grams of nutrient per 100 grams of product/)).toBeTruthy();
    expect(screen.getByText(/grams of nutrient per 100 mL of product/)).toBeTruthy();
    expect(screen.getByText(/P₂O₅, K₂O/)).toBeTruthy();
    expect(screen.getByText(/never converts between them/)).toBeTruthy();
    expect(screen.getByLabelText("About concentration basis")).toBeTruthy();
    expect(screen.getByLabelText("About analysis basis")).toBeTruthy();
    // Manual mode: both basis selectors are explicitly choosable.
    expect(screen.getByRole("combobox", { name: "Concentration basis" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Analysis basis" })).toBeTruthy();
  });

  it("shows an empty editable percentage when no analysis exists — never 0% declared", async () => {
    await startTarget();
    const pct = screen.getByLabelText("Nutrient percent");
    expect(pct).toHaveProperty("value", "");
    expect(screen.getByText(/Manual entry — from the product label/)).toBeTruthy();
  });

  it("persisted nutrientTarget records still open read-only (guard intact)", () => {
    const record: any = {
      id: "r1", vineyard_id: "v1", product_id: null, product_name: "Nitro 16",
      form: "solid", calculation_mode: "nutrientTarget", record_status: "completed",
      application_date: "2026-10-01", block_names: ["Block A"], total_area_ha: 2,
      total_vines: 4000, application_rate: 12.5, application_rate_unit: "g/vine",
      total_product_required: 50, product_unit: "kg", pack_size: null, pack_count: null,
      estimated_product_cost: null, labour_cost: null, machinery_cost: null,
      total_job_cost: null, notes: "", created_by: "u1", updated_by: "u1",
      created_at: "", updated_at: "", deleted_at: null, client_updated_at: null, sync_version: 1,
    };
    h.isAdmin = true; // even an admin gets the read-only guard for saved records
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <FertiliserCalculatorDialog open onOpenChange={() => {}} vineyardId="v1" paddocks={PADDOCKS} role="owner" existing={record} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getAllByText(/not supported by this version of the Portal/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Save/i })).toBeNull();
  });
});
