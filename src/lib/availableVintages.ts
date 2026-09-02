// Data-driven Vintage options.
//
// Contract (replaces the old generated "current Vintage + previous 15" list):
//  * A surface offers "All vintages" first, then ONLY the Vintages that
//    actually contain non-deleted records for the selected vineyard on that
//    surface.
//  * Vintage attribution uses the canonical season window (season start
//    month/day), never the calendar year.
//  * A combined dashboard passes several sources; the options are the union.
import { supabase } from "@/integrations/ios-supabase/client";

/** One dated table feeding a surface's Vintage options. */
export interface TableVintageSource {
  table: string;
  /** Dated column used to attribute a row to a Vintage. */
  dateColumn: string;
  /** Column holding the vineyard id (defaults to `vineyard_id`). */
  vineyardColumn?: string;
  /** Soft-delete column to exclude (defaults to `deleted_at`; null to skip). */
  softDeleteColumn?: string | null;
  /** Optional extra equality filters, e.g. `{ is_template: false }`. */
  equals?: Record<string, unknown>;
}

/**
 * A surface whose records are only reachable through an RPC (or that carries a
 * canonical `vintage_year`). Returns the Vintages that have records.
 */
export interface CustomVintageSource {
  /** Stable identity used in the react-query key. */
  key: string;
  loadVintages: (vineyardId: string) => Promise<number[]>;
}

export type VintageSource = TableVintageSource | CustomVintageSource;

export function isCustomSource(s: VintageSource): s is CustomVintageSource {
  return typeof (s as CustomVintageSource).loadVintages === "function";
}

/** Stable identity of a source, used for react-query keys. */
export function sourceKey(s: VintageSource): string {
  return isCustomSource(s) ? s.key : `${s.table}.${s.dateColumn}`;
}


/** Vintage year for an ISO date/timestamp string, or null when undated. */
export function vintageForISO(
  value: string | null | undefined,
  seasonStartMonth: number,
  seasonStartDay: number,
): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year)) return null;
  const onOrAfterStart =
    month > seasonStartMonth || (month === seasonStartMonth && day >= seasonStartDay);
  return onOrAfterStart ? year + 1 : year;
}

/** Unique Vintages represented by a list of dates, newest first. */
export function vintagesFromDates(
  values: Array<string | null | undefined>,
  seasonStartMonth: number,
  seasonStartDay: number,
): number[] {
  const set = new Set<number>();
  for (const v of values) {
    const y = vintageForISO(v, seasonStartMonth, seasonStartDay);
    if (y != null) set.add(y);
  }
  return Array.from(set).sort((a, b) => b - a);
}

/** Read every non-deleted dated value for one table source in one vineyard. */
export async function fetchSourceDates(
  source: TableVintageSource,
  vineyardId: string,
): Promise<string[]> {
  let q = supabase
    .from(source.table as any)
    .select(source.dateColumn)
    .eq(source.vineyardColumn ?? "vineyard_id", vineyardId) as any;
  const soft = source.softDeleteColumn === undefined ? "deleted_at" : source.softDeleteColumn;
  if (soft) q = q.is(soft, null);
  for (const [k, v] of Object.entries(source.equals ?? {})) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[])
    .map((r) => r?.[source.dateColumn])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Union of the Vintages represented by every given source, newest first. */
export async function fetchAvailableVintages(
  sources: VintageSource[],
  vineyardId: string,
  seasonStartMonth: number,
  seasonStartDay: number,
): Promise<number[]> {
  const results = await Promise.all(
    sources.map(async (s) =>
      isCustomSource(s)
        ? await s.loadVintages(vineyardId)
        : vintagesFromDates(
            await fetchSourceDates(s, vineyardId),
            seasonStartMonth,
            seasonStartDay,
          ),
    ),
  );
  const set = new Set<number>();
  results.flat().forEach((y) => Number.isFinite(y) && set.add(Number(y)));
  return Array.from(set).sort((a, b) => b - a);
}


/** Stable react-query key prefix so any surface can invalidate the options. */
export const VINTAGE_OPTIONS_KEY = "vintage-options";
