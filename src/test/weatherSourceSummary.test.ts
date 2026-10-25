import { describe, expect, it } from "vitest";
import {
  effectiveForecastSource,
  providerUsedFor,
  PROVIDER_PROVIDES,
} from "@/lib/weatherSourceSummary";

describe("effectiveForecastSource", () => {
  it("treats an explicit WillyWeather preference as a vineyard override", () => {
    const s = effectiveForecastSource("willyweather", true);
    expect(s).toMatchObject({ id: "willyweather", label: "WillyWeather", isOverride: true });
  });

  it("treats an explicit Open-Meteo preference as a vineyard override", () => {
    const s = effectiveForecastSource("open_meteo", true);
    expect(s).toMatchObject({ id: "open_meteo", isOverride: true });
  });

  it("resolves Auto to WillyWeather when a location is configured (app default)", () => {
    const s = effectiveForecastSource("auto", true);
    expect(s).toMatchObject({ id: "willyweather", isOverride: false });
  });

  it("resolves Auto to Open-Meteo when WillyWeather is not configured", () => {
    expect(effectiveForecastSource("auto", false)).toMatchObject({ id: "open_meteo", isOverride: false });
    expect(effectiveForecastSource(null, false)).toMatchObject({ id: "open_meteo", isOverride: false });
    expect(effectiveForecastSource(undefined, false)).toMatchObject({ id: "open_meteo", isOverride: false });
  });
});

describe("providerUsedFor", () => {
  it("represents the currently selected providers correctly", () => {
    const used = providerUsedFor({
      forecastSource: "willyweather",
      observationProvider: "davis_weatherlink",
      rainfallSource: "Davis WeatherLink",
    });
    expect(used.willyweather).toEqual(["Forecasts"]);
    expect(used.davis).toEqual(["Live observations", "Rainfall actuals"]);
    expect(used.open_meteo).toEqual(["Historical rainfall fallback"]);
  });

  it("never presents a configured-but-unselected provider as an active source", () => {
    const used = providerUsedFor({
      forecastSource: "open_meteo",
      observationProvider: "davis_weatherlink",
      rainfallSource: "Davis WeatherLink",
    });
    // Weather Underground may be configured, but nothing selected it.
    expect(used.wunderground).toEqual([]);
    expect(used.willyweather).toEqual([]);
    expect(used.mait).toEqual([]);
  });

  it("keeps capability labels for unconnected providers so Connect actions stay meaningful", () => {
    const used = providerUsedFor({
      forecastSource: "open_meteo",
      observationProvider: "none",
      rainfallSource: "Open-Meteo Archive (fallback)",
    });
    expect(used.mait).toEqual([]);
    expect(PROVIDER_PROVIDES.mait).toEqual(["Live observations", "Rainfall actuals"]);
    expect(PROVIDER_PROVIDES.wunderground).toContain("Rainfall actuals");
  });

  it("credits Weather Underground for observations and rainfall when selected", () => {
    const used = providerUsedFor({
      forecastSource: "open_meteo",
      observationProvider: "wunderground",
      rainfallSource: "Weather Underground",
    });
    expect(used.wunderground).toEqual(["Live observations", "Rainfall actuals"]);
    expect(used.davis).toEqual([]);
  });

  it("credits MAIT for live observations only when it is the selected source", () => {
    const used = providerUsedFor({
      forecastSource: "open_meteo",
      observationProvider: "mait_intelliweb",
      rainfallSource: "Open-Meteo Archive (fallback)",
    });
    expect(used.mait).toEqual(["Live observations"]);
  });

  it("always keeps Open-Meteo as the historical rainfall fallback", () => {
    const used = providerUsedFor({
      forecastSource: "willyweather",
      observationProvider: "wunderground",
      rainfallSource: "Weather Underground",
    });
    expect(used.open_meteo).toEqual(["Historical rainfall fallback"]);
  });
});
