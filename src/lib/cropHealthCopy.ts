// Single source of customer-facing wording for Crop Health Maps availability.
// Every consumer (timeline coverage text, per-paddock list, refresh summary,
// details drawer, missing-paddock statuses) must call `reasonToCustomerMessage`
// rather than build its own string. This keeps wording consistent and easy
// to update in one place.

import type {
  CropHealthAvailabilityReason,
  CropHealthPaddockViewState,
} from "./cropHealthViewModel";
import type { SatelliteIndexType } from "@/types/satellite";

export function layerDisplayLabel(layer: SatelliteIndexType): string {
  switch (layer) {
    case "TRUE_COLOUR": return "True Colour";
    case "NDVI": return "NDVI";
    case "EVI": return "EVI";
    case "GNDVI": return "GNDVI";
    case "MSAVI": return "MSAVI";
    case "NDRE": return "NDRE";
    case "RECI": return "RECI";
    case "GCI": return "GCI";
    case "RENDVI": return "RENDVI";
    case "NDMI": return "NDMI";
    case "PSRI": return "PSRI";
    default: return layer;
  }
}

export function reasonToCustomerMessage(
  reason: CropHealthAvailabilityReason,
  layer: SatelliteIndexType,
): string {
  const l = layerDisplayLabel(layer);
  switch (reason) {
    case "displayed": return "Imagery displayed";
    case "loading": return "Image available and loading";
    case "no_scene_for_date": return "No saved imagery for this date";
    case "selected_layer_missing": return `No ${l} layer saved for this date`;
    case "scene_incomplete": return `${l} processing incomplete`;
    case "asset_load_failed": return `${l} image could not be loaded`;
    case "overlay_mount_failed": return `${l} image could not be displayed`;
    case "cell_data_incomplete": return "Imagery displayed · Cell readings unavailable";
    case "package_upgrade_required": return "Imagery displayed · Update available";
  }
}

export function paddockCustomerStatus(p: CropHealthPaddockViewState): string {
  return reasonToCustomerMessage(p.availabilityReason, p.selectedLayer);
}
