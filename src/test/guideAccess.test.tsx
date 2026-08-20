import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GUIDE_ROLE_MATRIX,
  canOpenGuideRoute,
  canManageGuideImages,
  canViewGuide,
  guideActionDecision,
  setupActionDecision,
  setupHealthMode,
  showsDevelopmentLabels,
  showsInternalContent,
  showsSetupDiagnostics,
  visibleGuideItems,
  type GuideViewer,
} from "@/lib/guide/guideAccess";
import { HOW_VINETRACK_WORKS_CATALOGUE } from "@/lib/guide/howVineTrackWorksCatalogue";

const admin: GuideViewer = { isSystemAdmin: true, role: "owner" };
const owner: GuideViewer = { isSystemAdmin: false, role: "owner" };
const manager: GuideViewer = { isSystemAdmin: false, role: "manager" };
const supervisor: GuideViewer = { isSystemAdmin: false, role: "supervisor" };
const operator: GuideViewer = { isSystemAdmin: false, role: "operator" };

describe("Stage 5B — guide role matrix", () => {
  it("every vineyard role may view the guide", () => {
    for (const v of [admin, owner, manager, supervisor, operator]) {
      expect(canViewGuide(v)).toBe(true);
    }
    expect(canViewGuide({ isSystemAdmin: false, role: null })).toBe(false);
  });

  it("Setup Health is manageable by owner/manager and read-only below", () => {
    expect(setupHealthMode(owner)).toBe("manage");
    expect(setupHealthMode(manager)).toBe("manage");
    expect(setupHealthMode(supervisor)).toBe("read_only");
    expect(setupHealthMode(operator)).toBe("read_only");
    expect(GUIDE_ROLE_MATRIX.operator.setupHealth).toBe("read_only");
    expect(GUIDE_ROLE_MATRIX.system_admin.diagnostics).toBe(true);
  });

  it("internal content, dev labels, diagnostics and Guide Images stay admin-only", () => {
    for (const v of [owner, manager, supervisor, operator]) {
      expect(showsInternalContent(v)).toBe(false);
      expect(showsDevelopmentLabels(v)).toBe(false);
      expect(showsSetupDiagnostics(v)).toBe(false);
      expect(canManageGuideImages(v)).toBe(false);
    }
    expect(showsSetupDiagnostics(admin)).toBe(true);
    expect(canManageGuideImages(admin)).toBe(true);
  });

  it("hides internal Mapping / Crop Health entries from customer roles", () => {
    const internal = HOW_VINETRACK_WORKS_CATALOGUE.filter(
      (i) => i.availability !== "available" || i.visibilityGate === "system_admin",
    );
    expect(internal.length).toBeGreaterThan(0);
    const forOwner = visibleGuideItems(HOW_VINETRACK_WORKS_CATALOGUE, owner);
    for (const i of internal) expect(forOwner.find((x) => x.id === i.id)).toBeUndefined();
    expect(visibleGuideItems(HOW_VINETRACK_WORKS_CATALOGUE, admin)).toHaveLength(
      HOW_VINETRACK_WORKS_CATALOGUE.length,
    );
  });
});

describe("Stage 5B — guide actions never bypass permissions", () => {
  it("respects the portal page role matrix", () => {
    expect(canOpenGuideRoute("/team", operator)).toBe(false);
    expect(canOpenGuideRoute("/team", owner)).toBe(true);
    expect(canOpenGuideRoute("/setup/chemicals", supervisor)).toBe(false);
    expect(canOpenGuideRoute("/spray-jobs", supervisor)).toBe(true);
    expect(canOpenGuideRoute("/spray-jobs", operator)).toBe(false);
    // unrestricted routes stay open
    expect(canOpenGuideRoute("/pins", operator)).toBe(true);
  });

  it("keeps System Admin-only nav tools out of customer guide actions", () => {
    expect(canOpenGuideRoute("/tools/fertiliser-calculator", owner)).toBe(false);
    expect(canOpenGuideRoute("/tools/satellite-mapping", manager)).toBe(false);
    expect(canOpenGuideRoute("/tools/fertiliser-calculator", admin)).toBe(true);
    expect(guideActionDecision("/tools/fertiliser-calculator", operator).show).toBe(false);
  });

  it("offers read-only wording instead of an impossible setup action", () => {
    const d = setupActionDecision("/setup/vineyard", operator);
    expect(d.show).toBe(false);
    expect(d.hint).toMatch(/Owner or Manager/i);
    expect(setupActionDecision("/setup/vineyard", owner).show).toBe(true);
  });
});

// --- Rendering: customer vs System Admin -----------------------------------

vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: (globalThis as any).__isAdmin ?? false, loading: false }),
}));
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({
    selectedVineyardId: "v1",
    currentRole: (globalThis as any).__role ?? "operator",
  }),
}));

function setViewer(isAdmin: boolean, role: string) {
  (globalThis as any).__isAdmin = isAdmin;
  (globalThis as any).__role = role;
}

async function renderHero() {
  const { GuideHero } = await import("@/components/guide/GuideHero");
  const { showsDevelopmentLabels: shows } = await import("@/lib/guide/guideAccess");
  const viewer = {
    isSystemAdmin: (globalThis as any).__isAdmin as boolean,
    role: (globalThis as any).__role as any,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GuideHero showInternalBadge={shows(viewer)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Stage 5B — customer rendering", () => {
  it("customers never see the Internal preview badge; admins do", async () => {
    setViewer(false, "operator");
    await renderHero();
    expect(screen.queryByText(/internal preview/i)).toBeNull();

    setViewer(true, "owner");
    await renderHero();
    expect(screen.getAllByText(/internal preview/i).length).toBeGreaterThan(0);
  });

  it("setup health diagnostics render nothing for customer roles", async () => {
    const { SetupHealthDiagnostics } = await import(
      "@/components/guide/SetupHealthDiagnostics"
    );
    const summary = {
      checks: [],
      completedRequired: 0,
      totalRequired: 0,
      readinessPct: null,
      recommendedOutstanding: 0,
      groupStatuses: {},
      groupProgress: {},
      groups: [],
    } as any;

    setViewer(false, "manager");
    const { container } = render(<SetupHealthDiagnostics summary={summary} />);
    expect(container.textContent).not.toMatch(/diagnostics/i);

    setViewer(true, "manager");
    const admin = render(<SetupHealthDiagnostics summary={summary} />);
    expect(admin.container.textContent).toMatch(/Setup health diagnostics/i);
  });
});
