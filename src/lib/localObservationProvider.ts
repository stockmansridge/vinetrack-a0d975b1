// Local observation provider resolution for the Live Dashboard.
//
// "Local observation provider" = the source of MEASURED/current vineyard
// data (Davis WeatherLink, Weather Underground, or none). This is a
// different role from the FORECAST provider (WillyWeather / Open-Meteo),
// which is resolved elsewhere and is not touched here.
//
// Provider knowledge comes from the existing Portal weather integration
// status (`get_vineyard_weather_integration` via
// fetchWeatherStatusForVineyard). This module adds no second
// provider-precedence system of its own.
import {
  fetchWeatherStatusForVineyard,
  refreshDavisObservations,
  type WeatherIntegrationStatus,
} from "@/lib/weatherStatusQuery";

export type LocalObservationProvider = "davis_weatherlink" | "wunderground" | "none";

export interface ObservationProviderRefresh {
  provider: LocalObservationProvider;
  /** True only when an upstream provider fetch was actually issued. */
  attempted: boolean;
  /** False only for a genuine provider failure — never for "not available yet". */
  ok: boolean;
  reason?:
    | "provider_error"
    | "backend_current_refresh_not_available"
    | "no_provider_configured";
  message?: string;
}

const SOURCE_TO_PROVIDER: Record<string, LocalObservationProvider> = {
  davis: "davis_weatherlink",
  davis_weatherlink: "davis_weatherlink",
  wunderground: "wunderground",
  wunderground_pws: "wunderground",
};

/** Maps an observation row's `source` string onto a provider, if it is one. */
export function providerFromObservationSource(
  source?: string | null,
): LocalObservationProvider | null {
  if (!source) return null;
  return SOURCE_TO_PROVIDER[source.toLowerCase()] ?? null;
}

function isActive(s?: WeatherIntegrationStatus | null): boolean {
  return !!s?.configured && s.is_active !== false;
}

/**
 * Resolves the active local observation provider from existing integration
 * status. The current observation source only breaks ties between two active
 * providers; it never invents a provider that is not configured.
 */
export function resolveLocalObservationProvider(input: {
  davis?: WeatherIntegrationStatus | null;
  wunderground?: WeatherIntegrationStatus | null;
  observationSource?: string | null;
}): LocalObservationProvider {
  const davisActive = isActive(input.davis);
  const wuActive = isActive(input.wunderground);
  const fromSource = providerFromObservationSource(input.observationSource);

  if (davisActive && wuActive) {
    return fromSource ?? "davis_weatherlink";
  }
  if (davisActive) return "davis_weatherlink";
  if (wuActive) return "wunderground";
  if (fromSource) return fromSource;
  if (input.davis?.configured) return "davis_weatherlink";
  if (input.wunderground?.configured) return "wunderground";
  return "none";
}

/** Reads integration status and resolves the active observation provider. */
export async function fetchLocalObservationProvider(
  vineyardId: string,
  observationSource?: string | null,
): Promise<LocalObservationProvider> {
  const status = await fetchWeatherStatusForVineyard(vineyardId);
  return resolveLocalObservationProvider({
    davis: status.davis,
    wunderground: status.wunderground,
    observationSource,
  });
}

/**
 * Provider-neutral current-observation refresh.
 *
 * Davis has a canonical current-fetch action (davis-proxy `current`).
 * Weather Underground has no Portal-callable current-refresh action in the
 * canonical backend yet, and the browser must never call WU directly, so the
 * WU branch reports "not attempted" WITHOUT reporting an error; the caller
 * simply re-reads the provider-neutral current-weather cache.
 */
export async function refreshObservationProvider(
  vineyardId: string,
  provider: LocalObservationProvider,
): Promise<ObservationProviderRefresh> {
  switch (provider) {
    case "davis_weatherlink": {
      const proxy = await refreshDavisObservations(vineyardId);
      return {
        provider,
        attempted: true,
        ok: proxy.ok,
        reason: proxy.ok ? undefined : "provider_error",
        message: proxy.ok ? undefined : proxy.message,
      };
    }
    case "wunderground":
      return {
        provider,
        attempted: false,
        ok: true,
        reason: "backend_current_refresh_not_available",
      };
    default:
      return { provider: "none", attempted: false, ok: true, reason: "no_provider_configured" };
  }
}

export function observationProviderLabel(provider: LocalObservationProvider): string {
  switch (provider) {
    case "davis_weatherlink":
      return "Davis WeatherLink";
    case "wunderground":
      return "Weather Underground";
    default:
      return "No local observation source";
  }
}

/** Provider-aware wording for a failed/unavailable observation refresh. */
export function observationFailureTitle(provider: LocalObservationProvider): string {
  switch (provider) {
    case "davis_weatherlink":
      return "Live observations not refreshed (Davis WeatherLink)";
    case "wunderground":
      return "Live observations unavailable (Weather Underground)";
    default:
      return "No local observation source configured";
  }
}

/**
 * Provider-aware "nothing newer" wording. Only Davis performs an upstream
 * fetch today, so only Davis can truthfully report no newer data.
 */
export function noNewerObservationsMessage(
  refresh: ObservationProviderRefresh,
): string | null {
  if (refresh.provider === "davis_weatherlink" && refresh.attempted && refresh.ok) {
    return "Davis WeatherLink returned no newer data — the station hasn't reported since the last update.";
  }
  return null;
}
