import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  VINTAGE_HISTORY_YEARS,
  vintageOptions,
  vintageScope,
  applyVintageScope,
  isWithinVintage,
} from "@/lib/vintageScope";

// Southern-hemisphere style season: 1 July → 30 June.
const SEASON_MONTH = 7;
const SEASON_DAY = 1;

describe("vintage options", () => {
  it("offers the current Vintage plus the previous 15", () => {
    const opts = vintageOptions(2025);
    expect(opts.length).toBe(VINTAGE_HISTORY_YEARS + 1);
    expect(opts[0]).toBe(2025);
    expect(opts[opts.length - 1]).toBe(2010);
  });

  it("returns nothing for a non-finite anchor", () => {
    expect(vintageOptions(Number.NaN)).toEqual([]);
  });
});

describe("vintage scope window", () => {
  it("uses the canonical season range, not the calendar year", () => {
    const scope = vintageScope(2025, SEASON_MONTH, SEASON_DAY);
    expect(scope.vintage).toBe(2025);
    expect(scope.startISO < scope.endISO).toBe(true);
    // A season starting in July cannot begin on 1 January.
    expect(scope.startISO.endsWith("-01-01")).toBe(false);
  });

  it("does not overlap adjacent Vintages", () => {
    const a = vintageScope(2024, SEASON_MONTH, SEASON_DAY);
    const b = vintageScope(2025, SEASON_MONTH, SEASON_DAY);
    expect(a.endISO < b.startISO).toBe(true);
  });
});

describe("applyVintageScope", () => {
  let query: any;

  beforeEach(() => {
    query = { gte: vi.fn(() => query), lt: vi.fn(() => query) };
  });

  it("bounds the query as a half-open range on the given date column", () => {
    const scope = vintageScope(2025, SEASON_MONTH, SEASON_DAY);
    applyVintageScope(query, "date", scope);
    expect(query.gte).toHaveBeenCalledWith("date", scope.startISO);
    expect(query.lt).toHaveBeenCalledWith("date", scope.endExclusiveISO);
  });

  it("uses the next season start as the exclusive bound", () => {
    const a = vintageScope(2025, SEASON_MONTH, SEASON_DAY);
    const b = vintageScope(2026, SEASON_MONTH, SEASON_DAY);
    expect(a.endExclusiveISO).toBe(b.startISO);
    expect(a.endISO < a.endExclusiveISO).toBe(true);
  });

  it("leaves cross-vintage queries untouched when no scope is given", () => {
    applyVintageScope(query, "date", null);
    applyVintageScope(query, "date", undefined);
    expect(query.gte).not.toHaveBeenCalled();
    expect(query.lt).not.toHaveBeenCalled();
  });
});

describe("isWithinVintage", () => {
  const scope = vintageScope(2025, SEASON_MONTH, SEASON_DAY);
  const other = vintageScope(2024, SEASON_MONTH, SEASON_DAY);

  it("keeps records inside the window", () => {
    expect(isWithinVintage(scope.startISO, scope)).toBe(true);
    expect(isWithinVintage(scope.endISO, scope)).toBe(true);
  });

  it("keeps a timestamp late on the final day of the season", () => {
    expect(isWithinVintage(`${scope.endISO}T23:59:59Z`, scope)).toBe(true);
    expect(isWithinVintage(scope.endExclusiveISO, scope)).toBe(false);
  });

  it("rejects records from another Vintage", () => {
    expect(isWithinVintage(other.startISO, scope)).toBe(false);
    expect(isWithinVintage(other.endISO, scope)).toBe(false);
  });

  it("excludes undated records when scoped, keeps them when unscoped", () => {
    expect(isWithinVintage(null, scope)).toBe(false);
    expect(isWithinVintage(null, null)).toBe(true);
  });
});

