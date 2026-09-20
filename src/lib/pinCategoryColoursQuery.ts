// READ-ONLY: fetch the current vineyard's configured pin button colours.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  buildPinCategoryColours,
  EMPTY_PIN_CATEGORY_COLOURS,
  type ButtonConfigRow,
  type PinCategoryColourMap,
} from "@/lib/pinCategoryConfig";

export const PIN_CATEGORY_COLOURS_QUERY_KEY = "pin-category-colours";
export const PIN_BUTTON_CATALOGUE_QUERY_KEY = "pin-button-catalogue";
export const PIN_COLOUR_REFRESH_MS = 60_000;

export function pinCategoryColoursQueryKey(vineyardId: string | null | undefined) {
  return [PIN_CATEGORY_COLOURS_QUERY_KEY, vineyardId] as const;
}

export async function fetchPinCategoryColours(vineyardId: string): Promise<PinCategoryColourMap> {
  const { data, error } = await supabase
    .from("vineyard_button_configs")
    .select("config_type, config_data")
    .eq("vineyard_id", vineyardId);
  if (error) {
    if (import.meta.env.DEV) console.warn("[pins] button config unavailable:", error.message);
    return EMPTY_PIN_CATEGORY_COLOURS;
  }
  return buildPinCategoryColours((data ?? []) as ButtonConfigRow[]);
}

/**
 * Configured category colours for the selected vineyard. Falls back to the
 * canonical palette (empty map) whenever configuration is missing.
 */
export function usePinCategoryColours(vineyardIdOverride?: string | null): PinCategoryColourMap {
  const { selectedVineyardId } = useVineyard();
  const vineyardId = vineyardIdOverride ?? selectedVineyardId;
  const { data } = useQuery({
    queryKey: pinCategoryColoursQueryKey(vineyardId),
    enabled: !!vineyardId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: PIN_COLOUR_REFRESH_MS,
    refetchIntervalInBackground: false,
    queryFn: () => {
      if (!vineyardId) return Promise.resolve(EMPTY_PIN_CATEGORY_COLOURS);
      return fetchPinCategoryColours(vineyardId);
    },
  });
  return data ?? EMPTY_PIN_CATEGORY_COLOURS;
}
