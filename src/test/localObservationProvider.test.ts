import { describe, expect, it, vi, beforeEach } from "vitest";

const refreshDavisObservations = vi.fn();
const refreshWundergroundObservations = vi.fn();
const fetchWeatherStatusForVineyard = vi.fn();
const fetchServerObservationProviderSelection = vi.fn();

vi.mock("@/lib/weatherStatusQuery", () => ({
  refreshDavisObservations: (...a: unknown[]) => refreshDavisObservations(...a),
  fetchWeatherStatusForVineyard: (...a: unknown[]) => fetchWeatherStatusForVineyard(...a),
  fetchServerObservationProviderSelection: (...a: unknown[]) =>
    fetchServerObservationProviderSelection(...a),
}));
vi.mock("@/lib/wundergroundProxy", () => ({
  refreshWundergroundObservations: (...a: unknown[]) => refreshWundergroundObservations(...a),
}));

import {
  resolveLocalObservationProvider,
  fetchLocalObservationProvider,
  refreshObservationProvider,
  observationFailureTitle,
  observationProviderLabel,
  noNewerObservationsMessage,
  providerFromObservationSource,
  mapBackendObservationProvider,
} from "@/lib/localObservationProvider";

const cfg = (over: Record<string, unknown> = {}) =>
  ({ provider: "davis_weatherlink", configured: true, ...over }) as any;

beforeEach(() => {
  refreshDavisObservations.mockReset().mockResolvedValue({ ok: true });
  refreshWundergroundObservations.mockReset().mockResolvedValue({ ok: true });
  fetchWeatherStatusForVineyard.mockReset().mockResolvedValue({
    davis: { provider: "davis_weatherlink", configured: false },
    wunderground: { provider: "wunderground", configured: false },
    rpcUsed: true,
    anyConfigured: false,
  });
  fetchServerObservationProviderSelection.mockReset().mockResolvedValue(null);
});

describe("backend provider mapping", () => {
  it("maps backend values onto the Portal union in one place", () => {
    expect(mapBackendObservationProvider("davis_weatherlink")).toBe("davis_weatherlink");
    expect(mapBackendObservationProvider("wunderground_pws")).toBe("wunderground");
    expect(mapBackendObservationProvider("none")).toBe("none");
    expect(mapBackendObservationProvider(null)).toBeNull();
  });

  it("maps observation source strings", () => {
    expect(providerFromObservationSource("davis")).toBe("davis_weatherlink");
    expect(providerFromObservationSource("wunderground_pws")).toBe("wunderground");
    expect(providerFromObservationSource("open_meteo")).toBeNull();
  });
});

describe("explicit server selection is authoritative", () => {
  it("davis_weatherlink selection wins over an active WU integration", async () => {
    fetchServerObservationProviderSelection.mockResolvedValue("davis_weatherlink");
    fetchWeatherStatusForVineyard.mockResolvedValue({
      davis: cfg({ is_active: true }),
      wunderground: cfg({ provider: "wunderground", is_active: true }),
      rpcUsed: true,
      anyConfigured: true,
    });
    expect(await fetchLocalObservationProvider("v1")).toBe("davis_weatherlink");
  });

  it("wunderground_pws selection wins over an active Davis integration", async () => {
    fetchServerObservationProviderSelection.mockResolvedValue("wunderground_pws");
    expect(await fetchLocalObservationProvider("v1")).toBe("wunderground");
  });

  it("explicit none resolves to none even when providers are configured", async () => {
    fetchServerObservationProviderSelection.mockResolvedValue("none");
    fetchWeatherStatusForVineyard.mockResolvedValue({
      davis: cfg({ is_active: true }),
      wunderground: cfg({ provider: "wunderground", is_active: true }),
      rpcUsed: true,
      anyConfigured: true,
    });
    expect(await fetchLocalObservationProvider("v1")).toBe("none");
  });
});

describe("legacy vineyards (null server selection)", () => {
  it("prefers Davis first when both are usable", async () => {
    fetchWeatherStatusForVineyard.mockResolvedValue({
      davis: cfg({ is_active: true }),
      wunderground: cfg({ provider: "wunderground", is_active: true }),
      rpcUsed: true,
      anyConfigured: true,
    });
    expect(await fetchLocalObservationProvider("v1")).toBe("davis_weatherlink");
  });

  it("falls back to Weather Underground when only WU is usable", () => {
    expect(
      resolveLocalObservationProvider({
        davis: { provider: "davis_weatherlink", configured: false } as any,
        wunderground: cfg({ provider: "wunderground", is_active: true }),
      }),
    ).toBe("wunderground");
  });

  it("resolves none when nothing is configured", async () => {
    expect(await fetchLocalObservationProvider("v1")).toBe("none");
  });
});

describe("provider-neutral observation refresh", () => {
  it("calls Davis only for a Davis vineyard", async () => {
    const res = await refreshObservationProvider("v1", "davis_weatherlink");
    expect(refreshDavisObservations).toHaveBeenCalledWith("v1");
    expect(refreshWundergroundObservations).not.toHaveBeenCalled();
    expect(res).toMatchObject({ provider: "davis_weatherlink", attempted: true, ok: true });
  });

  it("calls the Weather Underground current action only for a WU vineyard", async () => {
    const res = await refreshObservationProvider("v1", "wunderground");
    expect(refreshWundergroundObservations).toHaveBeenCalledWith("v1");
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    expect(res).toMatchObject({ provider: "wunderground", attempted: true, ok: true });
  });

  it("reports a WU provider failure", async () => {
    refreshWundergroundObservations.mockResolvedValue({ ok: false, message: "Station offline." });
    const res = await refreshObservationProvider("v1", "wunderground");
    expect(res).toMatchObject({ attempted: true, ok: false, reason: "provider_error", message: "Station offline." });
  });

  it("reports a Davis provider failure", async () => {
    refreshDavisObservations.mockResolvedValue({ ok: false, message: "Davis rejected the credentials." });
    const res = await refreshObservationProvider("v1", "davis_weatherlink");
    expect(res).toMatchObject({ attempted: true, ok: false, reason: "provider_error" });
  });

  it("calls neither provider when none is selected", async () => {
    const res = await refreshObservationProvider("v1", "none");
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    expect(refreshWundergroundObservations).not.toHaveBeenCalled();
    expect(res).toMatchObject({ provider: "none", attempted: false, ok: true, reason: "no_provider_configured" });
  });
});

describe("provider-aware wording", () => {
  it("keeps Davis wording Davis-specific", () => {
    expect(observationFailureTitle("davis_weatherlink")).toBe("Live observations not refreshed (Davis WeatherLink)");
  });

  it("uses Weather Underground wording for WU failures", () => {
    expect(observationFailureTitle("wunderground")).toBe("Live observations not refreshed (Weather Underground)");
    expect(observationFailureTitle("wunderground")).not.toContain("Davis");
  });

  it("uses a neutral message when no provider is configured", () => {
    expect(observationFailureTitle("none")).toBe("No local observation source configured");
  });

  it("labels providers", () => {
    expect(observationProviderLabel("davis_weatherlink")).toBe("Davis WeatherLink");
    expect(observationProviderLabel("wunderground")).toBe("Weather Underground");
  });

  it("only claims 'no newer data' after a successful upstream fetch", () => {
    expect(noNewerObservationsMessage({ provider: "davis_weatherlink", attempted: true, ok: true })).toContain(
      "Davis WeatherLink returned no newer data",
    );
    expect(noNewerObservationsMessage({ provider: "wunderground", attempted: true, ok: true })).toContain(
      "Weather Underground returned no newer data",
    );
    expect(noNewerObservationsMessage({ provider: "wunderground", attempted: true, ok: false })).toBeNull();
    expect(noNewerObservationsMessage({ provider: "none", attempted: false, ok: true })).toBeNull();
  });
});
