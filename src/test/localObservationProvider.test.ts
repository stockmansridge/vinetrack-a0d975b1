import { describe, expect, it, vi, beforeEach } from "vitest";

const refreshDavisObservations = vi.fn();

vi.mock("@/lib/weatherStatusQuery", () => ({
  refreshDavisObservations: (...args: unknown[]) => refreshDavisObservations(...args),
  fetchWeatherStatusForVineyard: vi.fn(),
}));

import {
  resolveLocalObservationProvider,
  refreshObservationProvider,
  observationFailureTitle,
  observationProviderLabel,
  noNewerObservationsMessage,
  providerFromObservationSource,
} from "@/lib/localObservationProvider";

const cfg = (over: Record<string, unknown> = {}) => ({ provider: "davis_weatherlink", configured: true, ...over } as any);

beforeEach(() => refreshDavisObservations.mockReset());

describe("local observation provider resolution", () => {
  it("resolves Davis when Davis is active", () => {
    expect(resolveLocalObservationProvider({ davis: cfg({ is_active: true }) })).toBe("davis_weatherlink");
  });

  it("resolves Weather Underground when only WU is active", () => {
    expect(
      resolveLocalObservationProvider({
        davis: { provider: "davis_weatherlink", configured: false } as any,
        wunderground: cfg({ provider: "wunderground", is_active: true }),
      }),
    ).toBe("wunderground");
  });

  it("resolves none when nothing is configured", () => {
    expect(resolveLocalObservationProvider({})).toBe("none");
  });

  it("uses the current observation source to break a tie between two active providers", () => {
    const both = { davis: cfg({ is_active: true }), wunderground: cfg({ provider: "wunderground", is_active: true }) };
    expect(resolveLocalObservationProvider({ ...both, observationSource: "wunderground_pws" })).toBe("wunderground");
    expect(resolveLocalObservationProvider({ ...both })).toBe("davis_weatherlink");
  });

  it("maps observation source strings", () => {
    expect(providerFromObservationSource("davis")).toBe("davis_weatherlink");
    expect(providerFromObservationSource("wunderground_pws")).toBe("wunderground");
    expect(providerFromObservationSource("open_meteo")).toBeNull();
    expect(providerFromObservationSource(null)).toBeNull();
  });
});

describe("provider-neutral observation refresh", () => {
  it("calls Davis for a Davis vineyard", async () => {
    refreshDavisObservations.mockResolvedValue({ ok: true });
    const res = await refreshObservationProvider("v1", "davis_weatherlink");
    expect(refreshDavisObservations).toHaveBeenCalledWith("v1");
    expect(res).toMatchObject({ provider: "davis_weatherlink", attempted: true, ok: true });
  });

  it("reports a Davis provider failure", async () => {
    refreshDavisObservations.mockResolvedValue({ ok: false, message: "Davis rejected the credentials." });
    const res = await refreshObservationProvider("v1", "davis_weatherlink");
    expect(res).toMatchObject({ attempted: true, ok: false, reason: "provider_error" });
  });

  it("never calls Davis for a Weather Underground vineyard and is not an error", async () => {
    const res = await refreshObservationProvider("v1", "wunderground");
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    expect(res).toEqual({
      provider: "wunderground",
      attempted: false,
      ok: true,
      reason: "backend_current_refresh_not_available",
    });
  });

  it("never calls Davis when no provider is configured", async () => {
    const res = await refreshObservationProvider("v1", "none");
    expect(refreshDavisObservations).not.toHaveBeenCalled();
    expect(res).toMatchObject({ provider: "none", attempted: false, ok: true, reason: "no_provider_configured" });
  });
});

describe("provider-aware wording", () => {
  it("keeps Davis wording Davis-specific", () => {
    expect(observationFailureTitle("davis_weatherlink")).toBe("Live observations not refreshed (Davis WeatherLink)");
  });

  it("uses Weather Underground wording for WU", () => {
    expect(observationFailureTitle("wunderground")).toBe("Live observations unavailable (Weather Underground)");
    expect(observationFailureTitle("wunderground")).not.toContain("Davis");
  });

  it("uses a neutral message when no provider is configured", () => {
    expect(observationFailureTitle("none")).toBe("No local observation source configured");
    expect(observationFailureTitle("none")).not.toContain("Davis");
  });

  it("labels providers", () => {
    expect(observationProviderLabel("davis_weatherlink")).toBe("Davis WeatherLink");
    expect(observationProviderLabel("wunderground")).toBe("Weather Underground");
  });

  it("only claims 'no newer data' when an upstream fetch actually happened", () => {
    expect(
      noNewerObservationsMessage({ provider: "davis_weatherlink", attempted: true, ok: true }),
    ).toContain("Davis WeatherLink returned no newer data");
    expect(
      noNewerObservationsMessage({
        provider: "wunderground",
        attempted: false,
        ok: true,
        reason: "backend_current_refresh_not_available",
      }),
    ).toBeNull();
    expect(noNewerObservationsMessage({ provider: "none", attempted: false, ok: true })).toBeNull();
  });
});
