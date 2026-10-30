// Dashboard "Yield Estimate" total for the current vintage.
// Uses the same per-block source rule as the Yields Overview
// (resolveBlockEstimateSource: latest completed Yield Estimate Trip, else the
// SQL 221 pruning base estimate, damage OFF) — no new estimate maths.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYieldBlocks, fetchYieldReportsForVineyard } from "@/lib/yieldReportsQuery";
import { useYieldBunchWeights, blockVarietyIdentities, resolveBlockBunchWeight } from "@/lib/yieldBunchWeights";
import { buildBunchCountTrips, currentEstimatesByBlock } from "@/lib/bunchCountTrips";
import { useSeasonYieldBaseOverview } from "@/lib/seasonYieldQuery";
import { buildSeasonYieldEstimates } from "@/lib/seasonYieldContract";
import { resolveBlockEstimateSource } from "@/lib/yieldEstimateSource";
import { vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";
import { buildVarietyMap, useGrapeVarieties } from "@/lib/varietyResolver";

export interface YieldEstimateTotal {
  tonnes: number;
  blocksEstimated: number;
  blocksTotal: number;
}

/** Pure sum of the per-block current estimates. */
export function sumBlockEstimates(
  blockIds: string[],
  tripTonnes: Map<string, number | null>,
  pruningTonnes: Map<string, number | null>,
): YieldEstimateTotal {
  let tonnes = 0;
  let blocksEstimated = 0;
  for (const id of blockIds) {
    const k = id.toLowerCase();
    const t = tripTonnes.has(k) ? tripTonnes.get(k) ?? null : pruningTonnes.get(k) ?? null;
    if (t != null && Number.isFinite(t)) {
      tonnes += t;
      blocksEstimated++;
    }
  }
  return { tonnes, blocksEstimated, blocksTotal: blockIds.length };
}

export function useVintageYieldEstimateTotal(
  vineyardId: string | null | undefined,
  vintage: number | null | undefined,
  seasonStartMonth: number,
  seasonStartDay: number,
) {
  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchYieldBlocks(vineyardId!),
  });
  const reportsQ = useQuery({
    queryKey: ["yield_reports", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchYieldReportsForVineyard(vineyardId!),
  });
  const weightsQ = useYieldBunchWeights(vineyardId);
  const seasonQ = useSeasonYieldBaseOverview(vineyardId, vintage);
  const { data: grapeVarieties } = useGrapeVarieties(vineyardId);

  const data = useMemo<YieldEstimateTotal | null>(() => {
    if (!blocksQ.data || !reportsQ.data || vintage == null) return null;
    const varietyMap = buildVarietyMap(grapeVarieties ?? []);
    const blocks = blocksQ.data;
    const plantings = new Map(
      blocks.map((b) => [b.id.toLowerCase(), blockVarietyIdentities(b.varietyAllocations, varietyMap)]),
    );
    const rows = weightsQ.data ?? [];
    const trips = buildBunchCountTrips(reportsQ.data.sessions ?? [], {
      blocks,
      bunchWeightFor: (id: string) => resolveBlockBunchWeight(rows, id, plantings.get(id.toLowerCase()) ?? []),
      vintageOf: (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : vintageForDate(d, seasonStartMonth, seasonStartDay);
      },
    });
    const tripTonnes = new Map<string, number | null>();
    for (const [k, est] of currentEstimatesByBlock(trips, vintage)) {
      tripTonnes.set(k, resolveBlockEstimateSource(est, null).tonnes);
    }
    const model = buildSeasonYieldEstimates({ overview: seasonQ.data ?? null, applyDamage: false });
    const pruning = new Map<string, number | null>();
    for (const b of model.blocks) pruning.set(b.paddockId.toLowerCase(), b.tonnes);
    return sumBlockEstimates(blocks.map((b) => b.id), tripTonnes, pruning);
  }, [blocksQ.data, reportsQ.data, weightsQ.data, seasonQ.data, grapeVarieties, vintage, seasonStartMonth, seasonStartDay]);

  // Trip-owned blocks need the master weights: never total them from an
  // unloaded/failed weight read (that silently understates the vintage).
  return {
    data: weightsQ.data ? data : null,
    isLoading: blocksQ.isLoading || reportsQ.isLoading || seasonQ.isLoading || weightsQ.isLoading,
    error: blocksQ.error ?? reportsQ.error ?? weightsQ.error ?? null,
  };
}
