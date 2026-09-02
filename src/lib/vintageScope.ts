// Shared Vintage (season year) scoping for every dated operational surface.
//
// Contract:
//  * The canonical Vintage anchor is `useVintage()` (backed by the vineyard's
//    stored season start month/day). This module NEVER invents its own season
//    logic — it only turns a vintage year into the canonical season window via
//    `seasonRangeForVintage`.
//  * Surfaces offer the current Vintage and the previous 15 (16 options).
//  * Scoping is applied to the QUERY, not the heading: the underlying date
//    column is bounded by the season window so records from other Vintages can
//    never reach the client.
//  * Rows with a NULL date column are excluded by a bounded query. That is
//    intentional — an undated record cannot be attributed to a Vintage.
import { seasonRangeForVintage } from "@/lib/vineyardSeasonSettingsQuery";

/** Number of historical Vintages offered in addition to the current one. */
export const VINTAGE_HISTORY_YEARS = 15;

export interface VintageScope {
  vintage: number;
  /** Inclusive ISO start of the season window. */
  startISO: string;
  /** Inclusive ISO end of the season window. */
  endISO: string;
}

/** Current Vintage first, then the previous `VINTAGE_HISTORY_YEARS`. */
export function vintageOptions(
  currentVintage: number,
  history: number = VINTAGE_HISTORY_YEARS,
): number[] {
  if (!Number.isFinite(currentVintage)) return [];
  const out: number[] = [];
  for (let i = 0; i <= history; i += 1) out.push(currentVintage - i);
  return out;
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
  return { vintage, startISO, endISO };
}

/**
 * Apply a Vintage window to a PostgREST query on `column`.
 * A null/undefined scope means "all Vintages" and leaves the query untouched
 * (used by cross-vintage surfaces such as maps and multi-season analytics).
 */
export function applyVintageScope<T extends {
  gte: (c: string, v: any) => T;
  lte: (c: string, v: any) => T;
}>(query: T, column: string, scope: VintageScope | null | undefined): T {
  if (!scope) return query;
  return query.gte(column, scope.startISO).lte(column, scope.endISO);
}

/** Client-side equivalent of `applyVintageScope`, for already-fetched rows. */
export function isWithinVintage(
  value: string | null | undefined,
  scope: VintageScope | null | undefined,
): boolean {
  if (!scope) return true;
  if (!value) return false;
  return value >= scope.startISO && value <= scope.endISO;
}
