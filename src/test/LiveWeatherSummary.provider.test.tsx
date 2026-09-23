// Focused behavioural proof that the Live Dashboard weather Refresh respects
// the vineyard's configured LOCAL OBSERVATION provider.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const refreshDavisObservations = vi.fn();
const fetchWeatherStatusForVineyard = vi.fn();
const fetchLiveWeather = vi.fn();
const fetchFiveDayForecast = vi.fn();
const toast = vi.fn();

vi.mock("@/lib/weatherStatusQuery", () => ({
  refreshDavisObservations: (...a: unknown[]) => refreshDavisObservations(...a),
  fetchWeatherStatusForVineyard: (...a: unknown[]) => fetchWeatherStatusForVineyard(...a),
  fetchLiveWeather: (...a: unknown[]) => fetchLiveWeather(...a),
}));
vi.mock("@/lib/fiveDayForecast", () => ({
  fetchFiveDayForecast: (...a: unknown[]) => fetchFiveDayForecast(...a),
}));
vi.mock("@/components/weather/FiveDayForecastPanel", () => ({
  FiveDayForecastPanel: () => <div data-testid="forecast-panel" />,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));
vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({
    temperature: (v: number | null | undefined) => (v == null ? "—" : `${v}°C`),
    wind: (v: number | null | undefined) => (v == null ? "—" : `${v} km/h`),
    rainfall: (v: number | null | undefined) => (v == null ? "—" : `${v} mm`),
  }),
}));

import { LiveWeatherSummary } from "@/components/dashboard/LiveWeatherSummary";

const VID = "11111111-1111-1111-1111-111111111111";

const integration = (provider: string, configured: boolean, is_active = true) => ({
  provider,
  configured,
  is_active,
});

function statusFor(provider: "davis_weatherlink" | "wunderground" | "none") {
  return {
    davis: integration("davis_weatherlink", provider === "davis_weatherlink"),
    wunderground: integration("wunderground", provider === "wunderground"),
    rpcUsed: true,
    anyConfigured: provider !== "none",
  };
}

function liveReading(source: string, observedAt = "2026-10-03T05:00:00Z") {
  return {
    available: true,
    stale: false,
    reading: {
      source,
      station_name: "Test station",
      observed_at: observedAt,
      temperature_c: 17.4,
      humidity_pct: 61,
      wind_speed_kmh: 9.2,
      wind_direction_deg: 180,
      wind_gust_kmh: 21.5,
      rain_today_mm: 2.4,
      rain_rate_mm_per_hr: 0.2,
    },
  };
}

const okForecast = {
  available: true,
  forecast: { days: [{ date: "2026-10-03", periods: [] }], source: "WillyWeather", timezone: "Australia/Sydney" },
  cache: { fetchedAt: new Date().toISOString() },
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LiveWeatherSummary vineyardId={VID} refetchIntervalMs={0} />
    </QueryClientProvider>,
  );
}

const pressRefresh = async () => {
  const button = await screen.findByRole("button", { name: /refresh/i });
  fireEvent.click(button);
};

beforeEach(() => {
  refreshDavisObservations.mockReset().mockResolvedValue({ ok: true });
  fetchWeatherStatusForVineyard.mockReset();
  fetchLiveWeather.mockReset();
  fetchFiveDayForecast.mockReset().mockResolvedValue(okForecast);
  toast.mockReset();
});

describe("manual Refresh respects the configured observation provider", () => {
  it("Davis vineyard: refreshes Davis and reports success", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("davis_weatherlink"));
    fetchLiveWeather
      .mockResolvedValueOnce(liveReading("davis_weatherlink"))
      .mockResolvedValue(liveReading("davis_weatherlink", "2026-10-03T06:00:00Z"));

    renderPanel();
    await pressRefresh();

    await waitFor(() => expect(refreshDavisObservations).toHaveBeenCalledWith(VID));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Weather updated" }));
  });

  it("Weather Underground vineyard: never calls Davis, no Davis error, still reports success from cache", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("wunderground"));
    fetchLiveWeather.mockResolvedValue(liveReading("wunderground_pws"));

    renderPanel();
    await pressRefresh();

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Weather updated" }));
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    const titles = toast.mock.calls.map((c) => (c[0] as any).title as string);
    expect(titles.some((t) => t.includes("Davis"))).toBe(false);
  });

  it("no configured provider: never calls Davis and shows no Davis failure", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("none"));
    fetchLiveWeather.mockResolvedValue({ available: false, reason: "not_configured" });

    renderPanel();
    await pressRefresh();

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    const titles = toast.mock.calls.map((c) => (c[0] as any).title as string);
    expect(titles).toContain("No local observation source configured");
    expect(titles.some((t) => t.includes("Davis"))).toBe(false);
  });

  it("forecast refresh is independent: a Davis failure only warns about observations", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("davis_weatherlink"));
    fetchLiveWeather.mockResolvedValue(liveReading("davis_weatherlink"));
    refreshDavisObservations.mockResolvedValue({ ok: false, message: "Davis rejected the credentials." });

    renderPanel();
    await pressRefresh();

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Live observations not refreshed (Davis WeatherLink)",
        description: "Davis rejected the credentials.",
      }),
    );
    const titles = toast.mock.calls.map((c) => (c[0] as any).title as string);
    expect(titles.some((t) => t.startsWith("Forecast not refreshed"))).toBe(false);
  });

  it("forecast failure does not suppress a successful observation refresh", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("wunderground"));
    fetchLiveWeather.mockResolvedValue(liveReading("wunderground_pws"));
    fetchFiveDayForecast.mockResolvedValue({ available: false, reason: "error", message: "Provider down" });

    renderPanel();
    await pressRefresh();

    await waitFor(() => {
      const titles = toast.mock.calls.map((c) => (c[0] as any).title as string);
      expect(titles.some((t) => t.startsWith("Forecast not refreshed"))).toBe(true);
    });
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    const titles = toast.mock.calls.map((c) => (c[0] as any).title as string);
    expect(titles.some((t) => t.includes("Live observations"))).toBe(false);
  });
});

describe("automatic stale top-up respects the configured provider", () => {
  it("Davis vineyard: a stale cached observation triggers a Davis refresh", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("davis_weatherlink"));
    fetchLiveWeather.mockResolvedValue({ ...liveReading("davis_weatherlink"), stale: true });

    renderPanel();

    await waitFor(() => expect(refreshDavisObservations).toHaveBeenCalledWith(VID));
  });

  it("Weather Underground vineyard: a stale cached observation never triggers Davis", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("wunderground"));
    fetchLiveWeather.mockResolvedValue({ ...liveReading("wunderground_pws"), stale: true });

    renderPanel();

    await waitFor(() => expect(fetchLiveWeather).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    const titles = toast.mock.calls.map((c) => (c[0] as any).title as string);
    expect(titles.some((t) => t.includes("Davis"))).toBe(false);
  });

  it("no provider: a stale cached observation never triggers Davis", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue(statusFor("none"));
    fetchLiveWeather.mockResolvedValue({ ...liveReading("manual"), stale: true });

    renderPanel();

    await waitFor(() => expect(fetchLiveWeather).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(refreshDavisObservations).not.toHaveBeenCalled();
  });
});
