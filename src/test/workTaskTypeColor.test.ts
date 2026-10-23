import { describe, expect, it } from "vitest";
import { workTaskTypeBadgeClass, workTaskTypeColorKey } from "@/lib/workTaskTypeColor";

describe("work task type colour coding", () => {
  it("maps each default task type to its work family", () => {
    expect(workTaskTypeColorKey("Pruning")).toBe("canopy");
    expect(workTaskTypeColorKey("Leaf plucking")).toBe("canopy");
    expect(workTaskTypeColorKey("Shoot thinning")).toBe("canopy");
    expect(workTaskTypeColorKey("Wire lifting")).toBe("canopy");
    expect(workTaskTypeColorKey("Mowing")).toBe("ground");
    expect(workTaskTypeColorKey("Slashing")).toBe("ground");
    expect(workTaskTypeColorKey("Mulching")).toBe("ground");
    expect(workTaskTypeColorKey("Weeding")).toBe("ground");
    expect(workTaskTypeColorKey("Soil work")).toBe("ground");
    expect(workTaskTypeColorKey("Spraying")).toBe("spray");
    expect(workTaskTypeColorKey("Irrigation")).toBe("water");
    expect(workTaskTypeColorKey("Fertilising")).toBe("nutrient");
    expect(workTaskTypeColorKey("Harvesting")).toBe("harvest");
    expect(workTaskTypeColorKey("Planting")).toBe("planting");
    expect(workTaskTypeColorKey("Replanting")).toBe("planting");
    expect(workTaskTypeColorKey("Trellis repair")).toBe("repair");
    expect(workTaskTypeColorKey("Inspection")).toBe("inspection");
    expect(workTaskTypeColorKey("Other")).toBe("other");
  });

  it("gives every family a different colour so types stand apart in the list", () => {
    const classes = [
      "Pruning", "Mowing", "Spraying", "Irrigation", "Fertilising", "Harvesting",
      "Planting", "Trellis repair", "Inspection", "Machine work", "Other",
    ].map(workTaskTypeBadgeClass);
    expect(new Set(classes).size).toBe(classes.length);
  });

  it("colours custom types deterministically without inventing a family", () => {
    const first = workTaskTypeBadgeClass("Kestrel sweep");
    expect(first).toBe(workTaskTypeBadgeClass("Kestrel sweep"));
    expect(first).not.toBe(workTaskTypeBadgeClass("other"));
    // Unknown names still land on one of the real families, never the plain one.
    expect(workTaskTypeColorKey("Kestrel sweep")).not.toBe("other");
  });

  it("uses only the task design tokens, never raw colours", () => {
    for (const name of ["Pruning", "Spraying", "Harvesting", "Kestrel sweep", ""]) {
      const cls = workTaskTypeBadgeClass(name);
      expect(cls).toContain("task-");
      expect(cls).not.toMatch(/#[0-9a-f]{3}/i);
      expect(cls).not.toContain("bg-white");
      expect(cls).not.toContain("text-white");
    }
  });

  it("falls back to the neutral family when there is no task type", () => {
    expect(workTaskTypeColorKey(null)).toBe("other");
    expect(workTaskTypeColorKey("   ")).toBe("other");
  });
});
