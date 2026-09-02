import type { BlockHeat, HeatObservation } from "@/lib/growthHeatmap";

export interface HeatOverlay {
  id: string;
  url: string;
  /** [[minLat, minLng], [maxLat, maxLng]] */
  bounds: [[number, number], [number, number]];
}

export interface HeatMapViewProps {
  blocks: BlockHeat[];
  overlays: HeatOverlay[];
  observations: HeatObservation[];
  /** Observation ids that are shown for historical context but no longer
   *  influence the heat surface (older than the recency cut-off). */
  staleIds: Set<string>;
  /** Fit target — all polygon/observation points. */
  fitPoints: { lat: number; lng: number }[];
  /** Bump to re-fit the map. */
  fitKey: number;
  showBoundaries: boolean;
  onSelect: (obs: HeatObservation) => void;
}

