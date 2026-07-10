// Typed model for the VineTrack Satellite Mapping tool.
// No runtime values, no simulated data — types only.

export type SatelliteProvider = "COPERNICUS_SENTINEL_2";

export type SatelliteIndexType =
  | "TRUE_COLOUR"
  | "NDVI"
  | "NDRE"
  | "MSAVI"
  | "RECI"
  | "NDMI";

export type SatelliteProcessingStatus =
  | "not_requested"
  | "searching"
  | "queued"
  | "processing"
  | "complete"
  | "failed"
  | "no_suitable_scene"
  | "insufficient_coverage";

export type SatelliteDataQuality =
  | "good"
  | "partial"
  | "cloud_affected"
  | "shadow_affected"
  | "no_data";

export interface SatelliteScene {
  id: string;
  provider: SatelliteProvider;
  acquired_at: string; // ISO timestamp
  cloud_cover_percent: number | null;
  native_resolution_m: number; // e.g. 10
  processing_status: SatelliteProcessingStatus;
  quality: SatelliteDataQuality;
}

export interface SatelliteRasterAsset {
  scene_id: string;
  vineyard_id: string;
  paddock_ids: string[];
  index: SatelliteIndexType;
  // URL to a VineTrack-controlled clipped overlay (PNG or tile endpoint).
  overlay_url: string | null;
  // URL to the cached analysis raster used for hover sampling.
  analysis_raster_url: string | null;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
}

export interface SatelliteIndexSummary {
  paddock_id: string;
  scene_id: string;
  index: SatelliteIndexType;
  valid_pixel_count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  // Percentile thresholds derived from this paddock's own valid pixel
  // distribution — never universal agronomic thresholds.
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
}

export type PixelClassification =
  | "very_low"
  | "low"
  | "typical"
  | "high"
  | "very_high"
  | "no_valid_data"
  | "cloud_or_shadow"
  | "outside_paddock";

export interface SatellitePixelReading {
  paddock_id: string | null;
  paddock_name: string | null;
  index: SatelliteIndexType;
  value: number | null;
  classification: PixelClassification;
  acquired_at: string | null;
  native_resolution_m: number | null;
  quality: SatelliteDataQuality;
}
