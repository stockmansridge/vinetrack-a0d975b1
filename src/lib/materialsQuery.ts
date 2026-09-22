// Material Costs data layer (Phase 3, Portal).
//
// Reads and writes ONLY the shared backend tables created by migration 247 on
// the canonical VineTrack (iOS) project: material_catalogue, vineyard_materials,
// work_task_materials. No Portal-specific model, no schema changes.
//
// Rules enforced here:
//   - every vineyard read/write is scoped to the selected vineyard (RLS also
//     enforces this server-side; UI filtering is never the only guard)
//   - work_task_materials rows are FROZEN snapshots: name/category/unit are
//     written at save time and never re-bound to the library afterwards
//   - task-specific unit costs are never pushed back into vineyard_materials
//   - removal uses the existing soft-delete contract (deleted_at)
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import {
  mergeEffectiveMaterials,
  normaliseDecimalInput,
  type EffectiveMaterial,
  type MaterialCatalogueItem,
  type VineyardMaterial,
  type WorkTaskMaterial,
} from "./materialCosts";

const db = () => supabase as any;

export const materialQueryKeys = {
  catalogue: ["material-catalogue"] as const,
  vineyardMaterials: (vineyardId: string | null) => ["vineyard-materials", vineyardId] as const,
  workTaskMaterials: (vineyardId: string | null) =>
    ["work-task-materials", vineyardId] as const,
};

/** Human-readable message for a backend write failure. Never raw PostgREST text. */
export function describeMaterialError(error: unknown, fallback: string): string {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code ?? "";
  const message = String(e?.message ?? "");
  if (code === "42P01" || /relation .* does not exist/i.test(message)) {
    return "Material Costs is not available on this backend yet.";
  }
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return "You no longer have access to this vineyard's materials. Reload and try again.";
  }
  if (code === "23503") {
    return "That material or task no longer exists. Reload and try again.";
  }
  if (code === "23505" || code === "23514") {
    return "That material is not valid for this vineyard.";
  }
  if (code === "PGRST116") {
    return "That record has already been changed or removed. Reload and try again.";
  }
  return fallback;
}

// ------------------------------- catalogue -------------------------------

export async function fetchMaterialCatalogue(): Promise<MaterialCatalogueItem[]> {
  const res = await db()
    .from("material_catalogue")
    .select("id,key,name,category,default_unit,sort_order,is_active")
    .order("sort_order", { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []) as MaterialCatalogueItem[];
}

export async function fetchVineyardMaterials(vineyardId: string): Promise<VineyardMaterial[]> {
  const res = await db()
    .from("vineyard_materials")
    .select(
      "id,vineyard_id,base_material_id,name,category,unit,default_unit_cost,is_active,is_custom,deleted_at,created_at,updated_at",
    )
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) throw res.error;
  return (res.data ?? []) as VineyardMaterial[];
}

export function useMaterialCatalogue(enabled: boolean) {
  return useQuery({
    queryKey: materialQueryKeys.catalogue,
    enabled,
    queryFn: fetchMaterialCatalogue,
    staleTime: 10 * 60 * 1000,
  });
}

export function useVineyardMaterials(vineyardId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: materialQueryKeys.vineyardMaterials(vineyardId),
    enabled: enabled && !!vineyardId,
    queryFn: () => fetchVineyardMaterials(vineyardId!),
    staleTime: 60 * 1000,
  });
}

/** Merged library/selector rows for the selected vineyard. */
export function useEffectiveMaterials(vineyardId: string | null, enabled: boolean) {
  const catalogue = useMaterialCatalogue(enabled);
  const vineyard = useVineyardMaterials(vineyardId, enabled);
  const materials: EffectiveMaterial[] = mergeEffectiveMaterials(
    catalogue.data ?? [],
    vineyard.data ?? [],
  );
  return {
    materials,
    catalogue: catalogue.data ?? [],
    vineyardMaterials: vineyard.data ?? [],
    isLoading: catalogue.isLoading || vineyard.isLoading,
    error: (catalogue.error ?? vineyard.error) as unknown,
  };
}

// ------------------------- vineyard library writes -------------------------

export interface SaveVineyardOverrideInput {
  vineyardId: string;
  /** Catalogue item being overridden. */
  baseMaterialId: string;
  /** Standard identity — kept so the row stays recognisable. */
  name: string;
  category: string;
  unit: string;
  defaultUnitCost: string | null;
  /** Existing override row, when one already exists. */
  vineyardMaterialId?: string | null;
  userId?: string | null;
}

/**
 * Creates or updates the vineyard override for a standard catalogue item.
 * Never duplicates the material_catalogue row and never renames a standard item.
 */
export async function saveVineyardMaterialOverride(
  input: SaveVineyardOverrideInput,
): Promise<VineyardMaterial> {
  const patch = {
    unit: input.unit,
    default_unit_cost: normaliseDecimalInput(input.defaultUnitCost),
    updated_at: new Date().toISOString(),
    updated_by: input.userId ?? null,
  };
  if (input.vineyardMaterialId) {
    const res = await db()
      .from("vineyard_materials")
      .update(patch)
      .eq("id", input.vineyardMaterialId)
      .eq("vineyard_id", input.vineyardId)
      .select()
      .single();
    if (res.error) throw res.error;
    return res.data as VineyardMaterial;
  }
  const res = await db()
    .from("vineyard_materials")
    .insert({
      vineyard_id: input.vineyardId,
      base_material_id: input.baseMaterialId,
      name: input.name,
      category: input.category,
      is_custom: false,
      is_active: true,
      created_by: input.userId ?? null,
      ...patch,
    })
    .select()
    .single();
  if (res.error) throw res.error;
  return res.data as VineyardMaterial;
}

export interface SaveCustomMaterialInput {
  vineyardId: string;
  id?: string | null;
  name: string;
  category: string;
  unit: string;
  defaultUnitCost: string | null;
  userId?: string | null;
}

export async function saveCustomMaterial(
  input: SaveCustomMaterialInput,
): Promise<VineyardMaterial> {
  const patch = {
    name: input.name.trim(),
    category: input.category,
    unit: input.unit.trim(),
    default_unit_cost: normaliseDecimalInput(input.defaultUnitCost),
    updated_at: new Date().toISOString(),
    updated_by: input.userId ?? null,
  };
  if (input.id) {
    const res = await db()
      .from("vineyard_materials")
      .update(patch)
      .eq("id", input.id)
      .eq("vineyard_id", input.vineyardId)
      .select()
      .single();
    if (res.error) throw res.error;
    return res.data as VineyardMaterial;
  }
  const res = await db()
    .from("vineyard_materials")
    .insert({
      vineyard_id: input.vineyardId,
      base_material_id: null,
      is_custom: true,
      is_active: true,
      created_by: input.userId ?? null,
      ...patch,
    })
    .select()
    .single();
  if (res.error) throw res.error;
  return res.data as VineyardMaterial;
}

/** Deactivates / reactivates a vineyard custom material (migration 247 model). */
export async function setCustomMaterialActive(
  vineyardId: string,
  id: string,
  isActive: boolean,
  userId?: string | null,
): Promise<void> {
  const res = await db()
    .from("vineyard_materials")
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    })
    .eq("id", id)
    .eq("vineyard_id", vineyardId);
  if (res.error) throw res.error;
}

// ------------------------ work task material writes ------------------------

export async function fetchWorkTaskMaterials(vineyardId: string): Promise<WorkTaskMaterial[]> {
  const res = await db()
    .from("work_task_materials")
    .select(
      "id,vineyard_id,work_task_id,vineyard_material_id,material_name,category,unit,quantity,unit_cost,total_cost,notes,deleted_at,created_at,updated_at,sync_version",
    )
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) throw res.error;
  return (res.data ?? []) as WorkTaskMaterial[];
}

export function useWorkTaskMaterials(vineyardId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: materialQueryKeys.workTaskMaterials(vineyardId),
    enabled: enabled && !!vineyardId,
    queryFn: () => fetchWorkTaskMaterials(vineyardId!),
    staleTime: 30 * 1000,
  });
}

export interface AddWorkTaskMaterialInput {
  vineyardId: string;
  workTaskId: string;
  /** Provenance: the effective vineyard material row, when one exists. */
  vineyardMaterialId: string | null;
  /** Snapshot fields — frozen at save time. */
  materialName: string;
  category: string;
  unit: string;
  quantity: string;
  unitCost: string;
  userId?: string | null;
}

/**
 * Adds one frozen material line to a work task. total_cost is generated by the
 * backend from quantity × unit_cost, so it is never sent from the Portal.
 */
export async function addWorkTaskMaterial(
  input: AddWorkTaskMaterialInput,
): Promise<WorkTaskMaterial> {
  const res = await db()
    .from("work_task_materials")
    .insert({
      vineyard_id: input.vineyardId,
      work_task_id: input.workTaskId,
      vineyard_material_id: input.vineyardMaterialId,
      material_name: input.materialName,
      category: input.category,
      unit: input.unit,
      quantity: normaliseDecimalInput(input.quantity),
      unit_cost: normaliseDecimalInput(input.unitCost),
      created_by: input.userId ?? null,
    })
    .select()
    .single();
  if (res.error) throw res.error;
  return res.data as WorkTaskMaterial;
}

export interface UpdateWorkTaskMaterialInput {
  vineyardId: string;
  id: string;
  unit: string;
  quantity: string;
  unitCost: string;
  userId?: string | null;
}

/** Updates the EXISTING line — editing never creates a second row. */
export async function updateWorkTaskMaterial(
  input: UpdateWorkTaskMaterialInput,
): Promise<WorkTaskMaterial> {
  const res = await db()
    .from("work_task_materials")
    .update({
      unit: input.unit,
      quantity: normaliseDecimalInput(input.quantity),
      unit_cost: normaliseDecimalInput(input.unitCost),
      updated_at: new Date().toISOString(),
      updated_by: input.userId ?? null,
    })
    .eq("id", input.id)
    .eq("vineyard_id", input.vineyardId)
    .is("deleted_at", null)
    .select()
    .single();
  if (res.error) throw res.error;
  return res.data as WorkTaskMaterial;
}

/** Soft-deletes the task line only. The library material is untouched. */
export async function removeWorkTaskMaterial(
  vineyardId: string,
  id: string,
  userId?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const res = await db()
    .from("work_task_materials")
    .update({ deleted_at: now, updated_at: now, updated_by: userId ?? null })
    .eq("id", id)
    .eq("vineyard_id", vineyardId);
  if (res.error) throw res.error;
}
