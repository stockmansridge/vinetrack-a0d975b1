// 7-day rain forecast helper.
//
// Strategy:
//   1. Try server-side RPC `public.get_vineyard_rain_forecast(p_vineyard_id, p_days)`.
//   2. If the RPC isn't deployed, returns no data, or errors, fall back to a
//      direct Open-Meteo Forecast API call using the vineyard's configured
//      weather-station coordinates (Davis / Wunderground integration).
//   3. If we still have no coordinates, return a clear reason so the UI can
//      surface it (e.g. "Forecast unavailable — vineyard coordinates not set").
import { supabase } from "@/integrations/ios-supabase/client";
import { parsePolygonPoints, polygonCentroid } from "@/lib/paddockGeometry";
import {
  fetchWillyWeatherStatus,
  getForecastProvider,
} from "@/lib/willyWeatherProxy";

const IOS_SUPABASE_URL = "https://tbafuqwruefgkbyxrxyb.supabase.co";
const IOS_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw";

async function fetchWillyWeatherForecast(
  vineyardId: string,
  days: number,
): Promise<RainForecastResult> {
  let token: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
  } catch {
    /* ignore */
  }
  if (!token) {
    return { available: false, reason: "error", message: "Not signed in" };
  }
  try {
    const resp = await fetch(`${IOS_SUPABASE_URL}/functions/v1/willyweather-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: IOS_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action: "fetch_forecast", vineyardId, days }),
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || body?.success === false || body?.ok === false) {
      // eslint-disable-next-line no-console
      console.warn("[willyweather fetch_forecast] failed", { status: resp.status, body });
      return {
        available: false,
        reason: "error",
        message: body?.message ?? body?.error ?? `WillyWeather HTTP ${resp.status}`,
      };
    }
    const raw: any[] = body?.days ?? body?.forecast ?? body?.daily ?? [];
    const out: RainForecastDay[] = (Array.isArray(raw) ? raw : []).map((r: any) => ({
      date: String(r.date ?? r.day ?? r.forecast_date ?? ""),
      rainfall_mm: r.rainfall_mm ?? r.rain_mm ?? r.precip_mm ?? r.amount_mm ?? null,
      probability_pct: r.probability_pct ?? r.pop ?? r.rain_probability ?? null,
      temp_max_c: r.temp_max_c ?? r.temperature_max_c ?? r.max_temp_c ?? null,
      temp_min_c: r.temp_min_c ?? r.temperature_min_c ?? r.min_temp_c ?? null,
      wind_max_kmh: r.wind_max_kmh ?? r.wind_speed_max_kmh ?? r.max_wind_kmh ?? null,
    }));
    if (!out.length) {
      return { available: false, reason: "no_data", message: "WillyWeather returned no days" };
    }
    return { available: true, days: out, source: "willyweather_forecast", via: "willyweather" };
  } catch (e: any) {
    return { available: false, reason: "error", message: e?.message ?? "network error" };
  }
}

export interface RainForecastDay {
  date: string; // YYYY-MM-DD
  rainfall_mm: number | null;
  probability_pct?: number | null;
  temp_max_c?: number | null;
  temp_min_c?: number | null;
  wind_max_kmh?: number | null;
}

export type RainForecastReason =
  | "rpc_missing"
  | "no_data"
  | "no_coords"
  | "error";

export type RainForecastResult =
  | { available: true; days: RainForecastDay[]; source: string | null; via: "rpc" | "open_meteo" | "willyweather" }
  | { available: false; reason: RainForecastReason; message?: string };

async function tryRpc(vineyardId: string, days: number): Promise<RainForecastResult | null> {
  const res = await (supabase.rpc as any)("get_vineyard_rain_forecast", {
    p_vineyard_id: vineyardId,
    p_days: days,
  });
  if (res.error) {
    const msg = String(res.error.message ?? "");
    const code = String((res.error as any).code ?? "");
    if (code === "PGRST202" || /not\s*found|does not exist/i.test(msg)) {
      return null; // signal: try fallback
    }
    // Other errors: still try fallback rather than failing hard.
    return null;
  }
  const raw = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  if (!raw.length) return null;
  const out: RainForecastDay[] = raw.map((r: any) => ({
    date: String(r.date ?? r.day ?? r.forecast_date ?? ""),
    rainfall_mm: r.rainfall_mm ?? r.rain_mm ?? r.precip_mm ?? r.amount_mm ?? null,
    probability_pct: r.probability_pct ?? r.pop ?? null,
    temp_max_c: r.temp_max_c ?? r.temperature_max_c ?? null,
    temp_min_c: r.temp_min_c ?? r.temperature_min_c ?? null,
    wind_max_kmh: r.wind_max_kmh ?? r.wind_speed_max_kmh ?? null,
  }));
  return { available: true, days: out, source: raw[0]?.source ?? null, via: "rpc" };
}

export async function getVineyardCoords(
  vineyardId: string,
): Promise<{ lat: number; lon: number; station: string | null } | null> {
  for (const provider of ["davis_weatherlink", "wunderground"]) {
    const res = await (supabase.rpc as any)("get_vineyard_weather_integration", {
      p_vineyard_id: vineyardId,
      p_provider: provider,
    });
    if (res.error) continue;
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) continue;
    const lat = row.station_latitude ?? row.latitude ?? null;
    const lon = row.station_longitude ?? row.longitude ?? null;
    if (typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon)) {
      return { lat, lon, station: row.station_name ?? null };
    }
  }
  // Fallback: try the vineyards table directly for lat/lon columns.
  try {
    const { data } = await supabase
      .from("vineyards")
      .select("latitude, longitude, name")
      .eq("id", vineyardId)
      .maybeSingle();
    const lat = (data as any)?.latitude;
    const lon = (data as any)?.longitude;
    if (typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon)) {
      return { lat, lon, station: (data as any)?.name ?? null };
    }
  } catch {
    // ignore — column may not exist
  }
  // Final fallback: compute the vineyard's centroid from paddock polygons.
  try {
    const { data } = await supabase
      .from("paddocks")
      .select("polygon_points")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null);
    const rows = (data ?? []) as Array<{ polygon_points: any }>;
    let sumLat = 0;
    let sumLon = 0;
    let n = 0;
    for (const r of rows) {
      const c = polygonCentroid(parsePolygonPoints(r.polygon_points));
      if (c && isFinite(c.lat) && isFinite(c.lng)) {
        sumLat += c.lat;
        sumLon += c.lng;
        n++;
      }
    }
    if (n > 0) {
      return { lat: sumLat / n, lon: sumLon / n, station: "Vineyard centre" };
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  days: number,
): Promise<RainForecastResult> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_speed_10m_max` +
    `&wind_speed_unit=kmh` +
    `&timezone=auto&forecast_days=${days}`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      return { available: false, reason: "error", message: `Open-Meteo HTTP ${r.status}` };
    }
    const j = await r.json();
    const dates: string[] = j?.daily?.time ?? [];
    const sums: any[] = j?.daily?.precipitation_sum ?? [];
    const pops: any[] = j?.daily?.precipitation_probability_max ?? [];
    const tmax: any[] = j?.daily?.temperature_2m_max ?? [];
    const tmin: any[] = j?.daily?.temperature_2m_min ?? [];
    const wmax: any[] = j?.daily?.wind_speed_10m_max ?? [];
    const out: RainForecastDay[] = dates.map((d, i) => ({
      date: d,
      rainfall_mm: typeof sums[i] === "number" ? sums[i] : null,
      probability_pct: typeof pops[i] === "number" ? pops[i] : null,
      temp_max_c: typeof tmax[i] === "number" ? tmax[i] : null,
      temp_min_c: typeof tmin[i] === "number" ? tmin[i] : null,
      wind_max_kmh: typeof wmax[i] === "number" ? wmax[i] : null,
    }));
    if (!out.length) return { available: false, reason: "no_data" };
    return { available: true, days: out, source: "open_meteo_forecast", via: "open_meteo" };
  } catch (e: any) {
    return { available: false, reason: "error", message: e?.message ?? "network error" };
  }
}

export async function fetchRainForecast(
  vineyardId: string,
  days = 7,
): Promise<RainForecastResult> {
  // 0. Honour the vineyard's forecast-provider preference.
  let provider: "auto" | "open_meteo" | "willyweather" = "auto";
  try {
    provider = await getForecastProvider(vineyardId);
  } catch {
    /* ignore - default to auto */
  }

  const tryWilly = async (): Promise<RainForecastResult | null> => {
    try {
      const status = await fetchWillyWeatherStatus(vineyardId);
      if (!status.configured || status.is_active === false) return null;
    } catch {
      return null;
    }
    const r = await fetchWillyWeatherForecast(vineyardId, days);
    if (r.available) return r;
    // eslint-disable-next-line no-console
    console.warn("[rainForecast] WillyWeather fetch failed, falling back", r);
    return null;
  };

  if (provider === "willyweather") {
    const w = await tryWilly();
    if (w) return w;
    // explicit provider chosen — fall back to Open-Meteo but keep going
  } else if (provider === "auto") {
    const w = await tryWilly();
    if (w) return w;
  }

  // 1. Try server RPC.
  const rpcResult = await tryRpc(vineyardId, days);
  if (rpcResult) return rpcResult;

  // 2. Fallback: Open-Meteo Forecast using configured station coordinates.
  const coords = await getVineyardCoords(vineyardId);
  if (!coords) {
    return {
      available: false,
      reason: "no_coords",
      message: "Vineyard coordinates not configured. Set a weather station in Weather settings.",
    };
  }
  return fetchOpenMeteoForecast(coords.lat, coords.lon, days);
}

export interface RainForecastSummary {
  totalMm: number;
  firstRainDay: RainForecastDay | null;
  rainSoon: boolean; // any meaningful rain within next 24h
}

export function summarizeForecast(days: RainForecastDay[]): RainForecastSummary {
  let total = 0;
  let firstRainDay: RainForecastDay | null = null;
  for (const d of days) {
    const mm = typeof d.rainfall_mm === "number" ? d.rainfall_mm : 0;
    total += mm;
    if (!firstRainDay && mm >= 1) firstRainDay = d;
  }
  const today = days[0];
  const tomorrow = days[1];
  const rainSoon =
    (today && (today.rainfall_mm ?? 0) >= 1) ||
    (tomorrow && (tomorrow.rainfall_mm ?? 0) >= 1) ||
    false;
  return {
    totalMm: Math.round(total * 10) / 10,
    firstRainDay,
    rainSoon: !!rainSoon,
  };
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function forecastHeadline(summary: RainForecastSummary): string {
  if (!summary.firstRainDay || summary.totalMm < 1) {
    return "No significant rain in next 7 days";
  }
  const d = new Date(summary.firstRainDay.date);
  const day = isNaN(d.getTime()) ? summary.firstRainDay.date : WEEKDAY[d.getDay()];
  const mm = Math.round((summary.firstRainDay.rainfall_mm ?? 0) * 10) / 10;
  return `Rain forecast: ${mm} mm ${day}`;
}

export function forecastUnavailableReason(reason: RainForecastReason, message?: string): string {
  switch (reason) {
    case "rpc_missing":
      return "Forecast unavailable — server forecast service not deployed";
    case "no_coords":
      return "Forecast unavailable — vineyard coordinates not set";
    case "no_data":
      return "Forecast unavailable — no forecast data returned";
    case "error":
    default:
      return `Forecast unavailable${message ? ` — ${message}` : ""}`;
  }
}
