// Pending invitations for the currently authenticated user.
// RLS on the iOS Supabase `invitations` table allows the invited email's user
// to SELECT their own pending rows. Accept/decline use the existing iOS RPCs.
import { supabase } from "@/integrations/ios-supabase/client";

export interface PendingInvite {
  id: string;
  vineyard_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
  default_operator_category_id: string | null;
  vineyard_name: string | null;
  operator_category_name: string | null;
}

export async function fetchPendingInvitesForEmail(
  email: string,
): Promise<PendingInvite[]> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, vineyard_id, email, role, status, expires_at, default_operator_category_id, vineyards(name), operator_categories:default_operator_category_id(name)",
    )
    .ilike("email", normalised)
    .eq("status", "pending")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: true });
  if (error) {
    // 42501 / permission errors → just treat as no invites visible.
    if ((error as { code?: string }).code === "42501") return [];
    throw error;
  }
  return (data ?? []).map((row: any) => ({
    id: row.id,
    vineyard_id: row.vineyard_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expires_at: row.expires_at,
    default_operator_category_id: row.default_operator_category_id,
    vineyard_name: row.vineyards?.name ?? null,
    operator_category_name: row.operator_categories?.name ?? null,
  }));
}

export async function acceptInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("accept_invitation", { id });
  if (error) throw error;
}

export async function declineInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("decline_invitation", { id });
  if (error) throw error;
}
