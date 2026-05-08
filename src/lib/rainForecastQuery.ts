// 7-day rain forecast helper.
//
// Tries server-side RPC `public.get_vineyard_rain_forecast(p_vineyard_id, p_days)`.
// If the RPC isn't deployed yet, returns { available: false, reason: "rpc_missing" }
// so the UI can show a soft "Forecast unavailable" label.
import { supabase } from "@/integrations/ios-supabase/client";

export interface RainForecastDay {
  date: string; // YYYY-MM-DD
  rainfall_mm: number | null;
  probability_pct?: number | null;
}

export type RainForecastResult =
  | { available: true; days: RainForecastDay[]; source: string | null }
  | { available: false; reason: "rpc_missing" | "no_data" | "error"; message?: string };

export async function fetchRainForecast(
  vineyardId: string,
  days = 7,
): Promise<RainForecastResult> {
  const res = await (supabase.rpc as any)("get_vineyard_rain_forecast", {
    p_vineyard_id: vineyardId,
    p_days: days,
  });
  if (res.error) {
    const msg = String(res.error.message ?? "");
    const code = String((res.error as any).code ?? "");
    if (code === "PGRST202" || /not\s*found|does not exist/i.test(msg)) {
      return { available: false, reason: "rpc_missing", message: msg };
    }
    return { available: false, reason: "error", message: msg };
  }
  const raw = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  if (!raw.length) return { available: false, reason: "no_data" };
  const out: RainForecastDay[] = raw.map((r: any) => ({
    date: String(r.date ?? r.day ?? r.forecast_date ?? ""),
    rainfall_mm: r.rainfall_mm ?? r.rain_mm ?? r.precip_mm ?? r.amount_mm ?? null,
    probability_pct: r.probability_pct ?? r.pop ?? null,
  }));
  const source = raw[0]?.source ?? null;
  return { available: true, days: out, source };
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
