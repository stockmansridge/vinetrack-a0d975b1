import { describe, expect, it } from "vitest";
import { workTaskTypeBadgeClass, workTaskTypeColorKey } from "@/lib/workTaskTypeColor";

describe("work task type colour coding", () => {
  it("maps each default task type to its individual colour key", () => {
    expect(workTaskTypeColorKey("Pruning")).toBe("canopy");
    expect(workTaskTypeColorKey("Leaf plucking")).toBe("leaf");
    expect(workTaskTypeColorKey("Shoot thinning")).toBe("shoot");
    expect(workTaskTypeColorKey("Wire lifting")).toBe("wire");
    expect(workTaskTypeColorKey("Mowing")).toBe("ground");
    expect(workTaskTypeColorKey("Slashing")).toBe("slashing");
    expect(workTaskTypeColorKey("Mulching")).toBe("mulch");
    expect(workTaskTypeColorKey("Weeding")).toBe("weed");
    expect(workTaskTypeColorKey("Soil work")).toBe("soil");
    expect(workTaskTypeColorKey("Spraying")).toBe("spray");
    expect(workTaskTypeColorKey("Irrigation")).toBe("water");
    expect(workTaskTypeColorKey("Fertilising")).toBe("nutrient");
    expect(workTaskTypeColorKey("Harvesting")).toBe("harvest");
    expect(workTaskTypeColorKey("Planting")).toBe("planting");
    expect(workTaskTypeColorKey("Replanting")).toBe("replant");
    expect(workTaskTypeColorKey("Trellis repair")).toBe("repair");
    expect(workTaskTypeColorKey("Inspection")).toBe("inspection");
    expect(workTaskTypeColorKey("Other")).toBe("other");
  });

  it("keeps the task types in Jonathan's list distinct, ignoring case and whitespace", () => {
    const types = ["Pruning", "Shoot Thinning", "Wire Lifting", "Mulching", "Removing Guards"];
    expect(new Set(types.map(workTaskTypeColorKey)).size).toBe(5);
    expect(workTaskTypeColorKey("  shoot   thinning  ")).toBe("shoot");
    expect(workTaskTypeColorKey("Removing Guards")).toBe("guards");
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
