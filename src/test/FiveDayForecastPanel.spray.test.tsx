import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FiveDayForecastPanel } from "@/components/weather/FiveDayForecastPanel";
import { createRegionFormatters } from "@/lib/regionFormatters";
import { AU_DEFAULTS } from "@/lib/vineyardRegionSettingsQuery";
import type { FiveDayForecast, ForecastPeriod } from "@/lib/fiveDayForecast";

const rf = createRegionFormatters(AU_DEFAULTS);

function periods(dayIndex: number, detailed: boolean): ForecastPeriod[] {
  return Array.from({ length: 6 }, (_, bucket) => {
    const sprayable = dayIndex === 0 && bucket >= 1 && bucket <= 3;
    return {
      date: `2026-10-0${3 + dayIndex}`,
      startTimeLocal: `${String(bucket * 4).padStart(2, "0")}:00`,
      endTimeLocal: `${String(bucket * 4 + 4).padStart(2, "0")}:00`,
      sampleCount: detailed ? 4 : 0,
      tempMinC: detailed ? 14 : null,
      tempMaxC: detailed ? 26 : null,
      windMaxKmh: detailed ? (sprayable ? 8 : 30) : null,
      rainMm: detailed ? 0 : null,
      humidityMinPct: detailed ? (bucket === 2 ? 95 : 60) : null,
      humidityMaxPct: detailed ? 90 : null,
    } as ForecastPeriod;
  });
}

function forecast(detailed: boolean): FiveDayForecast {
  return {
    source: detailed ? "Open-Meteo" : "WillyWeather",
    timezone: "Australia/Sydney",
    updatedAt: null,
    days: Array.from({ length: 5 }, (_, dayIndex) => ({
      date: `2026-10-0${3 + dayIndex}`,
      conditionKey: null,
      conditionCode: null,
      conditionDescription: null,
      tempMinC: 14,
      tempMaxC: 26,
      rainMm: 0,
      rainProbabilityPct: 10,
      windMaxKmh: 12,
      humidityMaxPct: 80,
      periods: periods(dayIndex, detailed),
    })),
  } as unknown as FiveDayForecast;
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("spray windows on the forecast graphs", () => {
  beforeEach(() => {
    window.localStorage.clear();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver;
  });

  it("gives the temperature and wind graphs identical spray ranges", () => {
    render(<FiveDayForecastPanel vineyardId="v1" forecast={forecast(true)} rf={rf} />);
    const temp = screen.getByTestId("temperature-trend").getAttribute("data-spray-ranges");
    const wind = screen.getByTestId("wind-trend").getAttribute("data-spray-ranges");
    expect(temp).toBe(wind);
    // 04:00–08:00 and 12:00–16:00 standard, 08:00–12:00 high humidity inside it.
    expect(temp).toBe("optimal:1-1|optimal:3-3|high_humidity:2-2");
    expect(screen.getByTestId("spray-window-legend")).toHaveTextContent("Spray windows");
  });

  it("invents no bands when no detailed data is available at all", () => {
    render(<FiveDayForecastPanel vineyardId="v1" forecast={forecast(false)} rf={rf} />);
    // Provider-neutral wording: a data-availability problem, not a provider limit.
    expect(screen.getByTestId("spray-window-legend")).toHaveTextContent(
      "Detailed forecast data is currently unavailable for spray-window calculation.",
    );
  });

  it("renders identical bands for a supplemented primary provider", () => {
    const willy = {
      ...forecast(true),
      source: "WillyWeather",
      fieldSources: { temperature: "WillyWeather", wind: "WillyWeather", rain: "WillyWeather", humidity: "Open-Meteo", condition: "WillyWeather" },
    } as unknown as Parameters<typeof FiveDayForecastPanel>[0]["forecast"];
    render(<FiveDayForecastPanel vineyardId="v1" forecast={willy} rf={rf} />);
    expect(screen.getByTestId("temperature-trend").getAttribute("data-spray-ranges")).toBe(
      "optimal:1-1|optimal:3-3|high_humidity:2-2",
    );
    expect(screen.getByTestId("wind-trend").getAttribute("data-spray-ranges")).toBe(
      "optimal:1-1|optimal:3-3|high_humidity:2-2",
    );
    expect(screen.getByText(/Forecast: WillyWeather/)).toBeTruthy();
  });
});
