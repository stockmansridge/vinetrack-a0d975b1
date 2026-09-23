import { describe, it, expect } from "vitest";
import {
  groupMaterialsByCategory,
  materialLineSummary,
  materialTotalForTask,
  materialTotalNumber,
  mergeEffectiveMaterials,
  multiplyDecimals,
  normaliseDecimalInput,
  isPositiveDecimal,
  searchMaterials,
  selectableMaterials,
  sumDecimals,
  type MaterialCatalogueItem,
  type VineyardMaterial,
  type WorkTaskMaterial,
} from "@/lib/materialCosts";
import { materialCostsVisible } from "@/lib/materialCostsAccess";
import { ACTIVITIES, accessibleViews } from "@/lib/navigationConfig";
import { getAllowedRoles } from "@/lib/rolePermissions";

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
  {
    id: "cat-post",
    key: "line_post",
    name: "Line/Trellis Post",
    category: "Trellis",
    default_unit: "Each",
    sort_order: 20,
    is_active: true,
  },
];

const viewer = (isSystemAdmin: boolean) => ({
  role: "owner" as const,
  isSystemAdmin,
  irrigation: { records: true, reports: true, setup: true },
  hasAccountBilling: false,
  loading: false,
});

describe("Material Costs access gate", () => {
  it("shows Material Library to a System Admin only", () => {
    const settings = ACTIVITIES.find((a) => a.id === "settings")!;
    const adminViews = accessibleViews(settings, viewer(true)).map((v) => v.id);
    const userViews = accessibleViews(settings, viewer(false)).map((v) => v.id);
    expect(adminViews).toContain("settings.materialLibrary");
    expect(userViews).not.toContain("settings.materialLibrary");
    expect(materialCostsVisible({ isSystemAdmin: true })).toBe(true);
    expect(materialCostsVisible({ isSystemAdmin: false })).toBe(false);
  });

  it("keeps the Material Library route owner/manager restricted", () => {
    expect(getAllowedRoles("/setup/materials")).toEqual(["owner", "manager"]);
  });

  it("no longer gates Work Task Materials on System Admin status", () => {
    // The temporary gate was removed: anyone who can edit a Work Task sees
    // Materials, Material Total and the roll-up. Only the Material Library
    // stays gated. Guard the regression at the source level.
    const source = readFileSync(
      new URL("../pages/setup/WorkTasksPage.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("useMaterialCostsEnabled");
    expect(source).not.toContain("materialCostsAccess");
  });
});

describe("merged material library", () => {
  it("loads the standard catalogue including Gripple / Wire Joiner-Tensioner", () => {
    const merged = mergeEffectiveMaterials(catalogue, []);
    const names = merged.map((m) => m.name);
    expect(names).toContain("Gripple / Wire Joiner-Tensioner");
    expect(merged.every((m) => !m.isCustom)).toBe(true);
  });

  it("merges a vineyard override into the standard row without duplicating it", () => {
    const override: VineyardMaterial = {
      id: "vm-1",
      vineyard_id: "v1",
      base_material_id: "cat-grip",
      name: "Gripple / Wire Joiner-Tensioner",
      category: "Fasteners & Training",
      unit: "Pack",
      default_unit_cost: "1.82",
      is_custom: false,
      is_active: true,
    };
    const merged = mergeEffectiveMaterials(catalogue, [override]);
    const grip = merged.filter((m) => m.name === "Gripple / Wire Joiner-Tensioner");
    expect(grip).toHaveLength(1);
    expect(grip[0].unit).toBe("Pack");
    expect(grip[0].defaultUnitCost).toBe("1.82");
    expect(grip[0].vineyardMaterialId).toBe("vm-1");
    expect(merged).toHaveLength(catalogue.length);
  });

  it("keeps custom materials inside their own vineyard and drops deactivated ones from selection", () => {
    const vineyardA: VineyardMaterial[] = [
      {
        id: "vm-a",
        vineyard_id: "A",
        base_material_id: null,
        name: "Estate Vine Guard",
        category: "Vine Establishment",
        unit: "Each",
        default_unit_cost: "0.75",
        is_custom: true,
        is_active: true,
      },
      {
        id: "vm-a2",
        vineyard_id: "A",
        base_material_id: null,
        name: "Retired Clip",
        category: "Trellis",
        unit: "Each",
        default_unit_cost: "0.10",
        is_custom: true,
        is_active: false,
      },
    ];
    const mergedA = mergeEffectiveMaterials(catalogue, vineyardA);
    const mergedB = mergeEffectiveMaterials(catalogue, []);
    expect(mergedA.map((m) => m.name)).toContain("Estate Vine Guard");
    expect(mergedB.map((m) => m.name)).not.toContain("Estate Vine Guard");

    const selectableA = selectableMaterials(mergedA).map((m) => m.name);
    expect(selectableA).toContain("Estate Vine Guard");
    expect(selectableA).not.toContain("Retired Clip");

    // Reactivation restores selection.
    const reactivated = mergeEffectiveMaterials(
      catalogue,
      vineyardA.map((v) => ({ ...v, is_active: true })),
    );
    expect(selectableMaterials(reactivated).map((m) => m.name)).toContain("Retired Clip");
  });

  it("searches by name and groups by the existing categories", () => {
    const merged = mergeEffectiveMaterials(catalogue, []);
    expect(searchMaterials(merged, "gripple").map((m) => m.name)).toEqual([
      "Gripple / Wire Joiner-Tensioner",
    ]);
    const groups = groupMaterialsByCategory(merged).map((g) => g.category);
    expect(groups).toEqual(["Trellis", "Fasteners & Training"]);
  });

  it("never returns a deleted vineyard row", () => {
    const merged = mergeEffectiveMaterials(catalogue, [
      {
        id: "vm-del",
        vineyard_id: "A",
        base_material_id: null,
        name: "Deleted material",
        unit: "Each",
        is_custom: true,
        is_active: true,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(merged.map((m) => m.name)).not.toContain("Deleted material");
  });
});

describe("decimal-safe material maths", () => {
  it("accepts decimal quantities and rejects zero or negative", () => {
    expect(normaliseDecimalInput("42.5")).toBe("42.5");
    expect(normaliseDecimalInput("0.500")).toBe("0.5");
    expect(normaliseDecimalInput("abc")).toBeNull();
    expect(isPositiveDecimal("0.5")).toBe(true);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("-3")).toBe(false);
  });

  it("computes quantity x unit cost without floating-point drift", () => {
    expect(multiplyDecimals("12", "1.82")).toBe("21.84");
    expect(multiplyDecimals("0.5", "0.07")).toBe("0.04");
    expect(multiplyDecimals("3", "0.145")).toBe("0.44");
    // 0.1 * 3 is 0.30000000000000004 in binary floating point.
    expect(multiplyDecimals("0.1", "3")).toBe("0.3");
    expect(sumDecimals(["0.1", "0.2"])).toBe("0.3");
  });

  it("sums multiple active lines and ignores removed lines", () => {
    const lines: WorkTaskMaterial[] = [
      {
        id: "1",
        vineyard_id: "v",
        work_task_id: "t",
        material_name: "Gripple / Wire Joiner-Tensioner",
        quantity: "12",
        unit: "Each",
        unit_cost: "1.82",
        total_cost: "21.84",
      },
      {
        id: "2",
        vineyard_id: "v",
        work_task_id: "t",
        material_name: "Line/Trellis Post",
        quantity: "9",
        unit: "Each",
        unit_cost: "7.00",
        total_cost: "63.00",
      },
      {
        id: "3",
        vineyard_id: "v",
        work_task_id: "t",
        material_name: "Removed",
        quantity: "5",
        unit: "Each",
        unit_cost: "10",
        total_cost: "50",
        deleted_at: "2026-01-02T00:00:00Z",
      },
    ];
    expect(materialTotalForTask(lines)).toBe("84.84");
    expect(materialTotalNumber(lines)).toBe(84.84);
  });

  it("gives an existing task with no materials a zero material total", () => {
    expect(materialTotalForTask([])).toBe("0");
    expect(materialTotalNumber([])).toBe(0);
  });

  it("formats the compact line summary", () => {
    expect(
      materialLineSummary(
        { quantity: "12", unit: "Each", unit_cost: "1.82" },
        (n) => `$${n.toFixed(2)}`,
      ),
    ).toBe("12 Each × $1.82");
  });

  it("keeps a historical snapshot unchanged when the library is repriced", () => {
    const line: WorkTaskMaterial = {
      id: "1",
      vineyard_id: "v",
      work_task_id: "t",
      vineyard_material_id: "vm-1",
      material_name: "Gripple / Wire Joiner-Tensioner",
      category: "Fasteners & Training",
      unit: "Each",
      quantity: "12",
      unit_cost: "1.82",
      total_cost: "21.84",
    };
    // Library reprices and the custom material is deactivated afterwards.
    const repriced = mergeEffectiveMaterials(catalogue, [
      {
        id: "vm-1",
        vineyard_id: "v",
        base_material_id: "cat-grip",
        unit: "Pack",
        default_unit_cost: "9.99",
        is_active: false,
        is_custom: false,
      },
    ]);
    expect(repriced.find((m) => m.catalogueId === "cat-grip")?.defaultUnitCost).toBe("9.99");
    // The task line still renders and totals from its own snapshot.
    expect(line.unit_cost).toBe("1.82");
    expect(materialTotalForTask([line])).toBe("21.84");
  });
});
