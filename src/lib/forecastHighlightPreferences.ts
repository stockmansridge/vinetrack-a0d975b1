export interface ForecastHighlightSetting {
  enabled: boolean;
  threshold: number;
}

export interface ForecastHighlightPreferences {
  rain: ForecastHighlightSetting;
  wind: ForecastHighlightSetting;
  humidity: ForecastHighlightSetting;
  /** Spray criteria. `enabled` controls visual highlighting only — spray-window
   *  calculations always use the stored threshold values. */
  tempMin: ForecastHighlightSetting;
  tempMax: ForecastHighlightSetting;
  /** Allowable forecast rain per four-hour period for an optimal spray window. */
  sprayRain: ForecastHighlightSetting;
}

export const DEFAULT_FORECAST_HIGHLIGHTS: ForecastHighlightPreferences = {
  rain: { enabled: true, threshold: 5 },
  wind: { enabled: true, threshold: 15 },
  humidity: { enabled: false, threshold: 90 },
  tempMin: { enabled: false, threshold: 10 },
  tempMax: { enabled: false, threshold: 35 },
  sprayRain: { enabled: false, threshold: 0.1 },
};

export function forecastHighlightStorageKey(vineyardId: string): string {
  return `vinetrack:forecast-highlights:v1:${vineyardId}`;
}

function validSetting(value: unknown, fallback: ForecastHighlightSetting): ForecastHighlightSetting {
  if (!value || typeof value !== "object") return { ...fallback };
  const candidate = value as Partial<ForecastHighlightSetting>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    threshold:
      typeof candidate.threshold === "number" && Number.isFinite(candidate.threshold) && candidate.threshold >= 0
        ? candidate.threshold
        : fallback.threshold,
  };
}

export function parseForecastHighlightPreferences(raw: string | null): ForecastHighlightPreferences {
  if (!raw) return structuredClone(DEFAULT_FORECAST_HIGHLIGHTS);
  try {
    const parsed = JSON.parse(raw) as Partial<ForecastHighlightPreferences>;
    return {
      rain: validSetting(parsed.rain, DEFAULT_FORECAST_HIGHLIGHTS.rain),
      wind: validSetting(parsed.wind, DEFAULT_FORECAST_HIGHLIGHTS.wind),
      humidity: validSetting(parsed.humidity, DEFAULT_FORECAST_HIGHLIGHTS.humidity),
      tempMin: validSetting(parsed.tempMin, DEFAULT_FORECAST_HIGHLIGHTS.tempMin),
      tempMax: validSetting(parsed.tempMax, DEFAULT_FORECAST_HIGHLIGHTS.tempMax),
      sprayRain: validSetting(parsed.sprayRain, DEFAULT_FORECAST_HIGHLIGHTS.sprayRain),
    };
  } catch {
    return structuredClone(DEFAULT_FORECAST_HIGHLIGHTS);
  }
}

export function shouldHighlight(value: number | null, setting: ForecastHighlightSetting): boolean {
  return setting.enabled && value != null && value >= setting.threshold;
}

/**
 * Spray thresholds derived from the configured values ONLY. The visual
 * `enabled` switches are deliberately ignored here.
 */
export function sprayThresholdsFrom(preferences: ForecastHighlightPreferences): {
  minTempC: number;
  maxTempC: number;
  maxWindKmh: number;
  maxRainMm: number;
  minHumidityPct: number;
} {
  return {
    minTempC: preferences.tempMin.threshold,
    maxTempC: preferences.tempMax.threshold,
    maxWindKmh: preferences.wind.threshold,
    maxRainMm: preferences.sprayRain.threshold,
    minHumidityPct: preferences.humidity.threshold,
  };
}
