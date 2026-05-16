// Resolves "recent rain" mm for the Irrigation Advisor.
//
// Source of truth is the shared Supabase contract added in SQL 75:
//
//   get_vineyard_recent_rainfall(p_vineyard_id, p_lookback_hours)
//     → { recent_rain_mm, fallback_used, source_label, lookback_hours, ... }
//   get_vineyard_recent_rain_lookback_hours(p_vineyard_id)  -> integer
//   set_vineyard_recent_rain_lookback_hours(p_vineyard_id, p_hours)
//
// The portal never queries rainfall_daily directly and never calls Davis from
// the browser. If `fallback_used = true` and `recent_rain_mm = 0`, this is a
// soft fallback — recommendations still run, with the source label shown.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";

export type RecentRainStatus = "resolved" | "fallback" | "error";

export interface RecentRainResolution {
  totalMm: number;
  status: RecentRainStatus;
  lookbackHours: number;
  fromDate?: string;
  toDate?: string;
  sourceLabel: string;
  fallbackUsed: boolean;
  errorMessage?: string;
}

export function describeLookback(hours: number): string {
  if (hours <= 24) return "24 hr";
  if (hours <= 48) return "48 hr";
  if (hours <= 168) return "7 d";
  if (hours <= 336) return "14 d";
  return `${Math.round(hours / 24)} d`;
}

function pickRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

export async function resolveRecentRain(
  vineyardId: string,
  lookbackHours: number,
): Promise<RecentRainResolution> {
  const { data, error } = await iosSupabase.rpc("get_vineyard_recent_rainfall", {
    p_vineyard_id: vineyardId,
    p_lookback_hours: lookbackHours,
  });

  if (error) {
    return {
      totalMm: 0,
      status: "error",
      lookbackHours,
      sourceLabel: "fallback / rainfall source unavailable",
      fallbackUsed: true,
      errorMessage: error.message,
    };
  }

  const row = pickRow(data);
  const mm = Number(row?.recent_rain_mm ?? 0) || 0;
  const fallbackUsed = Boolean(row?.fallback_used);
  const label =
    (row?.source_label as string | undefined) ??
    (fallbackUsed ? "fallback / no recent actual rain found" : "rainfall_daily");
  const returnedHours = Number(row?.lookback_hours ?? lookbackHours) || lookbackHours;

  return {
    totalMm: Math.round(mm * 10) / 10,
    status: fallbackUsed && mm === 0 ? "fallback" : "resolved",
    lookbackHours: returnedHours,
    fromDate: row?.from_date as string | undefined,
    toDate: row?.to_date as string | undefined,
    sourceLabel: label,
    fallbackUsed,
  };
}

export function useRecentRainResolution(
  vineyardId: string | null | undefined,
  lookbackHours: number,
) {
  return useQuery<RecentRainResolution>({
    queryKey: ["recent-rain-resolution", vineyardId, lookbackHours],
    enabled: !!vineyardId && Number.isFinite(lookbackHours) && lookbackHours > 0,
    queryFn: () => resolveRecentRain(vineyardId!, lookbackHours),
    staleTime: 1000 * 60 * 15,
  });
}

// ---------- Shared vineyard-level lookback setting ----------

const LOOKBACK_DEFAULT = 48;
const LOOKBACK_ALLOWED = [24, 48, 168, 336];

export function useRecentRainLookbackHours(vineyardId: string | null | undefined) {
  return useQuery<number>({
    queryKey: ["recent-rain-lookback", vineyardId],
    enabled: !!vineyardId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await iosSupabase.rpc(
        "get_vineyard_recent_rain_lookback_hours",
        { p_vineyard_id: vineyardId! },
      );
      if (error) return LOOKBACK_DEFAULT;
      const n = Number(data);
      return Number.isFinite(n) && n > 0 ? n : LOOKBACK_DEFAULT;
    },
  });
}

export function useSetRecentRainLookbackHours(vineyardId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hours: number) => {
      if (!vineyardId) throw new Error("No vineyard selected");
      const safe = LOOKBACK_ALLOWED.includes(hours) ? hours : LOOKBACK_DEFAULT;
      const { error } = await iosSupabase.rpc(
        "set_vineyard_recent_rain_lookback_hours",
        { p_vineyard_id: vineyardId, p_hours: safe },
      );
      if (error) throw error;
      return safe;
    },
    onSuccess: (hours) => {
      qc.setQueryData(["recent-rain-lookback", vineyardId], hours);
      qc.invalidateQueries({ queryKey: ["recent-rain-resolution", vineyardId] });
    },
  });
}
