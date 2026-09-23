// WillyWeather forecast normalisation (Portal side).
//
// TERMINOLOGY (VineTrack rule):
//   Observations = measured data (Davis WeatherLink, Weather Underground, …)
//   Forecasts    = predicted data (WillyWeather, Open-Meteo, …)
// Everything in this file is FORECAST data. Intra-day values are forecast
// SAMPLES (sampleCount), never observations.
//
// The `willyweather-proxy` edge function lives in the canonical VineTrack
// (iOS) project and is owned by Rork. This normaliser accepts either:
//   1. the provider's own `forecasts` envelope passed straight through, or
//   2. a pre-shaped `{ days: [{ date, entries: {...} }] }` payload,
// so it starts producing real charts the moment the proxy stops discarding
// the timestamped temperature / wind / humidity entries. Nothing here
// fabricates or interpolates samples: a bucket with no provider entry keeps
// sampleCount 0 and null values.
import {
  BUCKETS_PER_DAY,
  FORECAST_DAYS,
  type FiveDayForecast,
  type ForecastDay,
  type ForecastPeriod,
} from "@/lib/fiveDayForecast";

const finite = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const min = (values: Array<number | null>): number | null => {
  const v = values.filter((x): x is number => x != null);
  return v.length ? Math.min(...v) : null;
};
const max = (values: Array<number | null>): number | null => {
  const v = values.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};
const sum = (values: Array<number | null>): number | null => {
  const v = values.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const two = (n: number) => String(n).padStart(2, "0");

/** A provider entry: local date-time string plus one value. */
interface Entry {
  dateTime?: string;
  date_time?: string;
  time?: string;
  [key: string]: unknown;
}

/** Splits a provider local date-time into vineyard-local date + hour. */
export function splitLocalDateTime(value: unknown): { date: string; hour: number } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return { date: m[1], hour };
}

function entryTime(entry: Entry): { date: string; hour: number } | null {
  return (
    splitLocalDateTime(entry.dateTime) ??
    splitLocalDateTime(entry.date_time) ??
    splitLocalDateTime(entry.time)
  );
}

function pick(entry: Entry, keys: string[]): number | null {
  for (const key of keys) {
    const v = finite(entry[key]);
    if (v != null) return v;
  }
  return null;
}

const TEMP_KEYS = ["temperature", "temp", "temperature_c", "value"];
const WIND_KEYS = ["speed", "wind_speed_kmh", "windSpeed", "value"];
const HUMIDITY_KEYS = ["relativeHumidity", "relative_humidity", "humidity", "value"];

/** One day of provider detail, in whatever shape the proxy forwards. */
export interface WillyDayDetail {
  date: string;
  temperatureEntries?: Entry[];
  windEntries?: Entry[];
  humidityEntries?: Entry[];
  /** Genuine timestamped intra-day rainfall entries only. */
  rainEntries?: Entry[];
}

/** Upper bound of a provider rainfall range, matching the daily treatment. */
function rainAmount(entry: Entry): number | null {
  const end = finite(entry.endRange);
  const start = finite(entry.startRange);
  const amount = finite(entry.amount) ?? finite(entry.rainfall_mm) ?? finite(entry.value);
  return end ?? amount ?? start;
}

export interface WillyForecastPayload {
  /** Daily summaries (already produced by the proxy today). */
  days?: Array<{
    date?: string;
    dateTime?: string;
    temp_min_c?: number | null;
    temp_max_c?: number | null;
    wind_max_kmh?: number | null;
    rainfall_mm?: number | null;
    probability_pct?: number | null;
    humidity_max_pct?: number | null;
    precis?: string | null;
    precisCode?: string | null;
    condition?: string | null;
    /** Detailed forecast samples, when the proxy forwards them. */
    temperatureEntries?: Entry[];
    windEntries?: Entry[];
    humidityEntries?: Entry[];
  }>;
  /** Raw provider envelope passthrough. */
  forecasts?: Record<string, { days?: Array<{ dateTime?: string; entries?: Entry[] }> }>;
  timezone?: string | null;
  location?: { timezone?: string | null; name?: string | null; id?: string | number | null } | null;
  updatedAt?: string | null;
  issueDateTime?: string | null;
}

/** Collects entries per forecast type from a raw provider `forecasts` envelope. */
export function detailFromForecastsEnvelope(
  payload: WillyForecastPayload,
): Map<string, WillyDayDetail> {
  const byDate = new Map<string, WillyDayDetail>();
  const put = (date: string): WillyDayDetail => {
    const existing = byDate.get(date) ?? { date };
    byDate.set(date, existing);
    return existing;
  };
  const collect = (typeKey: string, field: keyof WillyDayDetail) => {
    const days = payload.forecasts?.[typeKey]?.days ?? [];
    days.forEach((day) => {
      (day.entries ?? []).forEach((entry) => {
        const t = entryTime(entry) ?? splitLocalDateTime(day.dateTime);
        if (!t) return;
        const target = put(t.date);
        const list = (target[field] as Entry[] | undefined) ?? [];
        list.push(entry);
        (target[field] as Entry[]) = list;
      });
    });
  };
  collect("temperature", "temperatureEntries");
  collect("wind", "windEntries");
  // Providers use either spelling; both mean forecast relative humidity.
  collect("humidity", "humidityEntries");
  collect("relativehumidity", "humidityEntries");
  return byDate;
}

/**
 * Builds the six four-hour vineyard-local buckets for one day:
 * 00–04, 04–08, 08–12, 12–16, 16–20, 20–24.
 * Buckets with no provider sample stay null with sampleCount 0.
 */
export function bucketDayDetail(detail: WillyDayDetail): ForecastPeriod[] {
  const temps = new Map<number, Array<number | null>>();
  const winds = new Map<number, Array<number | null>>();
  const humidity = new Map<number, Array<number | null>>();
  const counts = new Map<number, number>();

  const add = (
    target: Map<number, Array<number | null>>,
    entries: Entry[] | undefined,
    keys: string[],
  ) => {
    (entries ?? []).forEach((entry) => {
      const t = entryTime(entry);
      if (!t || t.date !== detail.date) return;
      const bucket = Math.floor(t.hour / 4);
      const list = target.get(bucket) ?? [];
      list.push(pick(entry, keys));
      target.set(bucket, list);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    });
  };
  add(temps, detail.temperatureEntries, TEMP_KEYS);
  add(winds, detail.windEntries, WIND_KEYS);
  add(humidity, detail.humidityEntries, HUMIDITY_KEYS);

  const periods: ForecastPeriod[] = [];
  for (let bucket = 0; bucket < BUCKETS_PER_DAY; bucket += 1) {
    const startHour = bucket * 4;
    periods.push({
      date: detail.date,
      startHour,
      startTimeLocal: `${two(startHour)}:00`,
      endTimeLocal: `${two(startHour + 4)}:00`,
      tempMinC: min(temps.get(bucket) ?? []),
      tempMaxC: max(temps.get(bucket) ?? []),
      windMaxKmh: max(winds.get(bucket) ?? []),
      humidityMaxPct: max(humidity.get(bucket) ?? []),
      sampleCount: counts.get(bucket) ?? 0,
    });
  }
  return periods;
}

/**
 * Normalises the WillyWeather rainfall shape for one day.
 * The provider returns a rainfall RANGE (startRange/endRange) per period and
 * can return several intra-day periods. Ranges are normalised to the upper
 * bound where present (the "up to" figure growers read), then summed across
 * the day's periods. Probability is the day's maximum probability, not
 * entries[0].
 */
export function normaliseRainForDay(entries: Entry[] | undefined): number | null {
  if (!entries?.length) return null;
  return sum(
    entries.map((entry) => {
      const end = finite(entry.endRange);
      const start = finite(entry.startRange);
      const amount = finite(entry.amount) ?? finite(entry.rainfall_mm) ?? finite(entry.value);
      return end ?? amount ?? start;
    }),
  );
}

export function normaliseRainProbabilityForDay(entries: Entry[] | undefined): number | null {
  if (!entries?.length) return null;
  return max(entries.map((entry) => pick(entry, ["probability", "probability_pct", "value"])));
}

/** Provider `precis` / condition text → our canonical condition key. */
export function conditionFromPrecis(
  precis: string | null | undefined,
  code?: string | null,
): { key: string; label: string } | null {
  const text = `${code ?? ""} ${precis ?? ""}`.toLowerCase().trim();
  if (!text) return null;
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));
  if (has("storm", "thunder")) return { key: "storm", label: "Storms" };
  if (has("snow")) return { key: "snow", label: "Snow" };
  if (has("fog", "mist", "haze")) return { key: "fog", label: "Fog" };
  if (has("shower")) return { key: "showers", label: "Showers" };
  if (has("rain", "drizzle")) return { key: "rain", label: "Rain" };
  if (has("partly", "mostly-sunny", "mostly sunny")) return { key: "partly_cloudy", label: "Partly cloudy" };
  if (has("cloud", "overcast")) return { key: "cloudy", label: "Cloudy" };
  if (has("clear", "fine", "sunny")) return { key: "clear", label: precis?.trim() || "Sunny" };
  return { key: "cloudy", label: precis?.trim() || "Cloudy" };
}

/**
 * Normalises a WillyWeather forecast payload into the shared five-day
 * contract, preserving genuine intra-day samples where the provider supplies
 * them. Returns null when the payload carries no usable days.
 */
export function normaliseWillyWeatherForecast(
  payload: WillyForecastPayload,
  fetchedAt: string,
): FiveDayForecast | null {
  const envelopeDetail = detailFromForecastsEnvelope(payload);
  const summaryDays = payload.days ?? [];

  const dates = summaryDays.length
    ? summaryDays
        .map((day) => splitLocalDateTime(day.dateTime)?.date ?? (day.date ? String(day.date).slice(0, 10) : ""))
        .filter(Boolean)
    : Array.from(envelopeDetail.keys()).sort();
  if (!dates.length) return null;

  const rainDays = payload.forecasts?.rainfall?.days ?? [];
  const probDays = payload.forecasts?.rainfallprobability?.days ?? [];
  const rainByDate = new Map<string, Entry[]>();
  const probByDate = new Map<string, Entry[]>();
  rainDays.forEach((day) => {
    const date = splitLocalDateTime(day.dateTime)?.date;
    if (date) rainByDate.set(date, day.entries ?? []);
  });
  probDays.forEach((day) => {
    const date = splitLocalDateTime(day.dateTime)?.date;
    if (date) probByDate.set(date, day.entries ?? []);
  });

  let hasDetail = false;
  const days: ForecastDay[] = dates.slice(0, FORECAST_DAYS).map((date, index) => {
    const summary = summaryDays[index] ?? {};
    const detail: WillyDayDetail = {
      date,
      temperatureEntries:
        summary.temperatureEntries ?? envelopeDetail.get(date)?.temperatureEntries,
      windEntries: summary.windEntries ?? envelopeDetail.get(date)?.windEntries,
      humidityEntries: summary.humidityEntries ?? envelopeDetail.get(date)?.humidityEntries,
    };
    const periods = bucketDayDetail(detail);
    if (periods.some((p) => p.sampleCount > 0)) hasDetail = true;

    const condition = conditionFromPrecis(
      summary.precis ?? summary.condition ?? null,
      summary.precisCode ?? null,
    );
    const bucketTemps = periods.flatMap((p) => [p.tempMinC, p.tempMaxC]);
    return {
      date,
      conditionKey: condition?.key ?? null,
      conditionCode: summary.precisCode ?? null,
      conditionDescription: condition?.label ?? null,
      tempMinC: finite(summary.temp_min_c) ?? min(bucketTemps),
      tempMaxC: finite(summary.temp_max_c) ?? max(bucketTemps),
      rainMm: normaliseRainForDay(rainByDate.get(date)) ?? finite(summary.rainfall_mm),
      rainProbabilityPct:
        normaliseRainProbabilityForDay(probByDate.get(date)) ?? finite(summary.probability_pct),
      humidityMaxPct: finite(summary.humidity_max_pct) ?? max(periods.map((p) => p.humidityMaxPct)),
      windMaxKmh: finite(summary.wind_max_kmh) ?? max(periods.map((p) => p.windMaxKmh)),
      periods,
    };
  });

  const humidityKnown = days.some((day) => day.humidityMaxPct != null);
  const conditionKnown = days.some((day) => day.conditionDescription != null);
  return {
    days,
    source: "WillyWeather",
    sourceDetail: hasDetail ? "samples" : "daily",
    fieldSources: {
      temperature: "WillyWeather",
      wind: "WillyWeather",
      rain: "WillyWeather",
      humidity: humidityKnown ? "WillyWeather" : null,
      condition: conditionKnown ? "WillyWeather" : null,
    },
    timezone: payload.timezone ?? payload.location?.timezone ?? null,
    updatedAt: payload.updatedAt ?? payload.issueDateTime ?? fetchedAt,
  };
}
