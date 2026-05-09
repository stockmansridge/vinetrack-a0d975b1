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
  | { available: true; days: RainForecastDay[]; source: string | null; via: "rpc" | "open_meteo" }
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

async function getVineyardCoords(
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
    const out: RainForecastDay[] = dates.map((d, i) => ({
      date: d,
      rainfall_mm: typeof sums[i] === "number" ? sums[i] : null,
      probability_pct: typeof pops[i] === "number" ? pops[i] : null,
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
  // 1. Try server RPC first.
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
