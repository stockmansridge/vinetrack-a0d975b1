// Resolves "recent rain" mm for the Irrigation Advisor.
//
// Resolution order:
//   1. Davis WeatherLink / station data via `get_daily_rainfall` RPC
//      (which Rork backs with rainfall_daily — Davis preferred, then PWS,
//      then Open-Meteo archive fallback at the DB level).
//   2. 0 mm soft fallback if nothing is available.
//
// We never query rainfall_daily directly or call Davis from the browser.
import { useQuery } from "@tanstack/react-query";
import { fetchDailyRainfall, sourceLabel } from "@/lib/rainfallQuery";

export type RecentRainStatus =
  | "resolved" // got at least one row with a numeric rainfall value
  | "fallback" // RPC ok but no rows / all null → 0 mm fallback
  | "error"; // RPC missing/forbidden/failed → 0 mm fallback

export interface RecentRainResolution {
  totalMm: number;
  status: RecentRainStatus;
  lookbackHours: number;
  fromDate: string; // ISO
  toDate: string; // ISO
  sources: string[]; // raw source codes
  sourceLabel: string; // human-readable
  rowCount: number;
  errorMessage?: string;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function describeLookback(hours: number): string {
  if (hours <= 24) return "24 hr";
  if (hours <= 48) return "48 hr";
  if (hours <= 168) return "7 d";
  if (hours <= 336) return "14 d";
  return `${Math.round(hours / 24)} d`;
}

export async function resolveRecentRain(
  vineyardId: string,
  lookbackHours: number,
): Promise<RecentRainResolution> {
  const to = new Date();
  const from = new Date(to.getTime() - lookbackHours * 3600 * 1000);
  const fromDate = isoDate(from);
  const toDate = isoDate(to);

  const res = await fetchDailyRainfall(vineyardId, from, to);

  if (!res.ok) {
    return {
      totalMm: 0,
      status: "error",
      lookbackHours,
      fromDate,
      toDate,
      sources: [],
      sourceLabel: "fallback / rainfall source unavailable",
      rowCount: 0,
      errorMessage: res.message,
    };
  }

  let total = 0;
  let hasNumeric = false;
  const sources = new Set<string>();
  for (const r of res.rows) {
    if (typeof r.rainfall_mm === "number" && Number.isFinite(r.rainfall_mm)) {
      total += r.rainfall_mm;
      hasNumeric = true;
    }
    if (r.source) sources.add(r.source);
  }

  if (!hasNumeric) {
    return {
      totalMm: 0,
      status: "fallback",
      lookbackHours,
      fromDate,
      toDate,
      sources: [],
      sourceLabel: "fallback / no recent actual rain found",
      rowCount: res.rows.length,
    };
  }

  const list = Array.from(sources);
  const label =
    list.length === 0
      ? "rainfall_daily"
      : list.length === 1
        ? sourceLabel(list[0])
        : `Mixed (${list.map(sourceLabel).join(", ")})`;

  return {
    totalMm: Math.round(total * 10) / 10,
    status: "resolved",
    lookbackHours,
    fromDate,
    toDate,
    sources: list,
    sourceLabel: label,
    rowCount: res.rows.length,
  };
}

export function useRecentRainResolution(
  vineyardId: string | null | undefined,
  lookbackHours: number,
) {
  return useQuery<RecentRainResolution>({
    queryKey: ["recent-rain-resolution", vineyardId, lookbackHours],
    enabled: !!vineyardId,
    queryFn: () => resolveRecentRain(vineyardId!, lookbackHours),
    staleTime: 1000 * 60 * 15,
  });
}
