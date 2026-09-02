import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { vintageScope, type VintageScope } from "@/lib/vintageScope";
import {
  VINTAGE_OPTIONS_KEY,
  fetchAvailableVintages,
  type VintageSource,
} from "@/lib/availableVintages";

/** Sentinel used by the selector for "All vintages". */
export const ALL_VINTAGES = null;

export interface VintageFilter {
  /** Selected Vintage, or null for "All vintages" (no date restriction). */
  vintage: number | null;
  setVintage: (v: number | null) => void;
  /** Vintages that actually contain non-deleted records, newest first. */
  options: number[];
  /** Season window for the selection; null when "All vintages" is selected. */
  scope: VintageScope | null;
  /** True while season settings or the available Vintages are resolving. */
  isLoading: boolean;
  /** Re-read the available Vintages (after create, delete or restore). */
  refresh: () => void;
}

/**
 * Data-driven Vintage filter for a dated surface.
 *
 * Options come from the records themselves — "All vintages" first, then only
 * the Vintages with non-deleted records for the selected vineyard. The current
 * Vintage is selected by default only when it has records; otherwise the
 * surface opens on "All vintages".
 *
 * Pass several sources for a combined dashboard: the options are the union of
 * the Vintages represented by the seasonal records feeding it.
 */
export function useVintageFilter(
  sources: VintageSource | VintageSource[] = [],
): VintageFilter {
  const { selectedVineyardId } = useVineyard();
  const { vintage: currentVintage, seasonStartMonth, seasonStartDay, isLoading } = useVintage();
  const queryClient = useQueryClient();

  const list = useMemo(
    () => (Array.isArray(sources) ? sources : [sources]),
    // Sources are static per surface; key on their identity fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(sources)],
  );

  const optionsQuery = useQuery({
    queryKey: [
      VINTAGE_OPTIONS_KEY,
      selectedVineyardId,
      list.map((s) => `${s.table}.${s.dateColumn}`).join("|"),
      seasonStartMonth,
      seasonStartDay,
    ],
    enabled: !!selectedVineyardId && !!list.length && !isLoading,
    queryFn: () =>
      fetchAvailableVintages(list, selectedVineyardId!, seasonStartMonth, seasonStartDay),
  });

  const options = optionsQuery.data ?? [];
  // null = All vintages. `undefined` means "not chosen yet" so the default can
  // still settle once the available Vintages arrive.
  const [selected, setSelected] = useState<number | null | undefined>(undefined);

  // Reset the choice whenever the vineyard changes.
  useEffect(() => {
    setSelected(undefined);
  }, [selectedVineyardId]);

  const resolved: number | null = useMemo(() => {
    if (selected !== undefined) {
      // Keep an explicit choice only while it still has records.
      if (selected === null) return null;
      return options.includes(selected) ? selected : null;
    }
    if (!options.length) return null;
    return options.includes(currentVintage) ? currentVintage : null;
  }, [selected, options, currentVintage]);

  const scope = useMemo(
    () =>
      resolved == null ? null : vintageScope(resolved, seasonStartMonth, seasonStartDay),
    [resolved, seasonStartMonth, seasonStartDay],
  );

  return {
    vintage: resolved,
    setVintage: setSelected,
    options,
    scope,
    isLoading: isLoading || optionsQuery.isLoading,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: [VINTAGE_OPTIONS_KEY] }),
  };
}
