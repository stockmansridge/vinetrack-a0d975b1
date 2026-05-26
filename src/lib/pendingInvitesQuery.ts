// Pending invitations for the currently authenticated user.
// Keep this query scoped to the invitations table only so invited users do not
// lose rows when related-table joins are blocked by RLS.
import { supabase } from "@/integrations/ios-supabase/client";

export interface PendingInvite {
  id: string;
  vineyard_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
  default_operator_category_id: string | null;
  created_at: string | null;
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
    .select("id, vineyard_id, email, role, status, expires_at, default_operator_category_id, created_at")
    .eq("email", normalised)
    .eq("status", "pending")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: true });
  if (error) {
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
    created_at: row.created_at ?? null,
    vineyard_name: null,
    operator_category_name: null,
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
