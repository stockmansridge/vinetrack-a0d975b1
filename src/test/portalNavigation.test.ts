import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_ACTIVITY,
  ACTIVITIES,
  SYSTEM_ADMIN_ITEMS,
  accessibleActivities,
  accessibleViews,
  defaultPathFor,
  reportDestinations,
  resolveLocation,
  searchDestinations,
  type NavViewer,
} from "@/lib/navigationConfig";

const declaredRoutes = new Set(
  Array.from(readFileSync("src/App.tsx", "utf8").matchAll(/path="([^"]+)"/g)).map((m) => m[1]),
);

const viewer = (over: Partial<NavViewer> = {}): NavViewer => ({
  role: "owner",
  isSystemAdmin: false,
  irrigation: { records: true, reports: true, setup: true },
  hasAccountBilling: true,
  ...over,
});

describe("Portal navigation — destinations", () => {
  it("points every navigation destination at a declared route", () => {
    const paths = [...ACTIVITIES, ACCOUNT_ACTIVITY]
      .flatMap((a) => a.views.map((v) => v.path))
      .concat(SYSTEM_ADMIN_ITEMS.map((i) => i.path));
    for (const path of paths) {
      expect(declaredRoutes.has(path), `${path} is not a declared route`).toBe(true);
    }
  });

  it("corrects the previously broken fuel search targets", () => {
    const paths = searchDestinations(viewer()).map((d) => d.path);
    expect(paths).toContain("/fuel-purchases");
    expect(paths).toContain("/tractor-fuel-logs");
    expect(paths).not.toContain("/fuel/purchases");
    expect(paths).not.toContain("/fuel/tractor-logs");
  });

  it("uses the agreed sidebar order for an owner", () => {
    expect(accessibleActivities(viewer()).map((a) => a.label)).toEqual([
      "Dashboard",
      "Blocks",
      "Pins & Observations",
      "Weather",
      "Field Trips",
      "Work Tasks",
      "Spraying",
      "Pruning",
      "Yield & Harvest",
      "Irrigation",
      "Equipment & Fuel",
      "Reports & Exports",
      "Vineyard Settings",
    ]);
  });

  it("opens each activity directly on its first permitted destination", () => {
    const v = viewer();
    for (const activity of accessibleActivities(v)) {
      const target = defaultPathFor(activity, v);
      expect(target).toBe(accessibleViews(activity, v)[0].path);
    }
  });
});

describe("Portal navigation — current location", () => {
  const cases: [string, string, string][] = [
    ["/blocks/abc-123", "Blocks", "Overview"],
    ["/setup/paddocks/new", "Blocks", "Block Setup"],
    ["/settings/integrations/docs", "Vineyard Settings", "Integrations & API"],
    ["/settings/integrations/client-9", "Vineyard Settings", "Integrations & API"],
    ["/reports/yield-comparison", "Yield & Harvest", "Comparison"],
    ["/reports/yield", "Yield & Harvest", "Analytics"],
    ["/reports/pruning-activity", "Pruning", "Activity Report"],
    ["/irrigation/history", "Irrigation", "Records & History"],
    ["/setup/tractors/7", "Equipment & Fuel", "Tractors"],
    ["/account/billing", "Billing", "Billing & Invoices"],
  ];

  it.each(cases)("resolves %s to %s → %s", (path, activity, view) => {
    const found = resolveLocation(path);
    expect(found.activity?.label).toBe(activity);
    expect(found.view?.label).toBe(view);
  });
});

describe("Portal navigation — access", () => {
  it("keeps the Irrigation Advisor when record capability is absent", () => {
    const v = viewer({ irrigation: { records: false, reports: false, setup: false } });
    const irrigation = ACTIVITIES.find((a) => a.id === "irrigation")!;
    expect(accessibleViews(irrigation, v).map((x) => x.label)).toEqual(["Advisor"]);
  });

  it("hides Chemicals and Team from an operator but keeps the tracker", () => {
    const v = viewer({ role: "operator" });
    const spraying = ACTIVITIES.find((a) => a.id === "spraying")!;
    const labels = accessibleViews(spraying, v).map((x) => x.label);
    expect(labels).not.toContain("Chemicals");
    expect(labels).toContain("Resistance Planner");

    const settings = ACTIVITIES.find((a) => a.id === "settings")!;
    expect(accessibleViews(settings, v).map((x) => x.label)).not.toContain("Team");
  });

  it("keeps Integrations & API owner-only and inside Vineyard Settings", () => {
    const settings = ACTIVITIES.find((a) => a.id === "settings")!;
    const has = (role: string) =>
      accessibleViews(settings, viewer({ role })).some((x) => x.path === "/settings/integrations");
    expect(has("owner")).toBe(true);
    expect(has("manager")).toBe(false);
    expect(ACCOUNT_ACTIVITY.views.some((v) => v.path === "/settings/integrations")).toBe(false);
  });

  it("keeps both billing implementations reachable from the account menu", () => {
    const both = accessibleViews(ACCOUNT_ACTIVITY, viewer()).map((v) => v.path);
    expect(both).toEqual(["/account/billing", "/billing"]);
    const noAccount = accessibleViews(
      ACCOUNT_ACTIVITY,
      viewer({ hasAccountBilling: false }),
    ).map((v) => v.path);
    expect(noAccount).toEqual(["/billing"]);
  });

  it("does not expose System Admin surfaces to customers", () => {
    const customer = searchDestinations(viewer()).map((d) => d.path);
    expect(customer).not.toContain("/tools/satellite-mapping");
    expect(customer).not.toContain("/admin/dashboard");
    const admin = searchDestinations(viewer({ isSystemAdmin: true })).map((d) => d.path);
    expect(admin).toContain("/tools/satellite-mapping");
    expect(admin).toContain("/dashboard/how-vinetrack-works");
    expect(admin).toContain("/settings/data-coverage");
    expect(admin).toContain("/tools/fertiliser-calculator");
  });
});

describe("Portal navigation — reports catalogue", () => {
  it("lists every eligible report exactly once, using the work-area route", () => {
    const paths = reportDestinations(viewer()).map((d) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const expected of [
      "/reports/trips",
      "/reports/work-tasks",
      "/reports/pruning-activity",
      "/reports/spray",
      "/reports/rainfall",
      "/reports/growth-stage",
      "/reports/yield",
      "/reports/yield-comparison",
      "/reports/irrigation",
      "/reports/costs",
      "/reports/documents",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("hides cost reports from a supervisor", () => {
    expect(reportDestinations(viewer({ role: "supervisor" })).map((d) => d.path)).not.toContain(
      "/reports/costs",
    );
  });
});

describe("Portal navigation — old names still resolve", () => {
  const search = (q: string) =>
    searchDestinations(viewer({ isSystemAdmin: true }))
      .filter((d) =>
        [d.title, d.group, ...d.keywords].join(" ").toLowerCase().includes(q.toLowerCase()),
      )
      .map((d) => d.path);

  it.each([
    ["spray diary", "/reports/spray"],
    ["spray records", "/spray-records"],
    ["picking log", "/yield"],
    ["e-l", "/reports/growth-stage"],
    ["pruning report", "/reports/pruning-activity"],
    ["fuel purchases", "/fuel-purchases"],
    ["tractor fuel logs", "/tractor-fuel-logs"],
    ["growing season", "/setup/operational-preferences"],
    ["manual issues", "/pins"],
    ["worker types", "/setup/operator-categories"],
  ])("%s finds %s", (term, path) => {
    expect(search(term)).toContain(path);
  });
});
