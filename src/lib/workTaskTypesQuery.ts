// Query + write helpers for the shared work_task_types table on the iOS
// Supabase project. Mirrors the conventions used by operatorCategoriesQuery.
import { supabase } from "@/integrations/ios-supabase/client";

export interface WorkTaskType {
  id: string;
  vineyard_id: string;
  name: string;
  is_default?: boolean | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
}

const nowIso = () => new Date().toISOString();

export async function fetchWorkTaskTypesForVineyard(
  vineyardId: string,
): Promise<WorkTaskType[]> {
  const { data, error } = await supabase
    .from("work_task_types")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as WorkTaskType[];
}

export interface CreateWorkTaskTypeInput {
  vineyard_id: string;
  name: string;
  sort_order?: number | null;
  user_id: string | null;
}

export async function createWorkTaskType(
  input: CreateWorkTaskTypeInput,
): Promise<WorkTaskType> {
  const payload = {
    vineyard_id: input.vineyard_id,
    name: input.name,
    is_default: false,
    sort_order: input.sort_order ?? null,
    created_by: input.user_id,
    updated_by: input.user_id,
    client_updated_at: nowIso(),
    sync_version: 1,
    deleted_at: null,
  };
  const { data, error } = await supabase
    .from("work_task_types")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as WorkTaskType;
}

export interface UpdateWorkTaskTypeInput {
  id: string;
  name?: string;
  sort_order?: number | null;
  user_id: string | null;
  current_sync_version?: number | null;
}

export async function updateWorkTaskType(
  input: UpdateWorkTaskTypeInput,
): Promise<WorkTaskType> {
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const patch: Record<string, unknown> = {
    updated_by: input.user_id,
    client_updated_at: nowIso(),
    sync_version: nextVersion,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

  const { data, error } = await supabase
    .from("work_task_types")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (error) throw error;
  return data as WorkTaskType;
}

export async function softDeleteWorkTaskType(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const rpc = await supabase.rpc("soft_delete_work_task_type", { p_id: id });
  if (!rpc.error) return;
  const nextVersion = (currentSyncVersion ?? 0) + 1;
  const { error } = await supabase
    .from("work_task_types")
    .update({
      deleted_at: nowIso(),
      updated_by: userId,
      client_updated_at: nowIso(),
      sync_version: nextVersion,
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Merge synced rows with hardcoded defaults, case-insensitive dedupe.
 * Synced rows take priority (so renamed/edited types display the synced name).
 */
export function mergeTaskTypeNames(
  synced: WorkTaskType[],
  defaults: string[],
  extra: string[] = [],
): string[] {
  const seen = new Map<string, string>(); // lowerKey -> displayName
  const add = (name: string | null | undefined) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  };
  // Sync first so they win on case/spelling.
  synced
    .slice()
    .sort((a, b) => {
      const sa = a.sort_order ?? 9999;
      const sb = b.sort_order ?? 9999;
      if (sa !== sb) return sa - sb;
      return (a.name ?? "").localeCompare(b.name ?? "");
    })
    .forEach((r) => add(r.name));
  defaults.forEach(add);
  extra.forEach(add);
  return Array.from(seen.values());
}
