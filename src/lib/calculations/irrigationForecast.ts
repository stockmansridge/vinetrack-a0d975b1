// Forecast fetcher for Irrigation Advisor.
// Mirrors iOS IrrigationForecastService — uses Open-Meteo daily ETo + rainfall.
import { supabase } from "@/integrations/ios-supabase/client";
import { parsePolygonPoints, polygonCentroid } from "@/lib/paddockGeometry";
import type { ForecastDay } from "./irrigation";

export interface IrrigationForecast {
  days: ForecastDay[];
  source: string;
  coordsSource: string | null;
  lat: number;
  lon: number;
}

export type IrrigationForecastResult =
  | { available: true; forecast: IrrigationForecast }
  | { available: false; reason: "no_coords" | "error" | "no_data"; message?: string };

async function getCoords(
  vineyardId: string,
): Promise<{ lat: number; lon: number; source: string | null } | null> {
  for (const provider of ["davis_weatherlink", "wunderground"]) {
    try {
      const res = await (supabase.rpc as any)("get_vineyard_weather_integration", {
        p_vineyard_id: vineyardId,
        p_provider: provider,
      });
      if (res.error) continue;
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row) continue;
      const lat = row.station_latitude ?? row.latitude ?? null;
      const lon = row.station_longitude ?? row.longitude ?? null;
      if (typeof lat === "number" && typeof lon === "number") {
        return { lat, lon, source: row.station_name ?? "Weather station" };
      }
    } catch {
      // continue
    }
  }
  try {
    const { data } = await supabase
      .from("vineyards")
      .select("latitude, longitude, name")
      .eq("id", vineyardId)
      .maybeSingle();
    const lat = (data as any)?.latitude;
    const lon = (data as any)?.longitude;
    if (typeof lat === "number" && typeof lon === "number") {
      return { lat, lon, source: (data as any)?.name ?? null };
    }
  } catch {
    // ignore
  }
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
    if (n > 0) return { lat: sumLat / n, lon: sumLon / n, source: "Vineyard centre" };
  } catch {
    // ignore
  }
  return null;
}

export async function fetchIrrigationForecast(
  vineyardId: string,
  days = 5,
): Promise<IrrigationForecastResult> {
  const coords = await getCoords(vineyardId);
  if (!coords) {
    return { available: false, reason: "no_coords" };
  }
  const clamped = Math.max(1, Math.min(days, 16));
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${coords.lat}&longitude=${coords.lon}` +
    `&daily=et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max,temperature_2m_min,windspeed_10m_max` +
    `&forecast_days=${clamped}&timezone=auto&windspeed_unit=kmh`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { available: false, reason: "error", message: `HTTP ${r.status}` };
    const j = await r.json();
    const times: string[] = j?.daily?.time ?? [];
    const etos: any[] = j?.daily?.et0_fao_evapotranspiration ?? [];
    const rains: any[] = j?.daily?.precipitation_sum ?? [];
    const out: ForecastDay[] = times.map((d, i) => ({
      date: d,
      forecastEToMm: typeof etos[i] === "number" ? etos[i] : 0,
      forecastRainMm: typeof rains[i] === "number" ? rains[i] : 0,
    }));
    if (!out.length) return { available: false, reason: "no_data" };
    return {
      available: true,
      forecast: {
        days: out,
        source: "Open-Meteo",
        coordsSource: coords.source,
        lat: coords.lat,
        lon: coords.lon,
      },
    };
  } catch (e: any) {
    return { available: false, reason: "error", message: e?.message };
  }
}
