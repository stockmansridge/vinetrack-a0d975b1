import { describe, it, expect } from "vitest";
import {
  defaultGuideContent,
  manageableGuideAreas,
  newGuideStep,
  parseGuideContent,
  visibleSteps,
} from "@/lib/guide/guideContent";

describe("Guide Content — managed sections", () => {
  it("exposes the seven manageable guide sections", () => {
    expect(manageableGuideAreas().map((a) => a.id)).toEqual([
      "setup",
      "pins",
      "trips",
      "sprays",
      "work-tasks",
      "operational-tools",
      "reports",
    ]);
  });

  it("defaults to the existing hard-coded guide content", () => {
    const content = defaultGuideContent();
    expect(content.pins.heading).toBe("Pins, Repairs & Observations");
    expect(content.pins.steps[1].heading).toBe("Drop a Pin");
    expect(content.pins.steps.every((s) => s.enabled)).toBe(true);
  });

  it("merges stored overrides over the defaults and ignores unknown sections", () => {
    const merged = parseGuideContent({
      pins: {
        heading: "Pins",
        intro: "Managed intro",
        steps: [{ id: "pins.2", heading: "Renamed", body: "Body", enabled: false }],
      },
      "not-a-section": { heading: "nope" },
    });
    expect(merged.pins.heading).toBe("Pins");
    expect(merged.pins.steps).toHaveLength(1);
    expect(visibleSteps(merged.pins)).toHaveLength(0);
    expect(merged["not-a-section"]).toBeUndefined();
    // Untouched sections keep their defaults.
    expect(merged.trips.steps.length).toBeGreaterThan(0);
  });

  it("creates unique step ids so repeated clicks cannot collide", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newGuideStep("pins").id));
    expect(ids.size).toBe(20);
  });
});
