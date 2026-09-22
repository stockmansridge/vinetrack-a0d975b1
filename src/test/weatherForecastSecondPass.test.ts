import { describe, expect, it } from "vitest";
import {
  bucketDayDetail,
  conditionFromPrecis,
  normaliseRainForDay,
  normaliseRainProbabilityForDay,
  normaliseWillyWeatherForecast,
  splitLocalDateTime,
  type WillyForecastPayload,
} from "@/lib/forecast/willyWeatherForecast";
import { supplementForecast, type FiveDayForecast } from "@/lib/fiveDayForecast";
import { isCacheStale } from "@/lib/forecast/forecastCache";
import { mapLiveWeatherRow } from "@/lib/weatherStatusQuery";
import { weatherGlyphKey } from "@/components/weather/WeatherGlyph";

const DATES = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];

/** Provider-shaped payload: three-hourly temperature/wind entries per day. */
function willyPayload(options: { humidity?: boolean; precis?: boolean } = {}): WillyForecastPayload {
  const entriesFor = (date: string, key: string, base: number) =>
    Array.from({ length: 8 }, (_, i) => ({
      dateTime: `${date} ${String(i * 3).padStart(2, "0")}:00:00`,
      [key]: base + i,
    }));
  return {
    timezone: "Australia/Sydney",
    location: { timezone: "Australia/Sydney", name: "Stockmans Ridge" },
    days: DATES.map((date, index) => ({
      dateTime: `${date} 00:00:00`,
      temp_min_c: 8 + index,
      temp_max_c: 20 + index,
      wind_max_kmh: 18 + index,
      precis: options.precis === false ? null : "Showers",
      precisCode: options.precis === false ? null : "showers",
    })),
    forecasts: {
      temperature: { days: DATES.map((date) => ({ dateTime: `${date} 00:00:00`, entries: entriesFor(date, "temperature", 6) })) },
      wind: { days: DATES.map((date) => ({ dateTime: `${date} 00:00:00`, entries: entriesFor(date, "speed", 5) })) },
      ...(options.humidity
        ? {
            humidity: {
              days: DATES.map((date) => ({ dateTime: `${date} 00:00:00`, entries: entriesFor(date, "relativeHumidity", 50) })),
            },
          }
        : {}),
      rainfall: {
        days: DATES.map((date) => ({
          dateTime: `${date} 00:00:00`,
          entries: [
            { dateTime: `${date} 00:00:00`, startRange: 1, endRange: 5 },
            { dateTime: `${date} 12:00:00`, startRange: 0, endRange: 2 },
          ],
        })),
      },
      rainfallprobability: {
        days: DATES.map((date) => ({
          dateTime: `${date} 00:00:00`,
          entries: [
            { dateTime: `${date} 00:00:00`, probability: 20 },
            { dateTime: `${date} 12:00:00`, probability: 70 },
          ],
        })),
      },
    },
  };
}

describe("WillyWeather forecast detail", () => {
  it("produces five days with exactly 30 four-hour bucket positions", () => {
    const forecast = normaliseWillyWeatherForecast(willyPayload(), "2026-10-02T00:00:00Z");
    expect(forecast?.days).toHaveLength(5);
    expect(forecast?.days.flatMap((day) => day.periods)).toHaveLength(30);
    expect(forecast?.days.every((day) => day.periods.length === 6)).toBe(true);
  });

  it("fills temperature and wind from genuine provider samples, not duplicated daily values", () => {
    const forecast = normaliseWillyWeatherForecast(willyPayload(), "2026-10-02T00:00:00Z")!;
    const day = forecast.days[0];
    // 3-hourly entries → 2 samples in most 4-hour buckets, never zero.
    expect(day.periods.every((period) => period.sampleCount > 0)).toBe(true);
    expect(forecast.sourceDetail).toBe("samples");
    const highs = day.periods.map((period) => period.tempMaxC);
    expect(new Set(highs).size).toBeGreaterThan(1);
    expect(day.periods[0].windMaxKmh).not.toBeNull();
  });

  it("keeps WillyWeather as the source for the fields it provides", () => {
    const forecast = normaliseWillyWeatherForecast(willyPayload({ humidity: true }), "2026-10-02T00:00:00Z")!;
    expect(forecast.source).toBe("WillyWeather");
    expect(forecast.fieldSources?.temperature).toBe("WillyWeather");
    expect(forecast.fieldSources?.wind).toBe("WillyWeather");
    expect(forecast.fieldSources?.humidity).toBe("WillyWeather");
  });

  it("leaves a bucket empty rather than fabricating a value", () => {
    const periods = bucketDayDetail({
      date: "2026-10-03",
      temperatureEntries: [{ dateTime: "2026-10-03 09:00:00", temperature: 17 }],
    });
    expect(periods).toHaveLength(6);
    expect(periods[2]).toMatchObject({ sampleCount: 1, tempMaxC: 17 });
    expect(periods[0]).toMatchObject({ sampleCount: 0, tempMinC: null, tempMaxC: null, windMaxKmh: null });
  });

  it("aggregates intra-day rainfall ranges and takes the day's probability", () => {
    expect(normaliseRainForDay([{ startRange: 1, endRange: 5 }, { startRange: 0, endRange: 2 }])).toBe(7);
    expect(normaliseRainProbabilityForDay([{ probability: 20 }, { probability: 70 }])).toBe(70);
    expect(normaliseRainForDay([])).toBeNull();
  });

  it("maps provider precis text to a condition label and glyph", () => {
    expect(conditionFromPrecis("Possible shower")).toEqual({ key: "showers", label: "Showers" });
    expect(conditionFromPrecis("Clear")?.key).toBe("clear");
    expect(conditionFromPrecis("Thunderstorms")?.key).toBe("storm");
    expect(conditionFromPrecis(null)).toBeNull();
    expect(weatherGlyphKey("showers", null)).toBe("showers");
    expect(weatherGlyphKey(null, 95)).toBe("storm");
    expect(weatherGlyphKey(null, null)).toBe("unknown");
  });

  it("parses vineyard-local provider timestamps", () => {
    expect(splitLocalDateTime("2026-10-03 16:00:00")).toEqual({ date: "2026-10-03", hour: 16 });
    expect(splitLocalDateTime("nope")).toBeNull();
  });
});

describe("field-level forecast provenance", () => {
  const primary = normaliseWillyWeatherForecast(willyPayload(), "2026-10-02T00:00:00Z")!;
  const supplementary: FiveDayForecast = {
    days: primary.days.map((day) => ({
      ...day,
      humidityMaxPct: 72,
      conditionKey: "clear",
      conditionCode: 0,
      conditionDescription: "Clear",
      periods: day.periods.map((period) => ({ ...period, humidityMaxPct: 70 })),
    })),
    source: "Open-Meteo",
    sourceDetail: "samples",
    timezone: "Australia/Sydney",
    updatedAt: null,
  };

  it("uses the supplementary provider only for missing humidity and records the source", () => {
    const merged = supplementForecast(primary, supplementary);
    expect(merged.source).toBe("WillyWeather");
    expect(merged.fieldSources?.humidity).toBe("Open-Meteo");
    expect(merged.fieldSources?.temperature).toBe("WillyWeather");
    expect(merged.days[0].humidityMaxPct).toBe(72);
    // Temperature must still come from the primary provider.
    expect(merged.days[0].tempMaxC).toBe(primary.days[0].tempMaxC);
    // Condition already came from WillyWeather, so it is not overwritten.
    expect(merged.days[0].conditionDescription).toBe("Showers");
    expect(merged.fieldSources?.condition).toBe("WillyWeather");
  });

  it("does not supplement when the primary already supplies humidity", () => {
    const withHumidity = normaliseWillyWeatherForecast(willyPayload({ humidity: true }), "2026-10-02T00:00:00Z")!;
    const merged = supplementForecast(withHumidity, supplementary);
    expect(merged.fieldSources?.humidity).toBe("WillyWeather");
  });

  it("supplements the condition when the provider gives none", () => {
    const noPrecis = normaliseWillyWeatherForecast(willyPayload({ precis: false }), "2026-10-02T00:00:00Z")!;
    expect(noPrecis.fieldSources?.condition).toBeNull();
    const merged = supplementForecast(noPrecis, supplementary);
    expect(merged.fieldSources?.condition).toBe("Open-Meteo");
    expect(merged.days[0].conditionDescription).toBe("Clear");
  });
});

describe("shared forecast cache staleness", () => {
  it("trusts the server's is_stale flag", () => {
    expect(isCacheStale({ is_stale: false, stale_at: "1999-01-01T00:00:00Z" })).toBe(false);
    expect(isCacheStale({ is_stale: true })).toBe(true);
  });

  it("falls back to stale_at and treats a missing timestamp as stale", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(isCacheStale({ stale_at: future })).toBe(false);
    expect(isCacheStale({ stale_at: new Date(Date.now() - 1000).toISOString() })).toBe(true);
    expect(isCacheStale({})).toBe(true);
  });
});

describe("live observation RPC status mapping", () => {
  it("does not treat a status row as an available reading", () => {
    expect(mapLiveWeatherRow({ status: "not_configured" })).toMatchObject({ available: false, reason: "not_configured" });
    expect(mapLiveWeatherRow({ status: "no_data" })).toMatchObject({ available: false, reason: "no_data" });
    expect(mapLiveWeatherRow(null)).toMatchObject({ available: false, reason: "no_data" });
    expect(mapLiveWeatherRow({ status: "ok" })).toMatchObject({ available: false, reason: "no_data" });
  });

  it("uses the server's staleness rule rather than a Portal calculation", () => {
    const observed = new Date(Date.now() - 40 * 60_000).toISOString();
    const fresh = mapLiveWeatherRow({ status: "ok", temperature_c: 18, observed_at: observed, is_stale: false });
    expect(fresh).toMatchObject({ available: true, stale: false });
    const stale = mapLiveWeatherRow({ status: "ok", temperature_c: 18, observed_at: new Date().toISOString(), is_stale: true });
    expect(stale).toMatchObject({ available: true, stale: true });
  });

  it("maps a full Davis observation row", () => {
    const result = mapLiveWeatherRow({
      status: "ok",
      source: "davis_weatherlink",
      station_name: "Stockmans Ridge Wines",
      observed_at: "2026-10-03T05:00:00Z",
      temperature_c: 17.4,
      humidity_pct: 61,
      wind_speed_kmh: 9.2,
      wind_gust_kmh: 21.5,
      rain_today_mm: 2.4,
      rain_rate_mm_per_hr: 0.2,
      is_stale: false,
    });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.reading.station_name).toBe("Stockmans Ridge Wines");
      expect(result.reading.wind_gust_kmh).toBe(21.5);
    }
  });
});
