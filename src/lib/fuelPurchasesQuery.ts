// Query + write helpers for `fuel_purchases` on the iOS Supabase project.
//
// Confirmed columns (probed against the iOS Supabase REST endpoint):
//   id, vineyard_id, volume_litres, total_cost, date,
//   created_at, updated_at, deleted_at,
//   created_by, updated_by, client_updated_at, sync_version
//
// No notes / supplier / fuel_type / receipt / archive flag columns exist.
// No soft_delete_fuel_purchase RPC is deployed — soft-delete writes
// `deleted_at` directly via update.
import { supabase } from "@/integrations/ios-supabase/client";

export interface FuelPurchase {
  id: string;
  vineyard_id: string;
  volume_litres?: number | null;
  total_cost?: number | null;
  date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
}

export async function fetchFuelPurchasesForVineyard(
  vineyardId: string,
): Promise<FuelPurchase[]> {
  const { data, error } = await supabase
    .from("fuel_purchases")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as FuelPurchase[];
}

const nowIso = () => new Date().toISOString();

export interface FuelPurchaseWriteInput {
  vineyard_id: string;
  date: string;
  volume_litres: number;
  total_cost: number;
  user_id: string | null;
}

export async function createFuelPurchase(
  input: FuelPurchaseWriteInput,
): Promise<FuelPurchase> {
  const ts = nowIso();
  const { data, error } = await supabase
    .from("fuel_purchases")
    .insert({
      vineyard_id: input.vineyard_id,
      date: input.date,
      volume_litres: input.volume_litres,
      total_cost: input.total_cost,
      created_by: input.user_id,
      updated_by: input.user_id,
      client_updated_at: ts,
      sync_version: 1,
      deleted_at: null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as FuelPurchase;
}

export interface UpdateFuelPurchaseInput {
  id: string;
  date: string;
  volume_litres: number;
  total_cost: number;
  user_id: string | null;
  current_sync_version?: number | null;
}

export async function updateFuelPurchase(
  input: UpdateFuelPurchaseInput,
): Promise<FuelPurchase> {
  const ts = nowIso();
  const { data, error } = await supabase
    .from("fuel_purchases")
    .update({
      date: input.date,
      volume_litres: input.volume_litres,
      total_cost: input.total_cost,
      updated_by: input.user_id,
      client_updated_at: ts,
      sync_version: (input.current_sync_version ?? 0) + 1,
    })
    .eq("id", input.id)
    .select()
    .single();
  if (error) throw error;
  return data as FuelPurchase;
}

export async function softDeleteFuelPurchase(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const ts = nowIso();
  const { error } = await supabase
    .from("fuel_purchases")
    .update({
      deleted_at: ts,
      updated_by: userId,
      client_updated_at: ts,
      sync_version: (currentSyncVersion ?? 0) + 1,
    })
    .eq("id", id);
  if (error) throw error;
}

export function describeFuelWriteError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/row-level security|permission denied|RLS|42501/i.test(msg)) {
    return "You don't have permission to make this change. Only owners, managers, or supervisors can edit fuel purchases.";
  }
  return msg || "Something went wrong. Please try again.";
}
