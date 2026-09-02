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
  /** Fit target — all polygon/observation points. */
  fitPoints: { lat: number; lng: number }[];
  /** Bump to re-fit the map. */
  fitKey: number;
  showBoundaries: boolean;
  onSelect: (obs: HeatObservation) => void;
}
