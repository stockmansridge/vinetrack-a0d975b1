// Current estimate source per block for the Yields Overview.
//
// Rule (per Vintage + Block):
//   1. The latest COMPLETED Yield Estimate Trip with ≥1 recorded sample is the
//      source (currentEstimatesByBlock — drafts never participate).
//      If that trip cannot produce tonnes (e.g. bunch weight not configured)
//      the block shows the trip source with an explicit unavailable result —
//      it NEVER silently falls back to the pruning estimate.
//   2. Otherwise the SQL 221 pruning base estimate (Portal damage applied).
import type { CurrentBlockEstimate } from "@/lib/bunchCountTrips";

export type EstimateSourceKind = "yield_estimate_trip" | "pruning_estimate";

export const ESTIMATE_SOURCE_LABEL: Record<EstimateSourceKind, string> = {
  yield_estimate_trip: "Yield Estimate Trip",
  pruning_estimate: "Pruning Estimate",
};

export interface BlockEstimateSource {
  kind: EstimateSourceKind;
  tonnes: number | null;
  /** Why tonnes are unavailable, when they are. */
  unavailableReason: "bunch_weight_required" | "vine_count_required" | null;
  tripId: string | null;
}

export function resolveBlockEstimateSource(
  trip: CurrentBlockEstimate | undefined,
  pruningTonnes: number | null,
): BlockEstimateSource {
  if (trip) {
    const reason =
      trip.tonnes != null
        ? null
        : trip.bunchWeightGrams == null
        ? "bunch_weight_required"
        : "vine_count_required";
    return { kind: "yield_estimate_trip", tonnes: trip.tonnes, unavailableReason: reason, tripId: trip.tripId };
  }
  return { kind: "pruning_estimate", tonnes: pruningTonnes, unavailableReason: null, tripId: null };
}
