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
    queryKey: ["pin-category-colours", vineyardId],
    enabled: !!vineyardId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchPinCategoryColours(vineyardId!),
  });
  return data ?? EMPTY_PIN_CATEGORY_COLOURS;
}
