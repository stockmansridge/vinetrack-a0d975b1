import { fetchRainForecast, getVineyardCoords, type RainForecastDay } from "@/lib/rainForecastQuery";
import { getForecastProvider } from "@/lib/willyWeatherProxy";

export const FORECAST_DAYS = 5;
export const BUCKETS_PER_DAY = 6;

export interface ForecastPeriod {
  date: string;
  startHour: number;
  startTimeLocal: string;
  endTimeLocal: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  windMaxKmh: number | null;
  humidityMaxPct: number | null;
  observationCount: number;
}

export interface ForecastDay {
  date: string;
  conditionCode: number | string | null;
  conditionDescription: string | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  rainMm: number | null;
  rainProbabilityPct: number | null;
  humidityMaxPct: number | null;
  windMaxKmh: number | null;
  periods: ForecastPeriod[];
}

export interface FiveDayForecast {
  days: ForecastDay[];
  source: string;
  sourceDetail: "daily" | "hourly";
  timezone: string | null;
  updatedAt: string | null;
}

export type FiveDayForecastResult =
  | { available: true; forecast: FiveDayForecast }
  | { available: false; reason: "no_coords" | "no_data" | "error"; message?: string };

export interface OpenMeteoPayload {
  timezone?: string;
  utc_offset_seconds?: number;
  daily?: {
    time?: string[];
    weather_code?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    relative_humidity_2m?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
  };
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function min(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null);
  return valid.length ? Math.min(...valid) : null;
}

function max(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null);
  return valid.length ? Math.max(...valid) : null;
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

export function conditionDescription(code: number | string | null): string | null {
  const value = typeof code === "string" ? Number(code) : code;
  if (value == null || !Number.isFinite(value)) return null;
  if (value === 0) return "Clear";
  if (value === 1) return "Mostly clear";
  if (value === 2) return "Partly cloudy";
  if (value === 3) return "Overcast";
  if (value === 45 || value === 48) return "Fog";
  if ([51, 53, 55, 56, 57].includes(value)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "Snow";
  if ([95, 96, 99].includes(value)) return "Thunderstorm";
  return "Mixed conditions";
}

export function bucketHourlyForecast(payload: OpenMeteoPayload): Map<string, ForecastPeriod[]> {
  const times = payload.hourly?.time ?? [];
  const temperatures = payload.hourly?.temperature_2m ?? [];
  const winds = payload.hourly?.wind_speed_10m ?? [];
  const humidities = payload.hourly?.relative_humidity_2m ?? [];
  const raw = new Map<string, Array<{ temp: number | null; wind: number | null; humidity: number | null }>>();

  times.forEach((timestamp, index) => {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(timestamp);
    if (!match) return;
    const date = match[1];
    const hour = Number(match[2]);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;
    const bucket = Math.floor(hour / 4);
    const key = `${date}:${bucket}`;
    const values = raw.get(key) ?? [];
    values.push({
      temp: finite(temperatures[index]),
      wind: finite(winds[index]),
      humidity: finite(humidities[index]),
    });
    raw.set(key, values);
  });

  const byDate = new Map<string, ForecastPeriod[]>();
  for (const date of new Set(times.map((time) => time.slice(0, 10)).filter(Boolean))) {
    const periods: ForecastPeriod[] = [];
    for (let bucket = 0; bucket < BUCKETS_PER_DAY; bucket += 1) {
      const startHour = bucket * 4;
      const values = raw.get(`${date}:${bucket}`) ?? [];
      periods.push({
        date,
        startHour,
        startTimeLocal: `${two(startHour)}:00`,
        endTimeLocal: `${two(startHour + 4)}:00`,
        tempMinC: min(values.map((value) => value.temp)),
        tempMaxC: max(values.map((value) => value.temp)),
        windMaxKmh: max(values.map((value) => value.wind)),
        humidityMaxPct: max(values.map((value) => value.humidity)),
        observationCount: values.length,
      });
    }
    byDate.set(date, periods);
  }
  return byDate;
}

export function normaliseOpenMeteo(payload: OpenMeteoPayload, updatedAt: string): FiveDayForecast | null {
  const dates = payload.daily?.time ?? [];
  if (!dates.length) return null;
  const periodsByDate = bucketHourlyForecast(payload);
  const days = dates.slice(0, FORECAST_DAYS).map((date, index): ForecastDay => {
    const periods = periodsByDate.get(date) ?? [];
    const hourlyTemps = periods.flatMap((period) => [period.tempMinC, period.tempMaxC]);
    const hourlyWinds = periods.map((period) => period.windMaxKmh);
    const hourlyHumidity = periods.map((period) => period.humidityMaxPct);
    return {
      date,
      conditionCode: payload.daily?.weather_code?.[index] ?? null,
      conditionDescription: conditionDescription(payload.daily?.weather_code?.[index] ?? null),
      tempMinC: finite(payload.daily?.temperature_2m_min?.[index]) ?? min(hourlyTemps),
      tempMaxC: finite(payload.daily?.temperature_2m_max?.[index]) ?? max(hourlyTemps),
      rainMm: finite(payload.daily?.precipitation_sum?.[index]),
      rainProbabilityPct: finite(payload.daily?.precipitation_probability_max?.[index]),
      humidityMaxPct: max(hourlyHumidity),
      windMaxKmh: finite(payload.daily?.wind_speed_10m_max?.[index]) ?? max(hourlyWinds),
      periods,
    };
  });
  return {
    days,
    source: "Open-Meteo",
    sourceDetail: "hourly",
    timezone: payload.timezone ?? null,
    updatedAt,
  };
}

function normaliseDaily(days: RainForecastDay[], source: string | null): FiveDayForecast {
  return {
    days: days.slice(0, FORECAST_DAYS).map((day) => ({
      date: day.date,
      conditionCode: null,
      conditionDescription: null,
      tempMinC: day.temp_min_c ?? null,
      tempMaxC: day.temp_max_c ?? null,
      rainMm: day.rainfall_mm ?? null,
      rainProbabilityPct: day.probability_pct ?? null,
      humidityMaxPct: null,
      windMaxKmh: day.wind_max_kmh ?? null,
      periods: [],
    })),
    source: source?.toLowerCase().includes("open_meteo") ? "Open-Meteo" : "WillyWeather",
    sourceDetail: "daily",
    timezone: null,
    updatedAt: null,
  };
}

async function fetchDetailedOpenMeteo(lat: number, lon: number): Promise<FiveDayForecastResult> {
  const daily = "weather_code,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_speed_10m_max";
  const hourly = "temperature_2m,relative_humidity_2m,wind_speed_10m";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&daily=${daily}&hourly=${hourly}&wind_speed_unit=kmh&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return { available: false, reason: "error", message: `Open-Meteo HTTP ${response.status}` };
    const forecast = normaliseOpenMeteo(await response.json(), new Date().toISOString());
    return forecast ? { available: true, forecast } : { available: false, reason: "no_data" };
  } catch (error) {
    return { available: false, reason: "error", message: error instanceof Error ? error.message : "Network error" };
  }
}

export async function fetchFiveDayForecast(vineyardId: string): Promise<FiveDayForecastResult> {
  const daily = await fetchRainForecast(vineyardId, FORECAST_DAYS);
  if (!daily.available) {
    const failure = daily as Extract<Awaited<ReturnType<typeof fetchRainForecast>>, { available: false }>;
    return { available: false, reason: failure.reason === "rpc_missing" ? "error" : failure.reason, message: failure.message };
  }

  let preference: "auto" | "open_meteo" | "willyweather" = "auto";
  try {
    preference = await getForecastProvider(vineyardId);
  } catch {
    // The resolved daily source remains authoritative if preference lookup fails.
  }

  const resolvedOpenMeteo = daily.via === "open_meteo" || daily.source?.toLowerCase().includes("open_meteo");
  if (preference === "open_meteo" || resolvedOpenMeteo) {
    const coords = await getVineyardCoords(vineyardId);
    if (coords) {
      const detailed = await fetchDetailedOpenMeteo(coords.lat, coords.lon);
      if (detailed.available) return detailed;
    }
  }

  return { available: true, forecast: normaliseDaily(daily.days, daily.source) };
}