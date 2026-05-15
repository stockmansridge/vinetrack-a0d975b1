// App Notices — shared with the iOS app via public.app_notices on the
// iOS-side Supabase project. RLS gates writes to system admins.
//
// Discovered columns (probed against the live table):
//   id, title, message, notice_type, priority, is_active,
//   starts_at, ends_at, created_at, updated_at, created_by
//
// No dedicated admin_* RPCs exist for notices; we use direct table access.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

export interface AppNotice {
  id: string;
  title: string | null;
  message: string | null;
  notice_type: string | null;
  priority: number | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type AppNoticeUpsert = Partial<Omit<AppNotice, "created_at" | "updated_at">> & {
  title: string;
  message: string;
  is_active: boolean;
};

const QK = ["system-admin", "app-notices"] as const;

export function useAppNotices() {
  return useQuery({
    queryKey: [...QK],
    staleTime: 15_000,
    queryFn: async (): Promise<AppNotice[]> => {
      const { data, error } = await (supabase as any)
        .from("app_notices")
        .select(
          "id,title,message,notice_type,priority,is_active,starts_at,ends_at,created_at,updated_at,created_by",
        )
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AppNotice[];
    },
  });
}

export function useUpsertAppNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: AppNoticeUpsert) => {
      const payload: Record<string, unknown> = {
        title: n.title,
        message: n.message,
        notice_type: n.notice_type ?? null,
        priority: n.priority ?? 0,
        is_active: n.is_active,
        starts_at: n.starts_at ?? null,
        ends_at: n.ends_at ?? null,
      };
      if (n.id) {
        const { error } = await (supabase as any)
          .from("app_notices")
          .update(payload)
          .eq("id", n.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("app_notices").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useSetAppNoticeActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from("app_notices")
        .update({ is_active: args.is_active })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useDeleteAppNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("app_notices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}
