import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  role: "owner" as string,
  records: [] as any[],
  allocations: {} as Record<string, any[]>,
  fetchAllocCalls: [] as string[],
  saves: [] as any[],
  saveFail: false,
  toasts: [] as any[],
}));

vi.mock("@/integrations/ios-supabase/client", () => {
  const rows: Record<string, any[]> = {
    paddocks: [
      { id: "pA", name: "Block A", rows: [], polygon_points: [], vine_spacing: 1 },
      { id: "pB", name: "Block B", rows: [], polygon_points: [], vine_spacing: 1 },
    ],
    saved_chemicals: [],
  };
  const from = (t: string) => {
    const c: any = { select: () => c, eq: () => c, is: () => c, order: () => c, in: () => c,
      then: (r: any) => Promise.resolve({ data: rows[t] ?? [], error: null }).then(r) };
    return c;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: "v1", memberships: [{ vineyard_id: "v1", role: h.role }], currentRole: h.role }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: (t: any) => h.toasts.push(t), useToast: () => ({ toasts: [] }) }));
vi.mock("@/lib/chemicalInventory", () => ({ fetchInventorySummary: async () => null }));
vi.mock("@/lib/chemicalSeasonPricing", () => ({ fetchChemicalSeasonPrices: async () => new Map(), seasonPriceQueryKey: () => ["sp"] }));
vi.mock("@/lib/workTasksQuery", () => ({
  createLabourLine: vi.fn(), createWorkTask: vi.fn(), fetchWorkTaskPaddocksForVineyard: vi.fn(async () => []), syncWorkTaskPaddocks: vi.fn(),
}));
vi.mock("@/lib/fertiliserRecordsQuery", () => ({
  fetchFertiliserRecords: async () => h.records,
  fetchFertiliserAllocations: async (id: string) => { h.fetchAllocCalls.push(id); return h.allocations[id] ?? []; },
  saveFertiliserRecord: async (input: any) => {
    h.saves.push(input);
    if (h.saveFail) throw new Error("network down");
    return { record: { ...input }, allocations: input.allocations };
  },
  softDeleteFertiliserRecord: vi.fn(),
}));

vi.mock("@/components/PageHead", () => ({ PageHead: () => null }));
import FertiliserCalculatorPage from "@/pages/tools/FertiliserCalculatorPage";

const SOURCE = {
  id: "src-rec", vineyard_id: "v1", product_id: null, product_name: "Urea", form: "solid",
  calculation_mode: "perHectare", record_status: "planned", application_date: "2026-09-01",
  block_names: ["Block A", "Block B"], total_area_ha: 3, total_vines: 6000, application_rate: 50,
  application_rate_unit: "kg/ha", total_product_required: 150, product_unit: "kg", pack_size: 25,
  pack_count: 6, estimated_product_cost: null, labour_cost: 120, machinery_cost: 80, total_job_cost: 200,
  notes: "Post-harvest", created_by: "u1", updated_by: "u1", created_at: "", updated_at: "",
  deleted_at: null, client_updated_at: null, sync_version: 4,
};
const SRC_ALLOCS = [
  { id: "src-a1", fertiliser_record_id: "src-rec", vineyard_id: "v1", paddock_id: "pA", area_ha: 1, vine_count: 2000, application_rate: 50, product_required: 50, allocated_cost: null, created_at: "", updated_at: "" },
  { id: "src-a2", fertiliser_record_id: "src-rec", vineyard_id: "v1", paddock_id: "pB", area_ha: 2, vine_count: 4000, application_rate: 50, product_required: 100, allocated_cost: null, created_at: "", updated_at: "" },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><FertiliserCalculatorPage /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  h.role = "owner"; h.records = [{ ...SOURCE }]; h.allocations = { "src-rec": SRC_ALLOCS };
  h.fetchAllocCalls = []; h.saves = []; h.saveFail = false; h.toasts = [];
});

async function openRowAction(title: string) {
  renderPage();
  const btn = await screen.findByTitle(title);
  fireEvent.click(btn);
  return screen.findByRole("dialog");
}

describe("Fertiliser Duplicate", () => {
  it("copies the source into a brand-new record with new IDs and never touches the source", async () => {
    const dialog = await openRowAction("Duplicate");
    expect(h.fetchAllocCalls[0]).toBe("src-rec");
    expect(within(dialog).getByText("Duplicate Fertiliser Record")).toBeTruthy();
    // New record → planned/completed buttons, not edit buttons.
    expect(within(dialog).queryByText("Save changes")).toBeNull();
    expect(within(dialog).queryByText("Mark Completed")).toBeNull();
    fireEvent.click(await within(dialog).findByText("Save as Planned"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const s = h.saves[0];
    expect(s.id).not.toBe("src-rec");
    expect(s.id).toMatch(/[0-9a-f-]{36}/);
    expect(s.current_sync_version).toBe(0);
    expect(s.record_status).toBe("planned");
    expect(s).toMatchObject({
      product_name: "Urea", form: "solid", calculation_mode: "perHectare", application_rate: 50,
      pack_size: 25, labour_cost: 120, machinery_cost: 80, notes: "Post-harvest",
      total_area_ha: 3, total_vines: 6000, block_names: ["Block A", "Block B"],
    });
    expect(s.allocations.map((a: any) => a.paddock_id)).toEqual(["pA", "pB"]);
    expect(s.allocations.map((a: any) => [a.area_ha, a.vine_count])).toEqual([[1, 2000], [2, 4000]]);
    for (const a of s.allocations) expect(["src-a1", "src-a2"]).not.toContain(a.id);
    expect(new Set(s.allocations.map((a: any) => a.id)).size).toBe(2);
    // Source never written.
    expect(h.saves.some((x) => x.id === "src-rec")).toBe(false);
  });
});

describe("Fertiliser Mark Completed", () => {
  it("saves the same record as completed, keeps values and allocation IDs, then closes", async () => {
    const dialog = await openRowAction("Edit");
    const btn = await within(dialog).findByText("Mark Completed");
    await waitFor(() => expect((btn.closest("button") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const s = h.saves[0];
    expect(s.id).toBe("src-rec");
    expect(s.record_status).toBe("completed");
    expect(s.current_sync_version).toBe(4);
    expect(s).toMatchObject({ product_name: "Urea", application_rate: 50, pack_size: 25, labour_cost: 120, notes: "Post-harvest" });
    expect(s.allocations.map((a: any) => a.id)).toEqual(["src-a1", "src-a2"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.toasts.at(-1).title).toMatch(/completed/i);
  });

  it("reports a save error and stays open when persistence fails", async () => {
    h.saveFail = true;
    const dialog = await openRowAction("Edit");
    const btn = await within(dialog).findByText("Mark Completed");
    await waitFor(() => expect((btn.closest("button") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(h.toasts.at(-1)?.variant).toBe("destructive"));
    expect(h.toasts.at(-1).title).toBe("Could not save fertiliser record");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.toasts.some((t) => /completed/i.test(t.title))).toBe(false);
  });

  it("Save changes keeps a planned record planned", async () => {
    const dialog = await openRowAction("Edit");
    const btn = await within(dialog).findByText("Save changes");
    await waitFor(() => expect((btn.closest("button") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(h.saves[0]).toMatchObject({ id: "src-rec", record_status: "planned" });
    expect(h.saves[0].allocations.map((a: any) => a.id)).toEqual(["src-a1", "src-a2"]);
  });
});
