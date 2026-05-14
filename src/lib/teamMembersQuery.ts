// Query + write helpers for vineyard_members.operator_category_id.
// Owner/manager only — RLS on iOS Supabase enforces who can update.
import { supabase } from "@/integrations/ios-supabase/client";

export interface VineyardMemberRow {
  id: string;
  vineyard_id: string;
  user_id: string;
  role: string;
  joined_at?: string | null;
  operator_category_id?: string | null;
}

export async function fetchVineyardMembersWithCategory(
  vineyardId: string,
): Promise<VineyardMemberRow[]> {
  const { data, error } = await supabase
    .from("vineyard_members")
    .select("id, vineyard_id, user_id, role, joined_at, operator_category_id")
    .eq("vineyard_id", vineyardId);
  if (error) throw error;
  return (data ?? []) as VineyardMemberRow[];
}

export async function updateMemberOperatorCategory(
  membershipId: string,
  operatorCategoryId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("vineyard_members")
    .update({ operator_category_id: operatorCategoryId })
    .eq("id", membershipId);
  if (error) throw error;
}

export function describeMemberWriteError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/row-level security|permission denied|RLS|42501/i.test(msg)) {
    return "You don't have permission to change operator categories. Only owners and managers can edit.";
  }
  return msg || "Something went wrong. Please try again.";
}
