// Local observation provider resolution for the Live Dashboard.
//
// "Local observation provider" = the source of MEASURED/current vineyard
// data (Davis WeatherLink, Weather Underground, or none). This is a
// different role from the FORECAST provider (WillyWeather / Open-Meteo),
// which is resolved elsewhere and is not touched here.
//
// Authority order (matches SQL 249):
//   1. The vineyard's explicit server selection
//      (get_vineyard_current_observation_provider).
//   2. Legacy vineyards with no explicit selection (RPC returns null):
//      Davis first if usable, otherwise Weather Underground.
// No third precedence rule exists.
import {
  fetchWeatherStatusForVineyard,
  fetchServerObservationProviderSelection,
  refreshDavisObservations,
  type WeatherIntegrationStatus,
} from "@/lib/weatherStatusQuery";
import { refreshWundergroundObservations } from "@/lib/wundergroundProxy";

export type LocalObservationProvider = "davis_weatherlink" | "wunderground" | "none";

export interface ObservationProviderRefresh {
  provider: LocalObservationProvider;
  /** True only when an upstream provider fetch was actually issued. */
  attempted: boolean;
  /** False only for a genuine provider failure. */
  ok: boolean;
  reason?: "provider_error" | "no_provider_configured";
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

/**
 * Single mapping point between the backend provider values
 * ('davis_weatherlink' | 'wunderground_pws' | 'none') and the Portal union.
 * Returns null when the value carries no explicit selection.
 */
export function mapBackendObservationProvider(
  raw?: string | null,
): LocalObservationProvider | null {
  if (!raw) return null;
  const value = raw.toLowerCase().trim();
  if (value === "none") return "none";
  return SOURCE_TO_PROVIDER[value] ?? null;
}

function isActive(s?: WeatherIntegrationStatus | null): boolean {
  return !!s?.configured && s.is_active !== false;
}

/**
 * Legacy fallback used only when the vineyard has no explicit server
 * selection: Davis first if usable, otherwise Weather Underground.
 */
export function resolveLocalObservationProvider(input: {
  davis?: WeatherIntegrationStatus | null;
  wunderground?: WeatherIntegrationStatus | null;
  observationSource?: string | null;
  /** Raw value from get_vineyard_current_observation_provider, if known. */
  serverSelection?: string | null;
}): LocalObservationProvider {
  const explicit = mapBackendObservationProvider(input.serverSelection);
  if (explicit) return explicit;

  if (isActive(input.davis)) return "davis_weatherlink";
  if (isActive(input.wunderground)) return "wunderground";
  const fromSource = providerFromObservationSource(input.observationSource);
  if (fromSource) return fromSource;
  if (input.davis?.configured) return "davis_weatherlink";
  if (input.wunderground?.configured) return "wunderground";
  return "none";
}

/**
 * Resolves the active observation provider: explicit server selection first,
 * integration status only as the legacy fallback.
 */
export async function fetchLocalObservationProvider(
  vineyardId: string,
  observationSource?: string | null,
): Promise<LocalObservationProvider> {
  const serverSelection = await fetchServerObservationProviderSelection(vineyardId);
  const explicit = mapBackendObservationProvider(serverSelection);
  if (explicit) return explicit;

  const status = await fetchWeatherStatusForVineyard(vineyardId);
  return resolveLocalObservationProvider({
    davis: status.davis,
    wunderground: status.wunderground,
    observationSource,
  });
}

/**
 * Provider-neutral current-observation refresh. Both Davis (davis-proxy
 * "current") and Weather Underground (wunderground-proxy "current") perform a
 * genuine upstream fetch and write the observation server-side.
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
    case "wunderground": {
      const proxy = await refreshWundergroundObservations(vineyardId);
      return {
        provider,
        attempted: true,
        ok: proxy.ok,
        reason: proxy.ok ? undefined : "provider_error",
        message: proxy.ok ? undefined : proxy.message,
      };
    }
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
      return "Live observations not refreshed (Weather Underground)";
    default:
      return "No local observation source configured";
  }
}

/**
 * Provider-aware "nothing newer" wording. Only truthful after a successful
 * upstream fetch actually happened.
 */
export function noNewerObservationsMessage(
  refresh: ObservationProviderRefresh,
): string | null {
  if (!refresh.attempted || !refresh.ok) return null;
  if (refresh.provider === "davis_weatherlink") {
    return "Davis WeatherLink returned no newer data — the station hasn't reported since the last update.";
  }
  if (refresh.provider === "wunderground") {
    return "Weather Underground returned no newer data — the station hasn't reported since the last update.";
  }
  return null;
}
