import { describe, expect, it } from "vitest";
import {
  currentVintageForSeason,
  seasonRangeForVintage,
  vintageForDate,
} from "@/lib/vineyardSeasonSettingsQuery";

// Authoritative rule: the database `resolve_vintage_year` (SQL 119) and the
// mobile shared VintageResolver. A 1 January season start returns the
// observation's CALENDAR YEAR. Any other start rolls into the next year.

const d = (iso: string) => new Date(`${iso}T00:00:00`);

describe("1 January season start (SQL 119)", () => {
  it("returns the observation calendar year", () => {
    expect(vintageForDate(d("2026-02-15"), 1, 1)).toBe(2026);
    expect(vintageForDate(d("2026-01-01"), 1, 1)).toBe(2026);
    expect(vintageForDate(d("2026-12-31"), 1, 1)).toBe(2026);
    expect(vintageForDate(d("2025-12-31"), 1, 1)).toBe(2025);
    expect(vintageForDate(d("2027-01-01"), 1, 1)).toBe(2027);
  });

  it("spans the whole calendar year", () => {
    expect(seasonRangeForVintage(1, 1, 2026)).toEqual({
      startISO: "2026-01-01",
      endISO: "2026-12-31",
    });
  });
});

describe("non-January northern-style season (1 November)", () => {
  it("rolls into the following calendar year", () => {
    expect(vintageForDate(d("2025-10-31"), 11, 1)).toBe(2025);
    expect(vintageForDate(d("2025-11-01"), 11, 1)).toBe(2026);
    expect(vintageForDate(d("2026-01-01"), 11, 1)).toBe(2026);
    expect(vintageForDate(d("2026-10-31"), 11, 1)).toBe(2026);
  });

  it("has a matching range", () => {
    expect(seasonRangeForVintage(11, 1, 2026)).toEqual({
      startISO: "2025-11-01",
      endISO: "2026-10-31",
    });
  });
});

describe("southern-style season (1 July)", () => {
  it("resolves boundary dates", () => {
    expect(vintageForDate(d("2026-06-30"), 7, 1)).toBe(2026);
    expect(vintageForDate(d("2026-07-01"), 7, 1)).toBe(2027);
    expect(vintageForDate(d("2026-07-02"), 7, 1)).toBe(2027);
    expect(currentVintageForSeason(7, 1, d("2027-01-15"))).toBe(2027);
  });

  it("has a matching range", () => {
    expect(seasonRangeForVintage(7, 1, 2027)).toEqual({
      startISO: "2026-07-01",
      endISO: "2027-06-30",
    });
  });
});

describe("every assigned Vintage range actually contains its dates", () => {
  const configs: [number, number][] = [
    [1, 1],
    [7, 1],
    [11, 1],
    [3, 15],
    [2, 29],
    [12, 31],
  ];

  it("range(vintageForDate(date)) contains date for a year of dates", () => {
    for (const [m, day] of configs) {
      for (let offset = 0; offset < 400; offset += 1) {
        const date = new Date(2025, 0, 1 + offset);
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
          date.getDate(),
        ).padStart(2, "0")}`;
        const vintage = vintageForDate(date, m, day);
        const { startISO, endISO } = seasonRangeForVintage(m, day, vintage);
        expect(
          { config: `${m}/${day}`, iso, vintage, ok: iso >= startISO && iso <= endISO },
        ).toEqual({ config: `${m}/${day}`, iso, vintage, ok: true });
      }
    }
  });
});
