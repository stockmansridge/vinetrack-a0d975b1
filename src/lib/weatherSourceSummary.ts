// Pure derivation for the Weather Settings "Weather Data Sources" summary and
// per-provider "Currently used for" labels. Presentation only — it reads the
// same forecast preference, resolved observation provider and rainfall source
// label the page already computes; it never changes selection logic.
import type { ForecastProvider } from "@/lib/willyWeatherProxy";
import type { LocalObservationProvider } from "@/lib/localObservationProvider";

export type ForecastSourceId = "open_meteo" | "willyweather";
export type WeatherProviderId =
  | "open_meteo"
  | "willyweather"
  | "davis"
  | "wunderground"
  | "mait";

export interface EffectiveForecastSource {
  id: ForecastSourceId;
  label: string;
  /** True when the vineyard explicitly chose a provider rather than Auto. */
  isOverride: boolean;
}

/**
 * Resolves which service actually supplies 7-day forecasts. Auto (or unset)
 * is the app default: WillyWeather when a location is configured, otherwise
 * Open-Meteo. An explicit preference is a vineyard override.
 */
export function effectiveForecastSource(
  preference: ForecastProvider | null | undefined,
  willyConfigured: boolean,
): EffectiveForecastSource {
  if (preference === "willyweather") {
    return { id: "willyweather", label: "WillyWeather", isOverride: true };
  }
  if (preference === "open_meteo") {
    return { id: "open_meteo", label: "Open-Meteo Forecast", isOverride: true };
  }
  return willyConfigured
    ? { id: "willyweather", label: "WillyWeather", isOverride: false }
    : { id: "open_meteo", label: "Open-Meteo Forecast", isOverride: false };
}

/** Capabilities each provider CAN supply, derived from existing behaviour. */
export const PROVIDER_PROVIDES: Record<WeatherProviderId, string[]> = {
  open_meteo: ["Forecasts", "Historical rainfall archive"],
  willyweather: ["Forecasts"],
  davis: ["Live observations", "Rainfall actuals"],
  wunderground: ["Live observations", "Rainfall actuals"],
  mait: ["Live observations", "Rainfall actuals"],
};

/**
 * What each provider is actively selected for right now. A configured but
 * unselected provider returns an empty list so it is never presented as an
 * active source. Open-Meteo always carries the historical rainfall fallback.
 */
export function providerUsedFor(input: {
  forecastSource: ForecastSourceId;
  observationProvider: LocalObservationProvider;
  /** The page's rainfall actuals label, e.g. "Davis WeatherLink". */
  rainfallSource: string;
}): Record<WeatherProviderId, string[]> {
  const { forecastSource, observationProvider, rainfallSource } = input;
  return {
    open_meteo: [
      ...(forecastSource === "open_meteo" ? ["Forecasts"] : []),
      "Historical rainfall fallback",
    ],
    willyweather: forecastSource === "willyweather" ? ["Forecasts"] : [],
    davis: [
      ...(observationProvider === "davis_weatherlink" ? ["Live observations"] : []),
      ...(rainfallSource.startsWith("Davis") ? ["Rainfall actuals"] : []),
    ],
    wunderground: [
      ...(observationProvider === "wunderground" ? ["Live observations"] : []),
      ...(rainfallSource.startsWith("Weather Underground") ? ["Rainfall actuals"] : []),
    ],
    mait: observationProvider === "mait_intelliweb" ? ["Live observations"] : [],
  };
}
