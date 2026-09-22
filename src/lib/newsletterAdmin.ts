// System Admin access to the VineTrack Newsletter Builder.
//
// Campaign content lives on the Portal's own backend (newsletter_campaigns /
// _versions / _recipients), which grants nothing to anon or authenticated: all
// reads and writes go through the `admin-newsletters` and
// `admin-newsletter-send` Edge Functions, which verify the caller's VineTrack
// system-admin status server-side before touching anything.
//
// Audience data is never copied here — recipient resolution (Current Users ∪
// Newsletter Subscribers, minus suppression) happens inside the functions and
// only counts come back to the browser.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as functionsHost } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import type { NewsletterBlock } from "@/lib/newsletter/blocks";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "preparing"
  | "sending"
  | "sent"
  | "partially_failed"
  | "failed";

export interface NewsletterCampaign {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  from_name: string | null;
  reply_to: string | null;
  logo_url: string | null;
  logo_path: string | null;
  logo_alt: string | null;
  audience_current_users: boolean;
  audience_subscribers: boolean;
  blocks: NewsletterBlock[];
  status: CampaignStatus | string;
  scheduled_at: string | null;
  timezone: string;
  audience_counts: AudienceCounts | null;
  current_version_id: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewsletterVersion {
  id: string;
  campaign_id?: string;
  status: string;
  subject?: string;
  recipient_count: number;
  suppressed_count: number;
  sent_count: number;
  failed_count: number;
  audience_current_users?: boolean;
  audience_subscribers?: boolean;
  audience_counts?: AudienceCounts | null;
  sender_email: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface AudienceCounts {
  current_users: number;
  subscribers: number;
  in_both: number;
  unique_potential: number;
  suppressed: number;
  invalid: number;
  final: number;
}

export const NEWSLETTERS_QK = ["admin", "newsletters"] as const;

async function call(fn: "admin-newsletters" | "admin-newsletter-send", body: Record<string, unknown>) {
  const { data: sessionData } = await iosSupabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired — please sign in again.");

  const { data, error } = await functionsHost.functions.invoke(fn, {
    body,
    headers: { "x-vinetrack-token": token },
  });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try {
      const parsed = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (parsed?.error) throw new Error(parsed.error);
    } catch (e) {
      if (e instanceof Error && e.message) throw e;
    }
    throw new Error(error.message ?? "Request failed");
  }
  return (data ?? {}) as Record<string, unknown>;
}

export function useNewsletterCampaigns(enabled = true) {
  return useQuery({
    queryKey: [...NEWSLETTERS_QK, "list"],
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const res = await call("admin-newsletters", { action: "list" });
      return {
        campaigns: (res.campaigns ?? []) as NewsletterCampaign[],
        versions: (res.versions ?? []) as NewsletterVersion[],
      };
    },
  });
}

export function useNewsletterCampaign(id: string | undefined) {
  return useQuery({
    queryKey: [...NEWSLETTERS_QK, "detail", id ?? "new"],
    enabled: !!id && id !== "new",
    staleTime: 10_000,
    queryFn: async () => {
      const res = await call("admin-newsletters", { action: "get", id });
      return {
        campaign: res.campaign as NewsletterCampaign,
        versions: (res.versions ?? []) as NewsletterVersion[],
      };
    },
  });
}

export interface SaveCampaignInput {
  id?: string;
  name: string;
  subject: string;
  preheader?: string | null;
  from_name?: string | null;
  reply_to?: string | null;
  logo_url?: string | null;
  logo_path?: string | null;
  logo_alt?: string | null;
  audience_current_users: boolean;
  audience_subscribers: boolean;
  blocks: NewsletterBlock[];
  scheduled_at?: string | null;
  timezone?: string;
}

export function useSaveNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (campaign: SaveCampaignInput) => {
      const res = await call("admin-newsletters", { action: "save", campaign });
      return res.campaign as NewsletterCampaign;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...NEWSLETTERS_QK] }),
  });
}

export function useDuplicateNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await call("admin-newsletters", { action: "duplicate", id });
      return res.campaign as NewsletterCampaign;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...NEWSLETTERS_QK] }),
  });
}

export function useDeleteNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await call("admin-newsletters", { action: "delete", id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...NEWSLETTERS_QK] }),
  });
}

/** Live audience counts for the ticked sources. */
export function useAudienceCounts(includeUsers: boolean, includeSubscribers: boolean) {
  return useQuery({
    queryKey: [...NEWSLETTERS_QK, "audience", includeUsers, includeSubscribers],
    enabled: includeUsers || includeSubscribers,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await call("admin-newsletters", {
        action: "audience",
        include_current_users: includeUsers,
        include_subscribers: includeSubscribers,
      });
      return {
        counts: res.counts as AudienceCounts,
        warnings: (res.warnings ?? []) as string[],
      };
    },
  });
}

/** Renders the real send HTML on the server so preview === what is delivered. */
export function useNewsletterPreview(campaign: SaveCampaignInput | null, enabled: boolean) {
  const key = JSON.stringify({ s: campaign?.subject, p: campaign?.preheader, b: campaign?.blocks });
  return useQuery({
    queryKey: [...NEWSLETTERS_QK, "preview", key],
    enabled: enabled && !!campaign,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await call("admin-newsletters", { action: "preview", campaign });
      return { html: String(res.html ?? ""), text: String(res.text ?? "") };
    },
  });
}

export function useSendTestNewsletter() {
  return useMutation({
    mutationFn: async (vars: { campaign: SaveCampaignInput; recipients: string[] }) => {
      const res = await call("admin-newsletters", {
        action: "send_test",
        campaign: vars.campaign,
        recipients: vars.recipients,
      });
      return {
        sent: Number(res.sent ?? 0),
        failed: (res.failed ?? []) as { email: string; error?: string }[],
      };
    },
  });
}

export function useSendNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    // No automatic retry — a retry is always a deliberate second press, and the
    // server reconciles against the existing open version either way.
    retry: false,
    mutationFn: async (vars: { id: string; resume?: boolean }) => {
      const res = await call("admin-newsletter-send", {
        action: vars.resume ? "resume" : "send",
        id: vars.id,
      });
      return {
        versionId: String(res.version_id ?? ""),
        sent: Number(res.sent ?? 0),
        failed: Number(res.failed ?? 0),
        remaining: Number(res.remaining ?? 0),
        status: String(res.status ?? ""),
      };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...NEWSLETTERS_QK] }),
  });
}

export function useScheduleNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (vars: { id: string; scheduledAt: string }) => {
      await call("admin-newsletter-send", {
        action: "schedule",
        id: vars.id,
        scheduled_at: vars.scheduledAt,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...NEWSLETTERS_QK] }),
  });
}

export function useCancelSchedule() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      await call("admin-newsletter-send", { action: "cancel", id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...NEWSLETTERS_QK] }),
  });
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  preparing: "Preparing",
  sending: "Sending",
  sent: "Sent",
  partially_failed: "Partially failed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Newsletter campaigns are read-only once a send has started. */
export function isEditableStatus(status: string | undefined): boolean {
  return !status || ["draft", "scheduled", "failed"].includes(status);
}
