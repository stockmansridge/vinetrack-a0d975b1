// Provider-neutral spray-window calculation.
//
// This module knows nothing about Open-Meteo, WillyWeather, Metos, Davis or
// Weather Underground. It operates only on the normalised ForecastPeriod
// model. Provider adapters are responsible for producing genuine samples;
// nothing here fabricates or interpolates values.
//
// Weather suitability only — this never implies chemical-label approval.
import type { ForecastPeriod } from "@/lib/fiveDayForecast";

export interface SprayThresholds {
  /** Canonical °C. Period minimum must be strictly above this. */
  minTempC: number;
  /** Canonical °C. Period maximum must be strictly below this. */
  maxTempC: number;
  /** Canonical km/h. Period maximum wind must be strictly below this. */
  maxWindKmh: number;
  /** Canonical mm allowed per forecast period. */
  maxRainMm: number;
  /** Percent. Period MINIMUM humidity must be at or above this. */
  minHumidityPct: number;
}

export type SprayWindowKind = "optimal" | "high_humidity";

export interface SprayWindow {
  kind: SprayWindowKind;
  /** Position on the shared 0..(days*6-1) chart index axis. */
  startIndex: number;
  endIndex: number;
  startDate: string;
  endDate: string;
  startTimeLocal: string;
  endTimeLocal: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  windMaxKmh: number | null;
  rainMm: number | null;
  humidityMinPct: number | null;
}

/** A period with the chart index it occupies. */
interface IndexedPeriod {
  index: number;
  period: ForecastPeriod;
}

/**
 * Conservative standard qualification. Any missing required value fails.
 * Averages are never used.
 */
export function qualifiesStandard(period: ForecastPeriod, t: SprayThresholds): boolean {
  const { tempMinC, tempMaxC, windMaxKmh, rainMm } = period;
  if (tempMinC == null || tempMaxC == null || windMaxKmh == null || rainMm == null) return false;
  return (
    tempMinC > t.minTempC &&
    tempMaxC < t.maxTempC &&
    windMaxKmh < t.maxWindKmh &&
    rainMm <= t.maxRainMm
  );
}

/** High humidity requires the standard criteria plus sustained humidity. */
export function qualifiesHighHumidity(period: ForecastPeriod, t: SprayThresholds): boolean {
  if (!qualifiesStandard(period, t)) return false;
  return period.humidityMinPct != null && period.humidityMinPct >= t.minHumidityPct;
}

const minOf = (values: Array<number | null>): number | null => {
  const valid = values.filter((v): v is number => v != null);
  return valid.length ? Math.min(...valid) : null;
};
const maxOf = (values: Array<number | null>): number | null => {
  const valid = values.filter((v): v is number => v != null);
  return valid.length ? Math.max(...valid) : null;
};
const sumOf = (values: Array<number | null>): number | null => {
  const valid = values.filter((v): v is number => v != null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
};

function mergeRuns(
  matches: IndexedPeriod[],
  kind: SprayWindowKind,
): SprayWindow[] {
  const windows: SprayWindow[] = [];
  let run: IndexedPeriod[] = [];

  const flush = () => {
    if (!run.length) return;
    const first = run[0];
    const last = run[run.length - 1];
    windows.push({
      kind,
      startIndex: first.index,
      endIndex: last.index,
      startDate: first.period.date,
      endDate: last.period.date,
      startTimeLocal: first.period.startTimeLocal,
      endTimeLocal: last.period.endTimeLocal,
      tempMinC: minOf(run.map((r) => r.period.tempMinC)),
      tempMaxC: maxOf(run.map((r) => r.period.tempMaxC)),
      windMaxKmh: maxOf(run.map((r) => r.period.windMaxKmh)),
      rainMm: sumOf(run.map((r) => r.period.rainMm)),
      humidityMinPct: minOf(run.map((r) => r.period.humidityMinPct)),
    });
    run = [];
  };

  matches.forEach((entry) => {
    const previous = run[run.length - 1];
    if (previous && entry.index !== previous.index + 1) flush();
    run.push(entry);
  });
  flush();
  return windows;
}

/** True when enough intra-day detail exists for any spray-window decision. */
export function hasSprayDetail(periods: ForecastPeriod[]): boolean {
  return periods.some(
    (period) =>
      period.sampleCount > 0 &&
      period.tempMinC != null &&
      period.tempMaxC != null &&
      period.windMaxKmh != null &&
      period.rainMm != null,
  );
}

/**
 * Merges adjacent qualifying four-hour periods into continuous windows.
 * High-humidity windows are calculated independently and may sit inside a
 * larger standard window.
 */
export function calculateSprayWindows(
  periods: ForecastPeriod[],
  thresholds: SprayThresholds,
): { optimal: SprayWindow[]; highHumidity: SprayWindow[]; hasDetail: boolean } {
  const indexed: IndexedPeriod[] = periods.map((period, index) => ({ index, period }));
  const hasDetail = hasSprayDetail(periods);
  if (!hasDetail) return { optimal: [], highHumidity: [], hasDetail: false };
  return {
    optimal: mergeRuns(
      indexed.filter((entry) => qualifiesStandard(entry.period, thresholds)),
      "optimal",
    ),
    highHumidity: mergeRuns(
      indexed.filter((entry) => qualifiesHighHumidity(entry.period, thresholds)),
      "high_humidity",
    ),
    hasDetail: true,
  };
}
