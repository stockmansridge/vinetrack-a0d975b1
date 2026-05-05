// READ-ONLY query helper for saved_spray_presets. No writes.
//
// Schema (docs/supabase-schema.md §3.12):
//   saved_spray_presets: name, water_volume, spray_rate_per_ha,
//     concentration_factor, plus standard sync columns (id, vineyard_id,
//     created_at, updated_at, deleted_at, created_by, updated_by,
//     client_updated_at, sync_version).
//
//   No global/shared preset table — every row is scoped to a single
//   vineyard_id. No operation_type / target / equipment_id / chemical_id
//   columns and no JSONB mix payload — preset is just a water/rate recipe.
import { supabase } from "@/integrations/ios-supabase/client";

export interface SavedSprayPreset {
  id: string;
  vineyard_id: string;
  name?: string | null;
  water_volume?: number | null;
  spray_rate_per_ha?: number | null;
  concentration_factor?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface SavedSprayPresetsQueryResult {
  presets: SavedSprayPreset[];
  source: "vineyard_id" | "empty";
  vineyardCount: number;
  deletedExcluded: number;
  missingName: number;
  missingRate: number;
  // Surfaced for diagnostics: this table has no chemical FKs to resolve.
  linkedChemicalsResolved: number;
  linkedChemicalsUnresolved: number;
}

export async function fetchSavedSprayPresetsForVineyard(
  vineyardId: string,
): Promise<SavedSprayPresetsQueryResult> {
  const res = await supabase
    .from("saved_spray_presets")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) throw res.error;

  const presets = (res.data ?? []) as SavedSprayPreset[];
  return {
    presets,
    source: presets.length ? "vineyard_id" : "empty",
    vineyardCount: presets.length,
    deletedExcluded: 0,
    missingName: presets.filter((p) => !p.name).length,
    missingRate: presets.filter((p) => p.spray_rate_per_ha == null).length,
    linkedChemicalsResolved: 0,
    linkedChemicalsUnresolved: 0,
  };
}
