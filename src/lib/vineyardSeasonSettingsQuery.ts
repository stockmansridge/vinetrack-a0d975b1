// Shared vineyard Season Settings.
//
// Reads/writes go through the shared VineTrack Supabase RPCs
// `get_vineyard_season_settings` and `set_vineyard_season_settings`.
// The canonical columns live on `public.vineyards.season_start_month`
// and `public.vineyards.season_start_day`. RLS enforces:
//   - all vineyard members may read
//   - only owner/manager may write
//
// This value is shared across iOS, Android and the portal. Never mirror it
// to Lovable Cloud or a portal-only preferences table.
import { supabase } from "@/integrations/ios-supabase/client";

export interface SeasonSettings {
  season_start_month: number; // 1-12
  season_start_day: number;   // 1-31 (constrained by month)
  updated_at?: string | null;
}

export const SEASON_DEFAULTS: SeasonSettings = {
  season_start_month: 7,
  season_start_day: 1,
};

export function maxDayForMonth(month: number): number {
  if (month === 2) return 29;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

export function clampSeasonDay(month: number, day: number): number {
  const max = maxDayForMonth(month);
  if (!Number.isFinite(day) || day < 1) return 1;
  return Math.min(max, Math.floor(day));
}

export function isValidSeason(month: number, day: number): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= maxDayForMonth(month);
}

/** Current vintage for a season start date, matching iOS/Android. */
export function currentVintageForSeason(
  month: number,
  day: number,
  now: Date = new Date(),
): number {
  const y = now.getFullYear();
  const start = new Date(y, month - 1, day);
  return now >= start ? y + 1 : y;
}

/** Inclusive ISO date range covering the given vintage. */
export function seasonRangeForVintage(month: number, day: number, vintage: number) {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const start = new Date(vintage - 1, month - 1, day);
  const endExclusive = new Date(vintage, month - 1, day);
  const end = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);
  return { startISO: iso(start), endISO: iso(end) };
}

/** Compute the vintage a given date falls into. */
export function vintageForDate(date: Date, month: number, day: number): number {
  return currentVintageForSeason(month, day, date);
}

function coerce(raw: any): SeasonSettings {
  const row = Array.isArray(raw) ? raw[0] : raw;
  const m = Number(row?.season_start_month);
  const d = Number(row?.season_start_day);
  const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : SEASON_DEFAULTS.season_start_month;
  const dayRaw = Number.isInteger(d) && d >= 1 ? d : SEASON_DEFAULTS.season_start_day;
  return {
    season_start_month: month,
    season_start_day: clampSeasonDay(month, dayRaw),
    updated_at: row?.updated_at ?? null,
  };
}

export async function fetchVineyardSeasonSettings(
  vineyardId: string,
): Promise<SeasonSettings> {
  const { data, error } = await supabase.rpc("get_vineyard_season_settings", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
  return coerce(data);
}

export async function saveVineyardSeasonSettings(
  vineyardId: string,
  month: number,
  day: number,
): Promise<SeasonSettings> {
  const { data, error } = await supabase.rpc("set_vineyard_season_settings", {
    p_vineyard_id: vineyardId,
    p_season_start_month: month,
    p_season_start_day: day,
  });
  if (error) throw error;
  return coerce(data);
}

export const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];
