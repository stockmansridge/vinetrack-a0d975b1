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
  created_at: string | null;
  vineyard_name: string | null;
  operator_category_name: string | null;
}

const DEFAULT_PENDING_INVITE_TIMEOUT_MS = 6_000;

class PendingInviteLookupTimeoutError extends Error {
  constructor(message = "Invitation lookup timed out") {
    super(message);
    this.name = "PendingInviteLookupTimeoutError";
  }
}

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(timer),
    controller,
  };
}

export async function fetchPendingInvitesForEmail(
  email: string,
  options?: { timeoutMs?: number },
): Promise<PendingInvite[]> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return [];
  const nowIso = new Date().toISOString();
  const { signal, cancel, controller } = withTimeoutSignal(
    options?.timeoutMs ?? DEFAULT_PENDING_INVITE_TIMEOUT_MS,
  );
  const { data, error } = await supabase
    .from("invitations")
    .select("id, vineyard_id, email, role, status, expires_at, created_at")
    .abortSignal(signal)
    .eq("email", normalised)
    .eq("status", "pending")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: true });
  cancel();
  if (error) {
    if (controller.signal.aborted) {
      throw new PendingInviteLookupTimeoutError();
    }
    throw error;
  }
  return (data ?? []).map((row: any) => ({
    id: row.id,
    vineyard_id: row.vineyard_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at ?? null,
    vineyard_name: null,
    operator_category_name: null,
  }));
}

export function isPendingInviteLookupTimeout(error: unknown) {
  return error instanceof PendingInviteLookupTimeoutError;
}

export function describePendingInviteLookupError(error: unknown) {
  if (isPendingInviteLookupTimeout(error)) {
    return "Invitation lookup timed out";
  }
  const message = (error as { message?: string } | null)?.message ?? String(error ?? "");
  if (/42501|permission|rls/i.test(message)) {
    return "Invitation lookup was blocked by permissions";
  }
  return message || "Invitation lookup failed";
}

export async function acceptInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("accept_invitation", { id });
  if (error) throw error;
}

export async function declineInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("decline_invitation", { id });
  if (error) throw error;
}
