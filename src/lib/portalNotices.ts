// Portal notices — web-portal-only announcement banners.
//
// Stored on the Lovable Cloud project (public.portal_notices), completely
// separate from the shared app_notices table used by the iOS app. Everyone
// signed into the portal can read them; every write goes through the
// `admin-portal-notices` function, which verifies VineTrack system-admin
// status before touching the table.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export type PortalNoticeTone = "info" | "success" | "warning";

export interface PortalNotice {
  id: string;
  title: string;
  message: string;
  tone: PortalNoticeTone;
  priority: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalNoticeInput {
  id?: string;
  title: string;
  message: string;
  tone: PortalNoticeTone;
  priority: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

const LIST_QK = ["portal-notices", "live"] as const;
const ADMIN_QK = ["portal-notices", "admin"] as const;

/** A notice is shown when it is active and inside its optional date window. */
export function isNoticeLive(n: PortalNotice, now: Date = new Date()): boolean {
  if (!n.is_active) return false;
  if (n.starts_at && new Date(n.starts_at).getTime() > now.getTime()) return false;
  if (n.ends_at && new Date(n.ends_at).getTime() < now.getTime()) return false;
  return true;
}

/** Notices visible to the signed-in portal user. */
export function usePortalNotices() {
  return useQuery({
    queryKey: [...LIST_QK],
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<PortalNotice[]> => {
      const { data, error } = await (cloudSupabase as any)
        .from("portal_notices")
        .select("*")
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as PortalNotice[]).filter((n) => isNoticeLive(n));
    },
  });
}

async function callAdmin(body: Record<string, unknown>) {
  const { data: sessionData } = await iosSupabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired — please sign in again.");

  const { data, error } = await cloudSupabase.functions.invoke("admin-portal-notices", {
    body,
    headers: { "x-vinetrack-token": token },
  });
  if (error) {
    const ctx = (error as any).context;
    try {
      const parsed = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (parsed?.error) throw new Error(parsed.error);
    } catch (e) {
      if (e instanceof Error && e.message) throw e;
    }
    throw new Error(error.message ?? "Request failed");
  }
  return data as any;
}

/** Every notice, including inactive and scheduled ones (system admins only). */
export function useAllPortalNotices(enabled = true) {
  return useQuery({
    queryKey: [...ADMIN_QK],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<PortalNotice[]> => {
      const res = await callAdmin({ action: "list" });
      return (res?.notices ?? []) as PortalNotice[];
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ADMIN_QK });
    qc.invalidateQueries({ queryKey: LIST_QK });
  };
}

export function useSavePortalNotice() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: PortalNoticeInput) => callAdmin({ action: "upsert", ...input }),
    onSuccess: invalidate,
  });
}

export function useSetPortalNoticeActive() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; is_active: boolean }) =>
      callAdmin({ action: "set_active", ...args }),
    onSuccess: invalidate,
  });
}

export function useDeletePortalNotice() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => callAdmin({ action: "delete", id }),
    onSuccess: invalidate,
  });
}

const DISMISS_KEY = "vt_portal_notices_dismissed";

export function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Dismissal is keyed by notice id + updated_at so an edited notice reappears. */
export function dismissalKey(n: PortalNotice): string {
  return `${n.id}:${n.updated_at}`;
}

export function markDismissed(key: string) {
  try {
    const next = Array.from(new Set([...readDismissed(), key])).slice(-100);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
