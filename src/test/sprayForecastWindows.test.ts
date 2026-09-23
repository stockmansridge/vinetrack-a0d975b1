import { describe, expect, it } from "vitest";
import type { ForecastPeriod } from "@/lib/fiveDayForecast";
import {
  calculateSprayWindows,
  hasSprayDetail,
  qualifiesHighHumidity,
  qualifiesStandard,
  sprayDisplayBands,
  type SprayThresholds,
} from "@/lib/sprayForecastWindows";
import {
  DEFAULT_FORECAST_HIGHLIGHTS,
  sprayThresholdsFrom,
} from "@/lib/forecastHighlightPreferences";
import { createRegionFormatters } from "@/lib/regionFormatters";
import { AU_DEFAULTS } from "@/lib/vineyardRegionSettingsQuery";

const THRESHOLDS: SprayThresholds = sprayThresholdsFrom(DEFAULT_FORECAST_HIGHLIGHTS);

function period(overrides: Partial<ForecastPeriod> = {}): ForecastPeriod {
  return {
    date: "2026-10-03",
    startTimeLocal: "08:00",
    endTimeLocal: "12:00",
    sampleCount: 4,
    tempMinC: 14,
    tempMaxC: 26,
    windMaxKmh: 9,
    rainMm: 0,
    humidityMinPct: 60,
    humidityMaxPct: 80,
    ...overrides,
  } as ForecastPeriod;
}

describe("spray window qualification", () => {
  it("qualifies when all four base conditions pass", () => {
    expect(qualifiesStandard(period(), THRESHOLDS)).toBe(true);
  });

  it("fails when temperature is below the minimum", () => {
    expect(qualifiesStandard(period({ tempMinC: 9 }), THRESHOLDS)).toBe(false);
    expect(qualifiesStandard(period({ tempMinC: 10 }), THRESHOLDS)).toBe(false);
  });

  it("fails when temperature is above the maximum", () => {
    expect(qualifiesStandard(period({ tempMaxC: 36 }), THRESHOLDS)).toBe(false);
    expect(qualifiesStandard(period({ tempMaxC: 35 }), THRESHOLDS)).toBe(false);
  });

  it("fails at or above the wind threshold", () => {
    expect(qualifiesStandard(period({ windMaxKmh: 14.9 }), THRESHOLDS)).toBe(true);
    expect(qualifiesStandard(period({ windMaxKmh: 15 }), THRESHOLDS)).toBe(false);
  });

  it("fails when rain exceeds the spray rain limit", () => {
    expect(qualifiesStandard(period({ rainMm: 0.1 }), THRESHOLDS)).toBe(true);
    expect(qualifiesStandard(period({ rainMm: 0.2 }), THRESHOLDS)).toBe(false);
  });

  it("fails when any required value is missing", () => {
    expect(qualifiesStandard(period({ rainMm: null }), THRESHOLDS)).toBe(false);
    expect(qualifiesStandard(period({ windMaxKmh: null }), THRESHOLDS)).toBe(false);
    expect(qualifiesStandard(period({ tempMinC: null }), THRESHOLDS)).toBe(false);
    expect(qualifiesStandard(period({ tempMaxC: null }), THRESHOLDS)).toBe(false);
  });

  it("uses minimum humidity, not maximum, for high-humidity windows", () => {
    expect(qualifiesHighHumidity(period({ humidityMinPct: 92, humidityMaxPct: 98 }), THRESHOLDS)).toBe(true);
    // Only the maximum is above the threshold.
    expect(qualifiesHighHumidity(period({ humidityMinPct: 70, humidityMaxPct: 95 }), THRESHOLDS)).toBe(false);
    expect(qualifiesHighHumidity(period({ humidityMinPct: null }), THRESHOLDS)).toBe(false);
    // Still a standard window.
    expect(qualifiesStandard(period({ humidityMinPct: 70 }), THRESHOLDS)).toBe(true);
  });

  it("ignores the Highlight ON/OFF switch state", () => {
    const allOff = {
      ...DEFAULT_FORECAST_HIGHLIGHTS,
      wind: { enabled: false, threshold: 15 },
      humidity: { enabled: false, threshold: 90 },
      tempMin: { enabled: false, threshold: 10 },
      tempMax: { enabled: false, threshold: 35 },
      sprayRain: { enabled: false, threshold: 0.1 },
    };
    expect(sprayThresholdsFrom(allOff)).toEqual(THRESHOLDS);
    expect(qualifiesStandard(period({ windMaxKmh: 16 }), sprayThresholdsFrom(allOff))).toBe(false);
  });

  it("changing a threshold changes the result", () => {
    const relaxed = sprayThresholdsFrom({
      ...DEFAULT_FORECAST_HIGHLIGHTS,
      wind: { enabled: true, threshold: 25 },
    });
    expect(qualifiesStandard(period({ windMaxKmh: 20 }), THRESHOLDS)).toBe(false);
    expect(qualifiesStandard(period({ windMaxKmh: 20 }), relaxed)).toBe(true);
  });

  it("regional unit conversion never changes canonical criteria", () => {
    const imperial = createRegionFormatters({ ...AU_DEFAULTS, distance_unit: "imperial" });
    expect(imperial.temperatureToCanonical(50)).toBeCloseTo(10);
    expect(qualifiesStandard(period(), THRESHOLDS)).toBe(true);
  });
});

describe("continuous window merging", () => {
  const periods = (flags: boolean[], humid: number[] = []): ForecastPeriod[] =>
    flags.map((ok, index) =>
      period({
        startTimeLocal: `${String(index * 4).padStart(2, "0")}:00`,
        endTimeLocal: `${String(index * 4 + 4).padStart(2, "0")}:00`,
        windMaxKmh: ok ? 9 : 30,
        humidityMinPct: humid.includes(index) ? 95 : 60,
      }),
    );

  it("merges adjacent qualifying periods into one window", () => {
    const { optimal } = calculateSprayWindows(periods([false, true, true, true, false, false]), THRESHOLDS);
    expect(optimal).toHaveLength(1);
    expect(optimal[0]).toMatchObject({ startIndex: 1, endIndex: 3, startTimeLocal: "04:00", endTimeLocal: "16:00" });
  });

  it("keeps non-adjacent periods separate", () => {
    const { optimal } = calculateSprayWindows(periods([true, false, true, false, false, false]), THRESHOLDS);
    expect(optimal.map((w) => [w.startIndex, w.endIndex])).toEqual([[0, 0], [2, 2]]);
  });

  it("allows a high-humidity range inside a larger standard range", () => {
    const { optimal, highHumidity } = calculateSprayWindows(
      periods([true, true, true, true, false, false], [1, 2]),
      THRESHOLDS,
    );
    expect(optimal.map((w) => [w.startIndex, w.endIndex])).toEqual([[0, 3]]);
    expect(highHumidity.map((w) => [w.startIndex, w.endIndex])).toEqual([[1, 2]]);
  });

  it("splits display bands so shades never stack", () => {
    const { optimal, highHumidity } = calculateSprayWindows(
      periods([true, true, true, true, false, false], [1, 2]),
      THRESHOLDS,
    );
    const bands = sprayDisplayBands(optimal, highHumidity);
    expect(bands.filter((b) => b.kind === "optimal").map((b) => [b.startIndex, b.endIndex])).toEqual([[0, 0], [3, 3]]);
    expect(bands.filter((b) => b.kind === "high_humidity").map((b) => [b.startIndex, b.endIndex])).toEqual([[1, 2]]);
  });
});

describe("insufficient detail", () => {
  const dailyOnly = [
    period({ sampleCount: 0, tempMinC: null, tempMaxC: null, windMaxKmh: null, rainMm: null, humidityMinPct: null }),
    period({ sampleCount: 0, tempMinC: null, tempMaxC: null, windMaxKmh: null, rainMm: null, humidityMinPct: null }),
  ];

  it("invents no bands for a daily-only provider", () => {
    expect(hasSprayDetail(dailyOnly)).toBe(false);
    expect(calculateSprayWindows(dailyOnly, THRESHOLDS)).toEqual({ optimal: [], highHumidity: [], hasDetail: false });
  });
});
