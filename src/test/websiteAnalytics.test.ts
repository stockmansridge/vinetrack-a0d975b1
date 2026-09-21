import { describe, expect, it } from "vitest";
import {
  buildAnalyticsReport,
  enumeratePeriods,
  localDate,
  periodKey,
} from "../../supabase/functions/_shared/website-analytics-agg";
import { pageLabel, periodLabel, rangeForPreset } from "@/lib/websiteAnalytics";

const view = (created_at: string, page_path: string, session_id: string) => ({
  created_at,
  page_path,
  session_id,
});

describe("Australia/Sydney reporting boundaries", () => {
  it("puts a late-UTC instant on the next Sydney day", () => {
    // 2026-03-01 14:00 UTC is 2026-03-02 01:00 in Sydney.
    expect(localDate("2026-03-01T14:00:00Z")).toBe("2026-03-02");
    expect(periodKey("2026-03-01T14:00:00Z", "day")).toBe("2026-03-02");
    expect(periodKey("2026-03-01T14:00:00Z", "month")).toBe("2026-03");
    expect(periodKey("2026-03-01T14:00:00Z", "year")).toBe("2026");
  });

  it("keeps an early-UTC instant on the same Sydney day", () => {
    expect(localDate("2026-03-01T02:00:00Z")).toBe("2026-03-01");
  });
});

describe("period enumeration", () => {
  it("fills every day in the range", () => {
    expect(enumeratePeriods("2026-01-01", "2026-01-04", "day")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });

  it("collapses to months and years", () => {
    expect(enumeratePeriods("2026-01-01", "2026-03-15", "month")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(enumeratePeriods("2025-06-01", "2026-02-01", "year")).toEqual(["2025", "2026"]);
  });
});

describe("buildAnalyticsReport", () => {
  const pageViews = [
    view("2026-01-01T01:00:00Z", "/", "s1"),
    view("2026-01-01T02:00:00Z", "/", "s1"),
    view("2026-01-01T03:00:00Z", "/pricing", "s2"),
    view("2026-01-02T03:00:00Z", "/pricing", "s3"),
  ];
  const demoRequests = [
    { created_at: "2026-01-01T04:00:00Z", submitter_email: "Jane@Example.com " },
  ];
  const subscribers = [
    { created_at: "2026-01-01T05:00:00Z", email: "jane@example.com", source: "website_newsletter" },
    { created_at: "2026-01-02T05:00:00Z", email: "bob@example.com", source: "website_demo_opt_in" },
    { created_at: "2026-01-02T05:00:00Z", email: "ops@vinetrack.com.au", source: "manual" },
  ];

  const report = buildAnalyticsReport({
    pageViews,
    demoRequests,
    subscribers,
    granularity: "day",
    fromDay: "2026-01-01",
    toDay: "2026-01-02",
  });

  it("counts page views and distinct sessions", () => {
    expect(report.summary.page_views).toBe(4);
    expect(report.summary.sessions).toBe(3);
  });

  it("counts demo requests and website subscribers only", () => {
    expect(report.summary.demo_requests).toBe(1);
    // 'manual' is not a website source.
    expect(report.summary.new_subscribers).toBe(2);
  });

  it("dedupes the same email across demo and subscriber", () => {
    // jane (demo + newsletter) + bob = 2 distinct contacts.
    expect(report.summary.new_contacts).toBe(2);
  });

  it("computes the conversion rate from contacts over sessions", () => {
    expect(report.summary.conversion_rate).toBe(66.7);
  });

  it("returns null conversion rate with no sessions", () => {
    const empty = buildAnalyticsReport({
      pageViews: [],
      demoRequests,
      subscribers,
      granularity: "day",
    });
    expect(empty.summary.sessions).toBe(0);
    expect(empty.summary.conversion_rate).toBeNull();
  });

  it("excludes contacts that already existed before the window", () => {
    const repeat = buildAnalyticsReport({
      pageViews,
      demoRequests,
      subscribers,
      priorContacts: ["JANE@example.com"],
      granularity: "day",
    });
    expect(repeat.summary.new_contacts).toBe(1);
    // Raw counts are unchanged — only first-time contacts are deduped.
    expect(repeat.summary.demo_requests).toBe(1);
  });

  it("builds gap-free day series", () => {
    expect(report.traffic_series).toEqual([
      { period: "2026-01-01", page_views: 3, sessions: 2 },
      { period: "2026-01-02", page_views: 1, sessions: 1 },
    ]);
    expect(report.contact_series[0]).toEqual({
      period: "2026-01-01",
      demo_requests: 1,
      new_subscribers: 1,
      new_contacts: 1,
    });
  });

  it("groups by month and year", () => {
    const monthly = buildAnalyticsReport({
      pageViews,
      demoRequests,
      subscribers,
      granularity: "month",
      fromDay: "2026-01-01",
      toDay: "2026-01-02",
    });
    expect(monthly.traffic_series).toEqual([
      { period: "2026-01", page_views: 4, sessions: 3 },
    ]);
    const yearly = buildAnalyticsReport({
      pageViews,
      demoRequests,
      subscribers,
      granularity: "year",
      fromDay: "2026-01-01",
      toDay: "2026-01-02",
    });
    expect(yearly.traffic_series).toEqual([{ period: "2026", page_views: 4, sessions: 3 }]);
  });

  it("ranks top pages and the percentages total the summary", () => {
    expect(report.pages[0]).toEqual({
      page_path: "/",
      page_views: 2,
      sessions: 1,
      percentage_of_views: 50,
    });
    const views = report.pages.reduce((n, p) => n + p.page_views, 0);
    expect(views).toBe(report.summary.page_views);
    const pct = report.pages.reduce((n, p) => n + p.percentage_of_views, 0);
    expect(pct).toBeCloseTo(100, 1);
  });
});

describe("portal presentation helpers", () => {
  it("labels known website pages and falls back sensibly", () => {
    expect(pageLabel("/")).toBe("Home");
    expect(pageLabel("/pricing")).toBe("Pricing");
    expect(pageLabel("/vineyard-tools")).toBe("Vineyard Tools");
  });

  it("formats period labels per granularity", () => {
    expect(periodLabel("2026", "year")).toBe("2026");
    expect(periodLabel("2026-01", "month")).toMatch(/Jan/);
    expect(periodLabel("2026-01-05", "day")).toMatch(/5/);
  });

  it("builds ranges for the presets", () => {
    const now = new Date("2026-03-10T06:00:00Z");
    const r7 = rangeForPreset("7d", now);
    const days = (new Date(r7.date_to).getTime() - new Date(r7.date_from).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
    expect(new Date(rangeForPreset("year", now).date_from).getFullYear()).toBe(2026);
  });
});
