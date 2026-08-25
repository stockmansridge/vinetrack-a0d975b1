import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import {
  fetchVineyardRegionSettings,
  type CountryCode,
} from "@/lib/vineyardRegionSettingsQuery";
import { fetchVineyardLocation } from "@/lib/vineyardLocationQuery";
import {
  hemisphereFromCountry,
  meanLatitudeFromPolygons,
  resolveHemisphere,
  type Hemisphere,
} from "@/lib/hemisphere";
import {
  SEASON_DEFAULTS,
  currentVintageForSeason,
  fetchVineyardSeasonSettings,
  seasonRangeForVintage,
  vintageForDate as vintageForDateShared,
} from "@/lib/vineyardSeasonSettingsQuery";

export type { Hemisphere };

/**
 * @deprecated Country is a fallback only. Use `resolveHemisphere` from
 * `@/lib/hemisphere`, which prefers the vineyard's physical latitude.
 */
export function hemisphereForCountry(code: CountryCode | null | undefined): Hemisphere {
  return hemisphereFromCountry(code);
}

/**
 * Fallback latitude for vineyards with no stored GPS: the mean latitude of
 * their block/paddock polygon geometry (real recorded coordinates).
 */
async function fetchGeometryLatitude(vineyardId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("paddocks")
    .select("polygon_points")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .limit(50);
  if (error) return null;
  return meanLatitudeFromPolygons((data ?? []) as any[]);
}


/**
 * @deprecated Use `vintageForDate(date, month, day)` from
 * `vineyardSeasonSettingsQuery`. Retained for legacy call sites while they
 * migrate to the shared season contract.
 */
export function currentVintage(_hem: Hemisphere, now: Date = new Date()): number {
  return currentVintageForSeason(
    SEASON_DEFAULTS.season_start_month,
    SEASON_DEFAULTS.season_start_day,
    now,
  );
}

/** @deprecated Use `seasonRangeForVintage`. */
export function vintageDateRange(_hem: Hemisphere, vintage: number) {
  const { startISO, endISO } = seasonRangeForVintage(
    SEASON_DEFAULTS.season_start_month,
    SEASON_DEFAULTS.season_start_day,
    vintage,
  );
  return { startISO, endISO };
}

/**
 * Resolve the current vintage and season range for the selected vineyard
 * from the shared Supabase season settings. Falls back to 1 July only while
 * loading or if the RPC has no usable value.
 */
export function useVintage() {
  const { selectedVineyardId } = useVineyard();

  const seasonQ = useQuery({
    queryKey: ["vineyard-season-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardSeasonSettings(selectedVineyardId!),
    staleTime: 5 * 60 * 1000,
  });

  const regionQ = useQuery({
    queryKey: ["vineyard-region-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardRegionSettings(selectedVineyardId!),
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const month = seasonQ.data?.season_start_month ?? SEASON_DEFAULTS.season_start_month;
    const day = seasonQ.data?.season_start_day ?? SEASON_DEFAULTS.season_start_day;
    const vintage = currentVintageForSeason(month, day);
    const range = seasonRangeForVintage(month, day, vintage);
    const countryCode = regionQ.data?.country_code ?? null;
    const hemisphere = hemisphereForCountry(countryCode);
    return {
      hemisphere,
      vintage,
      countryCode,
      seasonStartMonth: month,
      seasonStartDay: day,
      isLoading: seasonQ.isLoading,
      ...range,
    };
  }, [seasonQ.data, seasonQ.isLoading, regionQ.data]);
}

/** Convenience re-export so callers only import from one place. */
export { vintageForDateShared as vintageForDate };
