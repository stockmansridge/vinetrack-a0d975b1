// Regression coverage for weather display units driven by the shared
// vineyard Region & Units `distance_unit` selector (metric/imperial).
// Storage stays canonical (mm, °C, km/h) — these tests prove display-only
// conversion in both unit systems from the same canonical inputs.
import { describe, it, expect } from "vitest";
import { createRegionFormatters, AU_FORMATTERS } from "./regionFormatters";
import { AU_DEFAULTS } from "./vineyardRegionSettingsQuery";

const metric = createRegionFormatters({ ...AU_DEFAULTS, distance_unit: "metric" });
const imperial = createRegionFormatters({ ...AU_DEFAULTS, distance_unit: "imperial" });

describe("weather display units — metric", () => {
  it("labels are mm / °C / km/h", () => {
    expect(metric.rainfallUnitLabel).toBe("mm");
    expect(metric.temperatureUnitLabel).toBe("°C");
    expect(metric.windUnitLabel).toBe("km/h");
  });
  it("rainfall mm → mm", () => {
    expect(metric.rainfall(12.4)).toBe("12.4 mm");
    expect(metric.rainfall(0)).toBe("0 mm");
  });
  it("temperature °C → °C", () => {
    expect(metric.temperature(24.6)).toBe("24.6°C");
    expect(metric.temperature(0)).toBe("0°C");
  });
  it("wind km/h → km/h", () => {
    expect(metric.wind(17)).toBe("17 km/h");
  });
});

describe("weather display units — imperial", () => {
  it("labels are in / °F / mph", () => {
    expect(imperial.rainfallUnitLabel).toBe("in");
    expect(imperial.temperatureUnitLabel).toBe("°F");
    expect(imperial.windUnitLabel).toBe("mph");
  });
  it("rainfall mm → inches at 2dp", () => {
    expect(imperial.rainfall(25.4)).toBe("1 in");
    expect(imperial.rainfall(12.4)).toBe("0.49 in");
  });
  it("temperature °C → °F", () => {
    expect(imperial.temperature(0)).toBe("32°F");
    expect(imperial.temperature(24.6)).toBe("76.3°F");
  });
  it("wind km/h → mph", () => {
    expect(imperial.wind(16.09344)).toBe("10 mph");
  });
});

describe("weather display units — shared behaviour", () => {
  it("same canonical value renders under both systems", () => {
    // 10 mm canonical
    expect(metric.rainfall(10)).toBe("10 mm");
    expect(imperial.rainfall(10)).toBe("0.39 in");
  });
  it("AU default (missing distance_unit) is metric", () => {
    expect(AU_FORMATTERS.rainfall(5)).toBe("5 mm");
    expect(AU_FORMATTERS.temperature(20)).toBe("20°C");
    expect(AU_FORMATTERS.wind(10)).toBe("10 km/h");
  });
  it("null/undefined inputs render empty, never crash", () => {
    expect(metric.rainfall(null)).toBe("");
    expect(imperial.temperature(undefined)).toBe("");
    expect(imperial.wind("n/a")).toBe("");
  });
});
