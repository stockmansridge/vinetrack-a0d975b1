// Member management RPCs (shared iOS Supabase project, SQL 79).
import { supabase } from "@/integrations/ios-supabase/client";

export type MemberRole = "owner" | "manager" | "supervisor" | "operator";

export async function updateMemberRole(
  membershipId: string,
  newRole: MemberRole,
): Promise<void> {
  const { error } = await supabase.rpc("update_member_role", {
    p_membership_id: membershipId,
    p_new_role: newRole,
  });
  if (error) throw error;
}

export async function updateMemberOperatorCategoryRpc(
  membershipId: string,
  operatorCategoryId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("update_member_worker_type", {
    p_membership_id: membershipId,
    p_worker_type_id: operatorCategoryId,
  });
  if (error) throw error;
}

export async function removeMember(membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_member", {
    p_membership_id: membershipId,
  });
  if (error) throw error;
}

export function describeMemberMgmtError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/last owner/i.test(msg)) return "You can't remove or demote the last owner.";
  if (/42501|permission|RLS/i.test(msg))
    return "You don't have permission to perform this action.";
  return msg || "Something went wrong. Please try again.";
}
