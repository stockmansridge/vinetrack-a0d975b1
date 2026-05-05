// READ-ONLY query helper for operator_categories. No writes.
//
// Schema (docs/supabase-schema.md §3.12):
//   operator_categories: name, cost_per_hour, plus standard sync columns
//   (id, vineyard_id, created_at, updated_at, deleted_at, created_by,
//   updated_by, client_updated_at, sync_version).
//
//   No global/shared rows, no description/sort_order/colour/icon columns,
//   and no foreign key from operators back to a category — we cannot
//   safely count linked operators without inventing a join.
import { supabase } from "@/integrations/ios-supabase/client";

export interface OperatorCategory {
  id: string;
  vineyard_id: string;
  name?: string | null;
  cost_per_hour?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface OperatorCategoriesQueryResult {
  categories: OperatorCategory[];
  source: "vineyard_id" | "empty";
  vineyardCount: number;
  deletedExcluded: number;
  missingName: number;
  missingCost: number;
}

export async function fetchOperatorCategoriesForVineyard(
  vineyardId: string,
): Promise<OperatorCategoriesQueryResult> {
  const res = await supabase
    .from("operator_categories")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) throw res.error;

  const categories = (res.data ?? []) as OperatorCategory[];
  return {
    categories,
    source: categories.length ? "vineyard_id" : "empty",
    vineyardCount: categories.length,
    deletedExcluded: 0,
    missingName: categories.filter((c) => !c.name).length,
    missingCost: categories.filter((c) => c.cost_per_hour == null).length,
  };
}
