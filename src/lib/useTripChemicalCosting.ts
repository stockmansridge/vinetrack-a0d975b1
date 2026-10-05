// Shared hook: everything computeTripCost needs for SQL 264 chemical costing
// across a set of trips — one final-price batch per distinct vintage and one
// batched Tank Actual read. Owner/Manager only (nothing is requested otherwise).
//
// Vintage: caller-supplied canonical `vintageByTrip` (allocation season_year)
// first; otherwise the trip date resolved in the VINEYARD time zone.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCanSeeCosts } from "@/lib/permissions";
import { useVintage } from "@/lib/useVintage";
import { fetchVineyard } from "@/lib/vineyardSettingsQuery";
import { useChemicalSeasonPrices, type SeasonPriceMap } from "@/lib/chemicalSeasonPricing";
import { fetchTankActualsForTrips, tankActualsQueryKey } from "@/lib/sprayTankActualsQuery";
import { resolveTripVintage } from "@/lib/chemicalCostVintage";
import type { Trip } from "@/lib/tripsQuery";

export interface TripChemicalCostingContext {
  prices: SeasonPriceMap | null;
  tankActualRows: any[];
  vintage: number | null;
}

export function useTripChemicalCosting(
  vineyardId: string | null | undefined,
  trips: ReadonlyArray<Trip>,
  sprayRecords: ReadonlyArray<{ trip_id?: string | null }>,
  opts: { vintageByTrip?: ReadonlyMap<string, number> | null } = {},
) {
  const canSeeCosts = useCanSeeCosts();
  const enabled = !!vineyardId && canSeeCosts;
  const { seasonStartMonth, seasonStartDay } = useVintage();
  const { data: vineyardRecord, isLoading: vyLoading } = useQuery({
    queryKey: ["vineyard-settings", vineyardId],
    enabled,
    queryFn: () => fetchVineyard(vineyardId!),
  });
  const timeZone = (vineyardRecord as any)?.timezone ?? null;
  const vintageByTrip = opts.vintageByTrip ?? null;

  const sprayTripIds = useMemo(() => {
    const linked = new Set(sprayRecords.map((r) => r.trip_id).filter(Boolean) as string[]);
    return trips.map((t) => t.id).filter((id) => linked.has(id));
  }, [trips, sprayRecords]);
  const vintageOf = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const t of trips) {
      m.set(t.id, resolveTripVintage(t, { vintageByTrip, seasonStartMonth, seasonStartDay, timeZone }));
    }
    return m;
  }, [trips, vintageByTrip, seasonStartMonth, seasonStartDay, timeZone]);
  const vintages = useMemo(
    () => sprayTripIds.map((id) => vintageOf.get(id)).filter((v): v is number => v != null),
    [sprayTripIds, vintageOf],
  );
  // Completed-trip costing is reporting: final vintage price (p_as_of = null).
  const prices = useChemicalSeasonPrices(vineyardId, vintages, { enabled: enabled && !vyLoading });
  const actualsQ = useQuery({
    queryKey: tankActualsQueryKey(vineyardId, sprayTripIds),
    enabled: enabled && sprayTripIds.length > 0,
    queryFn: () => fetchTankActualsForTrips(sprayTripIds),
    staleTime: 60 * 1000,
  });

  const contextFor = (trip: Trip): TripChemicalCostingContext => {
    const v = vintageOf.get(trip.id) ?? null;
    return {
      prices: v != null ? prices.byVintage.get(v) ?? null : null,
      tankActualRows: actualsQ.data?.byTrip.get(trip.id) ?? [],
      vintage: v,
    };
  };
  return { contextFor, isLoading: (enabled && vyLoading) || prices.isLoading || actualsQ.isLoading };
}
