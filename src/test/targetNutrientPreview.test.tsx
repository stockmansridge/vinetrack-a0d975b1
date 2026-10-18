// Target Nutrient (Preview) UI gating + safety:
// - The mode is selectable ONLY by System Admins.
// - Preview never saves: no Save/Mark Completed, mutation refuses.
// - Persisted nutrientTarget records still hit the read-only guard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ isAdmin: false, saves: [] as any[] }));

vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: h.isAdmin, loading: false }),
}));
vi.mock("@/integrations/ios-supabase/client", () => {
  const rows: Record<string, any[]> = { saved_chemicals: [] };
  const from = (t: string) => {
    const c: any = { select: () => c, eq: () => c, is: () => c, order: () => c, in: () => c,
      then: (r: any) => Promise.resolve({ data: rows[t] ?? [], error: null }).then(r) };
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
  beforeEach(() => { h.isAdmin = false; h.saves = []; });

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
