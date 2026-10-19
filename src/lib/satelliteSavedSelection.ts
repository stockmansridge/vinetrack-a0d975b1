import { SUPPORTED_PROCESSING_VERSIONS } from "./satelliteCompleteness";

export interface SavedCandidate {
  satellite_scene_id: string;
  index_type: string;
  processing_version?: string | null;
  id: string;
  storage_path: string;
  asset_type?: string | null;
}

/** Display publication is independent of summaries; analysis must be its exact generation. */
export function selectSavedPair<T extends SavedCandidate>(assets: T[], sceneId: string, index: string): { display?: T; analytical?: T } {
  const candidates = assets.filter((a) => a.satellite_scene_id === sceneId && a.index_type === index
    && SUPPORTED_PROCESSING_VERSIONS.includes(a.processing_version ?? "") && a.storage_path);
  const kind = (a: T) => a.asset_type ?? (a.storage_path.endsWith(".png") ? "DISPLAY_RASTER" : "ANALYTICAL_RASTER");
  const display = candidates.filter((a) => kind(a) === "DISPLAY_RASTER").sort((a, b) =>
    SUPPORTED_PROCESSING_VERSIONS.indexOf(a.processing_version ?? "") - SUPPORTED_PROCESSING_VERSIONS.indexOf(b.processing_version ?? "")
    || a.id.localeCompare(b.id))[0];
  const analytical = display ? candidates.filter((a) => kind(a) === "ANALYTICAL_RASTER"
    && a.processing_version === display.processing_version).sort((a, b) => a.id.localeCompare(b.id))[0] : undefined;
  return { display, analytical };
}