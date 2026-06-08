import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchVineyardRegionSettings } from "./vineyardRegionSettingsQuery";
import {
  AU_FORMATTERS,
  createRegionFormatters,
  type RegionFormatters,
} from "./regionFormatters";

/**
 * Returns Region & Units formatters for the active vineyard. Falls back
 * to AU defaults while loading or if no vineyard is selected.
 */
export function useRegionFormatters(): RegionFormatters {
  const { selectedVineyardId } = useVineyard();
  const { data } = useQuery({
    queryKey: ["vineyard-region-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardRegionSettings(selectedVineyardId!),
    staleTime: 5 * 60 * 1000,
  });
  return data ? createRegionFormatters(data) : AU_FORMATTERS;
}
