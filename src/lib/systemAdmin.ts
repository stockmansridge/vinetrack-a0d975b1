// Shared System Admin + Feature Flags helpers.
//
// Source of truth lives in the iOS-shared Supabase project
// (public.system_admins, public.system_feature_flags + RPCs).
// Lovable portal calls the same RPCs so iOS and the portal stay in sync.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface SystemFeatureFlag {
  key: string;
  label?: string | null;
  description?: string | null;
  category?: string | null;
  is_enabled: boolean;
  value?: unknown;
}

const ADMIN_QK = ["system-admin", "is-admin"] as const;
const FLAGS_QK = ["system-admin", "feature-flags"] as const;

export function useIsSystemAdmin(): { isAdmin: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const q = useQuery({
    queryKey: [...ADMIN_QK, user?.id ?? null],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("is_system_admin");
      if (error) {
        // Treat "function not found" / permission errors as not-admin so the
        // portal degrades gracefully when the migration is missing.
        // eslint-disable-next-line no-console
        console.debug("[systemAdmin] is_system_admin error", error.message);
        return false;
      }
      return Boolean(data);
    },
  });
  return { isAdmin: !!q.data, loading: authLoading || q.isLoading };
}

export function useFeatureFlags() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...FLAGS_QK, user?.id ?? null],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<SystemFeatureFlag[]> => {
      const { data, error } = await (supabase as any).rpc("get_system_feature_flags");
      if (error) {
        // eslint-disable-next-line no-console
        console.debug("[systemAdmin] get_system_feature_flags error", error.message);
        return [];
      }
      return (data ?? []) as SystemFeatureFlag[];
    },
  });
}

/** Reactive lookup of a single flag's enabled state. Defaults to false. */
export function useFeatureFlag(key: string): boolean {
  const { data } = useFeatureFlags();
  return !!data?.find((f) => f.key === key)?.is_enabled;
}

/** Combined gate: visible only when caller is a system admin AND flag is on. */
export function useDiagnosticPanel(key: string): boolean {
  const { isAdmin } = useIsSystemAdmin();
  const enabled = useFeatureFlag(key);
  return isAdmin && enabled;
}

export function useSetFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { key: string; isEnabled: boolean; value?: unknown }) => {
      const { error } = await (supabase as any).rpc("set_system_feature_flag", {
        p_key: args.key,
        p_is_enabled: args.isEnabled,
        p_value: args.value ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FLAGS_QK });
    },
  });
}
