// Query + write helpers for operator_categories on the iOS Supabase project.
//
// Schema (docs/supabase-schema.md §3.12):
//   operator_categories: name, cost_per_hour, plus standard sync columns
//   (id, vineyard_id, created_at, updated_at, deleted_at, created_by,
//   updated_by, client_updated_at, sync_version).
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
  client_updated_at?: string | null;
  sync_version?: number | null;
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
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[operatorCategories] fetched", {
      vineyardId,
      count: categories.length,
      rows: categories.map((c) => ({
        id: c.id,
        name: c.name,
        cost_per_hour: c.cost_per_hour,
        vineyard_id: c.vineyard_id,
        deleted_at: c.deleted_at,
      })),
    });
  }
  return {
    categories,
    source: categories.length ? "vineyard_id" : "empty",
    vineyardCount: categories.length,
    deletedExcluded: 0,
    missingName: categories.filter((c) => !c.name).length,
    missingCost: categories.filter((c) => c.cost_per_hour == null).length,
  };
}

export interface CreateOperatorCategoryInput {
  vineyard_id: string;
  name: string;
  cost_per_hour: number | null;
  user_id: string | null;
}

export async function createOperatorCategory(
  input: CreateOperatorCategoryInput,
): Promise<OperatorCategory> {
  const now = new Date().toISOString();
  const payload = {
    vineyard_id: input.vineyard_id,
    name: input.name,
    cost_per_hour: input.cost_per_hour,
    created_by: input.user_id,
    updated_by: input.user_id,
    client_updated_at: now,
    sync_version: 1,
    deleted_at: null,
  };
  const { data, error } = await supabase
    .from("operator_categories")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as OperatorCategory;
}

export interface UpdateOperatorCategoryInput {
  id: string;
  name?: string;
  cost_per_hour?: number | null;
  user_id: string | null;
  current_sync_version?: number | null;
}

export async function updateOperatorCategory(
  input: UpdateOperatorCategoryInput,
): Promise<OperatorCategory> {
  const now = new Date().toISOString();
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const patch: Record<string, unknown> = {
    updated_by: input.user_id,
    client_updated_at: now,
    sync_version: nextVersion,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.cost_per_hour !== undefined) patch.cost_per_hour = input.cost_per_hour;

  const { data, error } = await supabase
    .from("operator_categories")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (error) throw error;
  return data as OperatorCategory;
}

export async function softDeleteOperatorCategory(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  // Prefer RPC if it exists in the iOS project.
  const rpc = await supabase.rpc("soft_delete_operator_category", { p_id: id });
  if (!rpc.error) return;

  const now = new Date().toISOString();
  const nextVersion = (currentSyncVersion ?? 0) + 1;
  const { error } = await supabase
    .from("operator_categories")
    .update({
      deleted_at: now,
      updated_by: userId,
      client_updated_at: now,
      sync_version: nextVersion,
    })
    .eq("id", id);
  if (error) throw error;
}
