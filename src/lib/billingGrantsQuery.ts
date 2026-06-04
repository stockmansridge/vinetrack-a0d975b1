// Manual / internal unlimited billing grants. Backed by shared iOS Supabase RPCs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export interface ManualUnlimitedGrant {
  subscription_id: string;
  vineyard_id: string;
  vineyard_name: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
  owner_full_name: string | null;
  status: string | null;
  plan_code: string | null;
  manual_grant_reason: string | null;
  manual_grant_expires_at: string | null;
  manual_grant_revoked_at: string | null;
  active_licence_count: number | null;
  created_at: string | null;
  updated_at: string | null;
}

const QK = {
  grants: ["admin", "manual-unlimited-grants"] as const,
};

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (iosSupabase as any).rpc(name, args ?? {});
  if (error) throw error;
  return data as T;
}

export function useManualUnlimitedGrants() {
  return useQuery({
    queryKey: QK.grants,
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      rpc<ManualUnlimitedGrant[]>("admin_list_manual_unlimited_grants").then((d) => d ?? []),
  });
}

export function useGrantUnlimitedAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      ownerUserId: string;
      vineyardId: string;
      reason: string;
      expiresAt: string | null;
    }) =>
      rpc("admin_grant_unlimited_access", {
        p_owner_user_id: args.ownerUserId,
        p_vineyard_id: args.vineyardId,
        p_reason: args.reason,
        p_expires_at: args.expiresAt,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.grants }),
  });
}

export function useRevokeUnlimitedAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { subscriptionId: string; revokeLicences: boolean }) =>
      rpc("admin_revoke_unlimited_access", {
        p_subscription_id: args.subscriptionId,
        p_revoke_licences: args.revokeLicences,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.grants }),
  });
}

export function grantState(g: ManualUnlimitedGrant): "active" | "revoked" | "expired" {
  if (g.manual_grant_revoked_at) return "revoked";
  if (g.manual_grant_expires_at && new Date(g.manual_grant_expires_at).getTime() < Date.now())
    return "expired";
  return "active";
}
