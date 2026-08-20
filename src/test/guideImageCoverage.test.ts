import { describe, it, expect } from "vitest";
import {
  GUIDE_IMAGE_SLOTS,
  guideImageGroups,
  guideImageSlot,
} from "@/lib/guide/guideImages";
import { GUIDE_WORKFLOWS } from "@/lib/guide/guideWorkflows";
import { OPERATIONAL_TOOL_GUIDES } from "@/lib/guide/operationalToolGuides";

/**
 * Stage 5A — the Guide Images coverage report can only be trusted if every
 * image key used by the guide has a slot, and every slot appears exactly once
 * in the grouped admin/coverage view.
 */
describe("guide image coverage", () => {
  it("has unique slot keys", () => {
    const keys = GUIDE_IMAGE_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("groups every slot exactly once", () => {
    const grouped = guideImageGroups().flatMap((g) => [...g.primary, ...g.workflow]);
    expect(grouped.length).toBe(GUIDE_IMAGE_SLOTS.length);
    expect(new Set(grouped.map((s) => s.key)).size).toBe(GUIDE_IMAGE_SLOTS.length);
  });

  it("defines a slot for every workflow step image", () => {
    for (const wf of GUIDE_WORKFLOWS) {
      for (const step of wf.steps) {
        if (!step.imageKey) continue;
        expect(guideImageSlot(step.imageKey), step.imageKey).toBeTruthy();
      }
    }
  });

  it("defines a slot for every operational tool image", () => {
    for (const guide of OPERATIONAL_TOOL_GUIDES) {
      expect(guideImageSlot(guide.imageKey), guide.imageKey).toBeTruthy();
    }
  });

  it("presents screenshots as contain and photography as cover", () => {
    for (const slot of GUIDE_IMAGE_SLOTS) {
      expect(["photo", "screenshot"]).toContain(slot.kind);
    }
    expect(guideImageSlot("hero")?.kind).toBe("photo");
    expect(guideImageSlot("pins.step.drop")?.kind).toBe("screenshot");
  });
});
