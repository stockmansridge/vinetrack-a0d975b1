import { describe, expect, it } from "vitest";
import { tripFunctionBadgeClass, tripFunctionColorKey, tripFunctionDotClass } from "@/lib/tripFunctionColor";
import { TRIP_FUNCTION_LABELS } from "@/lib/tripFunctionLabels";

describe("trip function colour coding", () => {
  it("maps each known function to an explicit colour family", () => {
    expect(tripFunctionColorKey("spraying")).toBe("spray");
    expect(tripFunctionColorKey("slashing")).toBe("slashing");
    expect(tripFunctionColorKey("mulching")).toBe("mulch");
    expect(tripFunctionColorKey("harrowing")).toBe("soil");
    expect(tripFunctionColorKey("mowing")).toBe("ground");
    expect(tripFunctionColorKey("seeding")).toBe("planting");
    expect(tripFunctionColorKey("spreading")).toBe("nutrient");
    expect(tripFunctionColorKey("fertilising")).toBe("nutrient");
    expect(tripFunctionColorKey("undervineWeeding")).toBe("weed");
    expect(tripFunctionColorKey("interRowCultivation")).toBe("soil");
    expect(tripFunctionColorKey("pruning")).toBe("canopy");
    expect(tripFunctionColorKey("shootThinning")).toBe("shoot");
    expect(tripFunctionColorKey("canopyWork")).toBe("leaf");
    expect(tripFunctionColorKey("irrigationCheck")).toBe("water");
    expect(tripFunctionColorKey("repairs")).toBe("repair");
    expect(tripFunctionColorKey("other")).toBe("other");
  });

  it("gives the distinct function labels distinct colour families", () => {
    const keys = Object.keys(TRIP_FUNCTION_LABELS).map(tripFunctionColorKey);
    expect(new Set(keys).size).toBe(new Set(TRIP_FUNCTION_LABELS.values()).size);
  });

  it("colours unknown functions deterministically without inventing data", () => {
    expect(tripFunctionColorKey("fencing")).toBe(tripFunctionColorKey("fencing"));
    expect(tripFunctionColorKey("fencing")).not.toBe(tripFunctionColorKey("mowing"));
    expect(tripFunctionColorKey("  mulching ")).toBe("mulch");
    expect(tripFunctionColorKey(null)).toBe("other");
    expect(tripFunctionColorKey("")).toBe("other");
  });

  it("uses only the shared task design tokens, never raw colours", () => {
    for (const raw of ["spraying", "mulching", "pruning", "somethingNew", ""]) {
      const badge = tripFunctionBadgeClass(raw);
      expect(badge).toContain("task-");
      expect(badge).not.toMatch(/#[0-9a-f]{3}/i);
      expect(tripFunctionDotClass(raw)).toMatch(/^bg-task-/);
    }
  });
});
