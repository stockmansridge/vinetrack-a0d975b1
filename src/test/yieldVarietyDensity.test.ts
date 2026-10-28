import { describe, expect, it } from "vitest";
import { varietyTonnesPerHa, yieldTonnesPerHa } from "@/lib/yieldVarietyDensity";

describe("Variety Overview tonnes per hectare", () => {
  it("divides a block's variety yield by its allocated hectares", () => {
    expect(yieldTonnesPerHa(12, 1.5)).toBe(8);
  });
  it("divides total yield by total allocated area, not average block density", () => {
    expect(varietyTonnesPerHa([{ tonnes: 10, areaHa: 1 }, { tonnes: 30, areaHa: 9 }])).toBe(4);
  });
  it("counts separate planting areas once without duplicating the full block", () => {
    expect(varietyTonnesPerHa([{ tonnes: 6, areaHa: 0.5 }, { tonnes: 4, areaHa: 0.5 }])).toBe(10);
  });
  it("retains a genuine zero yield", () => {
    expect(yieldTonnesPerHa(0, 2)).toBe(0);
  });
  it.each([null, 0, -1, NaN, Infinity])("leaves invalid area %s unavailable", (area) => {
    expect(yieldTonnesPerHa(10, area)).toBeNull();
    expect(varietyTonnesPerHa([{ tonnes: 10, areaHa: area }])).toBeNull();
  });
  it("does not invent yields for missing weights or incomplete totals", () => {
    expect(yieldTonnesPerHa(null, 2)).toBeNull();
    expect(varietyTonnesPerHa([{ tonnes: 12, areaHa: 2 }, { tonnes: null, areaHa: 1 }])).toBeNull();
    expect(varietyTonnesPerHa([])).toBeNull();
  });
});