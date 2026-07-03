import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import {
  fetchVineyardRegionSettings,
  type CountryCode,
} from "@/lib/vineyardRegionSettingsQuery";

export type Hemisphere = "southern" | "northern";

const SOUTHERN: CountryCode[] = ["AU", "NZ", "ZA"];

export function hemisphereForCountry(code: CountryCode | null | undefined): Hemisphere {
  if (!code) return "southern";
  return SOUTHERN.includes(code) ? "southern" : "northern";
}

/**
 * Compute the current "vintage" year for a hemisphere.
 *
 * Southern hemisphere: growing season crosses the calendar year and is named
 * for the harvest year. From July onwards we roll to the next vintage
 * (e.g. July 2026 → Vintage 2027).
 *
 * Northern hemisphere: harvest lands in the same calendar year, so vintage
 * equals the current calendar year.
 */
export function currentVintage(hem: Hemisphere, now: Date = new Date()): number {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  if (hem === "southern") {
    return m >= 7 ? y + 1 : y;
  }
  return y;
}

/** Inclusive date range (ISO YYYY-MM-DD) covered by a given vintage. */
export function vintageDateRange(hem: Hemisphere, vintage: number) {
  if (hem === "southern") {
    // Jul 1 (V-1) → Jun 30 (V)
    return {
      startISO: `${vintage - 1}-07-01`,
      endISO: `${vintage}-06-30`,
    };
  }
  // Northern: Nov 1 (V-1) → Oct 31 (V) — covers winter prep + growing season.
  return {
    startISO: `${vintage - 1}-11-01`,
    endISO: `${vintage}-10-31`,
  };
}

export function useVintage() {
  const { selectedVineyardId } = useVineyard();
  const { data } = useQuery({
    queryKey: ["vineyard-region-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardRegionSettings(selectedVineyardId!),
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const hemisphere = hemisphereForCountry(data?.country_code);
    const vintage = currentVintage(hemisphere);
    const range = vintageDateRange(hemisphere, vintage);
    return {
      hemisphere,
      vintage,
      countryCode: data?.country_code ?? null,
      ...range,
    };
  }, [data?.country_code]);
}
