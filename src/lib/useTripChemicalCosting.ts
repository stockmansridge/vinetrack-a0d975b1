// Shared hook: everything computeTripCost needs for SQL 264 chemical costing
// across a set of trips — one final-price batch per distinct vintage and one
// batched Tank Actual read. Owner/Manager only (nothing is requested otherwise).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCanSeeCosts } from "@/lib/permissions";
import { useVintage, vintageForDate } from "@/lib/useVintage";
import { useChemicalSeasonPrices, type SeasonPriceMap } from "@/lib/chemicalSeasonPricing";
import { fetchTankActualsForTrips, tankActualsQueryKey } from "@/lib/sprayTankActualsQuery";
import type { Trip } from "@/lib/tripsQuery";

export interface TripChemicalCostingContext {
  prices: SeasonPriceMap | null;
  tankActualRows: any[];
  vintage: number | null;
}

export function tripVintage(
  trip: Pick<Trip, "start_time" | "created_at">,
  month: number,
  day: number,
): number | null {
  const iso = trip.start_time ?? trip.created_at ?? null;
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : vintageForDate(d, month, day);
}

export function useTripChemicalCosting(
  vineyardId: string | null | undefined,
  trips: ReadonlyArray<Trip>,
  sprayRecords: ReadonlyArray<{ trip_id?: string | null }>,
) {
  const canSeeCosts = useCanSeeCosts();
  const { seasonStartMonth, seasonStartDay } = useVintage();
  const sprayTripIds = useMemo(() => {
    const linked = new Set(sprayRecords.map((r) => r.trip_id).filter(Boolean) as string[]);
    return trips.map((t) => t.id).filter((id) => linked.has(id));
  }, [trips, sprayRecords]);
  const vintages = useMemo(
    () =>
      trips
        .filter((t) => sprayTripIds.includes(t.id))
        .map((t) => tripVintage(t, seasonStartMonth, seasonStartDay))
        .filter((v): v is number => v != null),
    [trips, sprayTripIds, seasonStartMonth, seasonStartDay],
  );
  // Completed-trip costing is reporting: final vintage price (p_as_of = null).
  const prices = useChemicalSeasonPrices(vineyardId, vintages, { enabled: canSeeCosts });
  const actualsQ = useQuery({
    queryKey: tankActualsQueryKey(vineyardId, sprayTripIds),
    enabled: !!vineyardId && canSeeCosts && sprayTripIds.length > 0,
    queryFn: () => fetchTankActualsForTrips(sprayTripIds),
    staleTime: 60 * 1000,
  });

  const contextFor = (trip: Trip): TripChemicalCostingContext => {
    const v = tripVintage(trip, seasonStartMonth, seasonStartDay);
    return {
      prices: v != null ? prices.byVintage.get(v) ?? null : null,
      tankActualRows: actualsQ.data?.byTrip.get(trip.id) ?? [],
      vintage: v,
    };
  };
  return { contextFor, isLoading: prices.isLoading || actualsQ.isLoading };
}
