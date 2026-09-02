// SQL 221 seasonal base-estimate access.
//
// Reads:   get_season_yield_base_overview(p_vineyard_id, p_vintage)
// Writes:  refresh_pruning_yield_estimates(p_vineyard_id, p_vintage)
//
// The refresh RPC is only ever called for the vintage the user is actively
// working in, immediately after Pruning Yield Calculator inputs are saved.
// Historical vintages are never refreshed or overwritten from the Portal.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import type { SeasonYieldBaseOverview } from "@/lib/seasonYieldContract";

export const SEASON_YIELD_OVERVIEW_KEY = "season_yield_base_overview";

export async function fetchSeasonYieldBaseOverview(
  vineyardId: string,
  vintage: number,
): Promise<SeasonYieldBaseOverview | null> {
  const { data, error } = await (supabase as any).rpc(
    "get_season_yield_base_overview",
    { p_vineyard_id: vineyardId, p_vintage: vintage },
  );
  if (error) throw error;
  const payload = Array.isArray(data) ? data[0] : data;
  return (payload as SeasonYieldBaseOverview) ?? null;
}

/** Recalculate the base estimates for ONE vineyard + vintage. */
export async function refreshPruningYieldEstimates(
  vineyardId: string,
  vintage: number,
): Promise<void> {
  const { error } = await (supabase as any).rpc("refresh_pruning_yield_estimates", {
    p_vineyard_id: vineyardId,
    p_vintage: vintage,
  });
  if (error) throw error;
}

export function useSeasonYieldBaseOverview(
  vineyardId: string | null | undefined,
  vintage: number | null | undefined,
) {
  return useQuery({
    queryKey: [SEASON_YIELD_OVERVIEW_KEY, vineyardId, vintage],
    enabled: !!vineyardId && vintage != null,
    queryFn: () => fetchSeasonYieldBaseOverview(vineyardId!, vintage!),
    staleTime: 60_000,
  });
}
