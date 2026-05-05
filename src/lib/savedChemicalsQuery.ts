// READ-ONLY query helper for saved_chemicals. No writes.
//
// Schema (docs/supabase-schema.md §3.12):
//   saved_chemicals: name, rate_per_ha, unit, chemical_group, use,
//     manufacturer, restrictions, notes, crop, problem, active_ingredient,
//     rates jsonb, purchase jsonb, label_url, mode_of_action,
//     plus standard sync columns (id, vineyard_id, created_at, updated_at,
//     deleted_at, created_by, updated_by, client_updated_at, sync_version).
//
//   No global/shared chemical library table — every row is scoped to a
//   single vineyard_id. No withholding_period / re_entry_interval column
//   (these typically live inside `restrictions` free text).
import { supabase } from "@/integrations/ios-supabase/client";

export interface SavedChemical {
  id: string;
  vineyard_id: string;
  name?: string | null;
  rate_per_ha?: number | null;
  unit?: string | null;
  chemical_group?: string | null;
  use?: string | null;
  manufacturer?: string | null;
  restrictions?: string | null;
  notes?: string | null;
  crop?: string | null;
  problem?: string | null;
  active_ingredient?: string | null;
  rates?: any;
  purchase?: any;
  label_url?: string | null;
  mode_of_action?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface SavedChemicalsQueryResult {
  chemicals: SavedChemical[];
  source: "vineyard_id" | "empty";
  vineyardCount: number;
  deletedExcluded: number;
  missingName: number;
  missingRate: number;
}

export async function fetchSavedChemicalsForVineyard(
  vineyardId: string,
): Promise<SavedChemicalsQueryResult> {
  const res = await supabase
    .from("saved_chemicals")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) throw res.error;

  const chemicals = (res.data ?? []) as SavedChemical[];
  return {
    chemicals,
    source: chemicals.length ? "vineyard_id" : "empty",
    vineyardCount: chemicals.length,
    deletedExcluded: 0,
    missingName: chemicals.filter((c) => !c.name).length,
    missingRate: chemicals.filter((c) => c.rate_per_ha == null).length,
  };
}
