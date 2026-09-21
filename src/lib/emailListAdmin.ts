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

  const { data, error } = await functionsHost.functions.invoke("admin-email-list", {
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

/** Edit a subscriber's name and email address. */
export function useUpdateSubscriber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
    }) => {
      await callAdmin({ action: "update", ...vars });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...EMAIL_LIST_QK] });
    },
  });
}

export function useBulkSubscriberStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { ids: string[]; status: SubscriberStatus }) => {
      const res = await callAdmin({ action: "bulk_status", ids: vars.ids, status: vars.status });
      return Number(res?.updated ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...EMAIL_LIST_QK] });
    },
  });
}

export function useDeleteSubscribers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await callAdmin({ action: "delete", ids });
      return Number(res?.deleted ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...EMAIL_LIST_QK] });
    },
  });
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  skipped_emails?: string[];
}

export function useImportSubscribers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { rows: ImportRow[]; source: string }) => {
      const res = await callAdmin({ action: "import", rows: vars.rows, source: vars.source });
      return {
        created: Number(res?.created ?? 0),
        updated: Number(res?.updated ?? 0),
        skipped: Number(res?.skipped ?? 0),
        skipped_emails: (res?.skipped_emails ?? []) as string[],
      } satisfies ImportSummary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...EMAIL_LIST_QK] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Import parsing (pure helpers, unit tested)                          */
/* ------------------------------------------------------------------ */

export interface ImportRow {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  status?: SubscriberStatus;
  source_page?: string | null;
}

export interface ImportParseResult {
  rows: ImportRow[];
  invalid: string[];
  duplicates: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isImportableEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase());
}

/** Split one delimited line, honouring double-quoted fields. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function detectDelimiter(line: string): string {
  const counts: Array<[string, number]> = [
    [",", (line.match(/,/g) ?? []).length],
    ["\t", (line.match(/\t/g) ?? []).length],
    [";", (line.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/**
 * Parse pasted text or a CSV file into importable rows.
 *
 * Accepts a plain list of addresses (one per line) or a delimited file with or
 * without a header row. Recognised headers: email, first name, last name,
 * status, source page (any capitalisation, spaces or underscores).
 */
export function parseEmailListImport(text: string): ImportParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], invalid: [], duplicates: 0 };

  const delimiter = detectDelimiter(lines[0]);
  let header: string[] | null = null;
  const firstCells = splitLine(lines[0], delimiter).map((c) => c.toLowerCase());
  if (firstCells.some((c) => c.replace(/[\s_]/g, "") === "email")) header = firstCells;

  const indexOf = (...names: string[]) => {
    if (!header) return -1;
    const wanted = names.map((n) => n.replace(/[\s_]/g, ""));
    return header.findIndex((h) => wanted.includes(h.replace(/[\s_]/g, "")));
  };
  const iEmail = indexOf("email", "emailaddress");
  const iFirst = indexOf("firstname", "first", "givenname");
  const iLast = indexOf("lastname", "last", "surname");
  const iStatus = indexOf("status");
  const iPage = indexOf("sourcepage", "page");

  const rows: ImportRow[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const line of header ? lines.slice(1) : lines) {
    const cells = splitLine(line, delimiter);
    const emailRaw = header
      ? (cells[iEmail] ?? "")
      : (cells.find((c) => c.includes("@")) ?? cells[0] ?? "");
    const email = emailRaw.trim().toLowerCase();
    if (!isImportableEmail(email)) {
      invalid.push(line.slice(0, 120));
      continue;
    }
    if (seen.has(email)) {
      duplicates += 1;
      continue;
    }
    seen.add(email);

    let first: string | null = null;
    let last: string | null = null;
    if (header) {
      first = iFirst >= 0 ? (cells[iFirst] || null) : null;
      last = iLast >= 0 ? (cells[iLast] || null) : null;
    } else {
      const others = cells.filter((c) => !c.includes("@") && c.length > 0);
      first = others[0] ?? null;
      last = others[1] ?? null;
    }

    const statusCell = header && iStatus >= 0 ? (cells[iStatus] ?? "").toLowerCase() : "";
    rows.push({
      email,
      first_name: first,
      last_name: last,
      status: statusCell === "unsubscribed" ? "unsubscribed" : "subscribed",
      source_page: header && iPage >= 0 ? (cells[iPage] || null) : null,
    });
  }

  return { rows, invalid, duplicates };
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
