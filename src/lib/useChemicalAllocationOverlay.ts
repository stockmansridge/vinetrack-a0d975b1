// Shared reporting-time SQL 264 chemical overlay for trip_cost_allocations.
// Used by Cost Reports AND Work Task Reports so both show the same linked-trip
// totals. Stored rows are never rewritten; Owner/Manager only.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCanSeeCosts } from "@/lib/permissions";
import { useVintage } from "@/lib/useVintage";
import { fetchVineyard } from "@/lib/vineyardSettingsQuery";
import { fetchSprayRecordsForVineyard, type SprayRecord } from "@/lib/sprayRecordsQuery";
import { useChemicalSeasonPrices } from "@/lib/chemicalSeasonPricing";
import {
  fetchTankActualsForTrips,
  fetchTripSessionsForTrips,
  tankActualsQueryKey,
} from "@/lib/sprayTankActualsQuery";
import {
  overlayAllocationsWithChemicalCost,
  resolveTripChemicalCost,
  type ChemicalCostResult,
  type OverlaidAllocation,
} from "@/lib/chemicalCostResolver";
import { resolveTripVintage, vintageByTripFromAllocations } from "@/lib/chemicalCostVintage";
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";

export function useChemicalAllocationOverlay(
  vineyardId: string | null | undefined,
  allocations: ReadonlyArray<TripCostAllocation>,
  opts: { enabled?: boolean } = {},
): { rows: OverlaidAllocation[]; isLoading: boolean } {
  const canSeeCosts = useCanSeeCosts();
  const enabled = !!vineyardId && canSeeCosts && opts.enabled !== false;
  const { seasonStartMonth, seasonStartDay } = useVintage();

  const { data: vineyardRecord, isLoading: vyLoading } = useQuery({
    queryKey: ["vineyard-settings", vineyardId],
    enabled,
    queryFn: () => fetchVineyard(vineyardId!),
  });
  const timeZone = (vineyardRecord as any)?.timezone ?? null;

  const { data: spray, isLoading: sprayLoading } = useQuery({
    queryKey: ["cost-spray", vineyardId],
    enabled,
    queryFn: () => fetchSprayRecordsForVineyard(vineyardId!),
  });
  const sprayByTrip = useMemo(() => {
    const m = new Map<string, SprayRecord[]>();
    for (const r of spray?.records ?? []) {
      if (!r.trip_id) continue;
      m.set(r.trip_id, [...(m.get(r.trip_id) ?? []), r]);
    }
    return m;
  }, [spray]);
  const tripIds = useMemo(
    () => Array.from(new Set(allocations.map((r) => r.trip_id).filter((id): id is string => !!id && sprayByTrip.has(id)))).sort(),
    [allocations, sprayByTrip],
  );
  const vintageByTrip = useMemo(() => vintageByTripFromAllocations(allocations), [allocations]);

  const { data: tripInfo, isLoading: tripsLoading } = useQuery({
    queryKey: ["trip-tank-sessions", vineyardId, tripIds.join(",")],
    enabled: enabled && tripIds.length > 0,
    queryFn: () => fetchTripSessionsForTrips(tripIds),
  });
  const vintageFor = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const id of tripIds) {
      const t = tripInfo?.get(id);
      m.set(id, resolveTripVintage(
        { id, start_time: t?.start_time ?? null, created_at: t?.created_at ?? null },
        { vintageByTrip, seasonStartMonth, seasonStartDay, timeZone },
      ));
    }
    return m;
  }, [tripIds, tripInfo, vintageByTrip, seasonStartMonth, seasonStartDay, timeZone]);
  const vintages = useMemo(
    () => Array.from(new Set(Array.from(vintageFor.values()).filter((v): v is number => v != null))),
    [vintageFor],
  );
  const prices = useChemicalSeasonPrices(vineyardId, vintages, { asOf: null, enabled });
  const { data: actuals, isLoading: actualsLoading } = useQuery({
    queryKey: tankActualsQueryKey(vineyardId, tripIds),
    enabled: enabled && tripIds.length > 0,
    queryFn: () => fetchTankActualsForTrips(tripIds),
  });

  const isLoading =
    enabled &&
    (sprayLoading || vyLoading || prices.isLoading || (tripIds.length > 0 && (actualsLoading || tripsLoading)));

  const rows = useMemo(() => {
    if (!enabled) return allocations.map((a) => ({ ...a }));
    if (isLoading) return [];
    const perTrip = new Map<string, ChemicalCostResult>();
    for (const tripId of tripIds) {
      const v = vintageFor.get(tripId) ?? null;
      const t = tripInfo?.get(tripId);
      perTrip.set(tripId, resolveTripChemicalCost({
        trip: { id: tripId, vineyard_id: t?.vineyard_id ?? vineyardId ?? null, tank_sessions: t?.tank_sessions },
        sprayRecords: sprayByTrip.get(tripId) ?? [],
        tankActualRows: actuals?.byTrip.get(tripId) ?? [],
        prices: v != null ? prices.byVintage.get(v) ?? null : null,
      }));
    }
    return overlayAllocationsWithChemicalCost(allocations, perTrip);
  }, [enabled, isLoading, allocations, tripIds, vintageFor, tripInfo, sprayByTrip, actuals, prices.byVintage, vineyardId]);

  return { rows, isLoading };
}
