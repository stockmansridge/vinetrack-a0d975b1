// Member management RPCs (shared iOS Supabase project).
// Live signatures (verified against the deployed schema cache):
//   update_member_role(p_vineyard_id uuid, p_user_id uuid, p_role text)
//   update_member_worker_type(p_vineyard_id uuid, p_user_id uuid, p_worker_type_id uuid)
import { supabase } from "@/integrations/ios-supabase/client";

export type MemberRole = "owner" | "manager" | "supervisor" | "operator";

export interface MemberKey {
  vineyardId: string;
  userId: string;
}

interface MembershipRow {
  vineyard_id?: string | null;
  user_id?: string | null;
  role?: string | null;
  worker_type_id?: string | null;
}

function firstRow(data: unknown): MembershipRow | null {
  if (Array.isArray(data)) return (data[0] as MembershipRow) ?? null;
  if (data && typeof data === "object") return data as MembershipRow;
  return null;
}

/** Read the saved membership row so a write can be confirmed. */
async function readMembership({ vineyardId, userId }: MemberKey): Promise<MembershipRow | null> {
  const { data, error } = await supabase
    .from("vineyard_members")
    .select("vineyard_id, user_id, role, worker_type_id")
    .eq("vineyard_id", vineyardId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as MembershipRow) ?? null;
}

/** Confirm the membership returned (or re-read) matches what was requested. */
async function confirmMembership(
  key: MemberKey,
  data: unknown,
  check: (row: MembershipRow) => boolean,
  what: string,
): Promise<MembershipRow> {
  let row = firstRow(data);
  if (row && (row.user_id == null || row.vineyard_id == null)) row = null;
  if (row && (row.user_id !== key.userId || row.vineyard_id !== key.vineyardId)) {
    throw new Error(`The server returned a different membership while saving ${what}.`);
  }
  if (!row) row = await readMembership(key);
  if (!row) throw new Error(`Membership not found — ${what} was not saved.`);
  if (!check(row)) throw new Error(`The saved ${what} doesn't match the requested value.`);
  return row;
}

export async function updateMemberRole(key: MemberKey, newRole: MemberRole): Promise<MembershipRow> {
  const { data, error } = await supabase.rpc("update_member_role", {
    p_vineyard_id: key.vineyardId,
    p_user_id: key.userId,
    p_role: newRole,
  });
  if (error) throw error;
  return confirmMembership(key, data, (r) => r.role === newRole, "role");
}

export async function updateMemberWorkerType(
  key: MemberKey,
  workerTypeId: string | null,
): Promise<MembershipRow> {
  const { data, error } = await supabase.rpc("update_member_worker_type", {
    p_vineyard_id: key.vineyardId,
    p_user_id: key.userId,
    p_worker_type_id: workerTypeId,
  });
  if (error) throw error;
  return confirmMembership(
    key,
    data,
    (r) => (r.worker_type_id ?? null) === workerTypeId,
    "worker type",
  );
}

export async function removeMember(membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_member", {
    p_membership_id: membershipId,
  });
  if (!error) return;

  // The shared VineTrack database may not have the `remove_member` RPC yet
  // (PGRST202 = function not found in the schema cache). Fall back to a
  // direct delete — RLS on `vineyard_members` still governs who may remove.
  const code = (error as { code?: string }).code;
  const msg = (error as { message?: string }).message ?? "";
  const missingFn = code === "PGRST202" || /Could not find the function/i.test(msg);
  if (!missingFn) throw error;

  const { error: delError } = await supabase
    .from("vineyard_members")
    .delete()
    .eq("id", membershipId);
  if (delError) throw delError;
}

export function describeMemberMgmtError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/last owner/i.test(msg)) return "You can't remove or demote the last owner.";
  if (/42501|permission|RLS/i.test(msg))
    return "You don't have permission to perform this action.";
  return msg || "Something went wrong. Please try again.";
}
