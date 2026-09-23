import { fetchRainForecast, getVineyardCoords, type RainForecastDay } from "@/lib/rainForecastQuery";
import {
  getForecastProvider,
  fetchWillyWeatherForecastPayload,
} from "@/lib/willyWeatherProxy";
import { fetchVineyardRegionSettings } from "@/lib/vineyardRegionSettingsQuery";

export const FORECAST_DAYS = 5;
export const BUCKETS_PER_DAY = 6;

/** Which service supplied a given forecast field. Field-level provenance so a
 *  supplementary provider is never presented as the primary one. */
export type ForecastFieldSource = string | null;

export interface ForecastFieldSources {
  temperature: ForecastFieldSource;
  wind: ForecastFieldSource;
  rain: ForecastFieldSource;
  humidity: ForecastFieldSource;
  condition: ForecastFieldSource;
}

/** One four-hour vineyard-local forecast bucket. `sampleCount` counts genuine
 *  provider forecast samples — these are forecasts, never observations. */
export interface ForecastPeriod {
  date: string;
  startHour: number;
  startTimeLocal: string;
  endTimeLocal: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  windMaxKmh: number | null;
  humidityMaxPct: number | null;
  /** Minimum forecast humidity across the period; needed for spray windows. */
  humidityMinPct: number | null;
  /** Genuine forecast rainfall for this period only. Never derived from a daily total. */
  rainMm: number | null;
  sampleCount: number;
}

export interface ForecastDay {
  date: string;
  /** Canonical condition key for the weather glyph (clear, rain, storm, …). */
  conditionKey?: string | null;
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
  /** "samples" = genuine intra-day provider samples; "daily" = daily only. */
  sourceDetail: "daily" | "samples";
  fieldSources?: ForecastFieldSources;
  timezone: string | null;
  updatedAt: string | null;
}

export type FiveDayForecastResult =
  | {
      available: true;
      forecast: FiveDayForecast;
      /** Present when the forecast came from the shared server-side cache. */
      cache?: { fetchedAt: string | null; fromCache: boolean; isStale: boolean };
    }
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
    precipitation?: Array<number | null>;
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

/** Sums only genuine values; null when the provider supplied none. */
function sumOrNull(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
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

/** Canonical glyph key for an Open-Meteo WMO code. */
export function conditionKeyFromCode(code: number | string | null): string | null {
  const value = typeof code === "string" ? Number(code) : code;
  if (value == null || !Number.isFinite(value)) return null;
  if (value === 0 || value === 1) return "clear";
  if (value === 2) return "partly_cloudy";
  if (value === 3) return "cloudy";
  if (value === 45 || value === 48) return "fog";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67].includes(value)) return "rain";
  if ([80, 81, 82].includes(value)) return "showers";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "snow";
  if ([95, 96, 99].includes(value)) return "storm";
  return "cloudy";
}

export function bucketHourlyForecast(payload: OpenMeteoPayload): Map<string, ForecastPeriod[]> {
  const times = payload.hourly?.time ?? [];
  const temperatures = payload.hourly?.temperature_2m ?? [];
  const winds = payload.hourly?.wind_speed_10m ?? [];
  const humidities = payload.hourly?.relative_humidity_2m ?? [];
  const rains = payload.hourly?.precipitation ?? [];
  const raw = new Map<
    string,
    Array<{ temp: number | null; wind: number | null; humidity: number | null; rain: number | null }>
  >();

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
      rain: finite(rains[index]),
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
        humidityMinPct: min(values.map((value) => value.humidity)),
        // Genuine hourly precipitation summed across the period; null when the
        // provider supplied no hourly precipitation for it.
        rainMm: sumOrNull(values.map((value) => value.rain)),
        sampleCount: values.length,
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
    const sampleTemps = periods.flatMap((period) => [period.tempMinC, period.tempMaxC]);
    const sampleWinds = periods.map((period) => period.windMaxKmh);
    const sampleHumidity = periods.map((period) => period.humidityMaxPct);
    const code = payload.daily?.weather_code?.[index] ?? null;
    return {
      date,
      conditionKey: conditionKeyFromCode(code),
      conditionCode: code,
      conditionDescription: conditionDescription(code),
      tempMinC: finite(payload.daily?.temperature_2m_min?.[index]) ?? min(sampleTemps),
      tempMaxC: finite(payload.daily?.temperature_2m_max?.[index]) ?? max(sampleTemps),
      rainMm: finite(payload.daily?.precipitation_sum?.[index]),
      rainProbabilityPct: finite(payload.daily?.precipitation_probability_max?.[index]),
      humidityMaxPct: max(sampleHumidity),
      windMaxKmh: finite(payload.daily?.wind_speed_10m_max?.[index]) ?? max(sampleWinds),
      periods,
    };
  });
  return {
    days,
    source: "Open-Meteo",
    sourceDetail: days.some((day) => day.periods.some((period) => period.sampleCount > 0))
      ? "samples"
      : "daily",
    fieldSources: {
      temperature: "Open-Meteo",
      wind: "Open-Meteo",
      rain: "Open-Meteo",
      humidity: "Open-Meteo",
      condition: "Open-Meteo",
    },
    timezone: payload.timezone ?? null,
    updatedAt,
  };
}

function normaliseDaily(days: RainForecastDay[], source: string | null, timezone: string | null): FiveDayForecast {
  const resolved = source?.toLowerCase().includes("open_meteo")
    ? "Open-Meteo"
    : source?.toLowerCase().includes("willyweather")
      ? "WillyWeather"
      : source ?? "Configured forecast service";
  return {
    days: days.slice(0, FORECAST_DAYS).map((day) => ({
      date: day.date,
      conditionKey: null,
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
    source: resolved,
    sourceDetail: "daily",
    fieldSources: {
      temperature: resolved,
      wind: resolved,
      rain: resolved,
      humidity: null,
      condition: null,
    },
    timezone,
    updatedAt: null,
  };
}

/** Period fields required before spray windows can be calculated. */
export const SPRAY_PERIOD_FIELDS = [
  "tempMinC",
  "tempMaxC",
  "windMaxKmh",
  "rainMm",
  "humidityMinPct",
  "humidityMaxPct",
] as const;

export type SprayPeriodField = (typeof SPRAY_PERIOD_FIELDS)[number];

/** Which provenance field a period field belongs to. */
const FIELD_GROUP: Record<SprayPeriodField, keyof ForecastFieldSources> = {
  tempMinC: "temperature",
  tempMaxC: "temperature",
  windMaxKmh: "wind",
  rainMm: "rain",
  humidityMinPct: "humidity",
  humidityMaxPct: "humidity",
};

/**
 * True when no period anywhere in the forecast carries a complete set of the
 * fields the provider-neutral spray-window calculator needs. Provider agnostic.
 */
export function needsSprayDetailSupplement(forecast: FiveDayForecast): boolean {
  return !forecast.days.some((day) =>
    day.periods.some(
      (period) => period.sampleCount > 0 && SPRAY_PERIOD_FIELDS.every((field) => period[field] != null),
    ),
  );
}

/**
 * Provider-neutral merge: the primary forecast stays authoritative for every
 * value it genuinely supplies, and ONLY missing fields are filled from the
 * supplementary forecast. Periods are matched by vineyard-local date and
 * four-hour start hour — never by array position. Field-level provenance is
 * recorded so the UI can say "Humidity: Open-Meteo" while the displayed
 * primary source remains the user's configured provider.
 *
 * Nothing here knows which services produced either forecast.
 */
export function supplementForecast(
  primary: FiveDayForecast,
  supplementary: FiveDayForecast,
): FiveDayForecast {
  const byDate = new Map(supplementary.days.map((day) => [day.date, day]));
  const supplemented = new Set<keyof ForecastFieldSources>();
  let changed = false;

  const days = primary.days.map((day) => {
    const extra = byDate.get(day.date);
    if (!extra) return day;

    const periods = day.periods.map((period) => {
      const match = extra.periods.find((candidate) => candidate.startHour === period.startHour);
      if (!match) return period;
      const filled: Partial<Record<SprayPeriodField, number | null>> = {};
      let filledAny = false;
      SPRAY_PERIOD_FIELDS.forEach((field) => {
        if (period[field] == null && match[field] != null) {
          filled[field] = match[field];
          supplemented.add(FIELD_GROUP[field]);
          filledAny = true;
        }
      });
      if (!filledAny) return period;
      changed = true;
      return {
        ...period,
        ...filled,
        // Genuine supplementary samples now back this period.
        sampleCount: Math.max(period.sampleCount, match.sampleCount),
      };
    });

    const needsDayHumidity = day.humidityMaxPct == null && extra.humidityMaxPct != null;
    const needsCondition = !day.conditionDescription && !!extra.conditionDescription;
    if (needsDayHumidity) supplemented.add("humidity");
    if (needsCondition) supplemented.add("condition");
    if (needsDayHumidity || needsCondition) changed = true;

    return {
      ...day,
      periods,
      humidityMaxPct: needsDayHumidity ? extra.humidityMaxPct : day.humidityMaxPct,
      tempMinC: day.tempMinC ?? extra.tempMinC,
      tempMaxC: day.tempMaxC ?? extra.tempMaxC,
      windMaxKmh: day.windMaxKmh ?? extra.windMaxKmh,
      conditionKey: needsCondition ? extra.conditionKey ?? null : day.conditionKey,
      conditionCode: needsCondition ? extra.conditionCode : day.conditionCode,
      conditionDescription: needsCondition ? extra.conditionDescription : day.conditionDescription,
    };
  });

  if (!changed) return primary;

  const base = primary.fieldSources ?? {
    temperature: primary.source,
    wind: primary.source,
    rain: primary.source,
    humidity: primary.days.some((day) => day.humidityMaxPct != null) ? primary.source : null,
    condition: primary.days.some((day) => day.conditionDescription) ? primary.source : null,
  };
  const sources = { ...base };
  supplemented.forEach((group) => {
    sources[group] = base[group] ?? supplementary.source;
    if (base[group] && base[group] !== supplementary.source) {
      // Primary still supplies part of this field group; note both sources.
      sources[group] = `${base[group]} + ${supplementary.source}`;
    }
  });

  const hasSamples = days.some((day) => day.periods.some((period) => period.sampleCount > 0));
  return {
    ...primary,
    days,
    sourceDetail: hasSamples ? "samples" : primary.sourceDetail,
    fieldSources: sources,
  };
}

async function fetchDetailedOpenMeteo(lat: number, lon: number, timezone: string | null): Promise<FiveDayForecastResult> {
  const daily = "weather_code,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_speed_10m_max";
  const hourly = "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&daily=${daily}&hourly=${hourly}&wind_speed_unit=kmh&timezone=${encodeURIComponent(timezone || "auto")}&forecast_days=${FORECAST_DAYS}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return { available: false, reason: "error", message: `Open-Meteo HTTP ${response.status}` };
    const forecast = normaliseOpenMeteo(await response.json(), new Date().toISOString());
    return forecast ? { available: true, forecast } : { available: false, reason: "no_data" };
  } catch (error) {
    return { available: false, reason: "error", message: error instanceof Error ? error.message : "Network error" };
  }
}

async function fetchWillyWeather(
  vineyardId: string,
  timezone: string | null,
): Promise<FiveDayForecast | null> {
  const { normaliseWillyWeatherForecast } = await import("@/lib/forecast/willyWeatherForecast");
  const payload = await fetchWillyWeatherForecastPayload(vineyardId, FORECAST_DAYS);
  if (!payload.ok) return null;
  const forecast = normaliseWillyWeatherForecast(payload.data ?? {}, new Date().toISOString());
  if (!forecast) return null;
  return { ...forecast, timezone: forecast.timezone ?? timezone };
}

/** Fetches directly from the configured provider, bypassing the shared cache. */
export async function fetchFiveDayForecastFromProvider(
  vineyardId: string,
): Promise<FiveDayForecastResult> {
  const region = await fetchVineyardRegionSettings(vineyardId).catch(() => null);
  const timezone = region?.timezone ?? null;

  let preference: "auto" | "open_meteo" | "willyweather" = "auto";
  try {
    preference = await getForecastProvider(vineyardId);
  } catch {
    // Preference lookup failure falls back to the resolved daily source.
  }

  /**
   * Completes any primary forecast with the supplementary detailed service.
   * The primary provider stays displayed and authoritative; only missing
   * fields are filled. Applied to every primary provider, present and future.
   */
  const complete = async (primary: FiveDayForecast): Promise<FiveDayForecast> => {
    const needsSupplement =
      needsSprayDetailSupplement(primary) ||
      primary.days.every((day) => day.humidityMaxPct == null) ||
      primary.days.every((day) => !day.conditionDescription);
    if (!needsSupplement) return primary;
    const coords = await getVineyardCoords(vineyardId);
    if (!coords) return primary;
    const extra = await fetchDetailedOpenMeteo(coords.lat, coords.lon, timezone);
    return extra.available ? supplementForecast(primary, extra.forecast) : primary;
  };

  if (preference === "willyweather") {
    const willy = await fetchWillyWeather(vineyardId, timezone);
    if (willy) return { available: true, forecast: await complete(willy) };
  }

  const daily = await fetchRainForecast(vineyardId, FORECAST_DAYS);
  if (!daily.available) {
    const failure = daily as Extract<Awaited<ReturnType<typeof fetchRainForecast>>, { available: false }>;
    return {
      available: false,
      reason: failure.reason === "rpc_missing" ? "error" : failure.reason,
      message: failure.message,
    };
  }

  const resolvedOpenMeteo = daily.via === "open_meteo" || daily.source?.toLowerCase().includes("open_meteo");
  if (preference === "open_meteo" || resolvedOpenMeteo) {
    const coords = await getVineyardCoords(vineyardId);
    if (coords) {
      const detailed = await fetchDetailedOpenMeteo(coords.lat, coords.lon, timezone);
      if (detailed.available) return detailed;
    }
  }

  return { available: true, forecast: normaliseDaily(daily.days, daily.source, timezone) };
}

/**
 * Cache-aware forecast read.
 *  - normal load: fresh shared cache → return it; stale/missing → fetch,
 *    normalise, cache, return.
 *  - `force` (manual Refresh): always fetch the provider and replace the cache.
 * A failed provider fetch never discards a usable cached forecast.
 */
export async function fetchFiveDayForecast(
  vineyardId: string,
  options: { force?: boolean } = {},
): Promise<FiveDayForecastResult & { staleCache?: boolean; refreshFailed?: boolean }> {
  const { readForecastCache, writeForecastCache } = await import("@/lib/forecast/forecastCache");
  let providerKey = "auto";
  try {
    providerKey = await getForecastProvider(vineyardId);
  } catch {
    // keep "auto"
  }

  const cached = await readForecastCache(vineyardId, providerKey);
  if (!options.force && cached && !cached.isStale) {
    return {
      available: true,
      forecast: cached.forecast,
      cache: { fetchedAt: cached.fetchedAt, fromCache: true, isStale: false },
    };
  }

  const fresh = await fetchFiveDayForecastFromProvider(vineyardId);
  if (fresh.available) {
    await writeForecastCache({
      vineyardId,
      provider: providerKey,
      timezone: fresh.forecast.timezone,
      forecast: fresh.forecast,
    });
    return {
      available: true,
      forecast: fresh.forecast,
      cache: { fetchedAt: new Date().toISOString(), fromCache: false, isStale: false },
    };
  }

  if (cached) {
    return {
      available: true,
      forecast: cached.forecast,
      cache: { fetchedAt: cached.fetchedAt, fromCache: true, isStale: cached.isStale },
      staleCache: cached.isStale,
      refreshFailed: true,
    };
  }
  return fresh;
}
