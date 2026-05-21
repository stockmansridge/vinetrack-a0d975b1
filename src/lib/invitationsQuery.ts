// Invitations RPCs (shared iOS Supabase project, SQL 79).
import { supabase } from "@/integrations/ios-supabase/client";

export type InvitationRole = "manager" | "supervisor" | "operator";
export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export interface VineyardInvitation {
  id: string;
  email: string;
  role: string;
  status: InvitationStatus | string;
  default_operator_category_id: string | null;
  invited_by: string | null;
  invited_by_display_name: string | null;
  invited_by_email: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export async function listVineyardInvitations(
  vineyardId: string,
): Promise<VineyardInvitation[]> {
  const { data, error } = await supabase.rpc("list_vineyard_invitations", {
    p_vineyard_id: vineyardId,
  });
  if (error) {
    if ((error as { code?: string }).code === "42501") return [];
    throw error;
  }
  return (data ?? []) as VineyardInvitation[];
}

export interface CreateInvitationInput {
  vineyard_id: string;
  email: string;
  role: InvitationRole;
  operator_category_id?: string | null;
  expires_in_days?: number;
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<VineyardInvitation> {
  // SQL 79 signature: (p_vineyard_id, p_email, p_role,
  // p_operator_category_id default null, p_expires_at default null).
  // No p_message / p_expires_in_days yet.
  const days = input.expires_in_days ?? 14;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  const { data, error } = await supabase.rpc("create_invitation", {
    p_vineyard_id: input.vineyard_id,
    p_email: input.email.trim().toLowerCase(),
    p_role: input.role,
    p_operator_category_id: input.operator_category_id ?? null,
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as VineyardInvitation;
}

export async function cancelInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_invitation", { p_id: id });
  if (error) throw error;
}

export async function resendInvitation(
  id: string,
  extendDays = 14,
): Promise<VineyardInvitation> {
  const { data, error } = await supabase.rpc("resend_invitation", {
    p_id: id,
    p_extend_days: extendDays,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as VineyardInvitation;
}

export function describeInvitationError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/already a member/i.test(msg)) return "That user is already a member of this vineyard.";
  if (/42501|permission|RLS/i.test(msg))
    return "You don't have permission to manage invitations.";
  return msg || "Something went wrong. Please try again.";
}
