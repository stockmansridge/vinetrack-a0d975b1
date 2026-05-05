// READ-ONLY weather integration status helper.
//
// Schema (docs/supabase-schema.md §3.17):
//   `vineyard_weather_integrations` is RLS-locked. The portal MUST NOT
//   SELECT it directly and MUST NOT call
//   `reveal_vineyard_weather_integration_credentials`. Status is fetched
//   via the safe RPC:
//
//     get_vineyard_weather_integration(vineyard_id, provider)
//
//   which returns non-secret fields only (station id/name, sensor flags,
//   has_api_key / has_api_secret booleans, last_tested_at, last_test_status,
//   is_active). We call it once per supported provider.
import { supabase } from "@/integrations/ios-supabase/client";

export type WeatherProvider = "davis_weatherlink" | "wunderground";

export interface WeatherIntegrationStatus {
  provider: WeatherProvider;
  configured: boolean;
  is_active?: boolean | null;
  station_id?: string | null;
  station_name?: string | null;
  has_api_key?: boolean | null;
  has_api_secret?: boolean | null;
  has_leaf_wetness?: boolean | null;
  has_rain?: boolean | null;
  has_wind?: boolean | null;
  has_temperature_humidity?: boolean | null;
  detected_sensors?: string[] | null;
  last_tested_at?: string | null;
  last_test_status?: string | null;
  updated_at?: string | null;
  error?: string | null;
}

export interface WeatherStatusResult {
  davis: WeatherIntegrationStatus;
  wunderground: WeatherIntegrationStatus;
  rpcUsed: string;
  anyConfigured: boolean;
}

async function fetchOne(
  vineyardId: string,
  provider: WeatherProvider,
): Promise<WeatherIntegrationStatus> {
  const res = await (supabase.rpc as any)("get_vineyard_weather_integration", {
    p_vineyard_id: vineyardId,
    p_provider: provider,
  });
  if (res.error) {
    return { provider, configured: false, error: res.error.message };
  }
  // RPC may return a single row or an array depending on definition.
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { provider, configured: false };
  return {
    provider,
    configured: true,
    is_active: row.is_active ?? null,
    station_id: row.station_id ?? null,
    station_name: row.station_name ?? null,
    has_api_key: row.has_api_key ?? null,
    has_api_secret: row.has_api_secret ?? null,
    has_leaf_wetness: row.has_leaf_wetness ?? null,
    has_rain: row.has_rain ?? null,
    has_wind: row.has_wind ?? null,
    has_temperature_humidity: row.has_temperature_humidity ?? null,
    detected_sensors: row.detected_sensors ?? null,
    last_tested_at: row.last_tested_at ?? null,
    last_test_status: row.last_test_status ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export async function fetchWeatherStatusForVineyard(
  vineyardId: string,
): Promise<WeatherStatusResult> {
  const [davis, wunderground] = await Promise.all([
    fetchOne(vineyardId, "davis_weatherlink"),
    fetchOne(vineyardId, "wunderground"),
  ]);
  return {
    davis,
    wunderground,
    rpcUsed: "get_vineyard_weather_integration(vineyard_id, provider)",
    anyConfigured: davis.configured || wunderground.configured,
  };
}
