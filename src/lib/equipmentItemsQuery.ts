// Query + write helpers for the shared `equipment_items` table on the iOS
// Supabase project. Vineyard-scoped, soft-delete only.
//
// Schema assumptions (confirmed by Rork):
//   public.equipment_items: id, vineyard_id, category ('other' for now),
//     name, sort_order, created_at, updated_at, deleted_at,
//     created_by, updated_by, client_updated_at, sync_version
//
// Soft-delete RPC: soft_delete_equipment_item(p_id) — falls back to a
// direct deleted_at update if the RPC is not yet deployed.
import { supabase } from "@/integrations/ios-supabase/client";

export type EquipmentCategory = "other";

export interface EquipmentItem {
  id: string;
  vineyard_id: string;
  category: EquipmentCategory | string;
  name: string;
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

export async function fetchEquipmentItemsForVineyard(
  vineyardId: string,
  category: EquipmentCategory = "other",
): Promise<EquipmentItem[]> {
  const { data, error } = await supabase
    .from("equipment_items")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .eq("category", category)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as EquipmentItem[];
}

export interface CreateEquipmentItemInput {
  vineyard_id: string;
  name: string;
  category?: EquipmentCategory;
  sort_order?: number | null;
  user_id: string | null;
}

export async function createEquipmentItem(
  input: CreateEquipmentItemInput,
): Promise<EquipmentItem> {
  const payload = {
    vineyard_id: input.vineyard_id,
    category: input.category ?? "other",
    name: input.name,
    sort_order: input.sort_order ?? null,
    created_by: input.user_id,
    updated_by: input.user_id,
    client_updated_at: nowIso(),
    sync_version: 1,
    deleted_at: null,
  };
  const { data, error } = await supabase
    .from("equipment_items")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as EquipmentItem;
}

export interface UpdateEquipmentItemInput {
  id: string;
  name?: string;
  sort_order?: number | null;
  user_id: string | null;
  current_sync_version?: number | null;
}

export async function updateEquipmentItem(
  input: UpdateEquipmentItemInput,
): Promise<EquipmentItem> {
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const patch: Record<string, unknown> = {
    updated_by: input.user_id,
    client_updated_at: nowIso(),
    sync_version: nextVersion,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

  const { data, error } = await supabase
    .from("equipment_items")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (error) throw error;
  return data as EquipmentItem;
}

export async function softDeleteEquipmentItem(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const rpc = await supabase.rpc("soft_delete_equipment_item", { p_id: id });
  if (!rpc.error) return;
  const nextVersion = (currentSyncVersion ?? 0) + 1;
  const { error } = await supabase
    .from("equipment_items")
    .update({
      deleted_at: nowIso(),
      updated_by: userId,
      client_updated_at: nowIso(),
      sync_version: nextVersion,
    })
    .eq("id", id);
  if (error) throw error;
}

// Lightweight selectors for the maintenance Item / Machine grouped picker.
export interface EquipmentSelectorOption {
  id: string;
  name: string;
  source: "tractor" | "spray_equipment" | "other";
}

export interface EquipmentSelectorGroups {
  tractors: EquipmentSelectorOption[];
  sprayEquipment: EquipmentSelectorOption[];
  otherItems: EquipmentSelectorOption[];
}

export async function fetchEquipmentSelectorOptions(
  vineyardId: string,
): Promise<EquipmentSelectorGroups> {
  const [tractors, spray, other] = await Promise.all([
    supabase
      .from("tractors")
      .select("id,name")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null),
    supabase
      .from("spray_equipment")
      .select("id,name")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null),
    fetchEquipmentItemsForVineyard(vineyardId, "other"),
  ]);
  if (tractors.error) throw tractors.error;
  if (spray.error) throw spray.error;

  const map = (
    rows: { id: string; name: string | null }[],
    source: EquipmentSelectorOption["source"],
  ): EquipmentSelectorOption[] =>
    rows
      .filter((r) => (r.name ?? "").trim().length > 0)
      .map((r) => ({ id: r.id, name: r.name as string, source }))
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    tractors: map((tractors.data ?? []) as any[], "tractor"),
    sprayEquipment: map((spray.data ?? []) as any[], "spray_equipment"),
    otherItems: map(
      other.map((o) => ({ id: o.id, name: o.name })),
      "other",
    ),
  };
}
