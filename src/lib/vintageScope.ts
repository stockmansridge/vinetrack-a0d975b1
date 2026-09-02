// Shared Vintage (season year) scoping for every dated operational surface.
//
// Contract:
//  * The canonical Vintage anchor is `useVintage()` (backed by the vineyard's
//    stored season start month/day). This module NEVER invents its own season
//    logic — it only turns a vintage year into the canonical season window via
//    `seasonRangeForVintage`.
//  * Scoping is applied to the QUERY, not the heading: the underlying date
//    column is bounded by the season window so records from other Vintages can
//    never reach the client.
//  * Rows with a NULL date column are excluded by a bounded query. That is
//    intentional — an undated record cannot be attributed to a Vintage.
import { seasonRangeForVintage } from "@/lib/vineyardSeasonSettingsQuery";

export interface VintageScope {
  vintage: number;
  /** Inclusive ISO start of the season window (season start date). */
  startISO: string;
  /** Inclusive ISO end DATE of the season window (display only). */
  endISO: string;
  /**
   * EXCLUSIVE upper bound: the next Vintage's season start date.
   * All query filtering uses `>= startISO AND < endExclusiveISO` so that
   * timestamp columns (created_at, start_time, fill_datetime) keep the whole
   * final day instead of being cut at midnight by an inclusive date bound.
   */
  endExclusiveISO: string;
}

/** Build the canonical season window for a Vintage. */
export function vintageScope(
  vintage: number,
  seasonStartMonth: number,
  seasonStartDay: number,
): VintageScope {
  const { startISO, endISO } = seasonRangeForVintage(
    seasonStartMonth,
    seasonStartDay,
    vintage,
  );
  // The next Vintage's start date is the canonical exclusive upper bound.
  const { startISO: endExclusiveISO } = seasonRangeForVintage(
    seasonStartMonth,
    seasonStartDay,
    vintage + 1,
  );
  return { vintage, startISO, endISO, endExclusiveISO };
}

/**
 * Apply a Vintage window to a PostgREST query on `column` as a half-open
 * range: `>= season start` and `< next season start`. Safe for both DATE and
 * TIMESTAMP columns.
 * A null/undefined scope means "all Vintages" and leaves the query untouched
 * (used by cross-vintage surfaces such as maps and multi-season analytics).
 */
export function applyVintageScope<T extends {
  gte: (c: string, v: any) => T;
  lt: (c: string, v: any) => T;
}>(query: T, column: string, scope: VintageScope | null | undefined): T {
  if (!scope) return query;
  return query.gte(column, scope.startISO).lt(column, scope.endExclusiveISO);
}

/** Client-side equivalent of `applyVintageScope`, for already-fetched rows. */
export function isWithinVintage(
  value: string | null | undefined,
  scope: VintageScope | null | undefined,
): boolean {
  if (!scope) return true;
  if (!value) return false;
  return value >= scope.startISO && value < scope.endExclusiveISO;
}

