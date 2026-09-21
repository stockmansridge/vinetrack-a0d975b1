// Pure aggregation for the Website Analytics report.
//
// Runs server-side (inside the admin Edge Function) so the browser never
// receives raw page-view rows — it only ever gets aggregated series. The module
// has no Deno or Supabase dependency so it is unit-testable directly.
//
// All date grouping uses the business reporting timezone, Australia/Sydney.

export const REPORT_TZ = "Australia/Sydney";

export type Granularity = "day" | "month" | "year";

export interface PageViewRow {
  created_at: string;
  page_path: string;
  session_id: string;
}

export interface DemoRequestRow {
  created_at: string;
  submitter_email?: string | null;
}

export interface SubscriberRow {
  created_at: string;
  email?: string | null;
  source?: string | null;
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

export interface PageRow {
  page_path: string;
  page_views: number;
  sessions: number;
  percentage_of_views: number;
}

export interface AnalyticsReport {
  summary: {
    page_views: number;
    sessions: number;
    demo_requests: number;
    new_subscribers: number;
    new_contacts: number;
    conversion_rate: number | null;
  };
  traffic_series: TrafficPoint[];
  contact_series: ContactPoint[];
  pages: PageRow[];
}

/** Website email-list sources that count as a new website subscriber. */
export const WEBSITE_SUBSCRIBER_SOURCES = ["website_newsletter", "website_demo_opt_in"];

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Local (Australia/Sydney) calendar date of an instant, as YYYY-MM-DD. */
export function localDate(iso: string, tz: string = REPORT_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = formatter(tz).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Grouping key for an instant: YYYY-MM-DD, YYYY-MM or YYYY. */
export function periodKey(
  iso: string,
  granularity: Granularity,
  tz: string = REPORT_TZ,
): string {
  const day = localDate(iso, tz);
  if (!day) return "";
  if (granularity === "year") return day.slice(0, 4);
  if (granularity === "month") return day.slice(0, 7);
  return day;
}

/** Every period between two local dates (inclusive), so charts have no gaps. */
export function enumeratePeriods(
  fromDay: string,
  toDay: string,
  granularity: Granularity,
): string[] {
  if (!fromDay || !toDay) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const start = new Date(`${fromDay}T00:00:00Z`);
  const end = new Date(`${toDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  // Cap at ~20 years of days to keep the response bounded.
  for (let i = 0; i < 7400; i += 1) {
    const cur = new Date(start.getTime() + i * 86_400_000);
    if (cur > end) break;
    const day = cur.toISOString().slice(0, 10);
    const key = granularity === "year"
      ? day.slice(0, 4)
      : granularity === "month"
      ? day.slice(0, 7)
      : day;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function normEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export interface BuildReportInput {
  pageViews: PageViewRow[];
  demoRequests: DemoRequestRow[];
  subscribers: SubscriberRow[];
  granularity: Granularity;
  /** Local start/end dates (YYYY-MM-DD) used to fill empty periods. */
  fromDay?: string;
  toDay?: string;
  tz?: string;
}

export function buildAnalyticsReport(input: BuildReportInput): AnalyticsReport {
  const tz = input.tz ?? REPORT_TZ;
  const gran = input.granularity;

  const periods = input.fromDay && input.toDay
    ? enumeratePeriods(input.fromDay, input.toDay, gran)
    : [];
  const order: string[] = [...periods];
  const ensure = (key: string) => {
    if (key && !order.includes(key)) order.push(key);
  };

  const viewsByPeriod = new Map<string, number>();
  const sessionsByPeriod = new Map<string, Set<string>>();
  const viewsByPage = new Map<string, number>();
  const sessionsByPage = new Map<string, Set<string>>();
  const allSessions = new Set<string>();

  for (const row of input.pageViews) {
    const key = periodKey(row.created_at, gran, tz);
    if (!key) continue;
    ensure(key);
    viewsByPeriod.set(key, (viewsByPeriod.get(key) ?? 0) + 1);
    const sid = String(row.session_id ?? "");
    if (sid) {
      if (!sessionsByPeriod.has(key)) sessionsByPeriod.set(key, new Set());
      sessionsByPeriod.get(key)!.add(sid);
      allSessions.add(sid);
    }
    const path = row.page_path || "/";
    viewsByPage.set(path, (viewsByPage.get(path) ?? 0) + 1);
    if (sid) {
      if (!sessionsByPage.has(path)) sessionsByPage.set(path, new Set());
      sessionsByPage.get(path)!.add(sid);
    }
  }

  const demosByPeriod = new Map<string, number>();
  const contactsByPeriod = new Map<string, Set<string>>();
  const allContacts = new Set<string>();
  let demoTotal = 0;

  for (const row of input.demoRequests) {
    const key = periodKey(row.created_at, gran, tz);
    if (!key) continue;
    ensure(key);
    demosByPeriod.set(key, (demosByPeriod.get(key) ?? 0) + 1);
    demoTotal += 1;
    const email = normEmail(row.submitter_email);
    if (email) {
      if (!contactsByPeriod.has(key)) contactsByPeriod.set(key, new Set());
      contactsByPeriod.get(key)!.add(email);
      allContacts.add(email);
    }
  }

  const subsByPeriod = new Map<string, number>();
  let subTotal = 0;

  for (const row of input.subscribers) {
    const source = String(row.source ?? "");
    if (!WEBSITE_SUBSCRIBER_SOURCES.includes(source)) continue;
    const key = periodKey(row.created_at, gran, tz);
    if (!key) continue;
    ensure(key);
    subsByPeriod.set(key, (subsByPeriod.get(key) ?? 0) + 1);
    subTotal += 1;
    const email = normEmail(row.email);
    if (email) {
      if (!contactsByPeriod.has(key)) contactsByPeriod.set(key, new Set());
      contactsByPeriod.get(key)!.add(email);
      allContacts.add(email);
    }
  }

  order.sort((a, b) => a.localeCompare(b));

  const traffic_series: TrafficPoint[] = order.map((period) => ({
    period,
    page_views: viewsByPeriod.get(period) ?? 0,
    sessions: sessionsByPeriod.get(period)?.size ?? 0,
  }));

  const contact_series: ContactPoint[] = order.map((period) => ({
    period,
    demo_requests: demosByPeriod.get(period) ?? 0,
    new_subscribers: subsByPeriod.get(period) ?? 0,
    new_contacts: contactsByPeriod.get(period)?.size ?? 0,
  }));

  const pageViewTotal = input.pageViews.length;
  const pages: PageRow[] = Array.from(viewsByPage.entries())
    .map(([page_path, page_views]) => ({
      page_path,
      page_views,
      sessions: sessionsByPage.get(page_path)?.size ?? 0,
      percentage_of_views: pageViewTotal > 0
        ? Math.round((page_views / pageViewTotal) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => b.page_views - a.page_views || a.page_path.localeCompare(b.page_path));

  const sessions = allSessions.size;
  const new_contacts = allContacts.size;

  return {
    summary: {
      page_views: pageViewTotal,
      sessions,
      demo_requests: demoTotal,
      new_subscribers: subTotal,
      new_contacts,
      conversion_rate: sessions > 0
        ? Math.round((new_contacts / sessions) * 1000) / 10
        : null,
    },
    traffic_series,
    contact_series,
    pages,
  };
}
