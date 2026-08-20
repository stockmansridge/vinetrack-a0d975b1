import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  OPERATIONAL_TOOL_GUIDES,
  operationalToolGuide,
  operationalToolGuides,
  operationalToolGuideRoute,
  operationalToolCatalogueItem,
  OPERATIONAL_TOOLS_ROUTE,
} from "@/lib/guide/operationalToolGuides";
import {
  HOW_VINETRACK_WORKS_CATALOGUE,
  SHARED_OPERATIONAL_TOOL_IDS,
} from "@/lib/guide/howVineTrackWorksCatalogue";
import { GUIDE_IMAGE_SLOTS, guideImageGroups } from "@/lib/guide/guideImages";
import OperationalToolGuidePage from "@/pages/dashboard/OperationalToolGuidePage";
import { EMPTY_SETUP_FACTS, deriveSetupHealth } from "@/lib/guide/setupHealth";

function renderToolRoute(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/dashboard/how-vinetrack-works/operational-tools/:tool"
            element={<OperationalToolGuidePage />}
          />
          <Route
            path="/dashboard/how-vinetrack-works/operational-tools"
            element={<div>Tool catalogue</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Stage 4B — operational tool guide catalogue", () => {
  it("covers exactly the 13 shared operational tool IDs, once each", () => {
    const ids = OPERATIONAL_TOOL_GUIDES.map((g) => g.toolId);
    expect(ids).toHaveLength(SHARED_OPERATIONAL_TOOL_IDS.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...SHARED_OPERATIONAL_TOOL_IDS].sort());
  });

  it("resolves every guide by its stable ID and rejects unknown IDs", () => {
    for (const id of SHARED_OPERATIONAL_TOOL_IDS) {
      expect(operationalToolGuide(id)?.toolId).toBe(id);
    }
    expect(operationalToolGuide("not_a_tool")).toBeUndefined();
    expect(operationalToolGuide(undefined)).toBeUndefined();
  });

  it("builds tool routes under the operational tools catalogue route", () => {
    for (const guide of operationalToolGuides()) {
      expect(operationalToolGuideRoute(guide.toolId)).toBe(
        `${OPERATIONAL_TOOLS_ROUTE}/${guide.toolId}`,
      );
    }
  });

  it("derives platforms from the verified catalogue rather than hand-typed values", () => {
    for (const guide of OPERATIONAL_TOOL_GUIDES) {
      const item = operationalToolCatalogueItem(guide);
      expect(item, `missing catalogue item for ${guide.toolId}`).toBeTruthy();
      expect(item!.platforms.length).toBeGreaterThan(0);
    }
  });

  it("never invents a web route for a mobile-only tool", () => {
    for (const guide of OPERATIONAL_TOOL_GUIDES) {
      const item = operationalToolCatalogueItem(guide)!;
      if (!item.platforms.includes("web")) {
        expect(item.webRoute, `${guide.toolId} must not have a web route`).toBeFalsy();
      }
    }
  });

  it("keeps every guide concise and complete", () => {
    for (const guide of OPERATIONAL_TOOL_GUIDES) {
      expect(guide.purpose.length).toBeGreaterThan(10);
      expect(guide.useCases.length).toBeGreaterThanOrEqual(2);
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.steps.length).toBeLessThanOrEqual(5);
      expect(guide.recordedOrCalculated.length).toBeGreaterThan(0);
      expect(guide.outcomes.length).toBeGreaterThan(0);
    }
  });
});

describe("Stage 4B — guide imagery", () => {
  it("defines one image slot per tool and the reports supporting visuals", () => {
    for (const guide of OPERATIONAL_TOOL_GUIDES) {
      expect(GUIDE_IMAGE_SLOTS.some((s) => s.key === guide.imageKey)).toBe(true);
    }
    for (const key of ["reports.activity", "reports.costs", "reports.sprays"]) {
      expect(GUIDE_IMAGE_SLOTS.some((s) => s.key === key)).toBe(true);
    }
  });

  it("groups tool images under a collapsible Operational Tools section", () => {
    const group = guideImageGroups().find((g) => g.group === "operational-tools");
    expect(group).toBeTruthy();
    expect(group!.workflow.length).toBe(SHARED_OPERATIONAL_TOOL_IDS.length);
    expect(group!.secondaryLabel).toBe("Tool images");
  });

  it("keeps image slot keys unique across all stages", () => {
    const keys = GUIDE_IMAGE_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Stage 4B — tool guide route", () => {
  it("renders the guide for a valid tool ID", () => {
    renderToolRoute("/dashboard/how-vinetrack-works/operational-tools/pruning_tracker");
    const guide = operationalToolGuide("pruning_tracker")!;
    const item = operationalToolCatalogueItem(guide)!;
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(item.title);
    expect(screen.getByText("When you would use it")).toBeTruthy();
    expect(screen.getByText("How it works")).toBeTruthy();
  });

  it("falls back to the catalogue for an unknown tool ID", () => {
    renderToolRoute("/dashboard/how-vinetrack-works/operational-tools/made_up_tool");
    expect(screen.getByText("Tool catalogue")).toBeTruthy();
  });
});

describe("Stage 4B — no impact on Core Setup health", () => {
  it("adds no setup health checks and no completion scoring", () => {
    const ids = deriveSetupHealth(EMPTY_SETUP_FACTS).checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith("tool."))).toBe(false);
    expect(ids.some((id) => id.startsWith("guide."))).toBe(false);
  });

  it("leaves the verified catalogue untouched by the guide layer", () => {
    expect(HOW_VINETRACK_WORKS_CATALOGUE.length).toBeGreaterThan(0);
    for (const item of HOW_VINETRACK_WORKS_CATALOGUE) {
      if (item.availability !== "available") {
        expect(
          OPERATIONAL_TOOL_GUIDES.some((g) => g.catalogueItemId === item.id),
          `${item.id} is not available and must not have a customer-facing tool guide`,
        ).toBe(false);
      }
    }
  });
});
