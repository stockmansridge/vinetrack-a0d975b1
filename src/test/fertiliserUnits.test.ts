import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRegionFormatters } from "@/lib/regionFormatters";
import {
  areaToCanonical, areaToDisplay, costPerAreaLabel, costPerAreaToDisplay,
  quantityLabel, quantityToDisplay, rateLabel, rateToCanonical,
} from "@/lib/fertiliserUnits";

const metric = createRegionFormatters({ area_unit: "hectares", volume_unit: "litres", currency_code: "AUD" });
const acre = createRegionFormatters({ area_unit: "acres", volume_unit: "litres", currency_code: "AUD" });
const us = createRegionFormatters({ area_unit: "acres", volume_unit: "gallons", currency_code: "USD" });

describe("fertiliser area", () => {
  it("1 ha shows as 1 ha", () => expect(metric.area(1, 2)).toBe("1 ha"));
  it("1 ha shows as ~2.471 ac", () => {
    expect(areaToDisplay(1, acre)).toBeCloseTo(2.4711, 3);
    expect(acre.area(1, 3)).toBe("2.471 ac");
  });
  it("acre input converts back to hectares", () => expect(areaToCanonical(2.4710538, acre)).toBeCloseTo(1, 5));
});

describe("fertiliser rates", () => {
  it("kg/ha unchanged for hectares", () => {
    expect(rateLabel("perHectare", "solid", metric)).toBe("kg/ha");
    expect(rateToCanonical(50, "perHectare", "solid", metric)).toBe(50);
  });
  it("20 kg/ac → ~49.421 kg/ha", () => {
    expect(rateLabel("perHectare", "solid", acre)).toBe("kg/ac");
    expect(rateToCanonical(20, "perHectare", "solid", acre)).toBeCloseTo(49.421, 3);
  });
  it("L/ha metric liquid", () => {
    expect(rateLabel("perHectare", "liquid", metric)).toBe("L/ha");
    expect(quantityLabel("liquid", metric)).toBe("L");
  });
  it("gal/ac converts to L/ha and totals to gal", () => {
    expect(rateLabel("perHectare", "liquid", us)).toBe("gal/ac");
    expect(rateToCanonical(1, "perHectare", "liquid", us)).toBeCloseTo(9.354, 3);
    expect(quantityLabel("liquid", us)).toBe("gal");
    expect(quantityToDisplay(3.785411784, "liquid", us)).toBeCloseTo(1, 6);
  });
  it("solid stays kg under gallons/acres; per-vine untouched", () => {
    expect(quantityLabel("solid", us)).toBe("kg");
    expect(rateLabel("perVine", "solid", us)).toBe("g/vine");
    expect(rateLabel("perVine", "liquid", us)).toBe("mL/vine");
    expect(rateToCanonical(15, "perVine", "liquid", us)).toBe(15);
  });
});

describe("fertiliser cost", () => {
  it("uses vineyard currency", () => {
    expect(createRegionFormatters({ currency_code: "AUD" }).currency(10)).toMatch(/\$10\.00/);
    expect(createRegionFormatters({ currency_code: "USD" }).currency(10)).toMatch(/\$10\.00/);
    expect(createRegionFormatters({ currency_code: "GBP" }).currency(10)).toContain("£10.00");
  });
  it("cost per area converts", () => {
    expect(costPerAreaLabel(metric)).toBe("Cost per hectare");
    expect(costPerAreaToDisplay(500, metric)).toBe(500);
    expect(costPerAreaLabel(acre)).toBe("Cost per acre");
    expect(costPerAreaToDisplay(500, acre)).toBeCloseTo(202.34, 2);
  });
  it("no literal $ money formatting remains", () => {
    for (const f of ["src/components/fertiliser/FertiliserCalculatorDialog.tsx", "src/pages/tools/FertiliserCalculatorPage.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/`\$\$\{|"\$"|`\$[0-9]/);
    }
  });
});
