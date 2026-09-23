// Focused tests for the Material Unit dropdown parity change.
//
// iOS/Android pick the Material Unit from a fixed list; the Portal must offer
// the same six options in the Work Task editor and the Material Library while
// keeping historical non-standard text units representable.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MATERIAL_UNIT_SUGGESTIONS,
  materialUnitOptions,
  mergeEffectiveMaterials,
  type MaterialCatalogueItem,
  type VineyardMaterial,
  type WorkTaskMaterial,
} from "@/lib/materialCosts";

const addWorkTaskMaterial = vi.fn().mockResolvedValue({});
const updateWorkTaskMaterial = vi.fn().mockResolvedValue({});
const removeWorkTaskMaterial = vi.fn().mockResolvedValue(undefined);
const saveCustomMaterial = vi.fn().mockResolvedValue({});
const saveVineyardMaterialOverride = vi.fn().mockResolvedValue({});
const setCustomMaterialActive = vi.fn().mockResolvedValue(undefined);
const useEffectiveMaterials = vi.fn();

vi.mock("@/lib/materialsQuery", () => ({
  addWorkTaskMaterial: (...a: unknown[]) => addWorkTaskMaterial(...a),
  updateWorkTaskMaterial: (...a: unknown[]) => updateWorkTaskMaterial(...a),
  removeWorkTaskMaterial: (...a: unknown[]) => removeWorkTaskMaterial(...a),
  saveCustomMaterial: (...a: unknown[]) => saveCustomMaterial(...a),
  saveVineyardMaterialOverride: (...a: unknown[]) => saveVineyardMaterialOverride(...a),
  setCustomMaterialActive: (...a: unknown[]) => setCustomMaterialActive(...a),
  useEffectiveMaterials: (...a: unknown[]) => useEffectiveMaterials(...a),
  describeMaterialError: (_e: unknown, fallback: string) => fallback,
  materialQueryKeys: {
    catalogue: ["material-catalogue"],
    vineyardMaterials: (id: string | null) => ["vineyard-materials", id],
    workTaskMaterials: (id: string | null) => ["work-task-materials", id],
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: "v1" }),
}));

vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({ currency: (n: number) => `$${n.toFixed(2)}` }),
}));

vi.mock("@/lib/materialCostsAccess", () => ({
  useMaterialCostsEnabled: () => ({ enabled: true, loading: false }),
}));

import { WorkTaskMaterialsSection } from "@/components/work-tasks/WorkTaskMaterialsSection";
import MaterialLibraryPage from "@/pages/setup/MaterialLibraryPage";

const SIX = ["Each", "Metre", "Roll", "Pack", "Box", "Bag"];

const catalogue: MaterialCatalogueItem[] = [
  {
    id: "cat-grip",
    key: "gripple",
    name: "Gripple / Wire Joiner-Tensioner",
    category: "Fasteners & Training",
    default_unit: "Each",
    sort_order: 10,
    is_active: true,
  },
];

const historicalCustom: VineyardMaterial = {
  id: "vm-hist",
  vineyard_id: "v1",
  base_material_id: null,
  name: "Old Skein Material",
  category: "Trellis",
  unit: "Skein",
  default_unit_cost: "0.50",
  is_custom: true,
  is_active: true,
};

function effectiveMaterials() {
  return mergeEffectiveMaterials(catalogue, [historicalCustom]);
}

function mockMaterials() {
  const materials = effectiveMaterials();
  useEffectiveMaterials.mockReturnValue({
    materials,
    catalogue,
    vineyardMaterials: [historicalCustom],
    isLoading: false,
    error: null,
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function unitSelect(id: string): HTMLSelectElement {
  return document.getElementById(id) as HTMLSelectElement;
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.value);
}

const money = (n: number) => `$${n.toFixed(2)}`;

const historicalLine: WorkTaskMaterial = {
  id: "line-1",
  vineyard_id: "v1",
  work_task_id: "t1",
  material_name: "Old Skein Material",
  category: "Trellis",
  unit: "Skein",
  quantity: "4",
  unit_cost: "0.50",
  total_cost: "2.00",
};

describe("materialUnitOptions", () => {
  it("matches the shared mobile list exactly", () => {
    expect(MATERIAL_UNIT_SUGGESTIONS).toEqual(SIX);
    expect(materialUnitOptions("Each")).toEqual(SIX);
    expect(materialUnitOptions("")).toEqual(SIX);
    expect(materialUnitOptions(null)).toEqual(SIX);
  });

  it("keeps a historical non-standard unit representable", () => {
    expect(materialUnitOptions("Skein")).toEqual([...SIX, "Skein"]);
  });
});

describe("Work Task material editor unit dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaterials();
  });

  it("offers all six units and pre-selects the material default when adding", async () => {
    render(
      <WorkTaskMaterialsSection
        vineyardId="v1"
        workTaskId="t1"
        lines={[]}
        canSeeCosts
        money={money}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: /Add Material/i }));
    fireEvent.click(await screen.findByText("Gripple / Wire Joiner-Tensioner"));
    const select = unitSelect("mat-unit");
    expect(optionValues(select)).toEqual(SIX);
    expect(select.value).toBe("Each");

    fireEvent.change(select, { target: { value: "Pack" } });
    fireEvent.change(document.getElementById("mat-qty")!, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /Save material/i }));
    await waitFor(() =>
      expect(addWorkTaskMaterial).toHaveBeenCalledWith(
        expect.objectContaining({ unit: "Pack" }),
      ),
    );
  });

  it("keeps a historical snapshot unit selectable and saves the chosen text unchanged", async () => {
    render(
      <WorkTaskMaterialsSection
        vineyardId="v1"
        workTaskId="t1"
        lines={[historicalLine]}
        canSeeCosts
        money={money}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Old Skein Material" }));
    const select = unitSelect("mat-unit");
    expect(optionValues(select)).toEqual([...SIX, "Skein"]);
    expect(select.value).toBe("Skein");

    fireEvent.change(select, { target: { value: "Bag" } });
    fireEvent.click(screen.getByRole("button", { name: /Save material/i }));
    // The frozen task line is updated in place; the library is untouched.
    await waitFor(() =>
      expect(updateWorkTaskMaterial).toHaveBeenCalledWith(
        expect.objectContaining({ id: "line-1", unit: "Bag" }),
      ),
    );
    expect(saveVineyardMaterialOverride).not.toHaveBeenCalled();
    expect(saveCustomMaterial).not.toHaveBeenCalled();
  });
});

describe("Material Library unit dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaterials();
  });

  it("offers all six units with the effective unit pre-selected for a standard override", async () => {
    render(<MaterialLibraryPage />, { wrapper });
    fireEvent.click(await screen.findByText("Gripple / Wire Joiner-Tensioner"));
    const select = unitSelect("lib-unit");
    expect(optionValues(select)).toEqual(SIX);
    expect(select.value).toBe("Each");

    fireEvent.change(select, { target: { value: "Metre" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveVineyardMaterialOverride).toHaveBeenCalledWith(
        expect.objectContaining({ baseMaterialId: "cat-grip", unit: "Metre" }),
      ),
    );
  });

  it("keeps a historical custom unit representable and saves the selected text unchanged", async () => {
    render(<MaterialLibraryPage />, { wrapper });
    await screen.findByText("Old Skein Material");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const select = unitSelect("lib-unit");
    expect(optionValues(select)).toEqual([...SIX, "Skein"]);
    expect(select.value).toBe("Skein");

    fireEvent.change(select, { target: { value: "Roll" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveCustomMaterial).toHaveBeenCalledWith(
        expect.objectContaining({ id: "vm-hist", unit: "Roll" }),
      ),
    );
  });
});
