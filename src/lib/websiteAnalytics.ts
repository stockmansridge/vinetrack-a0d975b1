// System Admin access to the first-party VineTrack website analytics report.
//
// Traffic data lives in the canonical VineTrack database
// (public.website_page_views — see sql/243), alongside support_requests and
// email_list_subscribers. The table grants nothing to anon/authenticated, so no
// client reads it directly: the `admin-website-analytics` Edge Function
// verifies the caller's VineTrack system-admin status, aggregates server-side
// and returns only summary totals and series. The Portal uses the Lovable Cloud
// client purely to *invoke* that function (it is hosted there).
import { useQuery } from "@tanstack/react-query";
import { supabase as functionsHost } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export type Granularity = "day" | "month" | "year";
export type DatePreset = "7d" | "30d" | "90d" | "year" | "all" | "custom";

export interface AnalyticsSummary {
  page_views: number;
  sessions: number;
  demo_requests: number;
  new_subscribers: number;
  new_contacts: number;
  conversion_rate: number | null;
}

export interface TrafficPoint {
  period: string;
  page_views: number;
  sessions: number;
}

export interface ContactPoint {
  period: string;
  demo_requests: number;
  new_subscribers: number;
  new_contacts: number;
}

export interface TopPageRow {
  page_path: string;
  page_views: number;
  sessions: number;
  percentage_of_views: number;
}

export interface AnalyticsReport {
  summary: AnalyticsSummary;
  traffic_series: TrafficPoint[];
  contact_series: ContactPoint[];
  pages: TopPageRow[];
  meta?: {
    timezone?: string;
    granularity?: Granularity;
    environment?: string;
    traffic_table_pending?: boolean;
    subscribers_table_pending?: boolean;
  };
}

export interface ReportRange {
  date_from: string;
  date_to: string;
}

/** Friendly labels for the public website pages; the real path stays visible. */
const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/discover": "Discover",
  "/pricing": "Pricing",
  "/enhance": "Enhance",
  "/about": "About",
  "/contact": "Contact",
};

export function pageLabel(path: string): string {
  if (PAGE_LABELS[path]) return PAGE_LABELS[path];
  const tail = path.replace(/^\//, "").split("/").pop() ?? "";
  if (!tail) return path;
  return tail
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Local start-of-day / end-of-day bounds for a preset, as ISO instants. */
export function rangeForPreset(preset: DatePreset, now: Date = new Date()): ReportRange {
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (preset) {
    case "7d":
      start.setDate(start.getDate() - 6);
      break;
    case "30d":
      start.setDate(start.getDate() - 29);
      break;
    case "90d":
      start.setDate(start.getDate() - 89);
      break;
    case "year":
      start.setMonth(0, 1);
      break;
    case "all":
      start.setFullYear(2024, 0, 1);
      break;
    default:
      start.setDate(start.getDate() - 29);
  }
  return { date_from: start.toISOString(), date_to: end.toISOString() };
}

/** Axis label for a period key (YYYY-MM-DD, YYYY-MM or YYYY). */
export function periodLabel(period: string, granularity: Granularity): string {
  if (granularity === "year") return period;
  if (granularity === "month") {
    const [y, m] = period.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  const [y, m, d] = period.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const WEBSITE_ANALYTICS_QK = ["admin", "website-analytics"] as const;

async function callAdmin(body: Record<string, unknown>) {
  const { data: sessionData } = await iosSupabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired — please sign in again.");

  const { data, error } = await functionsHost.functions.invoke("admin-website-analytics", {
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
  return data as AnalyticsReport;
}

export function useWebsiteAnalytics(params: {
  range: ReportRange;
  granularity: Granularity;
  environment?: "production" | "preview";
}) {
  const environment = params.environment ?? "production";
  return useQuery({
    queryKey: [
      ...WEBSITE_ANALYTICS_QK,
      params.range.date_from,
      params.range.date_to,
      params.granularity,
      environment,
    ],
    staleTime: 60_000,
    queryFn: () =>
      callAdmin({
        action: "report",
        date_from: params.range.date_from,
        date_to: params.range.date_to,
        granularity: params.granularity,
        environment,
      }),
  });
}
