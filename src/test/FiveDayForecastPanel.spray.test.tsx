import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FiveDayForecastPanel, formatSprayWindowTime } from "@/components/weather/FiveDayForecastPanel";
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

let restoreChartLayoutMocks: (() => void) | null = null;

function installChartLayoutMocks() {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const element = this as Element;
    if (element.classList.contains("recharts-responsive-container")) {
      return {
        x: 0,
        y: 0,
        width: 900,
        height: 176,
        top: 0,
        left: 0,
        right: 900,
        bottom: 176,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return original.call(this);
  };
  restoreChartLayoutMocks = () => {
    Element.prototype.getBoundingClientRect = original;
    restoreChartLayoutMocks = null;
  };
}

function nonSprayableForecast(): FiveDayForecast {
  const base = forecast(true);
  return {
    ...base,
    days: base.days.map((day) => ({
      ...day,
      periods: day.periods.map((period) => ({ ...period, windMaxKmh: 30 })),
    })),
  };
}

function sprayRects(testId: string) {
  return Array.from(screen.getByTestId(testId).querySelectorAll(".spray-area .recharts-reference-area-rect"));
}

function sprayEdges(testId: string) {
  return Array.from(screen.getByTestId(testId).querySelectorAll(".spray-edge .recharts-reference-line-line"));
}

function rectBounds(rects: Element[]) {
  return rects.map((rect) => ({
    x: rect.getAttribute("x"),
    width: rect.getAttribute("width"),
    fill: rect.getAttribute("fill"),
    opacity: rect.getAttribute("fill-opacity"),
  }));
}

describe("spray windows on the forecast graphs", () => {
  beforeEach(() => {
    window.localStorage.clear();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver;
    installChartLayoutMocks();
  });

  afterEach(() => {
    restoreChartLayoutMocks?.();
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

  it("renders visible spray-area SVG bands and boundary lines on both graphs", async () => {
    render(<FiveDayForecastPanel vineyardId="v1" forecast={forecast(true)} rf={rf} />);

    await waitFor(() => expect(sprayRects("temperature-trend")).toHaveLength(3));

    const tempRects = sprayRects("temperature-trend");
    const windRects = sprayRects("wind-trend");
    expect(windRects).toHaveLength(3);
    expect(rectBounds(tempRects)).toEqual(rectBounds(windRects));
    expect(tempRects.every((rect) => Number.isFinite(Number(rect.getAttribute("x"))))).toBe(true);
    expect(tempRects.every((rect) => Number(rect.getAttribute("width")) > 0)).toBe(true);
    expect(tempRects.every((rect) => Number(rect.getAttribute("height")) > 0)).toBe(true);
    expect(windRects.every((rect) => Number(rect.getAttribute("height")) > 0)).toBe(true);
    expect(tempRects.some((rect) => rect.getAttribute("fill") === "hsl(var(--primary))")).toBe(true);
    expect(tempRects.some((rect) => rect.getAttribute("fill-opacity") === "0.2")).toBe(true);
    expect(tempRects.some((rect) => rect.getAttribute("fill-opacity") === "0.14")).toBe(true);

    const tempEdges = sprayEdges("temperature-trend");
    const windEdges = sprayEdges("wind-trend");
    expect(tempEdges).toHaveLength(6);
    expect(windEdges).toHaveLength(6);
    expect(tempEdges.map((line) => line.getAttribute("x1"))).toEqual(windEdges.map((line) => line.getAttribute("x1")));
  });

  it("renders no spray-area SVG bands when no periods qualify", async () => {
    render(<FiveDayForecastPanel vineyardId="v1" forecast={nonSprayableForecast()} rf={rf} />);

    await waitFor(() => expect(screen.getByTestId("temperature-trend").querySelector("svg")).toBeTruthy());
    expect(sprayRects("temperature-trend")).toHaveLength(0);
    expect(sprayRects("wind-trend")).toHaveLength(0);
    expect(sprayEdges("temperature-trend")).toHaveLength(0);
    expect(sprayEdges("wind-trend")).toHaveLength(0);
  });

  it("includes dates when a tooltip spray window crosses midnight", () => {
    expect(formatSprayWindowTime({
      kind: "optimal",
      startIndex: 4,
      endIndex: 7,
      startDate: "2026-09-25",
      endDate: "2026-09-26",
      startTimeLocal: "16:00",
      endTimeLocal: "08:00",
      tempMinC: 14,
      tempMaxC: 24,
      windMaxKmh: 8,
      rainMm: 0,
      humidityMinPct: 60,
    })).toBe("Fri 25 Sep 16:00 – Sat 26 Sep 08:00");
    expect(formatSprayWindowTime({
      kind: "optimal",
      startIndex: 2,
      endIndex: 3,
      startDate: "2026-09-25",
      endDate: "2026-09-25",
      startTimeLocal: "08:00",
      endTimeLocal: "16:00",
      tempMinC: 14,
      tempMaxC: 24,
      windMaxKmh: 8,
      rainMm: 0,
      humidityMinPct: 60,
    })).toBe("08:00–16:00");
  });
});
