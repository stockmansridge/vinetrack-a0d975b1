// Weather integration helper.
//
// Schema (docs/supabase-schema.md §3.17, §5, §8.7):
//   `vineyard_weather_integrations` is RLS-locked. The portal MUST NOT
//   SELECT it directly and MUST NOT call
//   `reveal_vineyard_weather_integration_credentials`. All access goes
//   through these RPCs / edge functions:
//
//     get_vineyard_weather_integration(p_vineyard_id, p_provider)
//       — members read non-secret fields only.
//     save_vineyard_weather_integration(...)
//       — owner/manager. NULL credential args COALESCE existing values.
//     delete_vineyard_weather_integration(p_vineyard_id, p_provider)
//       — owner/manager.
//     edge function `davis-proxy`
//       — action "test_saved" tests stored creds server-side and updates
//         last_tested_at / last_test_status.
//       — action "test" tests newly-typed creds before save.
//
// We never log api_key / api_secret values from this module.
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
  caller_role?: string | null;
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
    caller_role: row.caller_role ?? null,
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

// ---------------------------------------------------------------------------
// Owner/Manager write helpers (Weather is the sanctioned portal-write
// exception per docs §8.7). All writes go through RPCs; we never touch
// the table directly and never reveal stored credentials.
// ---------------------------------------------------------------------------

export interface SaveWeatherInput {
  vineyardId: string;
  provider: WeatherProvider;
  isActive: boolean;
  stationId: string | null;
  stationName: string | null;
  /** New API key value, or null to keep existing. Never send "". */
  apiKey: string | null;
  /** New API secret value, or null to keep existing. Never send "". */
  apiSecret: string | null;
}

export async function saveWeatherIntegration(input: SaveWeatherInput) {
  const { error } = await (supabase.rpc as any)(
    "save_vineyard_weather_integration",
    {
      p_vineyard_id: input.vineyardId,
      p_provider: input.provider,
      p_is_active: input.isActive,
      p_station_id: input.stationId,
      p_station_name: input.stationName,
      p_api_key: input.apiKey, // NULL preserves existing via COALESCE
      p_api_secret: input.apiSecret, // NULL preserves existing via COALESCE
    },
  );
  if (error) throw error;
}

export async function deleteWeatherIntegration(
  vineyardId: string,
  provider: WeatherProvider,
) {
  const { error } = await (supabase.rpc as any)(
    "delete_vineyard_weather_integration",
    {
      p_vineyard_id: vineyardId,
      p_provider: provider,
    },
  );
  if (error) throw error;
}

export interface DavisTestResult {
  ok: boolean;
  message?: string;
  last_test_status?: string | null;
  last_tested_at?: string | null;
}

/** Tests stored server-side credentials. Updates last_tested_at server-side. */
export async function testSavedDavis(vineyardId: string): Promise<DavisTestResult> {
  const { data, error } = await supabase.functions.invoke("davis-proxy", {
    body: { action: "test_saved", vineyard_id: vineyardId },
  });
  if (error) return { ok: false, message: error.message };
  const ok = (data as any)?.ok ?? (data as any)?.success ?? false;
  return {
    ok: !!ok,
    message: (data as any)?.message ?? (data as any)?.error ?? undefined,
    last_test_status: (data as any)?.last_test_status ?? null,
    last_tested_at: (data as any)?.last_tested_at ?? null,
  };
}

/** Tests newly-typed credentials before saving. Does not persist. */
export async function testTypedDavis(args: {
  vineyardId: string;
  apiKey: string;
  apiSecret: string;
  stationId?: string | null;
}): Promise<DavisTestResult> {
  const { data, error } = await supabase.functions.invoke("davis-proxy", {
    body: {
      action: "test",
      vineyard_id: args.vineyardId,
      api_key: args.apiKey,
      api_secret: args.apiSecret,
      station_id: args.stationId ?? null,
    },
  });
  if (error) return { ok: false, message: error.message };
  const ok = (data as any)?.ok ?? (data as any)?.success ?? false;
  return {
    ok: !!ok,
    message: (data as any)?.message ?? (data as any)?.error ?? undefined,
  };
}
