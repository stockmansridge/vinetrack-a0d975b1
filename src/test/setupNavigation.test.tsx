import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SETUP_DETAIL_ACTIONS,
  hasIndividualSetupActions,
  setupDetailActions,
  setupGroupAction,
} from "@/lib/guide/setupDetailActions";
import { setupActionDecision, type GuideViewer } from "@/lib/guide/guideAccess";
import {
  deriveSetupHealth,
  type SetupBlockFact,
  type SetupHealthFacts,
} from "@/lib/guide/setupHealth";
import { SetupHealthChecks } from "@/components/guide/SetupHealthChecks";

// ── helpers ────────────────────────────────────────────────────────────────
const appRoutes = new Set(
  Array.from(readFileSync("src/App.tsx", "utf8").matchAll(/path="([^"]+)"/g)).map(
    (m) => m[1],
  ),
);

const block = (over: Partial<SetupBlockFact> = {}): SetupBlockFact => ({
  id: Math.random().toString(36).slice(2),
  name: "Block",
  hasBoundary: true,
  hasRows: true,
  hasPlanting: true,
  hasPlantingDetail: true,
  isIrrigated: false,
  ...over,
});

const facts = (over: Partial<SetupHealthFacts> = {}): SetupHealthFacts => ({
  resolved: true,
  vineyard: { name: "Test Vineyard", hasLocation: true },
  blocks: [block()],
  weather: { anyConfigured: true },
  equipment: { tractors: 1, machines: 1, sprayEquipment: 1, other: 0 },
  team: { members: 3, owners: 1 },
  spray: { chemicals: 4, sprayEquipment: 1, operationalEvidence: 10 },
  irrigation: { applicable: true, systemsOk: true, valvesOk: true, allocationsOk: true },
  preferences: { seasonConfigured: true },
  ...over,
});

const renderChecks = (summary: ReturnType<typeof deriveSetupHealth>, collapsed: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SetupHealthChecks summary={summary} defaultCollapsed={collapsed} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

// ── 1. Equipment mapping ───────────────────────────────────────────────────
describe("Stage 5C.1 — Equipment setup destinations", () => {
  const routeFor = (id: string) =>
    setupDetailActions("equipment").find((a) => a.id === id)?.route;

  it("links every equipment item to its own configuration page", () => {
    expect(routeFor("equipment.tractors")).toBe("/setup/tractors");
    expect(routeFor("equipment.machines")).toBe("/setup/vineyard-machines");
    expect(routeFor("equipment.spray")).toBe("/setup/spray-equipment");
    expect(routeFor("equipment.other")).toBe("/setup/equipment-other");
  });

  it("drops the generic Equipment CTA because destinations differ", () => {
    expect(setupGroupAction("equipment")).toBeUndefined();
    expect(hasIndividualSetupActions("equipment")).toBe(true);
  });
});

// ── 2. Whole matrix ────────────────────────────────────────────────────────
describe("Stage 5C.1 — setup detail destination matrix", () => {
  it("points every actionable row at a real portal route", () => {
    for (const [group, actions] of Object.entries(SETUP_DETAIL_ACTIONS)) {
      expect(actions.length, group).toBeGreaterThan(0);
      for (const a of actions) expect(appRoutes.has(a.route), `${group}/${a.route}`).toBe(true);
    }
  });

  it("keeps a group CTA only where one destination configures the whole area", () => {
    expect(setupGroupAction("weather")).toBe("/setup/weather");
    expect(setupGroupAction("irrigation")).toBe("/irrigation/setup");
    expect(setupGroupAction("preferences")).toBe("/setup/operational-preferences");
    for (const g of ["vineyard", "equipment", "team", "spray"]) {
      expect(setupGroupAction(g), g).toBeUndefined();
    }
  });

  it("routes spray requirements to their own configuration surfaces", () => {
    const spray = setupDetailActions("spray");
    expect(spray.find((a) => a.id === "spray.equipment")?.route).toBe(
      "/setup/spray-equipment",
    );
    expect(spray.find((a) => a.id === "spray.chemicals")?.route).toBe("/setup/chemicals");
  });

  it("uses the existing Team surface without inventing a new route", () => {
    expect(setupDetailActions("team").map((a) => a.route)).toEqual([
      "/team",
      "/team",
      "/setup/operator-categories",
    ]);
  });
});

// ── 3. Permissions ─────────────────────────────────────────────────────────
describe("Stage 5C.1 — permission-aware setup item links", () => {
  it("never offers a destination the viewer cannot open", () => {
    const operator: GuideViewer = { isSystemAdmin: false, role: "operator" };
    const admin: GuideViewer = { isSystemAdmin: true, role: "owner" };
    for (const actions of Object.values(SETUP_DETAIL_ACTIONS)) {
      for (const a of actions) {
        expect(setupActionDecision(a.route, admin).show).toBe(true);
        const d = setupActionDecision(a.route, operator);
        if (!d.show) expect(d.hint).toBeTruthy();
      }
    }
  });
});

// ── 4. Collapse behaviour ──────────────────────────────────────────────────
describe("Stage 5C.1 — setup readiness collapse", () => {
  it("collapses the check list when required setup is complete, and reopens on demand", () => {
    const summary = deriveSetupHealth(facts());
    expect(summary.completedRequired).toBe(summary.totalRequired);
    renderChecks(summary, true);
    expect(screen.getByText(/required checks/)).toBeTruthy();
    expect(screen.queryByText("Vineyard profile")).toBeNull();
    fireEvent.click(screen.getByText("Show setup checks"));
    expect(screen.getByText("Vineyard profile")).toBeTruthy();
  });

  it("stays expanded while required setup is incomplete", () => {
    const summary = deriveSetupHealth(facts({ weather: { anyConfigured: false } }));
    expect(summary.actionsRequired).toBeGreaterThan(0);
    renderChecks(summary, false);
    expect(screen.getByText("Weather source connected")).toBeTruthy();
    expect(screen.getByText("Hide setup checks")).toBeTruthy();
  });
});

// ── 5. Operational Preferences ─────────────────────────────────────────────
describe("Stage 5C.1 — optional Preferences status", () => {
  const pref = (s: SetupHealthFacts["preferences"]) =>
    deriveSetupHealth(facts({ preferences: s })).checks.find(
      (c) => c.id === "preferences.season",
    )!;

  it("reports a persisted preference as Configured without touching readiness", () => {
    const base = deriveSetupHealth(facts());
    const c = pref({ seasonConfigured: true, seasonDetail: "Season starts 1 July" });
    expect(c.importance).toBe("optional");
    expect(c.status).toBe("complete");
    expect(c.statusLabel).toBe("Configured");
    expect(c.countsTowardReadiness).toBe(false);
    expect(base.readinessPct).toBe(100);
  });

  it("does not call unsaved defaults configured, and adds no penalty", () => {
    const s = deriveSetupHealth(facts({ preferences: { seasonConfigured: false } }));
    const c = s.checks.find((x) => x.id === "preferences.season")!;
    expect(c.statusLabel).toBe("Using defaults");
    expect(c.status).not.toBe("complete");
    expect(c.countsTowardReadiness).toBe(false);
    expect(s.readinessPct).toBe(100);
    expect(s.actionsRequired).toBe(0);
    expect(s.recommendedOutstanding).toBe(0);
  });

  it("says Unable to check rather than Not checked yet when the read fails", () => {
    const c = pref({ seasonConfigured: null });
    expect(c.statusLabel).toBe("Unable to check");
    expect(c.countsTowardReadiness).toBe(false);
  });
});
