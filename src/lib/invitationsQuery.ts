// Invitations RPCs (VineTrack Supabase project).
// Email delivery is handled by the unified `send-invitation-email` Edge
// Function on the VineTrack project. The portal never composes emails
// directly — it only passes the invitation id and context.
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
  default_worker_type_id: string | null;
  invited_by: string | null;
  invited_by_display_name: string | null;
  invited_by_email: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface InvitationEmailOutcome {
  sent: boolean;
  errorMessage?: string;
  errorCode?: string;
}

export interface InvitationOperationResult {
  invitation: VineyardInvitation;
  email: InvitationEmailOutcome;
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
  worker_type_id?: string | null;
  expires_in_days?: number;
}

async function readInvokeErrorContext(error: unknown): Promise<{ message?: string; code?: string }> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const text = await ctx.clone().text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          return {
            message: parsed?.message || parsed?.error || undefined,
            code: parsed?.error_code || parsed?.code || undefined,
          };
        } catch {
          return { message: text.slice(0, 300) };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { message: (error as Error)?.message };
}

/** Invoke the unified send-invitation-email Edge Function on the VineTrack
 *  project. Never throws — returns an outcome the caller can render honestly. */
export async function sendInvitationEmail(
  invitationId: string,
  context: "new" | "resend",
): Promise<InvitationEmailOutcome> {
  try {
    const { error } = await supabase.functions.invoke("send-invitation-email", {
      body: {
        invitation_id: invitationId,
        source_platform: "portal",
        context,
      },
    });
    if (error) {
      const ctx = await readInvokeErrorContext(error);
      return {
        sent: false,
        errorMessage: ctx.message ?? "The email could not be sent.",
        errorCode: ctx.code,
      };
    }
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      errorMessage: err instanceof Error ? err.message : "Unexpected error sending the email.",
    };
  }
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<InvitationOperationResult> {
  // create_invitation signature is unchanged after the Worker Types rename —
  // it still takes p_operator_category_id even though the underlying column
  // is now invitations.worker_type_id.
  const days = input.expires_in_days ?? 14;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  const { data, error } = await supabase.rpc("create_invitation", {
    p_vineyard_id: input.vineyard_id,
    p_email: input.email.trim().toLowerCase(),
    p_role: input.role,
    p_operator_category_id: input.worker_type_id ?? null,
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as VineyardInvitation;
  const email = await sendInvitationEmail(row.id, "new");
  return { invitation: row, email };
}

export async function cancelInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_invitation", { p_id: id });
  if (error) throw error;
}

export async function resendInvitation(
  id: string,
  extendDays = 14,
): Promise<InvitationOperationResult> {
  // Prefer the two-arg signature (p_id, p_extend_days). Some deployments only
  // expose the single-arg form — fall back on PostgREST "function not found
  // in schema cache" (PGRST202).
  let data: unknown;
  let error: { code?: string; message?: string } | null = null;
  ({ data, error } = await supabase.rpc("resend_invitation", {
    p_id: id,
    p_extend_days: extendDays,
  }));
  if (error && (error.code === "PGRST202" || /schema cache/i.test(error.message ?? ""))) {
    ({ data, error } = await supabase.rpc("resend_invitation", { p_id: id }));
  }
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as VineyardInvitation;
  const email = await sendInvitationEmail(row.id, "resend");
  return { invitation: row, email };
}

export function describeInvitationError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/already a member/i.test(msg)) return "That user is already a member of this vineyard.";
  if (/42501|permission|RLS/i.test(msg))
    return "You don't have permission to manage invitations.";
  return msg || "Something went wrong. Please try again.";
}
