// WillyWeather provider helpers.
//
// All calls go through the `willyweather-proxy` edge function on the iOS
// Supabase project. The browser must NEVER see the WillyWeather API key —
// the key is stored as the `WILLYWEATHER_API_KEY` edge function secret and
// is only used server-side.
//
// Vineyard-level WillyWeather config (location id, lat/lon, last test) is
// stored in `public.vineyard_weather_integrations` with provider =
// 'willyweather'. The forecast provider preference is stored on
// `public.vineyards.forecast_provider` and read/written via this proxy.
import { supabase } from "@/integrations/ios-supabase/client";

const IOS_SUPABASE_URL = "https://tbafuqwruefgkbyxrxyb.supabase.co";
const IOS_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw";

export type ForecastProvider = "auto" | "open_meteo" | "willyweather";

export interface WillyLocation {
  id: string;
  name: string;
  region?: string | null;
  state?: string | null;
  postcode?: string | null;
  latitude: number;
  longitude: number;
  distanceKm?: number | null;
}

export interface WillyProxyError {
  ok: false;
  code:
    | "not_configured"
    | "function_not_found"
    | "unauthorized"
    | "forbidden"
    | "network"
    | "unknown";
  message: string;
  status?: number;
}

function friendly(code: WillyProxyError["code"], fallback?: string): string {
  switch (code) {
    case "not_configured":
      return "WillyWeather is not configured yet.";
    case "function_not_found":
      return "WillyWeather service is not deployed yet.";
    case "unauthorized":
      return "Sign-in expired. Please sign out and sign in again.";
    case "forbidden":
      return "Only vineyard Owners and Managers can change this setting.";
    case "network":
      return fallback ?? "Network error contacting WillyWeather service.";
    default:
      return fallback ?? "WillyWeather request failed.";
  }
}

async function callProxy<T = any>(payload: Record<string, unknown>): Promise<
  { ok: true; data: T } | WillyProxyError
> {
  let token: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
  } catch {
    // ignore
  }
  if (!token) {
    return { ok: false, code: "unauthorized", message: friendly("unauthorized") };
  }
  let resp: Response;
  try {
    resp = await fetch(`${IOS_SUPABASE_URL}/functions/v1/willyweather-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: IOS_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    return {
      ok: false,
      code: "network",
      message: friendly("network", e?.message),
    };
  }
  if (resp.status === 404) {
    return {
      ok: false,
      code: "function_not_found",
      message: friendly("function_not_found"),
      status: 404,
    };
  }
  if (resp.status === 401) {
    return { ok: false, code: "unauthorized", message: friendly("unauthorized"), status: 401 };
  }
  if (resp.status === 403) {
    return { ok: false, code: "forbidden", message: friendly("forbidden"), status: 403 };
  }
  if (resp.status === 503) {
    return {
      ok: false,
      code: "not_configured",
      message: friendly("not_configured"),
      status: 503,
    };
  }
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  if (!resp.ok || body?.success === false) {
    const upstream = body?.http_status ? ` (upstream HTTP ${body.http_status})` : "";
    const detail = body?.message ?? body?.error ?? `HTTP ${resp.status}`;
    // eslint-disable-next-line no-console
    console.warn("[willyweather-proxy] error", {
      status: resp.status,
      payload,
      body,
    });
    return {
      ok: false,
      code: "unknown",
      message: friendly("unknown", `${detail}${upstream}`),
      status: resp.status,
    };
  }
  // eslint-disable-next-line no-console
  console.debug("[willyweather-proxy] ok", { payload, body });
  return { ok: true, data: body as T };
}

// ---------- Forecast provider preference ----------

export async function getForecastProvider(
  vineyardId: string,
): Promise<ForecastProvider> {
  const r = await callProxy<{ provider?: ForecastProvider }>({
    action: "get_provider_preference",
    vineyardId,
  });
  if (!r.ok) return "auto";
  const p = r.data?.provider;
  if (p === "auto" || p === "open_meteo" || p === "willyweather") return p;
  return "auto";
}

export async function setForecastProvider(
  vineyardId: string,
  provider: ForecastProvider,
): Promise<{ ok: boolean; message?: string }> {
  const r = await callProxy({
    action: "set_provider_preference",
    vineyardId,
    provider,
  });
  if (!r.ok) return { ok: false, message: (r as WillyProxyError).message };
  return { ok: true };
}

// ---------- WillyWeather integration management ----------

export interface WillyIntegrationStatus {
  configured: boolean;
  is_active: boolean | null;
  station_id: string | null;
  station_name: string | null;
  station_latitude: number | null;
  station_longitude: number | null;
  last_tested_at: string | null;
  last_test_status: string | null;
  caller_role?: string | null;
  error?: string | null;
}

export async function fetchWillyWeatherStatus(
  vineyardId: string,
): Promise<WillyIntegrationStatus> {
  const res = await (supabase.rpc as any)("get_vineyard_weather_integration", {
    p_vineyard_id: vineyardId,
    p_provider: "willyweather",
  });
  if (res.error) {
    return {
      configured: false,
      is_active: null,
      station_id: null,
      station_name: null,
      station_latitude: null,
      station_longitude: null,
      last_tested_at: null,
      last_test_status: null,
      error: res.error.message,
    };
  }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) {
    return {
      configured: false,
      is_active: null,
      station_id: null,
      station_name: null,
      station_latitude: null,
      station_longitude: null,
      last_tested_at: null,
      last_test_status: null,
    };
  }
  return {
    configured: true,
    is_active: row.is_active ?? null,
    station_id: row.station_id ?? null,
    station_name: row.station_name ?? null,
    station_latitude: row.station_latitude ?? row.latitude ?? null,
    station_longitude: row.station_longitude ?? row.longitude ?? null,
    last_tested_at: row.last_tested_at ?? null,
    last_test_status: row.last_test_status ?? null,
    caller_role: row.caller_role ?? null,
  };
}

export async function searchWillyLocations(
  vineyardId: string,
  query: string,
): Promise<{ ok: true; locations: WillyLocation[] } | WillyProxyError> {
  const r = await callProxy<{ locations: WillyLocation[] }>({
    action: "search_locations",
    vineyardId,
    query,
  });
  if (!r.ok) return r as WillyProxyError;
  return { ok: true, locations: r.data?.locations ?? [] };
}

export async function searchNearestWillyLocation(
  vineyardId: string,
  lat: number,
  lon: number,
): Promise<{ ok: true; locations: WillyLocation[] } | WillyProxyError> {
  const r = await callProxy<{ locations: WillyLocation[] }>({
    action: "search_locations",
    vineyardId,
    lat,
    lon,
  });
  if (!r.ok) return r as WillyProxyError;
  return { ok: true, locations: r.data?.locations ?? [] };
}

export async function setWillyLocation(
  vineyardId: string,
  loc: { id: string; name: string; latitude: number; longitude: number },
): Promise<{ ok: boolean; message?: string }> {
  const r = await callProxy({
    action: "set_location",
    vineyardId,
    locationId: loc.id,
    locationName: loc.name,
    latitude: loc.latitude,
    longitude: loc.longitude,
  });
  if (!r.ok) return { ok: false, message: (r as WillyProxyError).message };
  return { ok: true };
}

export async function testWillyConnection(
  vineyardId: string,
): Promise<{ ok: boolean; message?: string }> {
  const r = await callProxy({ action: "test_connection", vineyardId });
  if (!r.ok) return { ok: false, message: (r as WillyProxyError).message };
  return { ok: true };
}

export async function deleteWillyIntegration(
  vineyardId: string,
): Promise<{ ok: boolean; message?: string }> {
  const r = await callProxy({ action: "delete", vineyardId });
  if (!r.ok) return { ok: false, message: (r as WillyProxyError).message };
  return { ok: true };
}
