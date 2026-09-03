import { describe, expect, it } from "vitest";
import {
  hemisphereFromCountry,
  hemisphereFromLatitude,
  hemisphereLabel,
  meanLatitudeFromPolygons,
  resolveHemisphere,
} from "@/lib/hemisphere";
import {
  currentVintageForSeason,
  seasonRangeForVintage,
} from "@/lib/vineyardSeasonSettingsQuery";

// Regional/unit settings are represented here to prove they are simply not
// inputs to the resolver at all.
const METRIC = { area_unit: "hectares", distance_unit: "metric" } as const;
const US = { area_unit: "acres", distance_unit: "imperial" } as const;

describe("hemisphere resolver — latitude is authoritative", () => {
  it("southern latitude + metric units → southern", () => {
    void METRIC;
    expect(resolveHemisphere({ latitude: -33.29, countryCode: "AU" }).hemisphere).toBe("southern");
  });

  it("southern latitude + US units and US country → southern", () => {
    void US;
    const r = resolveHemisphere({ latitude: -33.29, countryCode: "US" });
    expect(r.hemisphere).toBe("southern");
    expect(r.source).toBe("vineyard_latitude");
  });

  it("northern latitude + metric units → northern", () => {
    expect(resolveHemisphere({ latitude: 38.5, countryCode: "AU" }).hemisphere).toBe("northern");
  });

  it("northern latitude + US units → northern", () => {
    expect(resolveHemisphere({ latitude: 38.5, countryCode: "US" }).hemisphere).toBe("northern");
  });

  it("changing regional units cannot change hemisphere", () => {
    const a = resolveHemisphere({ latitude: -33.29, countryCode: "AU" });
    const b = resolveHemisphere({ latitude: -33.29, countryCode: "US" });
    expect(a.hemisphere).toBe(b.hemisphere);
  });

  it("crossing the equator changes hemisphere", () => {
    expect(hemisphereFromLatitude(-0.5)).toBe("southern");
    expect(hemisphereFromLatitude(0.5)).toBe("northern");
    expect(hemisphereFromLatitude(0)).toBe("northern");
  });
});

describe("hemisphere resolver — fallbacks", () => {
  it("uses block geometry latitude when the vineyard has no stored GPS (JH Testing case)", () => {
    const r = resolveHemisphere({
      latitude: null,
      geometryLatitude: -33.2951,
      countryCode: "US",
    });
    expect(r.hemisphere).toBe("southern");
    expect(r.source).toBe("geometry_latitude");
  });

  it("falls back to country only when no latitude exists", () => {
    expect(resolveHemisphere({ countryCode: "US" })).toMatchObject({
      hemisphere: "northern",
      source: "country",
    });
    expect(resolveHemisphere({ countryCode: "AU" }).hemisphere).toBe("southern");
    expect(resolveHemisphere({}).source).toBe("default");
  });

  it("ignores invalid latitudes", () => {
    expect(resolveHemisphere({ latitude: NaN, countryCode: "AU" }).source).toBe("country");
    expect(resolveHemisphere({ latitude: 999, geometryLatitude: -20 }).source).toBe(
      "geometry_latitude",
    );
  });

  it("computes mean latitude from polygon shapes", () => {
    expect(
      meanLatitudeFromPolygons([
        { polygon_points: [{ latitude: -33.2, longitude: 148 }, { lat: -33.4, lng: 148 }] },
      ]),
    ).toBeCloseTo(-33.3, 5);
    expect(meanLatitudeFromPolygons([{ polygon_points: [[38.1, -122]] }])).toBeCloseTo(38.1, 5);
    expect(meanLatitudeFromPolygons([{ polygon_points: null }])).toBeNull();
    expect(meanLatitudeFromPolygons([])).toBeNull();
  });

  it("country helper still works for legacy callers", () => {
    expect(hemisphereFromCountry("ZA")).toBe("southern");
    expect(hemisphereFromCountry("GB")).toBe("northern");
    expect(hemisphereFromCountry(null)).toBe("southern");
  });

  it("labels", () => {
    expect(hemisphereLabel("southern")).toBe("Southern Hemisphere");
    expect(hemisphereLabel("northern")).toBe("Northern Hemisphere");
  });
});

describe("vintage date ranges are unchanged by hemisphere", () => {
  it("southern season (1 July) resolves July → June", () => {
    const { startISO, endISO } = seasonRangeForVintage(7, 1, 2027);
    expect(startISO).toBe("2026-07-01");
    expect(endISO).toBe("2027-06-30");
  });

  it("northern season (1 January) is the calendar year (SQL 119)", () => {
    const { startISO, endISO } = seasonRangeForVintage(1, 1, 2027);
    expect(startISO).toBe("2027-01-01");
    expect(endISO).toBe("2027-12-31");
  });

  it("current vintage is driven by season start, not hemisphere", () => {
    expect(currentVintageForSeason(7, 1, new Date("2026-08-25T00:00:00Z"))).toBe(2027);
    expect(currentVintageForSeason(1, 1, new Date("2026-08-25T00:00:00Z"))).toBe(2026);
  });
});
