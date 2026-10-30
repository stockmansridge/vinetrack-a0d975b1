import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let tables: Record<string, Record<string, any>> = {};
let failNext = false;
const calls: string[] = [];
const from = vi.fn((table: string) => {
  const q: any = {
    select: () => q,
    eq: (_c: string, id: string) => { q.id = id; return q; },
    maybeSingle: async () => {
      calls.push(`${table}:${q.id}`);
      if (failNext) { failNext = false; return { data: null, error: { message: "boom" } }; }
      return { data: tables[table]?.[q.id] ?? null, error: null };
    },
  };
  return q;
});
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { from: (t: string) => from(t), functions: { invoke: vi.fn() } } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("Lovable Cloud used"); } } }));
vi.mock("@/lib/masterChemicals", async (orig) => ({ ...(await orig<Record<string, unknown>>()), fetchMasterChemical: vi.fn(async () => null) }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ currentCountry: "AU", currentVineyardId: "v1", memberships: [{ vineyard_id: "v1", role: "owner", vineyard_name: "Stockman" }] }) }));
vi.mock("@/lib/permissions", () => ({ useCanSeeCosts: () => true }));
const updateSavedChemical = vi.fn(async (id: string, input: unknown) => ({ id, ...(input as object) }));
vi.mock("@/lib/savedChemicalsQuery", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchSavedChemicalsForVineyard: vi.fn(async () => []),
  updateSavedChemical: (...a: [string, unknown]) => updateSavedChemical(...a),
  createSavedChemical: vi.fn(),
}));

import { fetchCatalogueReference } from "@/lib/chemicalCatalogueReference";
import { ChemicalEditor } from "@/components/chemicals/ChemicalEditorSheet";
import { ChemicalIntelligenceDialog } from "@/components/chemicals/ChemicalIntelligenceDialog";

const approvedRev = {
  id: "rev-2", product_id: "p1", review_status: "approved",
  default_rate_options: {
    per_hectare: [{ id: "a", min_value: 0.8, max_value: 1.2, unit: "L/ha", targets: ["Powdery mildew"] }],
    per_100_litres: [{ id: "b", value: 25, unit: "mL/100 L" }, { id: "c", value: 40, unit: "mL/100 L", restrictions: "Do not exceed 3 sprays" }],
  },
};
const seed = () => {
  tables = {
    chemical_v3_products: { p1: { id: "p1", status: "approved", approved_revision_id: "rev-2", current_revision_id: "rev-3" }, p2: { id: "p2", status: "pending_review", approved_revision_id: null } },
    chemical_v3_product_revisions: { "rev-2": approvedRev, "rev-3": { id: "rev-3", product_id: "p1", review_status: "pending_review" }, "rev-p2": { id: "rev-p2", product_id: "p2", review_status: "pending_review" } },
  };
};
beforeEach(() => { seed(); calls.length = 0; failNext = false; updateSavedChemical.mockClear(); });

const linked = {
  id: "chem-1", vineyard_id: "v1", name: "Belanty", notes: "Old notes", unit: "L/ha",
  chemical_v3_product_id: "p1", chemical_v3_revision_id: "rev-1",
  default_rates: {
    version: 1,
    per_hectare: { option_key: "default_option_v1_x", rate_ids: ["rate_v1_a"], basis: "per_hectare", unit: "L", value: 2, min_value: null, max_value: null, source: "operator", selected_at: "2026-01-01T00:00:00Z", label_version: null },
    per_100_litres: null,
  },
  vineyard_preferred_rate: { amount: 1.1, unit: "L", basis: "per_hectare", note: null },
  // Raw V3 use as stored for Belanty: plural crop, no is_grapevine flag.
  registered_uses: [{ crop: "Grapes", targets: ["Powdery mildew"], rates: [{ value: 0.8, unit: "L/ha" }], method: "Foliar", restrictions: "Max 2", withholding_statement: "14 days" }],
  label_rate_bases: ["per_hectare"],
  verification_status: "verified",
  verification_sources: [{ kind: "label", url: "https://example.com" }],
} as any;
const INTEL_KEYS = ["intelligence", "registered_uses", "label_rate_bases", "verification_status", "verification_sources", "verification_conflicts", "verification_unresolved_fields"];

const mkClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = (c: QueryClient, ui: React.ReactNode) => <MemoryRouter><QueryClientProvider client={c}>{ui}</QueryClientProvider></MemoryRouter>;
function wrap(ui: React.ReactNode, c = mkClient()) {
  return { client: c, ...render(tree(c, ui)) };
}
const editor = (initial: any, open = true) => (
  <ChemicalEditor open={open} onOpenChange={() => {}} initial={initial} vineyardId="v1" existingLibrary={[]} canSeeCosts onSaved={() => {}} />
);

describe("catalogue reference authority", () => {
  it("uses approved_revision_id (never current_revision_id) with matching product and explicit approval", async () => {
    const r = await fetchCatalogueReference({ productId: "p1", revisionId: "rev-1" });
    expect(r.state).toBe("approved");
    expect((r as any).revision.id).toBe("rev-2");
    expect(calls).not.toContain("chemical_v3_product_revisions:rev-3");
  });
  it("rejects a revision without explicit approved status", async () => {
    tables.chemical_v3_product_revisions["rev-2"] = { ...approvedRev, review_status: undefined };
    expect((await fetchCatalogueReference({ productId: "p1", revisionId: null })).state).toBe("unavailable");
  });
  it("rejects a revision belonging to another product", async () => {
    tables.chemical_v3_product_revisions["rev-2"] = { ...approvedRev, product_id: "other" };
    expect(await fetchCatalogueReference({ productId: "p1", revisionId: null })).toEqual({ state: "unavailable", reason: "mismatch" });
  });
  it("revision-only links resolve through the product's approved pointer to the newer revision", async () => {
    tables.chemical_v3_product_revisions["rev-1"] = { id: "rev-1", product_id: "p1", review_status: "approved" };
    const r = await fetchCatalogueReference({ productId: null, revisionId: "rev-1" });
    expect((r as any).revision.id).toBe("rev-2");
  });
  it("pending discoveries are not approved", async () => {
    expect(await fetchCatalogueReference({ productId: null, revisionId: "rev-p2" })).toEqual({ state: "not_approved", status: "pending_review" });
  });
  it("a rejected/pending PRODUCT with an old approved pointer is not approved", async () => {
    tables.chemical_v3_products.p1 = { ...tables.chemical_v3_products.p1, status: "rejected" };
    expect(await fetchCatalogueReference({ productId: "p1", revisionId: null })).toEqual({ state: "not_approved", status: "rejected" });
    tables.chemical_v3_products.p1 = { ...tables.chemical_v3_products.p1, status: undefined };
    expect((await fetchCatalogueReference({ productId: "p1", revisionId: null })).state).toBe("not_approved");
  });
  it("missing product is unavailable", async () => {
    expect(await fetchCatalogueReference({ productId: "nope", revisionId: null })).toEqual({ state: "unavailable", reason: "product_missing" });
  });
});

describe("Edit chemical catalogue section", () => {
  it("shows badge and every rate option by basis for a linked record with missing local fields", async () => {
    wrap(editor(linked));
    expect(await screen.findByText("Per hectare (1)")).toBeTruthy();
    expect(screen.getByText("Per 100 litres (2)")).toBeTruthy();
    expect(screen.getByText("0.8–1.2 L/ha")).toBeTruthy();
    expect(screen.getByText("25 mL/100 L")).toBeTruthy();
    expect(screen.getByText("40 mL/100 L")).toBeTruthy();
    expect(screen.getByTitle("Approved VineTrack catalogue product")).toBeTruthy();
    expect(screen.queryByText(/No registered grapevine/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
  it("shows Retry on error and loads after retry", async () => {
    failNext = true;
    wrap(editor(linked));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Per hectare (1)")).toBeTruthy();
  });
  it("pending link shows pending status, never approved", async () => {
    wrap(editor({ ...linked, chemical_v3_product_id: "p2", chemical_v3_revision_id: "rev-p2" }));
    expect(await screen.findByTestId("catalogue-not-approved")).toBeTruthy();
    expect(screen.getByText("Catalogue: pending review")).toBeTruthy();
    expect(screen.queryByTitle("Approved VineTrack catalogue product")).toBeNull();
  });
  it("manual/unlinked record makes no catalogue query", async () => {
    wrap(editor({ ...linked, chemical_v3_product_id: null, chemical_v3_revision_id: null }));
    await screen.findByDisplayValue("Belanty");
    expect(calls.length).toBe(0);
    expect(screen.queryByText("Catalogue rates")).toBeNull();
  });
  it("switching chemicals never shows the previous chemical's rates", async () => {
    const { rerender, client } = wrap(editor(linked));
    await screen.findByText("Per hectare (1)");
    tables.chemical_v3_products.p3 = { id: "p3", status: "approved", approved_revision_id: "rev-9" };
    tables.chemical_v3_product_revisions["rev-9"] = { id: "rev-9", product_id: "p3", review_status: "approved", default_rate_options: { per_hectare: [], per_100_litres: [] } };
    rerender(tree(client, editor({ ...linked, id: "chem-2", name: "Other", chemical_v3_product_id: "p3" })));
    expect(screen.queryByText("0.8–1.2 L/ha")).toBeNull();
    expect(await screen.findByTestId("catalogue-no-rates")).toBeTruthy();
  });
  it("populates preferred/default rates; a notes-only save omits rates and raw V3 intelligence", async () => {
    wrap(editor(linked));
    await screen.findByText("Per hectare (1)");
    expect((screen.getByLabelText("Preferred rate amount") as HTMLInputElement).value).toBe("1.1");
    fireEvent.change(screen.getByDisplayValue("Old notes"), { target: { value: "New notes" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/i }));
    await waitFor(() => expect(updateSavedChemical).toHaveBeenCalled());
    const [id, payload] = updateSavedChemical.mock.calls[0] as [string, any];
    expect(id).toBe("chem-1");
    expect(payload.notes).toBe("New notes");
    for (const k of ["chemical_v3_product_id", "chemical_v3_revision_id", "vineyard_preferred_rate", "default_rates", ...INTEL_KEYS]) expect([k, k in payload]).toEqual([k, false]);
  });
  it("a preferred-rate edit writes only that field, never intelligence or default_rates", async () => {
    wrap(editor(linked));
    await screen.findByText("Per hectare (1)");
    fireEvent.change(screen.getByLabelText("Preferred rate amount"), { target: { value: "1.4" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/i }));
    await waitFor(() => expect(updateSavedChemical).toHaveBeenCalled());
    const payload = updateSavedChemical.mock.calls[0][1] as any;
    expect(payload.vineyard_preferred_rate).toMatchObject({ amount: 1.4, unit: "L", basis: "per_hectare" });
    for (const k of ["default_rates", ...INTEL_KEYS]) expect([k, k in payload]).toEqual([k, false]);
  });
  it("a deliberate intelligence edit is still persisted", async () => {
    // No saved default here: an intelligence edit re-runs the existing stale-default gate.
    wrap(editor({ ...linked, default_rates: null }));
    await screen.findByText("Per hectare (1)");
    const reg = screen.getByText(/^Registration number/).closest("div")!.querySelector("input") as HTMLInputElement;
    fireEvent.change(reg, { target: { value: "99999" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/i }));
    await waitFor(() => expect(updateSavedChemical).toHaveBeenCalled());
    const payload = updateSavedChemical.mock.calls[0][1] as any;
    expect(payload.intelligence).toBeTruthy();
    expect(payload.intelligence.registration_number).toBe("99999");
  });
  it("reopening refetches newer approved rates; a failed refetch drops the approved badge", async () => {
    const { rerender, client } = wrap(editor(linked));
    await screen.findByText("Per hectare (1)");
    rerender(tree(client, editor(linked, false)));
    tables.chemical_v3_products.p1 = { ...tables.chemical_v3_products.p1, approved_revision_id: "rev-4" };
    tables.chemical_v3_product_revisions["rev-4"] = { id: "rev-4", product_id: "p1", review_status: "approved", default_rate_options: { per_hectare: [], per_100_litres: [{ id: "z", value: 55, unit: "mL/100 L" }] } };
    rerender(tree(client, editor(linked, true)));
    expect(await screen.findByText("55 mL/100 L")).toBeTruthy();
    expect(screen.queryByText("0.8–1.2 L/ha")).toBeNull();
    rerender(tree(client, editor(linked, false)));
    failNext = true;
    rerender(tree(client, editor(linked, true)));
    expect(await screen.findByTestId("catalogue-error")).toBeTruthy();
    expect(screen.queryByTitle("Approved VineTrack catalogue product")).toBeNull();
    expect(screen.queryByText("55 mL/100 L")).toBeNull();
  });
  it("rejected product shows its product status, not approved", async () => {
    tables.chemical_v3_products.p1 = { ...tables.chemical_v3_products.p1, status: "rejected" };
    wrap(editor(linked));
    expect(await screen.findByText("Catalogue: rejected")).toBeTruthy();
    expect(screen.queryByTitle("Approved VineTrack catalogue product")).toBeNull();
  });
});

describe("Chemical details dialog", () => {
  it("shows the same catalogue rates", async () => {
    wrap(<ChemicalIntelligenceDialog row={linked} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Per 100 litres (2)")).toBeTruthy();
  });
});
