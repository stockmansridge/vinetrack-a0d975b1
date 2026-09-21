// System Admin access to the VineTrack website email list.
//
// Subscriber data lives in the canonical VineTrack database
// (public.email_list_subscribers, alongside support_requests — see
// sql/242_email_list_subscribers.sql). The table grants nothing to
// anon/authenticated, so no client ever reads it directly: every read and
// write goes through the `admin-email-list` Edge Function, which verifies the
// caller's VineTrack system-admin status and then uses the VineTrack service
// role. The Portal only uses the Lovable Cloud client to *invoke* that
// function (it is hosted there) — never as a subscriber data source.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as functionsHost } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export type SubscriberStatus = "subscribed" | "unsubscribed";

export interface EmailListSubscriber {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: SubscriberStatus | string;
  source: string;
  source_page: string | null;
  consent_version: string | null;
  subscribed_at: string | null;
  unsubscribed_at: string | null
  created_at: string | null;
  updated_at: string | null;
}

export const EMAIL_LIST_QK = ["admin", "email-list"] as const;

async function callAdmin(body: Record<string, unknown>) {
  const { data: sessionData } = await iosSupabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired — please sign in again.");

  const { data, error } = await cloudSupabase.functions.invoke("admin-email-list", {
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
  return data as Record<string, unknown>;
}

export function useEmailListSubscribers(enabled = true) {
  return useQuery({
    queryKey: [...EMAIL_LIST_QK],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<EmailListSubscriber[]> => {
      const res = await callAdmin({ action: "list" });
      return (res?.subscribers ?? []) as EmailListSubscriber[];
    },
  });
}

export function useSetSubscriberStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; status: SubscriberStatus }) => {
      await callAdmin({ action: "set_status", id: vars.id, status: vars.status });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...EMAIL_LIST_QK] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Filtering + CSV export (pure helpers, unit tested)                  */
/* ------------------------------------------------------------------ */

export interface EmailListFilters {
  search: string;
  status: string; // "all" | subscribed | unsubscribed
  source: string; // "all" | source value
}

export function filterSubscribers(
  rows: EmailListSubscriber[],
  filters: EmailListFilters,
): EmailListSubscriber[] {
  const q = filters.search.trim().toLowerCase();
  return rows
    .filter((r) => {
      if (filters.status !== "all" && (r.status ?? "") !== filters.status) return false;
      if (filters.source !== "all" && (r.source ?? "") !== filters.source) return false;
      if (!q) return true;
      return [r.email, r.first_name, r.last_name]
        .map((x) => (x ?? "").toLowerCase())
        .some((x) => x.includes(q));
    })
    .sort((a, b) => (b.subscribed_at ?? "").localeCompare(a.subscribed_at ?? ""));
}

/** RFC 4180 escaping: quote when the value contains a comma, quote or newline. */
export function csvCell(value: string | null | undefined): string {
  const v = value ?? "";
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export const EMAIL_LIST_CSV_HEADERS = [
  "First Name",
  "Last Name",
  "Email",
  "Status",
  "Source",
  "Source Page",
  "Subscribed At",
  "Unsubscribed At",
] as const;

/**
 * CSV for the current filtered view. Excel-compatible: UTF-8 BOM is added by
 * the download helper and rows use CRLF line endings.
 */
export function buildEmailListCsv(rows: EmailListSubscriber[]): string {
  const lines = [EMAIL_LIST_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.first_name),
        csvCell(r.last_name),
        csvCell(r.email),
        csvCell(r.status),
        csvCell(r.source),
        csvCell(r.source_page),
        csvCell(r.subscribed_at),
        csvCell(r.unsubscribed_at),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

export function emailListCsvFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `vinetrack-email-list-${stamp}.csv`;
}

export function downloadEmailListCsv(rows: EmailListSubscriber[]): void {
  // Leading BOM so Excel detects UTF-8.
  const blob = new Blob(["\uFEFF", buildEmailListCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = emailListCsvFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
