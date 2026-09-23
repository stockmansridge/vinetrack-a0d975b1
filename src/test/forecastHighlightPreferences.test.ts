import { describe, expect, it } from "vitest";
import { createRegionFormatters } from "@/lib/regionFormatters";
import { AU_DEFAULTS } from "@/lib/vineyardRegionSettingsQuery";
import { DEFAULT_FORECAST_HIGHLIGHTS, forecastHighlightStorageKey, parseForecastHighlightPreferences, shouldHighlight } from "@/lib/forecastHighlightPreferences";

describe("forecast presentation highlights", () => {
  it("uses the requested defaults", () => {
    expect(DEFAULT_FORECAST_HIGHLIGHTS).toEqual({
      rain: { enabled: true, threshold: 5 },
      wind: { enabled: true, threshold: 15 },
      humidity: { enabled: false, threshold: 90 },
      tempMin: { enabled: false, threshold: 10 },
      tempMax: { enabled: false, threshold: 35 },
      sprayRain: { enabled: false, threshold: 0.1 },
    });
  });

  it("uses exact inclusive thresholds and honours disabled toggles", () => {
    expect(shouldHighlight(4.9, DEFAULT_FORECAST_HIGHLIGHTS.rain)).toBe(false);
    expect(shouldHighlight(5, DEFAULT_FORECAST_HIGHLIGHTS.rain)).toBe(true);
    expect(shouldHighlight(14.9, DEFAULT_FORECAST_HIGHLIGHTS.wind)).toBe(false);
    expect(shouldHighlight(15, DEFAULT_FORECAST_HIGHLIGHTS.wind)).toBe(true);
    expect(shouldHighlight(95, DEFAULT_FORECAST_HIGHLIGHTS.humidity)).toBe(false);
    expect(shouldHighlight(95, { enabled: true, threshold: 90 })).toBe(true);
  });

  it("namespaces persisted settings by vineyard", () => {
    expect(forecastHighlightStorageKey("vineyard-a")).not.toBe(forecastHighlightStorageKey("vineyard-b"));
  });

  it("round-trips valid persisted settings and rejects corrupt values", () => {
    const saved = { rain: { enabled: false, threshold: 7 }, wind: { enabled: true, threshold: 18 }, humidity: { enabled: true, threshold: 88 } };
    expect(parseForecastHighlightPreferences(JSON.stringify(saved))).toEqual({ ...DEFAULT_FORECAST_HIGHLIGHTS, ...saved });
    expect(parseForecastHighlightPreferences("bad json")).toEqual(DEFAULT_FORECAST_HIGHLIGHTS);
  });

  it("converts editor values to canonical mm and km/h", () => {
    const imperial = createRegionFormatters({ ...AU_DEFAULTS, distance_unit: "imperial" });
    expect(imperial.rainfallToCanonical(1)).toBeCloseTo(25.4);
    expect(imperial.windToCanonical(10)).toBeCloseTo(16.09344);
  });
});