import { describe, expect, it } from "vitest";
import {
  needsSprayDetailSupplement,
  supplementForecast,
  type FiveDayForecast,
  type ForecastPeriod,
} from "@/lib/fiveDayForecast";
import { calculateSprayWindows } from "@/lib/sprayForecastWindows";
import { DEFAULT_FORECAST_HIGHLIGHTS, sprayThresholdsFrom } from "@/lib/forecastHighlightPreferences";

const THRESHOLDS = sprayThresholdsFrom(DEFAULT_FORECAST_HIGHLIGHTS);

function period(startHour: number, overrides: Partial<ForecastPeriod> = {}): ForecastPeriod {
  return {
    date: "2026-09-24",
    startHour,
    startTimeLocal: `${String(startHour).padStart(2, "0")}:00`,
    endTimeLocal: `${String(startHour + 4).padStart(2, "0")}:00`,
    tempMinC: 14,
    tempMaxC: 26,
    windMaxKmh: 8,
    humidityMaxPct: 80,
    humidityMinPct: 60,
    rainMm: 0,
    sampleCount: 4,
    ...overrides,
  };
}

function forecast(source: string, periods: ForecastPeriod[], overrides: Partial<FiveDayForecast> = {}): FiveDayForecast {
  return {
    source,
    sourceDetail: periods.some((p) => p.sampleCount > 0) ? "samples" : "daily",
    timezone: "Australia/Sydney",
    updatedAt: null,
    days: [
      {
        date: "2026-09-24",
        conditionKey: "clear",
        conditionCode: 0,
        conditionDescription: "Clear",
        tempMinC: 14,
        tempMaxC: 26,
        rainMm: 0,
        rainProbabilityPct: 10,
        humidityMaxPct: 80,
        windMaxKmh: 12,
        periods,
      },
    ],
    ...overrides,
  };
}

const supplementary = forecast("Open-Meteo", [
  period(8, { tempMinC: 99, tempMaxC: 99, windMaxKmh: 99, rainMm: 9, humidityMinPct: 95, humidityMaxPct: 97 }),
  period(12, { tempMinC: 99, tempMaxC: 99, windMaxKmh: 99, rainMm: 0, humidityMinPct: 70, humidityMaxPct: 75 }),
]);

describe("provider-neutral forecast supplementation", () => {
  it("leaves a complete primary forecast untouched", () => {
    const primary = forecast("WillyWeather", [period(8), period(12)]);
    expect(needsSprayDetailSupplement(primary)).toBe(false);
    expect(supplementForecast(primary, supplementary)).toBe(primary);
  });

  it("fills only missing humidity and keeps genuine primary values", () => {
    const primary = forecast("WillyWeather", [
      period(8, { humidityMinPct: null, humidityMaxPct: null }),
      period(12, { humidityMinPct: null, humidityMaxPct: null }),
    ]);
    expect(needsSprayDetailSupplement(primary)).toBe(true);
    const merged = supplementForecast(primary, supplementary);
    const first = merged.days[0].periods[0];
    expect(first.humidityMinPct).toBe(95);
    expect(first.tempMinC).toBe(14);
    expect(first.tempMaxC).toBe(26);
    expect(first.windMaxKmh).toBe(8);
    expect(first.rainMm).toBe(0);
    expect(merged.source).toBe("WillyWeather");
    expect(merged.fieldSources?.temperature).toBe("WillyWeather");
    expect(merged.fieldSources?.humidity).toContain("Open-Meteo");
  });

  it("fills only period rainfall when that is the single missing field", () => {
    const primary = forecast("WillyWeather", [period(8), period(12, { rainMm: null })]);
    const merged = supplementForecast(primary, supplementary);
    expect(merged.days[0].periods[0].rainMm).toBe(0);
    expect(merged.days[0].periods[1].rainMm).toBe(0);
    expect(merged.days[0].periods[1].windMaxKmh).toBe(8);
    expect(merged.fieldSources?.rain).toContain("Open-Meteo");
    expect(merged.fieldSources?.wind).toBe("WillyWeather");
  });

  it("matches periods by date and start hour, never array position", () => {
    const primary = forecast("WillyWeather", [
      period(12, { humidityMinPct: null, humidityMaxPct: null }),
    ]);
    const merged = supplementForecast(primary, supplementary);
    // The 12:00 period must take the supplementary 12:00 value (70), not 08:00 (95).
    expect(merged.days[0].periods[0].humidityMinPct).toBe(70);
  });

  it("ignores supplementary days with a different date", () => {
    const primary = forecast("WillyWeather", [period(8, { humidityMinPct: null })]);
    const otherDay = { ...supplementary, days: [{ ...supplementary.days[0], date: "2026-09-25" }] };
    expect(supplementForecast(primary, otherDay)).toBe(primary);
  });

  it("produces the same spray windows whichever provider is primary", () => {
    const openMeteoPrimary = forecast("Open-Meteo", [period(8, { humidityMinPct: 95 }), period(12)]);
    const willyPrimary = supplementForecast(
      forecast("WillyWeather", [
        period(8, { humidityMinPct: null, humidityMaxPct: null }),
        period(12, { humidityMinPct: null, humidityMaxPct: null }),
      ]),
      supplementary,
    );
    const ranges = (f: FiveDayForecast) => {
      const result = calculateSprayWindows(f.days.flatMap((day) => day.periods), THRESHOLDS);
      return [
        result.optimal.map((w) => [w.startIndex, w.endIndex]),
        result.highHumidity.map((w) => [w.startIndex, w.endIndex]),
      ];
    };
    expect(ranges(willyPrimary)).toEqual(ranges(openMeteoPrimary));
    expect(willyPrimary.source).toBe("WillyWeather");
  });

  it("marks a daily-only primary as sample-backed once genuine samples are merged", () => {
    const primary = forecast("Legacy RPC", [
      period(8, { sampleCount: 0, tempMinC: null, tempMaxC: null, windMaxKmh: null, rainMm: null, humidityMinPct: null, humidityMaxPct: null }),
    ]);
    const merged = supplementForecast(primary, supplementary);
    expect(merged.sourceDetail).toBe("samples");
    expect(merged.days[0].periods[0].sampleCount).toBe(4);
    expect(merged.source).toBe("Legacy RPC");
  });
});

describe("daily-only primary with empty periods", () => {
  const full = forecast("Open-Meteo", [0, 4, 8, 12, 16, 20].map((h) => period(h)));
  const daily = forecast("WillyWeather", [], {
    fieldSources: { temperature: "WillyWeather", wind: "WillyWeather", rain: "WillyWeather", humidity: null, condition: null },
  });
  daily.days[0] = { ...daily.days[0], tempMinC: 5, tempMaxC: 30, windMaxKmh: 40 };

  it("adopts supplementary periods for the same date and keeps daily cards", () => {
    const out = supplementForecast(daily, full);
    expect(out.days[0].periods).toHaveLength(6);
    expect(out.days[0].tempMinC).toBe(5);
    expect(out.days[0].tempMaxC).toBe(30);
    expect(out.days[0].windMaxKmh).toBe(40);
    expect(out.source).toBe("WillyWeather");
    expect(out.sourceDetail).toBe("samples");
    expect(out.fieldSources?.temperature).toBe("WillyWeather + Open-Meteo");
    expect(out.fieldSources?.wind).toBe("WillyWeather + Open-Meteo");
  });

  it("leaves periods empty when no matching date exists", () => {
    const other = { ...full, days: [{ ...full.days[0], date: "2026-09-30" }] };
    expect(supplementForecast(daily, other).days[0].periods).toEqual([]);
  });
});

describe("daily-only 5-day primary", () => {
  const dates = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"];
  const mkDay = (date: string, periods: ForecastPeriod[], v: number) => ({
    date, conditionKey: null, conditionCode: null, conditionDescription: null,
    tempMinC: v, tempMaxC: v + 10, rainMm: v / 10, rainProbabilityPct: v, humidityMaxPct: null, windMaxKmh: v + 20, periods,
  });
  const primary: FiveDayForecast = {
    source: "WillyWeather", sourceDetail: "daily", timezone: "Australia/Sydney", updatedAt: null,
    fieldSources: { temperature: "WillyWeather", wind: "WillyWeather", rain: "WillyWeather", humidity: null, condition: null },
    days: dates.map((d, i) => mkDay(d, [], i + 1)),
  };
  // Supplementary days deliberately in reverse order to prove date matching.
  const supp: FiveDayForecast = {
    source: "Open-Meteo", sourceDetail: "samples", timezone: "Australia/Sydney", updatedAt: null,
    days: [...dates].reverse().map((d) => mkDay(d, [0, 4, 8, 12, 16, 20].map((h) => period(h, { date: d })), 99)),
  };

  it("receives 30 periods, matched by date, with daily values unchanged", () => {
    const out = supplementForecast(primary, supp);
    expect(out.days.flatMap((d) => d.periods)).toHaveLength(30);
    out.days.forEach((day, i) => {
      expect(day.date).toBe(dates[i]);
      expect(day.periods.every((p) => p.date === day.date)).toBe(true);
      expect(day.tempMinC).toBe(i + 1);
      expect(day.tempMaxC).toBe(i + 11);
      expect(day.windMaxKmh).toBe(i + 21);
      expect(day.rainMm).toBe((i + 1) / 10);
      expect(day.rainProbabilityPct).toBe(i + 1);
    });
    expect(out.source).toBe("WillyWeather");
  });

  it("missing supplementary dates stay empty", () => {
    const partial = { ...supp, days: supp.days.filter((d) => d.date !== "2026-09-26") };
    const out = supplementForecast(primary, partial);
    expect(out.days[2].periods).toEqual([]);
    expect(out.days.flatMap((d) => d.periods)).toHaveLength(24);
  });

  it("existing primary periods are not replaced", () => {
    const own = period(8, { tempMinC: 1, tempMaxC: 2, windMaxKmh: 3, rainMm: 0, humidityMinPct: 10, humidityMaxPct: 20, date: dates[0] });
    const withPeriods = { ...primary, days: [mkDay(dates[0], [own], 1), ...primary.days.slice(1)] };
    const out = supplementForecast(withPeriods, supp);
    expect(out.days[0].periods).toHaveLength(1);
    expect(out.days[0].periods[0]).toMatchObject({ tempMinC: 1, tempMaxC: 2, windMaxKmh: 3 });
  });
});
