// Edit Chemical flow parity with iOS/Android.
//
//   Add    = identify/search (ChemicalAILookup mounted)
//   Edit   = edit the saved record directly (NO lookup mount, no network)
//   Verify = explicit "Check for updates" only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.fn();
const from = vi.fn(() => {
  throw new Error("unexpected database access");
});

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (...a: unknown[]) => from(...(a as [])),
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (...a: unknown[]) => from(...(a as [])),
  },
}));
vi.mock("@/lib/masterChemicals", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchMasterChemical: vi.fn(async () => null),
}));
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ currentCountry: "AU", currentVineyardId: "v1" }),
}));
vi.mock("@/lib/permissions", () => ({ useCanSeeCosts: () => true }));

const updateSavedChemical = vi.fn(async (id: string, input: unknown) => ({
  id,
  ...(input as Record<string, unknown>),
}));
const createSavedChemical = vi.fn(async (input: unknown) => ({ id: "new-1", ...(input as object) }));

vi.mock("@/lib/savedChemicalsQuery", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchSavedChemicalsForVineyard: vi.fn(async () => []),
  updateSavedChemical: (...a: [string, unknown]) => updateSavedChemical(...a),
  createSavedChemical: (...a: [unknown]) => createSavedChemical(...a),
}));

import { ChemicalEditor } from "@/components/chemicals/ChemicalEditorSheet";
import type { SavedChemical } from "@/lib/savedChemicalsQuery";

const existing = {
  id: "chem-1",
  vineyard_id: "v1",
  name: "Thiovit Jet",
  active_ingredient: "Sulfur 800 g/kg",
  manufacturer: "Syngenta",
  use: "Fungicide",
  product_category: "fungicide",
  unit: "kg/ha",
  rate_per_ha: 3,
  notes: "Old notes",
  restrictions: "",
  label_url: "",
} as unknown as SavedChemical;

function renderEditor(initial: SavedChemical | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChemicalEditor
        open
        onOpenChange={() => {}}
        initial={initial}
        vineyardId="v1"
        existingLibrary={[]}
        canSeeCosts
        onSaved={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  from.mockClear();
  updateSavedChemical.mockClear();
  createSavedChemical.mockClear();
});

describe("Edit existing chemical", () => {
  it("opens directly on the populated editor without mounting the lookup", async () => {
    renderEditor(existing);
    expect(await screen.findByDisplayValue("Thiovit Jet")).toBeTruthy();
    // Lookup search field belongs to Add only.
    expect(screen.queryByLabelText("Search product")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lookup" })).toBeNull();
    // No search-first placeholder copy.
    expect(screen.queryByText(/Search for the registered product/i)).toBeNull();
  });

  it("performs zero chemical-search network calls when Edit is opened", async () => {
    renderEditor(existing);
    await screen.findByDisplayValue("Thiovit Jet");
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
  });

  it("saves edited notes against the same chemical id", async () => {
    renderEditor(existing);
    const notes = await screen.findByDisplayValue("Old notes");
    fireEvent.change(notes, { target: { value: "New notes" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/i }));
    await waitFor(() => expect(updateSavedChemical).toHaveBeenCalled());
    const [id, payload] = updateSavedChemical.mock.calls[0] as [string, any];
    expect(id).toBe("chem-1");
    expect(payload.notes).toBe("New notes");
    expect(createSavedChemical).not.toHaveBeenCalled();
  });

  it("exposes an explicit Check for updates action that opens re-verify", async () => {
    renderEditor(existing);
    fireEvent.click(await screen.findByRole("button", { name: /Check for updates/i }));
    expect(await screen.findByText("Re-verify chemical")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cancelling re-verify returns to the unchanged edit draft and writes nothing", async () => {
    renderEditor(existing);
    fireEvent.click(await screen.findByRole("button", { name: /Check for updates/i }));
    await screen.findByText("Re-verify chemical");
    const closes = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closes[closes.length - 1]);
    await waitFor(() => expect(screen.queryByText("Re-verify chemical")).toBeNull());
    expect(await screen.findByDisplayValue("Thiovit Jet")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    expect(updateSavedChemical).not.toHaveBeenCalled();
  });
});

describe("New chemical", () => {
  it("still opens the search-first lookup flow", async () => {
    renderEditor(null);
    expect(await screen.findByLabelText("Search product")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Check for updates/i })).toBeNull();
  });
});
