import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  GUIDE_WORKFLOWS,
  guideWorkflow,
  workflowPlatforms,
  workflowProductAction,
} from "@/lib/guide/guideWorkflows";
import {
  GUIDE_IMAGE_SLOTS,
  guideImageGroups,
  guideImageSlot,
} from "@/lib/guide/guideImages";
import { HOW_VINETRACK_WORKS_CATALOGUE } from "@/lib/guide/howVineTrackWorksCatalogue";
import { deriveSetupHealth, EMPTY_SETUP_FACTS } from "@/lib/guide/setupHealth";
import GuideAreaPage from "@/pages/dashboard/GuideAreaPage";

// Guide images resolve through the shared store; stub it so tests control
// whether an uploaded asset exists for a given key.
const uploaded = new Map<string, { url: string; focus?: "left" | "center" | "right" }>();

vi.mock("@/lib/guide/guideImageStore", () => ({
  useGuideImages: () => ({ data: {} }),
  useGuideImage: (key?: string) => (key && uploaded.get(key)) || {},
  guideImagePublicUrl: () => undefined,
}));

vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: null }),
}));

function renderArea(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/dashboard/how-vinetrack-works/${slug}`]}>
        <Routes>
          <Route path="/dashboard/how-vinetrack-works/:area" element={<GuideAreaPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const AREAS = ["pins", "trips", "sprays", "work-tasks"] as const;

beforeEach(() => uploaded.clear());

describe("Stage 4A — workflow guide catalogue", () => {
  it("defines exactly the four field workflows", () => {
    expect(GUIDE_WORKFLOWS.map((w) => w.areaKey)).toEqual([
      "pins",
      "trips",
      "sprays",
      "work-tasks",
    ]);
  });

  it("keeps every workflow to 4–6 steps in a stable order", () => {
    for (const w of GUIDE_WORKFLOWS) {
      expect(w.steps.length).toBeGreaterThanOrEqual(4);
      expect(w.steps.length).toBeLessThanOrEqual(6);
      expect(w.sequence.length).toBe(w.steps.length);
    }
    expect(guideWorkflow("pins")!.sequence).toEqual([
      "Observe",
      "Drop Pin",
      "Add Details",
      "Action",
      "Complete",
      "History",
    ]);
    expect(guideWorkflow("sprays")!.sequence).toEqual([
      "Plan",
      "Blocks",
      "Products",
      "Apply",
      "Complete",
      "Spray Record",
    ]);
    expect(guideWorkflow("work-tasks")!.sequence).toEqual([
      "Create",
      "Assign",
      "Perform",
      "Record",
      "Track",
      "Complete",
    ]);
  });

  it("derives platforms from the verified catalogue only", () => {
    for (const w of GUIDE_WORKFLOWS) {
      const expected = new Set(
        w.catalogueItemIds.flatMap(
          (id) => HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === id)?.platforms ?? [],
        ),
      );
      expect(new Set(workflowPlatforms(w))).toEqual(expected);
    }
  });

  it("uses real product routes from the catalogue", () => {
    expect(workflowProductAction(guideWorkflow("pins")!)).toEqual({
      label: "Open Pins, Repairs & Observations",
      route: "/pins",
    });
    expect(workflowProductAction(guideWorkflow("trips")!)?.route).toBe("/trips");
    expect(workflowProductAction(guideWorkflow("sprays")!)?.route).toBe("/spray-jobs");
    expect(workflowProductAction(guideWorkflow("work-tasks")!)?.route).toBe("/work-tasks");
  });

  it("records what is captured and where it goes for every workflow", () => {
    for (const w of GUIDE_WORKFLOWS) {
      expect(w.recordedItems.length).toBeGreaterThan(0);
      expect(w.downstreamUses.length).toBeGreaterThan(0);
    }
  });
});

describe("Stage 4A — guide image keys", () => {
  it("adds workflow step keys without a second image system", () => {
    const keys = GUIDE_IMAGE_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const w of GUIDE_WORKFLOWS) {
      for (const step of w.steps) {
        if (!step.imageKey) continue;
        expect(keys).toContain(step.imageKey);
        expect(guideImageSlot(step.imageKey)!.group).toBe(w.areaKey);
      }
    }
  });

  it("keeps the primary area keys unchanged for the landing page", () => {
    const primary = GUIDE_IMAGE_SLOTS.filter((s) => s.primary).map((s) => s.key);
    expect(primary).toEqual([
      "hero",
      "setup",
      "pins",
      "trips",
      "sprays",
      "work-tasks",
      "operational-tools",
      "reports",
    ]);
  });

  it("groups slots for the admin manager", () => {
    const groups = guideImageGroups();
    const pins = groups.find((g) => g.group === "pins")!;
    expect(pins.primary.map((s) => s.key)).toEqual(["pins"]);
    expect(pins.workflow.map((s) => s.key)).toEqual([
      "pins.step.drop",
      "pins.step.details",
      "pins.step.complete",
    ]);
  });
});

describe("Stage 4A — workflow guide pages", () => {
  it.each(AREAS)("renders the %s workflow page", (slug) => {
    renderArea(slug);
    const w = guideWorkflow(slug)!;
    expect(screen.getByRole("heading", { name: "How it works" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What gets recorded" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where the information goes" })).toBeTruthy();
    for (const step of w.steps) {
      expect(screen.getByRole("heading", { name: step.title })).toBeTruthy();
    }
    const action = workflowProductAction(w)!;
    const links = screen.getAllByRole("link", { name: new RegExp(action.label) });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toBe(action.route);
  });

  it("falls back safely when a supporting image is missing", () => {
    const { container } = renderArea("pins");
    const slot = container.querySelector('[data-guide-image-key="pins.step.drop"]');
    expect(slot).toBeTruthy();
    expect(slot!.getAttribute("data-guide-image-state")).toBe("placeholder");
    expect(slot!.querySelector("img")).toBeNull();
  });

  it("uses an uploaded workflow image when one exists", () => {
    uploaded.set("pins.step.drop", { url: "https://cdn.example/pins-drop.png" });
    const { container } = renderArea("pins");
    const slot = container.querySelector('[data-guide-image-key="pins.step.drop"]');
    expect(slot!.getAttribute("data-guide-image-state")).toBe("image");
    expect(slot!.querySelector("img")!.getAttribute("src")).toBe(
      "https://cdn.example/pins-drop.png",
    );
  });

  it("never shows setup-health scoring on workflow pages", () => {
    for (const slug of AREAS) {
      const { container, unmount } = renderArea(slug);
      expect(container.textContent).not.toMatch(/Not checked yet|Setup health|readiness/i);
      unmount();
    }
  });
});

describe("Stage 4A — setup health untouched", () => {
  it("adds no workflow usage checks to the Core Setup denominator", () => {
    const summary = deriveSetupHealth(EMPTY_SETUP_FACTS);
    for (const check of summary.checks) {
      expect(check.id).not.toMatch(/^(pins|trips|sprays|work-tasks)\.step\./);
      expect(check.id).not.toMatch(/^usage\./);
    }
  });
});
