import { describe, it, expect } from "vitest";
import {
  bootstrapGuideContent,
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

describe("Guide Content — canonical import of the existing guide", () => {
  it("populates every one of the seven sections with heading, intro and steps", () => {
    const content = defaultGuideContent();
    for (const area of manageableGuideAreas()) {
      const s = content[area.id];
      expect(s.heading.length).toBeGreaterThan(0);
      expect(s.intro.length).toBeGreaterThan(0);
      expect(s.steps.length).toBeGreaterThan(0);
      // Reuses the existing Guide Image key — never a new identifier.
      expect(s.imageKey).toBe(area.id);
    }
  });

  it("keeps the existing pins copy, platform labels and supporting items", () => {
    const pins = defaultGuideContent().pins;
    expect(pins.steps.map((s) => s.heading).slice(0, 3)).toEqual([
      "Find something in the vineyard",
      "Drop a Pin",
      "Add information",
    ]);
    expect(pins.steps[0].items?.length).toBeGreaterThan(0);
    expect(pins.steps[1].platform).toBeTruthy();
    expect(pins.steps[1].imageKey).toBe("pins.step.drop");
  });

  it("bootstraps missing sections but never overwrites managed edits", () => {
    const stored = {
      pins: {
        heading: "Edited heading",
        intro: "Edited intro",
        steps: [{ id: "pins.2", heading: "Only step", body: "b", enabled: true }],
      },
    };
    const { map, changed } = bootstrapGuideContent(stored);
    expect(changed).toBe(true);
    expect(map.pins.heading).toBe("Edited heading");
    expect(map.pins.steps).toHaveLength(1);
    expect(map.trips.steps.length).toBeGreaterThan(0);
    // Second pass is a no-op — repeated visits never rewrite the flag.
    expect(bootstrapGuideContent(map).changed).toBe(false);
  });
});
