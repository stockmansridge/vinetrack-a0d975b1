import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Info, RefreshCw, Satellite as SatelliteIcon, ChevronDown, Loader2, Wrench, Maximize2, Minimize2, PanelRight, CalendarDays, ShieldAlert } from "lucide-react";
import MapWorkspaceDrawer, { type DrawerTab } from "@/components/satellite/MapWorkspaceDrawer";
import SatelliteDateSlider from "@/components/satellite/SatelliteDateSlider";
import RefreshProgressPanel from "@/components/satellite/RefreshProgressPanel";
import { fromArrayBuffer } from "geotiff";
import SatelliteMap, { type SatelliteRasterOverlay, type OverlayCallbackInfo, type SatelliteMapDiagnostics } from "@/components/SatelliteMap";
import OverlayHealthPanel from "@/components/satellite/OverlayHealthPanel";
import { useCropHealthViewModel } from "@/hooks/useCropHealthViewModel";
import { displayKeyFor, analyticalKeyFor, type AssetLoadState, type OverlayLifecycleState } from "@/lib/cropHealthViewModel";
import { reasonToCustomerMessage } from "@/lib/cropHealthCopy";

import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { fetchList } from "@/lib/queries";
import { parsePolygonPoints, LatLng, parseRows, estimateRowNumberAt, type PaddockRow } from "@/lib/paddockGeometry";
import { paddockColor } from "@/lib/paddockColor";
import { supabase } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { toast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import type { SatelliteIndexType } from "@/types/satellite";
import {
  inspectCompleteness,
  reportFromManifest,
  REQUIRED_INDICES,
  CURRENT_PROCESSING_VERSION,
  type CompletenessReport,
  type PaddockCompleteness,
} from "@/lib/satelliteCompleteness";
import { fetchManifest, fetchAssetBytes, type ManifestResponse } from "@/lib/satelliteManifest";
import { getAssetBlob, deleteCachedAsset, readCachedAsset } from "@/lib/satelliteCache";

// Satellite edge functions live in the Lovable Cloud project but authorize the
// caller against the VineTrack iOS Supabase project. Send the iOS access token
// as the Bearer header so `verifySystemAdmin` there succeeds.
async function invokeSatelliteFn(name: string, body: unknown) {
  const { data: { session } } = await iosSupabase.auth.getSession();
  if (!session?.access_token) {
    return { data: null as any, error: new Error("Not signed in to VineTrack") as any };
  }
  const result = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const response = result.error?.context;
  if (response instanceof Response) {
    try {
      const text = await response.clone().text();
      (result.error as any).details = JSON.parse(text);
    } catch {
      // Keep the original invoke error if the response body is not JSON.
    }
  }
  return result;
}


// ---------- Layer definitions ----------
type InterpretationDirection =
  | "higher_usually_more_vegetation"
  | "higher_usually_more_chlorophyll_signal"
  | "higher_usually_more_moisture_signal"
  | "higher_usually_more_senescence"
  | "context_only";

type LayerOption = {
  id: SatelliteIndexType;
  label: string;
  short: string;
  description: string;
  nativeResM: number;
  resamplingNote: boolean;
  legend: string[];
  // Plain-English endpoint labels
  legendLow: string;
  legendHigh: string;
  // Documented display range (numerical). These are display bounds only —
  // values outside remain in analytical rasters and tooltips.
  displayMin: number;
  displayMax: number;
  // One-line supporting note under the legend colour bar.
  legendNote: string;
  // Direction of meaning used to phrase copy consistently.
  interpretationDirection: InterpretationDirection;
  // Content for the legend's info popover.
  infoWhat: string;
  infoLow: string;
  infoHigh: string;
  infoImportant: string;
  // Extra caution shown in legend + tooltip (e.g. PSRI seasonality note).
  extraCaution?: string;
  // Whether to rely mainly on paddock-relative wording instead of fixed bands.
  useRelativeBands?: boolean;
};

const fmt = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1));

const LAYERS: LayerOption[] = [
  {
    id: "TRUE_COLOUR", label: "Satellite Image", short: "True colour", nativeResM: 10, resamplingNote: false,
    description: "A natural-colour view of the vineyard from the selected Sentinel-2 capture. Uses native 10 m visible bands.",
    legend: ["#3b2f1e", "#7a6a48", "#c7b98a", "#e9e2c7", "#ffffff"],
    legendLow: "Darker surface", legendHigh: "Brighter surface",
    displayMin: 0, displayMax: 255,
    legendNote: "Natural-colour Sentinel-2 image. No numerical index value.",
    interpretationDirection: "context_only",
    infoWhat: "A natural-colour composite from Sentinel-2 red, green and blue bands.",
    infoLow: "Darker areas (shadow, water, dense canopy in shade).",
    infoHigh: "Brighter areas (exposed soil, bare ground, clouds).",
    infoImportant: "No agronomic index is being measured — this is a visual reference only.",
  },
  {
    id: "NDVI", label: "NDVI — General Vine Vigour", short: "NDVI", nativeResM: 10, resamplingNote: false,
    description: "Overall canopy vigour. Uses native 10 m red (B04) and near-infrared (B08) data.",
    legend: ["#8b3a2b", "#c98a3f", "#e6d36a", "#7ec26b", "#1e6b2e"],
    legendLow: "Water, bare soil or very little green vegetation",
    legendHigh: "Very strong green vegetation signal",
    displayMin: -0.2, displayMax: 0.9,
    legendNote: "Higher values usually indicate more green vegetation in the satellite cell.",
    interpretationDirection: "higher_usually_more_vegetation",
    infoWhat: "NDVI compares near-infrared and red reflectance to highlight green vegetation.",
    infoLow: "Usually indicate water, shadow, exposed soil or very little green vegetation.",
    infoHigh: "Usually indicate a strong or dense green vegetation signal.",
    infoImportant: "A high value is not automatically better. Compare nearby cells, earlier imagery and field observations.",
  },
  {
    id: "EVI", label: "EVI — Dense Canopy Vigour", short: "EVI", nativeResM: 10, resamplingNote: false,
    description: "Shows canopy vigour while reducing some soil and atmospheric influence. It can remain useful where dense vegetation causes NDVI values to level out. Bands: 10 m blue (B02), red (B04), NIR (B08).",
    legend: ["#8b3a2b", "#c98a3f", "#e6d36a", "#7ec26b", "#1e6b2e"],
    legendLow: "Very little active canopy",
    legendHigh: "Strong dense-canopy signal",
    displayMin: -0.2, displayMax: 1.0,
    legendNote: "Higher values usually indicate stronger or denser active vegetation.",
    interpretationDirection: "higher_usually_more_vegetation",
    infoWhat: "EVI improves on NDVI in dense canopies by reducing soil and atmospheric influence.",
    infoLow: "Usually indicate little active vegetation or a non-vegetated surface.",
    infoHigh: "Usually indicate a strong dense-canopy signal.",
    infoImportant: "A high value is not automatically better. Compare with nearby cells and field observations.",
  },
  {
    id: "GNDVI", label: "GNDVI — Chlorophyll & Nitrogen Signal", short: "GNDVI", nativeResM: 10, resamplingNote: false,
    description: "Highlights relative differences in green-canopy chlorophyll. It may help identify areas requiring inspection for canopy or nutritional variation. Bands: 10 m green (B03), NIR (B08).",
    legend: ["#8b3a2b", "#c98a3f", "#e6d36a", "#7ec26b", "#1e6b2e"],
    legendLow: "Very weak green-canopy chlorophyll signal",
    legendHigh: "Strong green-canopy chlorophyll signal",
    displayMin: -0.2, displayMax: 0.9,
    legendNote: "Higher values usually indicate a stronger green-canopy chlorophyll response, but do not directly prove nitrogen status.",
    interpretationDirection: "higher_usually_more_chlorophyll_signal",
    infoWhat: "GNDVI uses green and near-infrared reflectance and is sensitive to canopy chlorophyll.",
    infoLow: "Usually indicate little or no green-canopy chlorophyll response.",
    infoHigh: "Usually indicate a strong green-canopy chlorophyll response.",
    infoImportant: "A higher signal does not by itself prove nitrogen sufficiency — confirm with tissue tests and field checks.",
  },
  {
    id: "MSAVI", label: "MSAVI — Vigour with Soil Adjustment", short: "MSAVI", nativeResM: 10, resamplingNote: false,
    description: "Reduces soil influence for sparse canopies. Uses native 10 m red (B04) and NIR (B08).",
    legend: ["#7a4a2b", "#b98a55", "#e0cc99", "#a3c977", "#2f6b2e"],
    legendLow: "Bare soil or very sparse vegetation",
    legendHigh: "Strong vegetation signal",
    displayMin: -0.2, displayMax: 0.9,
    legendNote: "Higher values usually indicate more vegetation after reducing some exposed-soil influence.",
    interpretationDirection: "higher_usually_more_vegetation",
    infoWhat: "MSAVI adjusts NDVI-like vigour to reduce the effect of exposed soil in sparse canopies.",
    infoLow: "Usually indicate bare soil or very sparse vegetation.",
    infoHigh: "Usually indicate a strong vegetation signal.",
    infoImportant: "A high value is not automatically better. Use with field observations.",
  },
  {
    id: "NDRE", label: "NDRE — Canopy Chlorophyll", short: "NDRE", nativeResM: 20, resamplingNote: true,
    description: "Canopy chlorophyll differences, useful in denser canopies. Uses 20 m native red-edge (B05) and 10 m NIR (B08); result is on a 10 m display grid.",
    legend: ["#4a2c6a", "#7f5aa8", "#c4a8d6", "#8fd18f", "#1e6b2e"],
    legendLow: "Very weak red-edge chlorophyll signal",
    legendHigh: "Strong red-edge chlorophyll signal",
    displayMin: -0.2, displayMax: 0.8,
    legendNote: "Higher values usually indicate a stronger chlorophyll response in established canopy.",
    interpretationDirection: "higher_usually_more_chlorophyll_signal",
    infoWhat: "NDRE uses red-edge and near-infrared reflectance to highlight canopy chlorophyll variation.",
    infoLow: "Usually indicate little or no red-edge canopy response.",
    infoHigh: "Usually indicate a strong red-edge chlorophyll response.",
    infoImportant: "Most useful once canopies are established. A high value is not automatically better.",
  },
  {
    id: "RECI", label: "RECI — Chlorophyll Activity", short: "RECI", nativeResM: 20, resamplingNote: true,
    description: "Relative differences in leaf chlorophyll. Uses 20 m native red-edge (B05) and 10 m NIR (B08); result is on a 10 m display grid.",
    legend: ["#4b2e2e", "#a06b3f", "#e4c26a", "#7fbf6a", "#1e5b2e"],
    legendLow: "Low chlorophyll response",
    legendHigh: "Very strong chlorophyll response",
    displayMin: 0, displayMax: 5,
    legendNote: "Higher values indicate a stronger red-edge chlorophyll signal. This index is not limited to 1.0.",
    interpretationDirection: "higher_usually_more_chlorophyll_signal",
    useRelativeBands: true,
    infoWhat: "RECI is a red-edge chlorophyll ratio index — it has no fixed upper bound of 1.0.",
    infoLow: "Low relative chlorophyll response for this scene.",
    infoHigh: "Very strong relative chlorophyll response for this scene.",
    infoImportant: "This index has no universal maximum of 1.0. Interpret cells relative to the paddock distribution and prior images.",
  },
  {
    id: "GCI", label: "GCI — Green Chlorophyll Index", short: "GCI", nativeResM: 10, resamplingNote: false,
    description: "Highlights relative canopy chlorophyll activity using green and near-infrared reflectance. Bands: 10 m green (B03), NIR (B08).",
    legend: ["#4b2e2e", "#a06b3f", "#e4c26a", "#7fbf6a", "#1e5b2e"],
    legendLow: "Low green chlorophyll response",
    legendHigh: "Very strong green chlorophyll response",
    displayMin: 0, displayMax: 8,
    legendNote: "Higher values indicate a stronger chlorophyll signal. This index is not limited to 1.0.",
    interpretationDirection: "higher_usually_more_chlorophyll_signal",
    useRelativeBands: true,
    infoWhat: "GCI is a green-band chlorophyll ratio — like RECI it has no fixed upper bound.",
    infoLow: "Low relative green-chlorophyll response for this scene.",
    infoHigh: "Very strong relative green-chlorophyll response for this scene.",
    infoImportant: "This index has no universal maximum of 1.0. Interpret cells relative to the paddock distribution.",
  },
  {
    id: "RENDVI", label: "RENDVI — Red-Edge Vine Vigour", short: "RENDVI", nativeResM: 20, resamplingNote: true,
    description: "Measures canopy variation using narrow near-infrared and red-edge data. It may be useful for established canopies and later growth stages. Bands: 20 m red-edge (B05), 20 m narrow NIR (B8A); result shown on 10 m display grid.",
    legend: ["#4a2c6a", "#7f5aa8", "#c4a8d6", "#8fd18f", "#1e6b2e"],
    legendLow: "Little or no red-edge canopy signal",
    legendHigh: "Strong red-edge canopy signal",
    displayMin: -0.2, displayMax: 0.8,
    legendNote: "Higher values usually indicate stronger established-canopy or chlorophyll response.",
    interpretationDirection: "higher_usually_more_chlorophyll_signal",
    infoWhat: "RENDVI measures the contrast between red-edge and narrow near-infrared reflectance.",
    infoLow: "Usually indicate little canopy, exposed soil or a weaker red-edge response.",
    infoHigh: "Usually indicate a stronger established-canopy and chlorophyll response.",
    infoImportant: "A high value is not automatically better. Compare nearby cells, earlier imagery and field observations.",
  },
  {
    id: "NDMI", label: "NDMI — Canopy Moisture", short: "NDMI", nativeResM: 20, resamplingNote: true,
    description: "Relative canopy-moisture variation. Uses 10 m NIR (B08) and 20 m native SWIR (B11); result is on a 10 m display grid.",
    legend: ["#7a3b1e", "#c98a4f", "#e6dcb0", "#7fb7d1", "#1e4f7a"],
    legendLow: "Low vegetation-moisture signal",
    legendHigh: "Strong vegetation-moisture signal",
    displayMin: -0.5, displayMax: 0.7,
    legendNote: "Higher values generally indicate a stronger canopy-moisture response, but do not by themselves confirm irrigation status or water stress.",
    interpretationDirection: "higher_usually_more_moisture_signal",
    infoWhat: "NDMI compares near-infrared and short-wave infrared reflectance and is sensitive to canopy moisture.",
    infoLow: "Usually indicate a low vegetation-moisture signal (may also occur on non-vegetated surfaces).",
    infoHigh: "Usually indicate a strong vegetation-moisture signal.",
    infoImportant: "Do not interpret cells as dry, irrigated or water-stressed without field confirmation.",
  },
  {
    id: "PSRI", label: "PSRI — Leaf Ageing & Senescence", short: "PSRI", nativeResM: 20, resamplingNote: true,
    description: "Highlights relative pigment changes associated with leaf ageing and senescence. It is most useful when comparing similar growth stages and dates. Bands: 10 m blue (B02), red (B04), 20 m red-edge (B06); result shown on 10 m display grid.",
    legend: ["#1e6b2e", "#7ec26b", "#e6d36a", "#c98a3f", "#8b3a2b"],
    legendLow: "Low senescence or pigment-change signal",
    legendHigh: "Stronger senescence or pigment-change signal",
    displayMin: -0.2, displayMax: 0.5,
    legendNote: "Higher values may indicate greater leaf ageing or pigment change. For this layer, higher is not necessarily better.",
    interpretationDirection: "higher_usually_more_senescence",
    useRelativeBands: true,
    infoWhat: "PSRI highlights pigment changes associated with leaf ageing and senescence.",
    infoLow: "Usually indicate little pigment change or ageing signal.",
    infoHigh: "Usually indicate a stronger pigment-change or senescence signal — not necessarily healthier vines.",
    infoImportant: "A higher value generally means a stronger ageing or pigment-change signal, not necessarily healthier vines.",
    extraCaution: "Compare similar growth stages because natural seasonal ageing changes this index.",
  },
];

// Grouped presentation for the Map Layer selector.
const LAYER_GROUPS: Array<{ label: string; ids: SatelliteIndexType[] }> = [
  { label: "Satellite Image", ids: ["TRUE_COLOUR"] },
  { label: "Canopy & Vigour", ids: ["NDVI", "EVI", "GNDVI", "MSAVI"] },
  { label: "Chlorophyll & Red Edge", ids: ["NDRE", "RECI", "GCI", "RENDVI"] },
  { label: "Moisture & Seasonal Change", ids: ["NDMI", "PSRI"] },
];

const PSRI_CAUTION =
  "Seasonal leaf ageing naturally changes this index. Compare similar growth stages before treating a difference as unusual.";

const LAYER_DISCLAIMER =
  "Satellite indices indicate relative variation and do not by themselves diagnose disease, water stress, nutrient deficiency or vine health. Each 10 m or 20 m cell may include vines, inter-row vegetation, exposed soil and shadow together.";

// ---------- Plain-English general interpretation bands ----------
// Returned band text is deliberately descriptive, not evaluative. Layers with
// `useRelativeBands` (RECI, GCI, PSRI) return null here — their tooltips lean
// on the paddock-relative wording instead.
function generalBand(index: SatelliteIndexType, v: number): string | null {
  switch (index) {
    case "NDVI":
      if (v < 0.15) return "Very sparse green vegetation signal";
      if (v < 0.30) return "Sparse green vegetation signal";
      if (v < 0.50) return "Moderate vegetation signal";
      if (v < 0.70) return "Strong green vegetation signal";
      return "Very strong green vegetation signal";
    case "EVI":
      if (v < 0.20) return "Very weak dense-canopy signal";
      if (v < 0.40) return "Weak dense-canopy signal";
      if (v < 0.60) return "Moderate dense-canopy vigour";
      if (v < 0.80) return "Strong dense-canopy vigour";
      return "Very strong dense-canopy signal";
    case "GNDVI":
      if (v < 0.20) return "Very weak green-canopy chlorophyll signal";
      if (v < 0.40) return "Weak green-canopy chlorophyll signal";
      if (v < 0.60) return "Moderate green-canopy chlorophyll signal";
      if (v < 0.80) return "Strong green-canopy chlorophyll signal";
      return "Very strong green-canopy chlorophyll signal";
    case "MSAVI":
      if (v < 0.15) return "Very sparse vegetation after soil adjustment";
      if (v < 0.30) return "Sparse vegetation after soil adjustment";
      if (v < 0.50) return "Moderate soil-adjusted vegetation signal";
      if (v < 0.70) return "Strong soil-adjusted vegetation signal";
      return "Very strong soil-adjusted vegetation signal";
    case "NDRE":
      if (v < 0.10) return "Very weak red-edge chlorophyll signal";
      if (v < 0.20) return "Weak red-edge chlorophyll signal";
      if (v < 0.35) return "Moderate red-edge chlorophyll signal";
      if (v < 0.50) return "Strong red-edge chlorophyll signal";
      return "Very strong red-edge chlorophyll signal";
    case "RENDVI":
      if (v < 0.10) return "Very weak red-edge canopy signal";
      if (v < 0.20) return "Weak red-edge canopy signal";
      if (v < 0.35) return "Moderate red-edge canopy signal";
      if (v < 0.50) return "Strong red-edge canopy signal";
      return "Very strong red-edge canopy signal";
    case "NDMI":
      if (v < 0.00) return "Very low canopy-moisture signal";
      if (v < 0.15) return "Low canopy-moisture signal";
      if (v < 0.30) return "Moderate canopy-moisture signal";
      if (v < 0.45) return "Strong canopy-moisture signal";
      return "Very strong canopy-moisture signal";
    case "PSRI":
      if (v < 0.00) return "Very low senescence or pigment-change signal";
      if (v < 0.10) return "Low senescence or pigment-change signal";
      if (v < 0.20) return "Moderate senescence or pigment-change signal";
      if (v < 0.30) return "Strong senescence or pigment-change signal";
      return "Very strong senescence or pigment-change signal";
    default:
      return null;
  }
}

// Paddock-relative 5-band wording for indices without a universal scale (RECI, GCI).
function relativeMeaning(
  index: SatelliteIndexType,
  value: number,
  s: { percentile_10: number | null; percentile_25: number | null; percentile_75: number | null; percentile_90: number | null } | undefined,
): string | null {
  if (index !== "RECI" && index !== "GCI") return null;
  const noun = index === "RECI" ? "chlorophyll activity" : "green chlorophyll activity";
  if (!s || s.percentile_10 == null || s.percentile_25 == null || s.percentile_75 == null || s.percentile_90 == null) {
    return `Typical ${noun} for this paddock`;
  }
  if (value <= s.percentile_10) return `Very low ${noun} for this paddock`;
  if (value <= s.percentile_25) return `Low ${noun} for this paddock`;
  if (value <= s.percentile_75) return `Typical ${noun} for this paddock`;
  if (value <= s.percentile_90) return `High ${noun} for this paddock`;
  return `Very high ${noun} for this paddock`;
}

// Paddock-relative band + approximate percentile using stored quartile anchors.
type RelativeInterp = { band: string; approxPct: number | null };
function relativeInterpretation(
  value: number,
  s: { percentile_10: number | null; percentile_25: number | null; percentile_75: number | null; percentile_90: number | null } | undefined,
): RelativeInterp | null {
  if (!s || s.percentile_10 == null || s.percentile_25 == null || s.percentile_75 == null || s.percentile_90 == null) return null;
  const { percentile_10: p10, percentile_25: p25, percentile_75: p75, percentile_90: p90 } = s;
  const lerp = (v: number, x0: number, x1: number, y0: number, y1: number) =>
    x1 === x0 ? y0 : y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
  if (value <= p10) return { band: "Among the lowest 10% of this paddock", approxPct: null };
  if (value <= p25) return { band: "Lower than most of this paddock", approxPct: Math.round(lerp(value, p10, p25, 10, 25)) };
  if (value <= p75) return { band: "Typical for this paddock", approxPct: Math.round(lerp(value, p25, p75, 25, 75)) };
  if (value <= p90) return { band: "Higher than most of this paddock", approxPct: Math.round(lerp(value, p75, p90, 75, 90)) };
  return { band: "Among the highest 10% of this paddock", approxPct: null };
}

// ---------- Paddock type ----------
interface Paddock {
  id: string;
  name: string | null;
  polygon_points: any;
  vineyard_id: string;
}

// ---------- Portal-side types from list-scenes ----------
interface DBScene {
  id: string;
  paddock_id: string;
  vineyard_id: string;
  provider_scene_id: string;
  acquired_at: string;
  scene_cloud_cover_pct: number | null;
  paddock_valid_coverage_pct: number | null;
  paddock_cloud_cover_pct: number | null;
  quality_status: string;
  processing_status: string;
}
interface DBAsset {
  id: string;
  satellite_scene_id: string;
  index_type: SatelliteIndexType;
  asset_type?: "DISPLAY_RASTER" | "ANALYTICAL_RASTER" | string | null;
  storage_path: string;
  bounds: { north: number; south: number; east: number; west: number } | null;
  raster_width?: number | null;
  raster_height?: number | null;
  native_resolution_m: number | null;
  display_resolution_m: number | null;
  data_type?: string | null;
  scale_factor?: number | null;
  no_data_sentinel?: number | null;
  row_orientation?: string | null;
  processing_version?: string | null;
  acquisition_date?: string | null;
}
interface DBSummary {
  satellite_scene_id: string;
  index_type: SatelliteIndexType;
  mean_value: number | null;
  median_value: number | null;
  percentile_10: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  percentile_90: number | null;
}

type SatelliteSearchError = {
  code: string | null;
  providerStatus: number | null;
  paddockId: string | null;
  paddockName: string | null;
  message: string;
};

type DecodedAnalyticalRaster = {
  key: string;
  assetId: string;
  data: ArrayLike<number>;
  width: number;
  height: number;
  bounds: { north: number; south: number; east: number; west: number };
  noData: number | null;
  scale: number;
  rowOrientation: string;
  processingVersion: string;
};

type AssetPipelineDiagnostic = {
  assetId: string;
  paddockId: string | null;
  layer: SatelliteIndexType | string | null;
  endpointStatus: number | null;
  blobSize: number | null;
  mimeType: string | null;
  etag: string | null;
  objectUrlCreated: boolean;
  imageStatus: "not_checked" | "loaded" | "error";
  bounds: string;
  finalStatus: "pending" | "cached" | "loaded" | "failed";
  error: string | null;
};

type ProcessingFailureDiagnostic = {
  paddockId: string;
  paddockName: string | null;
  httpStatus: number | null;
  code: string | null;
  status: string | null;
  failedStage: string | null;
  failedLayer: string | null;
  providerStatus: number | null;
  message: string;
  failedLayers?: Array<{ index?: string; code?: string; message?: string }>;
};

const assetKind = (a: DBAsset) => a.asset_type ?? (a.storage_path.endsWith(".png") ? "DISPLAY_RASTER" : "ANALYTICAL_RASTER");
const analyticalCacheKey = (paddockId: string, sceneId: string, indexType: SatelliteIndexType, processingVersion: string | null | undefined) =>
  `${paddockId}:${sceneId}:${indexType}:${processingVersion ?? "unknown"}`;

function parseSatelliteFunctionError(error: any): { code: string | null; providerStatus: number | null; message: string; httpStatus: number | null; status: string | null; failedLayer: string | null; failedStage: string | null; failedLayers?: Array<{ index?: string; code?: string; message?: string }> } {
  const fallback = String(error?.message ?? error ?? "Unknown error");
  const raw = error?.details ?? error?.context ?? fallback;
  if (typeof raw === "object" && raw) {
    if (raw instanceof Response) return { code: null, providerStatus: raw.status, httpStatus: raw.status, status: null, failedLayer: null, failedStage: null, message: fallback };
    return {
      code: raw.code ?? null,
      providerStatus: raw.provider_status ?? null,
      httpStatus: raw.statusCode ?? raw.httpStatus ?? null,
      status: raw.status ?? null,
      failedLayer: raw.failed_layer ?? raw.layer ?? null,
      failedStage: raw.failed_stage ?? raw.stage ?? null,
      failedLayers: Array.isArray(raw.failed_layers) ? raw.failed_layers : undefined,
      message: raw.error ?? raw.message ?? fallback,
    };
  }
  const text = String(raw);
  const match = text.match(/\{.*\}$/s);
  if (!match) return { code: null, providerStatus: null, httpStatus: null, status: null, failedLayer: null, failedStage: null, message: fallback };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      code: parsed.code ?? null,
      providerStatus: parsed.provider_status ?? null,
      httpStatus: parsed.statusCode ?? parsed.httpStatus ?? null,
      status: parsed.status ?? null,
      failedLayer: parsed.failed_layer ?? parsed.layer ?? null,
      failedStage: parsed.failed_stage ?? parsed.stage ?? null,
      failedLayers: Array.isArray(parsed.failed_layers) ? parsed.failed_layers : undefined,
      message: parsed.error ?? parsed.message ?? fallback,
    };
  } catch {
    return { code: null, providerStatus: null, httpStatus: null, status: null, failedLayer: null, failedStage: null, message: fallback };
  }
}

// ---------- Map helpers ----------

// Parse polygon_points → array of polygons, each an array of rings (outer + holes).
function parseGeometry(raw: any): LatLng[][][] {
  if (!raw) return [];
  let val: any = raw;
  if (typeof raw === "string") { try { val = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(val) || val.length === 0) return [];
  const first = val[0];
  const isPoint = (p: any) => p && (typeof p.lat === "number" || typeof p.latitude === "number");
  // Case A: flat point array → single Polygon, single ring
  if (isPoint(first) || (Array.isArray(first) && typeof first[0] === "number")) {
    const ring = parsePolygonPoints(val);
    return ring.length >= 3 ? [[ring]] : [];
  }
  // Case B: array of rings (points inside first[])
  if (Array.isArray(first) && isPoint(first[0])) {
    const rings = (val as any[]).map((r) => parsePolygonPoints(r)).filter((r) => r.length >= 3);
    return rings.length ? [rings] : [];
  }
  // Case C: array of polygons (MultiPolygon)
  if (Array.isArray(first) && Array.isArray(first[0])) {
    const polys: LatLng[][][] = [];
    for (const poly of val as any[]) {
      const rings = (poly as any[]).map((r: any) => parsePolygonPoints(r)).filter((r: any) => r.length >= 3);
      if (rings.length) polys.push(rings);
    }
    return polys;
  }
  return [];
}

// (Legacy `computeStalePaddockIds` removed — availability is decided by the
// unified Crop Health view model.)

// Module-level so it survives page unmount/remount within the tab session.
// Records the last time we auto-triggered a refresh for a given vineyard.
const autoRunTimestamps = new Map<string, number>();
const AUTO_RUN_COOLDOWN_MS = 10 * 60_000;

// ---------- Page ----------
export default function SatelliteMappingPage() {
  const { isAdmin: isSystemAdmin, loading: adminLoading } = useIsSystemAdmin();
  const { selectedVineyardId, memberships } = useVineyard();
  const qc = useQueryClient();

  const [vineyardId, setVineyardId] = useState<string | null>(selectedVineyardId);
  const activeVineyardId = vineyardId ?? selectedVineyardId;

  const [paddockId, setPaddockId] = useState<string>("all");
  const [layer, setLayer] = useState<SatelliteIndexType>("NDVI");
  const [opacity, setOpacity] = useState<number>(70);
  const [legendOpen, setLegendOpen] = useState<boolean>(false);
  const [selectedSceneKey, setSelectedSceneKey] = useState<string | null>(null); // COMMITTED date (YYYY-MM-DD)
  const [previewDate, setPreviewDate] = useState<string | null>(null); // transient preview (null = same as committed)
  const [interacting, setInteracting] = useState(false); // slider drag / key in progress
  const [isPlaying, setIsPlaying] = useState(false); // timeline playback
  const [disableCropOverlays, setDisableCropOverlays] = useState(false);
  const [mapDiagnostics, setMapDiagnostics] = useState<SatelliteMapDiagnostics | null>(null);
  const [assetDiagnostics, setAssetDiagnostics] = useState<Record<string, AssetPipelineDiagnostic>>({});
  const [processingFailures, setProcessingFailures] = useState<ProcessingFailureDiagnostic[]>([]);
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({}); // asset_id -> object URL (blob:) or signed URL fallback
  const [searchError, setSearchError] = useState<SatelliteSearchError | null>(null);
  const [rasterCacheVersion, setRasterCacheVersion] = useState(0);
  const analyticalCacheRef = useRef(new Map<string, DecodedAnalyticalRaster | Promise<DecodedAnalyticalRaster> | { error: string }>());
  // Blob cache (in-memory mirror of IndexedDB) so the analytical decoder can
  // reuse bytes already downloaded for the display raster path.
  const assetBlobsRef = useRef(new Map<string, Blob>()); // key = `${assetId}:${processingVersion}`
  const objectUrlsRef = useRef(new Map<string, string>()); // asset_id -> blob: URL
  // Diagnostics: cache hit/miss counters for the crop-health browser cache.
  const cacheStatsRef = useRef({
    displayRequested: 0, displayHits: 0, displayMisses: 0,
    analyticalRequested: 0, analyticalHits: 0, analyticalMisses: 0,
    decodedHits: 0, decodedMisses: 0,
    assetRequests: 0, http304: 0, bytesDownloaded: 0,
  });
  const [, forceStatsRerender] = useState(0);
  const bumpStats = () => forceStatsRerender((v) => v + 1);

  // Hover readout — real value sampled locally from the matched analytical raster.
  const [hover, setHover] = useState<
    | null
    | {
        lat: number;
        lng: number;
        x: number;
        y: number;
        paddockId: string | null;
        paddockName: string | null;
        acquiredAt: string | null;
        status: "idle" | "loading" | "ready" | "no_data" | "error" | "missing_analytical";
        value: number | null;
        message: string | null;
        cellResM: number | null;
        cellRect: { north: number; south: number; east: number; west: number } | null;
        estRow: number | null;
      }
  >(null);

  // Batch progress for Refresh Imagery. Rich per-paddock stage tracking that
  // drives the persistent progress panel over the map (Step 2 of the crop
  // health refresh polish). Old `batchProgress` shape has been replaced.
  type PadStage =
    | "waiting"
    | "searching"
    | "found"
    | "downloading"
    | "processing"
    | "saving"
    | "manifest"
    | "loading_overlay"
    | "complete"
    | "no_imagery"
    | "failed"
    | "skipped";
  type PadOutcome =
    | "updated"
    | "reprocessed"
    | "already_current"
    | "no_newer"
    | "failed"
    | "skipped";
  type PadErrorKind =
    | "provider_unavailable"
    | "no_newer_capture"
    | "processing_failed"
    | "asset_failed"
    | "overlay_failed"
    | null;
  type PadProgress = {
    id: string;
    name: string;
    stage: PadStage;
    errorKind: PadErrorKind;
    errorMessage?: string | null;
    oldSceneId?: string | null;
    oldProcessingVersion?: string | null;
    oldAssetId?: string | null;
    newSceneId?: string | null;
    newProcessingVersion?: string | null;
    newAssetId?: string | null;
    outcome?: PadOutcome;
    cacheInvalidated?: boolean;
    overlayRemounted?: boolean;
    overlayMountedAt?: string | null;
    processingHttpStatus?: number | null;
    processingCode?: string | null;
    processingStatus?: string | null;
    failedStage?: string | null;
    failedLayer?: string | null;
    providerStatus?: number | null;
    failedLayers?: Array<{ index?: string; code?: string; message?: string }>;
  };
  type RefreshSummary = {
    updated: number;
    reprocessed: number;
    alreadyCurrent: number;
    noNewer: number;
    failed: number;
    displayed: number;
    expected: number;
  };
  const [refreshProgress, setRefreshProgress] = useState<{
    running: boolean;
    total: number;
    order: string[];
    paddocks: Record<string, PadProgress>;
    summary?: RefreshSummary;
  } | null>(null);
  // Legacy alias so downstream code that expects a rollup keeps compiling.
  type PadStatus = "queued" | "searching" | "processing" | "complete" | "insufficient_coverage" | "rate_limited" | "failed" | "skipped";

  // Summary of the most recent Refresh Imagery pass. Populated by the mutation
  // and shown in the admin diagnostics panel.
  const [lastRefreshSummary, setLastRefreshSummary] = useState<{
    at: string;
    processedPaddocks: number;
    repairedItems: number;
    skippedPaddocks: number;
    providerCallsAvoided: number;
  } | null>(null);

  // Paddocks list
  const { data: paddocks = [], isLoading: paddocksLoading } = useQuery({
    queryKey: ["satellite-paddocks", activeVineyardId],
    enabled: !!activeVineyardId && isSystemAdmin,
    queryFn: () => fetchList<Paddock>("paddocks", activeVineyardId!),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Server manifest — source of truth for per-paddock completeness, the
  // date-coverage index AND per-scene asset metadata (v3). The previous
  // `satellite-list-scenes` query has been retired; every scene/asset/summary
  // the page renders now flows from `manifestQuery.data.date_coverage[*].paddocks[*].layers`.
  const activePaddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);
  const manifestQuery = useQuery({
    queryKey: ["satellite-manifest", activeVineyardId, activePaddockIds.join(",")],
    queryFn: () => fetchManifest(activeVineyardId!, activePaddockIds),
    enabled: !!activeVineyardId,
    staleTime: 30_000,
  });

  // ---- Derived scenes / assets / summaries ------------------------------
  // A thin compat shim so existing code (report generator, hover sampler,
  // signed-URL loader, etc.) keeps working with the shape it already
  // understands. Nothing here talks to the network.
  const derivedFromManifest = useMemo(() => {
    const scenes: DBScene[] = [];
    const assets: DBAsset[] = [];
    const summaries: DBSummary[] = [];
    const seenScenes = new Set<string>();
    const seenAssets = new Set<string>();
    for (const entry of manifestQuery.data?.date_coverage ?? []) {
      for (const p of entry.paddocks) {
        if (!seenScenes.has(p.scene_id)) {
          seenScenes.add(p.scene_id);
          scenes.push({
            id: p.scene_id,
            paddock_id: p.paddock_id,
            vineyard_id: activeVineyardId ?? "",
            provider_scene_id: p.provider_scene_id ?? "",
            acquired_at: p.acquired_at,
            scene_cloud_cover_pct: p.scene_cloud_cover_pct,
            paddock_valid_coverage_pct: p.paddock_valid_coverage_pct,
            paddock_cloud_cover_pct: p.paddock_cloud_cover_pct,
            quality_status: "",
            processing_status: "complete",
          });
        }
        for (const layer of p.layers) {
          if (layer.display && !seenAssets.has(layer.display.asset_id)) {
            seenAssets.add(layer.display.asset_id);
            assets.push({
              id: layer.display.asset_id,
              satellite_scene_id: p.scene_id,
              index_type: layer.index_type as SatelliteIndexType,
              asset_type: "DISPLAY_RASTER",
              storage_path: layer.display.storage_path ?? "",
              bounds: layer.display.bounds,
              raster_width: layer.display.raster_width,
              raster_height: layer.display.raster_height,
              native_resolution_m: layer.display.native_resolution_m,
              display_resolution_m: layer.display.display_resolution_m,
              data_type: layer.display.data_type,
              scale_factor: layer.display.scale_factor,
              no_data_sentinel: layer.display.no_data_sentinel,
              row_orientation: layer.display.row_orientation,
              processing_version: layer.display.processing_version,
            });
          }
          if (layer.analytical && !seenAssets.has(layer.analytical.asset_id)) {
            seenAssets.add(layer.analytical.asset_id);
            assets.push({
              id: layer.analytical.asset_id,
              satellite_scene_id: p.scene_id,
              index_type: layer.index_type as SatelliteIndexType,
              asset_type: "ANALYTICAL_RASTER",
              storage_path: layer.analytical.storage_path ?? "",
              bounds: layer.analytical.bounds,
              raster_width: layer.analytical.raster_width,
              raster_height: layer.analytical.raster_height,
              native_resolution_m: layer.analytical.native_resolution_m,
              display_resolution_m: layer.analytical.display_resolution_m,
              data_type: layer.analytical.data_type,
              scale_factor: layer.analytical.scale_factor,
              no_data_sentinel: layer.analytical.no_data_sentinel,
              row_orientation: layer.analytical.row_orientation,
              processing_version: layer.analytical.processing_version,
            });
          }
          if (layer.summary) {
            summaries.push({
              satellite_scene_id: p.scene_id,
              index_type: layer.index_type as SatelliteIndexType,
              mean_value: layer.summary.mean_value,
              median_value: layer.summary.median_value,
              percentile_10: layer.summary.percentile_10,
              percentile_25: layer.summary.percentile_25,
              percentile_75: layer.summary.percentile_75,
              percentile_90: layer.summary.percentile_90,
            });
          }
        }
      }
    }
    return { scenes, assets, summaries };
  }, [manifestQuery.data, activeVineyardId]);

  // (Legacy `scenesQuery` shim removed — every consumer reads `derivedFromManifest`
  // and the unified `viewModel` below directly. Manifest v3 is the sole source.)


  const activeLayer = LAYERS.find((l) => l.id === layer)!;

  // Parsed paddock geometry
  const geoms = useMemo(() => {
    return paddocks.map((p) => ({
      id: p.id,
      name: p.name ?? "Unnamed paddock",
      polys: parseGeometry(p.polygon_points),
    })).filter((g) => g.polys.length > 0);
  }, [paddocks]);

  // Parsed rows per paddock (for estimated row number in hover popup).
  const rowsByPaddock = useMemo(() => {
    const map = new Map<string, PaddockRow[]>();
    for (const p of paddocks) {
      const rs = parseRows((p as any).rows);
      if (rs.length > 0) map.set(p.id, rs);
    }
    return map;
  }, [paddocks]);

  const visibleGeoms = useMemo(() => {
    if (paddockId === "all") return geoms;
    return geoms.filter((g) => g.id === paddockId);
  }, [geoms, paddockId]);

  // Bounds no longer needed — SatelliteMap fits the visible paddocks itself.

  // ---- Date-coverage index ----------------------------------------------
  // Group all completed scenes by acquisition day (YYYY-MM-DD) and, for each
  // (date, paddock), keep the SINGLE best scene using:
  //   1. highest paddock_valid_coverage_pct
  //   2. lowest paddock_cloud_cover_pct
  //   3. latest acquired_at
  // This is the client-side date-coverage index the page renders from — no
  // mixing dates, no per-millisecond timestamp fragility.
  const dateCoverage = useMemo(() => {
    // Prefer the server-side date-coverage index.
    const serverIndex = manifestQuery.data?.date_coverage;
    if (serverIndex && serverIndex.length > 0) {
      return serverIndex.map((entry) => {
        const sceneByPaddock = new Map<string, DBScene>();
        for (const p of entry.paddocks) {
          sceneByPaddock.set(p.paddock_id, {
            id: p.scene_id,
            paddock_id: p.paddock_id,
            vineyard_id: activeVineyardId ?? "",
            provider_scene_id: p.provider_scene_id ?? "",
            acquired_at: p.acquired_at,
            scene_cloud_cover_pct: null,
            paddock_valid_coverage_pct: p.paddock_valid_coverage_pct,
            paddock_cloud_cover_pct: p.paddock_cloud_cover_pct,
            quality_status: "",
            processing_status: "complete",
          } as DBScene);
        }
        return {
          date: entry.acquisition_date,
          sceneByPaddock,
          paddockCount: entry.available_paddock_count,
          activeCount: entry.active_paddock_count,
          coveragePercent: entry.coverage_percent,
          missing: entry.missing_paddocks,
          layerCoverage: entry.layer_coverage ?? {},
        };
      });

    }
    // Fallback: client-side reconstruction from scenesQuery.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[SatelliteMappingPage] Falling back to client-side date coverage; server date_coverage not present.");
    }
    const scenes = derivedFromManifest?.scenes ?? [];
    const grouped = new Map<string, Map<string, DBScene>>();
    const better = (a: DBScene, b: DBScene): DBScene => {
      const cov = (b.paddock_valid_coverage_pct ?? -1) - (a.paddock_valid_coverage_pct ?? -1);
      if (cov > 0) return b; if (cov < 0) return a;
      const cl = (a.paddock_cloud_cover_pct ?? 101) - (b.paddock_cloud_cover_pct ?? 101);
      if (cl > 0) return b; if (cl < 0) return a;
      return b.acquired_at > a.acquired_at ? b : a;
    };
    for (const s of scenes) {
      if (s.processing_status !== "complete") continue;
      const date = s.acquired_at.slice(0, 10);
      let per = grouped.get(date);
      if (!per) { per = new Map(); grouped.set(date, per); }
      const cur = per.get(s.paddock_id);
      per.set(s.paddock_id, cur ? better(cur, s) : s);
    }
    const total = geoms.length || 1;
    return Array.from(grouped.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, sceneByPaddock]) => ({
        date,
        sceneByPaddock,
        paddockCount: sceneByPaddock.size,
        activeCount: geoms.length,
        coveragePercent: Math.round((sceneByPaddock.size / total) * 1000) / 10,
        missing: [] as { paddock_id: string; reason: "no_scene_for_date" | "scene_not_complete" | "package_version_mismatch" }[],
        layerCoverage: {} as Partial<Record<string, { available: number; total: number; percent: number; available_paddock_ids: string[]; missing_paddock_ids: string[] }>>,
      }));
  }, [manifestQuery.data, derivedFromManifest, activeVineyardId, geoms]);


  const isAllPaddocks = paddockId === "all";
  const totalPaddocks = geoms.length;

  // Human-readable label: "7 Jul 2026".
  const formatDate = (iso: string): string => {
    try {
      return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
      });
    } catch { return iso; }
  };

  const dateOptions = useMemo(() => dateCoverage.map((g) => {
    const lc = g.layerCoverage?.[layer];
    const paddockCount = lc ? lc.available : g.paddockCount;
    const activeCount = lc ? lc.total : g.activeCount;
    const coveragePercent = lc ? lc.percent
      : (typeof g.coveragePercent === "number" && Number.isFinite(g.coveragePercent) ? g.coveragePercent : 0);
    const pctLabel = Number.isInteger(coveragePercent) ? `${coveragePercent}` : coveragePercent.toFixed(1);
    return {
      date: g.date,
      scenes: Array.from(g.sceneByPaddock.values()),
      paddockCount,
      activeCount,
      coveragePercent,
      layerCoverage: g.layerCoverage,
      label: `${formatDate(g.date)} · ${pctLabel}% ${activeLayer.short} coverage · ${paddockCount} of ${activeCount || totalPaddocks} paddocks`,
    };
  }), [dateCoverage, totalPaddocks, layer, activeLayer.short]);


  const providerFreshness = manifestQuery.data?.provider_freshness ?? null;
  const recommendedDefaultDate = manifestQuery.data?.recommended_default_date ?? null;

  // Auto-select: prefer server-provided recommended default; restore saved
  // selection if it still exists; drop legacy "latest" markers.
  useEffect(() => {
    if (dateCoverage.length === 0) return;
    if (selectedSceneKey === "latest") { setSelectedSceneKey(null); return; }
    // If a selection exists but is no longer in the available dates, drop it.
    if (selectedSceneKey && !dateCoverage.some((g) => g.date === selectedSceneKey)) {
      setSelectedSceneKey(null);
      return;
    }
    if (!selectedSceneKey && activeVineyardId) {
      try {
        const saved = localStorage.getItem(`crop-health:date:${activeVineyardId}`);
        if (saved && dateCoverage.some((g) => g.date === saved)) {
          setSelectedSceneKey(saved);
          return;
        }
      } catch { /* ignore */ }
    }
    if (!selectedSceneKey) {
      if (recommendedDefaultDate && dateCoverage.some((g) => g.date === recommendedDefaultDate)) {
        setSelectedSceneKey(recommendedDefaultDate);
        return;
      }
      // Server didn't yield one — pick newest with the highest coverage.
      const best = [...dateCoverage].sort((a, b) =>
        b.coveragePercent - a.coveragePercent || b.date.localeCompare(a.date))[0];
      if (best) setSelectedSceneKey(best.date);
    }
  }, [dateCoverage, selectedSceneKey, recommendedDefaultDate, activeVineyardId]);

  // Persist user selections per vineyard so revisits keep the same date/layer/
  // paddock/opacity/legend state.
  useEffect(() => {
    if (!activeVineyardId || !selectedSceneKey) return;
    try { localStorage.setItem(`crop-health:date:${activeVineyardId}`, selectedSceneKey); } catch { /* ignore */ }
  }, [activeVineyardId, selectedSceneKey]);
  useEffect(() => {
    if (!activeVineyardId) return;
    try { localStorage.setItem(`crop-health:layer:${activeVineyardId}`, layer); } catch { /* ignore */ }
  }, [activeVineyardId, layer]);
  useEffect(() => {
    if (!activeVineyardId) return;
    try { localStorage.setItem(`crop-health:opacity:${activeVineyardId}`, String(opacity)); } catch { /* ignore */ }
  }, [activeVineyardId, opacity]);
  useEffect(() => {
    if (!activeVineyardId) return;
    try { localStorage.setItem(`crop-health:legend-open:${activeVineyardId}`, legendOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [activeVineyardId, legendOpen]);
  useEffect(() => {
    if (!activeVineyardId) return;
    try { localStorage.setItem(`crop-health:paddock:${activeVineyardId}`, paddockId); } catch { /* ignore */ }
  }, [activeVineyardId, paddockId]);

  // Restore per-vineyard preferences on vineyard change. Paddock restoration
  // is deferred until the paddocks list has loaded so we can validate it.
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeVineyardId) return;
    try {
      const savedLayer = localStorage.getItem(`crop-health:layer:${activeVineyardId}`);
      if (savedLayer) setLayer(savedLayer as SatelliteIndexType);
      const savedOpacity = localStorage.getItem(`crop-health:opacity:${activeVineyardId}`);
      if (savedOpacity != null) {
        const n = Number(savedOpacity);
        if (Number.isFinite(n)) setOpacity(Math.max(0, Math.min(100, Math.round(n))));
      }
      const savedLegend = localStorage.getItem(`crop-health:legend-open:${activeVineyardId}`);
      if (savedLegend != null) setLegendOpen(savedLegend !== "0");
    } catch { /* ignore */ }
    restoredForRef.current = null; // trigger paddock restore below once list ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVineyardId]);

  // Restore saved paddock once paddocks list is loaded (and validate it exists).
  useEffect(() => {
    if (!activeVineyardId) return;
    if (restoredForRef.current === activeVineyardId) return;
    if (paddocksLoading) return;
    try {
      const saved = localStorage.getItem(`crop-health:paddock:${activeVineyardId}`);
      if (saved && (saved === "all" || paddocks.some((p) => p.id === saved))) {
        setPaddockId(saved);
      } else {
        setPaddockId("all");
      }
    } catch { setPaddockId("all"); }
    restoredForRef.current = activeVineyardId;
  }, [activeVineyardId, paddocksLoading, paddocks]);


  // The date used for DISPLAY overlays; may temporarily differ from the
  // committed date while the user scrubs the timeline.
  const effectiveDisplayDate = previewDate ?? selectedSceneKey;

  // Build asset pairs (display + optional analytical) for a given date +
  // current layer. Uses the best scene per paddock for that date.
  const buildAssetPairsFor = (dateKey: string | null) => {
    if (!dateKey || !derivedFromManifest) return [] as Array<{ displayAsset: DBAsset; analyticalAsset?: DBAsset; scene: DBScene }>;
    const { assets } = derivedFromManifest;
    const displayFor = (sceneId: string) => assets.find((x) =>
      x.satellite_scene_id === sceneId && x.index_type === layer && assetKind(x) === "DISPLAY_RASTER"
    );
    const analyticalFor = (sceneId: string) => assets.find((x) =>
      x.satellite_scene_id === sceneId && x.index_type === layer && assetKind(x) === "ANALYTICAL_RASTER"
    );
    const group = dateCoverage.find((g) => g.date === dateKey);
    if (!group) return [];
    const out: Array<{ displayAsset: DBAsset; analyticalAsset?: DBAsset; scene: DBScene }> = [];
    for (const scene of group.sceneByPaddock.values()) {
      const displayAsset = displayFor(scene.id);
      if (displayAsset) out.push({ displayAsset, analyticalAsset: analyticalFor(scene.id), scene });
    }
    return out;
  };

  // Committed pairs — drive analytical decode, hover sampling, summaries.
  const activeAssetPairs = useMemo(
    () => buildAssetPairsFor(selectedSceneKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derivedFromManifest, selectedSceneKey, layer, dateCoverage],
  );

  // Effective display pairs — drive the map overlay images.
  const displayAssetPairs = useMemo(
    () => (effectiveDisplayDate === selectedSceneKey ? activeAssetPairs : buildAssetPairsFor(effectiveDisplayDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derivedFromManifest, effectiveDisplayDate, selectedSceneKey, layer, dateCoverage, activeAssetPairs],
  );

  const activeAssets = useMemo(
    () => displayAssetPairs.map(({ displayAsset, scene }) => ({ asset: displayAsset, scene })),
    [displayAssetPairs],
  );

  const activeAnalyticalAssets = useMemo(
    () => activeAssetPairs
      .filter((x) => x.analyticalAsset)
      .map(({ analyticalAsset, scene }) => ({ asset: analyticalAsset!, scene })),
    [activeAssetPairs],
  );

  // Adjacent-date display asset preload. Look up the immediately-previous and
  // immediately-next saved date for the CURRENT layer and warm the browser
  // cache. Cache-first, sequential (concurrency 1), never fetches analytical.
  const sortedDatesAsc = useMemo(
    () => dateCoverage.map((g) => g.date).slice().sort((a, b) => a.localeCompare(b)),
    [dateCoverage],
  );
  const preloadDisplayAssets = useMemo(() => {
    if (!selectedSceneKey || sortedDatesAsc.length < 2) return [] as Array<{ asset: DBAsset; scene: DBScene }>;
    const idx = sortedDatesAsc.indexOf(selectedSceneKey);
    if (idx < 0) return [];
    const targets: string[] = [];
    if (idx > 0) targets.push(sortedDatesAsc[idx - 1]);
    if (idx < sortedDatesAsc.length - 1) targets.push(sortedDatesAsc[idx + 1]);
    const out: Array<{ asset: DBAsset; scene: DBScene }> = [];
    for (const d of targets) {
      for (const pair of buildAssetPairsFor(d)) {
        out.push({ asset: pair.displayAsset, scene: pair.scene });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedDatesAsc, selectedSceneKey, layer, derivedFromManifest, dateCoverage]);

  // Are any preview-date display assets still loading? Drives the loading
  // caption shown near the map during a scrub.
  const previewPending = useMemo(() => {
    if (effectiveDisplayDate === selectedSceneKey) return false;
    return displayAssetPairs.some(({ displayAsset }) => !signedUrls[displayAsset.id]);
  }, [effectiveDisplayDate, selectedSceneKey, displayAssetPairs, signedUrls]);

  // Target overlay set for the map, sourced from the effective display date.
  // If a preview date has assets still loading, we retain the committed-date
  // overlays instead of blanking the map, then crossfade when preview is ready.
  const targetMapOverlays = useMemo<SatelliteRasterOverlay[]>(() => {
    if (disableCropOverlays) return [];
    const source = previewPending
      ? activeAssetPairs.map(({ displayAsset, scene }) => ({ asset: displayAsset, scene }))
      : activeAssets;
    return source
      .filter(({ asset }) => asset.bounds && signedUrls[asset.id])
      .map(({ asset, scene }) => ({
        paddockId: scene.paddock_id,
        url: signedUrls[asset.id],
        bounds: asset.bounds!,
        opacity: opacity / 100,
        // Stable identity — matches `displayKeyFor(paddockId, effectiveDate, layer, assetId)`
        // so the view model and every overlay-lifecycle callback share ONE key space.
        key: displayKeyFor(scene.paddock_id, effectiveDisplayDate, layer, asset.id),
        sceneId: scene.id,
        indexType: layer,
        assetId: asset.id,
      }));
  }, [activeAssets, activeAssetPairs, signedUrls, opacity, previewPending, effectiveDisplayDate, layer, disableCropOverlays]);

  // Crossfade-mounted overlays. When the target changes, keep the previous
  // set briefly with opacity 0 so its CSS transition animates out while the
  // incoming set animates in.
  const [mapOverlays, setMapOverlays] = useState<SatelliteRasterOverlay[]>([]);
  useEffect(() => {
    const nextKeys = new Set(targetMapOverlays.map((o) => o.key!));
    setMapOverlays((prev) => {
      const prevKeys = new Set(prev.map((o) => o.key!));
      const same = prevKeys.size === nextKeys.size
        && [...nextKeys].every((k) => prevKeys.has(k));
      if (same || prefersReducedMotion) return targetMapOverlays;
      const outgoing = prev
        .filter((o) => !nextKeys.has(o.key!))
        .map((o) => ({ ...o, opacity: 0 }));
      return [...outgoing, ...targetMapOverlays];
    });
    if (prefersReducedMotion) return;
    const t = setTimeout(() => setMapOverlays(targetMapOverlays), 280);
    return () => clearTimeout(t);
  }, [targetMapOverlays, prefersReducedMotion]);

  // --- Overlay & asset lifecycle → unified view-model input maps ----------
  // Keys use `displayKeyFor(paddockId, effectiveDisplayDate, layer, assetId)` and
  // `analyticalKeyFor(paddockId, sceneId, layer, assetId)`. Every consumer of
  // "is this paddock displayed / loading / failed" reads the derived view model,
  // never these raw maps directly.
  const [displayLoadState, setDisplayLoadState] = useState<Map<string, AssetLoadState>>(() => new Map());
  const [overlayLifecycle, setOverlayLifecycle] = useState<Map<string, OverlayLifecycleState>>(() => new Map());
  const [analyticalLoadState, setAnalyticalLoadState] = useState<Map<string, AssetLoadState>>(() => new Map());
  const overlayLifecycleRef = useRef(overlayLifecycle);
  useEffect(() => { overlayLifecycleRef.current = overlayLifecycle; }, [overlayLifecycle]);

  const handleOverlayLoad = useCallback((info: OverlayCallbackInfo) => {
    if (info.assetId) {
      setAssetDiagnostics((prev) => {
        const cur = prev[info.assetId!] ?? null;
        if (!cur) return prev;
        return { ...prev, [info.assetId!]: { ...cur, imageStatus: "loaded", finalStatus: "loaded", error: null } };
      });
    }
    setDisplayLoadState((prev) => {
      const cur = prev.get(info.overlayKey);
      if (cur?.phase === "loaded") return prev;
      const next = new Map(prev); next.set(info.overlayKey, { phase: "loaded" }); return next;
    });
  }, []);
  const handleOverlayError = useCallback((info: OverlayCallbackInfo) => {
    if (info.assetId) {
      setAssetDiagnostics((prev) => {
        const cur = prev[info.assetId!] ?? null;
        if (!cur) return prev;
        return { ...prev, [info.assetId!]: { ...cur, imageStatus: "error", finalStatus: "failed", error: "image decode failed" } };
      });
    }
    setDisplayLoadState((prev) => {
      const next = new Map(prev); next.set(info.overlayKey, { phase: "failed", errorMessage: `${info.indexType ?? "asset"} could not be loaded` }); return next;
    });
    setOverlayLifecycle((prev) => {
      const next = new Map(prev); next.set(info.overlayKey, { phase: "error", errorMessage: "Overlay <img> load failed" }); return next;
    });
  }, []);
  const handleOverlayMounted = useCallback((info: OverlayCallbackInfo) => {
    if (info.assetId) {
      setAssetDiagnostics((prev) => {
        const cur = prev[info.assetId!] ?? null;
        if (!cur) return prev;
        return { ...prev, [info.assetId!]: { ...cur, finalStatus: "loaded" } };
      });
    }
    setOverlayLifecycle((prev) => {
      const cur = prev.get(info.overlayKey);
      if (cur?.phase === "mounted") return prev;
      const next = new Map(prev); next.set(info.overlayKey, { phase: "mounted" }); return next;
    });
  }, []);
  const handleOverlayUnmounted = useCallback((info: OverlayCallbackInfo) => {
    setOverlayLifecycle((prev) => {
      if (!prev.has(info.overlayKey)) return prev;
      const next = new Map(prev); next.set(info.overlayKey, { phase: "unmounted" }); return next;
    });
    setDisplayLoadState((prev) => {
      if (!prev.has(info.overlayKey)) return prev;
      const next = new Map(prev); next.delete(info.overlayKey); return next;
    });
  }, []);

  // Seed 'loading' load-state for any target overlay we don't already track.
  useEffect(() => {
    setDisplayLoadState((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const o of targetMapOverlays) {
        const k = o.key!;
        if (!next.has(k)) { next.set(k, { phase: "loading" }); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [targetMapOverlays]);

  // ============= Unified Crop Health View Model =============
  // ONE derived state consumed by every customer-facing surface: paddocks
  // displayed, coverage %, per-paddock list, missing chips, hover availability,
  // refresh completion summary, selected-date diagnostics, Overlay Health panel.
  // Never re-derive availability from raw manifest/state anywhere else.
  const activePaddockMetas = useMemo(
    () => geoms.map((g) => ({ id: g.id, name: g.name })),
    [geoms],
  );
  const viewModel = useCropHealthViewModel({
    manifest: manifestQuery.data ?? null,
    selectedDate: effectiveDisplayDate,
    selectedLayer: layer,
    activePaddocks: activePaddockMetas,
    displayLoadState,
    analyticalLoadState,
    overlayLifecycle,
  });
  const mountedPaddockCount = viewModel.summary.overlaysMounted;



  // Clear stale search / refresh errors when the user changes date or layer so
  // banners from a previous selection don't linger on a fresh view.
  const errorClearKey = `${selectedSceneKey ?? ""}::${layer}`;
  const lastErrorClearKeyRef = useRef(errorClearKey);
  useEffect(() => {
    if (lastErrorClearKeyRef.current !== errorClearKey) {
      lastErrorClearKeyRef.current = errorClearKey;
      setSearchError(null);
    }
  }, [errorClearKey]);




  // ---- Playback ---------------------------------------------------------
  const PLAYBACK_MS = 1250;
  const togglePlay = useCallback(() => {
    if (sortedDatesAsc.length < 2) return;
    setIsPlaying((cur) => {
      if (cur) return false;
      // If we're at the newest date, restart from the oldest.
      const last = sortedDatesAsc[sortedDatesAsc.length - 1];
      if (selectedSceneKey === last) setSelectedSceneKey(sortedDatesAsc[0]);
      setPreviewDate(null);
      return true;
    });
  }, [sortedDatesAsc, selectedSceneKey]);

  // Playback tick — advance chronologically, pause if next asset is not yet
  // loaded (so we never blank the map), stop at the newest date.
  useEffect(() => {
    if (!isPlaying) return;
    if (sortedDatesAsc.length < 2) { setIsPlaying(false); return; }
    const t = setInterval(() => {
      setSelectedSceneKey((prev) => {
        const idx = prev ? sortedDatesAsc.indexOf(prev) : -1;
        if (idx < 0) return sortedDatesAsc[0];
        if (idx >= sortedDatesAsc.length - 1) {
          // Reached the newest — stop playback on next tick.
          setTimeout(() => setIsPlaying(false), 0);
          return prev;
        }
        const nextDate = sortedDatesAsc[idx + 1];
        // If the next date's display assets aren't preloaded yet, pause this
        // tick — the loader is downloading. We'll advance on the next tick.
        const nextPairs = buildAssetPairsFor(nextDate);
        const ready = nextPairs.every((p) => signedUrls[p.displayAsset.id]);
        if (!ready) return prev;
        return nextDate;
      });
    }, PLAYBACK_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, sortedDatesAsc, signedUrls, layer, dateCoverage]);

  // Stop playback and clear any preview when context changes.
  useEffect(() => { setIsPlaying(false); setPreviewDate(null); }, [activeVineyardId, paddockId, layer]);


  // Cache-first loader: for each visible asset, check IndexedDB for a stored
  // blob keyed by (assetId, processingVersion). If present, mint an object URL
  // and render immediately with zero network. Otherwise fetch a short-lived
  // signed URL, download the bytes, cache them and mint the object URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Order: committed display + committed analytical first, then adjacent
      // preload (display only). Preload never triggers analytical downloads.
      const all = [
        ...activeAssets,
        ...activeAnalyticalAssets,
        ...preloadDisplayAssets,
      ];
      for (const { asset } of all) {
        if (signedUrls[asset.id]) continue;
        const kind = assetKind(asset);
        const pv = asset.processing_version ?? null;
        const isDisplay = kind === "DISPLAY_RASTER";
        const boundsLabel = asset.bounds
          ? `${asset.bounds.west.toFixed(5)},${asset.bounds.south.toFixed(5)} → ${asset.bounds.east.toFixed(5)},${asset.bounds.north.toFixed(5)}`
          : "—";
        const sceneForAsset = displayAssetPairs.find((p) => p.displayAsset.id === asset.id)?.scene
          ?? activeAssetPairs.find((p) => p.analyticalAsset?.id === asset.id || p.displayAsset.id === asset.id)?.scene
          ?? null;
        const updateAssetDiag = (patch: Partial<AssetPipelineDiagnostic>) => {
          if (!isDisplay) return;
          setAssetDiagnostics((prev) => ({
            ...prev,
            [asset.id]: {
              assetId: asset.id,
              paddockId: sceneForAsset?.paddock_id ?? null,
              layer: asset.index_type,
              endpointStatus: null,
              blobSize: null,
              mimeType: null,
              etag: null,
              objectUrlCreated: false,
              imageStatus: "not_checked",
              bounds: boundsLabel,
              finalStatus: "pending",
              error: null,
              ...(prev[asset.id] ?? {}),
              ...patch,
            },
          }));
        };
        updateAssetDiag({ finalStatus: "pending" });
        if (isDisplay) cacheStatsRef.current.displayRequested += 1;
        else cacheStatsRef.current.analyticalRequested += 1;

        // Cache probe (no network).
        const cachedProbe = await readCachedAsset(asset.id, pv);
        if (cachedProbe) {
          if (isDisplay) cacheStatsRef.current.displayHits += 1;
          else cacheStatsRef.current.analyticalHits += 1;
          assetBlobsRef.current.set(`${asset.id}:${pv ?? "unknown"}`, cachedProbe.blob);
          if (cancelled) return;
          const url = URL.createObjectURL(cachedProbe.blob);
          objectUrlsRef.current.set(asset.id, url);
          updateAssetDiag({
            endpointStatus: 304,
            blobSize: cachedProbe.blob.size,
            mimeType: cachedProbe.contentType ?? cachedProbe.blob.type ?? null,
            etag: cachedProbe.etag,
            objectUrlCreated: true,
            finalStatus: "cached",
          });
          setSignedUrls((prev) => ({ ...prev, [asset.id]: url }));
          bumpStats();
          continue;
        }
        if (isDisplay) cacheStatsRef.current.displayMisses += 1;
        else cacheStatsRef.current.analyticalMisses += 1;

        try {
          const blob = await getAssetBlob(asset.id, pv, async (ifNoneMatch) => {
            const r = await fetchAssetBytes(asset.id, ifNoneMatch);
            cacheStatsRef.current.assetRequests += 1;
            if (r.status === 304) cacheStatsRef.current.http304 += 1;
            else if (r.blob) cacheStatsRef.current.bytesDownloaded += r.blob.size;
            updateAssetDiag({
              endpointStatus: r.status,
              blobSize: r.blob?.size ?? null,
              mimeType: r.contentType,
              etag: r.etag,
            });
            return { status: r.status, blob: r.blob, etag: r.etag, contentType: r.contentType };
          });

          if (cancelled) return;
          if (!blob) {
            updateAssetDiag({ finalStatus: "failed", error: "No blob returned" });
            continue;
          }
          assetBlobsRef.current.set(`${asset.id}:${pv ?? "unknown"}`, blob);
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.set(asset.id, url);
          updateAssetDiag({
            blobSize: blob.size,
            mimeType: blob.type || null,
            objectUrlCreated: true,
            finalStatus: "loaded",
          });
          setSignedUrls((prev) => ({ ...prev, [asset.id]: url }));
          bumpStats();
        } catch (e: any) {
          updateAssetDiag({ finalStatus: "failed", error: String(e?.message ?? e) });
          console.error("asset load failed", e);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssets, activeAnalyticalAssets, preloadDisplayAssets, displayAssetPairs, activeAssetPairs]);

  // Revoke stale object URLs when the visible asset set changes. Keeps memory
  // bounded across date/layer switches. Adjacent-preload and preview-display
  // assets remain "alive" so scrubbing doesn't churn the cache.
  useEffect(() => {
    const alive = new Set([
      ...activeAssets,
      ...activeAnalyticalAssets,
      ...displayAssetPairs.map(({ displayAsset, scene }) => ({ asset: displayAsset, scene })),
    ].map((x) => x.asset.id));
    for (const [assetId, url] of objectUrlsRef.current.entries()) {
      if (!alive.has(assetId)) {
        if (import.meta.env.DEV) console.info("[CropHealth] revoke object URL", { assetId });
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        objectUrlsRef.current.delete(assetId);
        setSignedUrls((prev) => {
          if (!(assetId in prev)) return prev;
          const next = { ...prev }; delete next[assetId]; return next;
        });
      }
    }
  }, [activeAssets, activeAnalyticalAssets, displayAssetPairs, selectedSceneKey, layer]);

  // Clear decoded analytical rasters when the user changes the data context.
  useEffect(() => {
    analyticalCacheRef.current.clear();
    setRasterCacheVersion((v) => v + 1);
  }, [activeVineyardId, selectedSceneKey, layer]);

  // Decode selected analytical rasters once. Pointer movement only reads this cache.
  useEffect(() => {
    let cancelled = false;

    async function decodeAsset(asset: DBAsset, scene: DBScene, url: string) {
      if (!asset.bounds) throw new Error("Analytical raster bounds missing");
      const key = analyticalCacheKey(scene.paddock_id, scene.id, asset.index_type, asset.processing_version);
      const existing = analyticalCacheRef.current.get(key);
      if (existing) { cacheStatsRef.current.decodedHits += 1; return; }
      cacheStatsRef.current.decodedMisses += 1;

      const promise = (async (): Promise<DecodedAnalyticalRaster> => {
        // Prefer the cached blob (already downloaded for display) over the network.
        const blobKey = `${asset.id}:${asset.processing_version ?? "unknown"}`;
        const cachedBlob = assetBlobsRef.current.get(blobKey);
        const buf = cachedBlob
          ? await cachedBlob.arrayBuffer()
          : await (async () => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`Analytical raster fetch failed (${res.status})`);
              return res.arrayBuffer();
            })();
        const tiff = await fromArrayBuffer(buf);
        const image = await tiff.getImage();
        const rasters: any = await image.readRasters({ interleave: true });
        return {
          key,
          assetId: asset.id,
          data: rasters as ArrayLike<number>,
          width: asset.raster_width ?? image.getWidth(),
          height: asset.raster_height ?? image.getHeight(),
          bounds: asset.bounds!,
          noData: asset.no_data_sentinel ?? -9999,
          scale: asset.scale_factor ?? 1,
          rowOrientation: asset.row_orientation ?? "north_to_south",
          processingVersion: asset.processing_version ?? "unknown",
        };
      })();

      analyticalCacheRef.current.set(key, promise);
      const vmKey = analyticalKeyFor(scene.paddock_id, scene.id, asset.index_type, asset.id);
      setAnalyticalLoadState((prev) => {
        const next = new Map(prev); next.set(vmKey, { phase: "loading" }); return next;
      });
      setRasterCacheVersion((v) => v + 1);
      try {
        const decoded = await promise;
        if (cancelled) return;
        analyticalCacheRef.current.set(key, decoded);
        setAnalyticalLoadState((prev) => {
          const next = new Map(prev); next.set(vmKey, { phase: "loaded" }); return next;
        });
      } catch (e: any) {
        if (cancelled) return;
        analyticalCacheRef.current.set(key, { error: String(e?.message ?? e) });
        setAnalyticalLoadState((prev) => {
          const next = new Map(prev); next.set(vmKey, { phase: "failed", errorMessage: String(e?.message ?? e) }); return next;
        });
      } finally {
        if (!cancelled) setRasterCacheVersion((v) => v + 1);
      }
    }

    for (const { asset, scene } of activeAnalyticalAssets) {
      const url = signedUrls[asset.id];
      if (url) void decodeAsset(asset, scene, url);
    }

    return () => { cancelled = true; };
    // rasterCacheVersion is deliberately not a dependency; it is only a UI refresh tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnalyticalAssets, signedUrls]);

  // Summaries lookup by paddock (for hover + selected-scene classification)
  const summaryByPaddock = useMemo(() => {
    const map = new Map<string, DBSummary>();
    if (!derivedFromManifest || !selectedSceneKey) return map;
    const relevantScenes = derivedFromManifest.scenes.filter(
      (s) => s.acquired_at.slice(0, 10) === selectedSceneKey,
    );
    const bySceneId = new Map(relevantScenes.map((s) => [s.id, s]));
    for (const sum of derivedFromManifest.summaries) {
      if (sum.index_type !== layer) continue;
      const scene = bySceneId.get(sum.satellite_scene_id);
      if (scene) map.set(scene.paddock_id, sum);
    }
    return map;
  }, [derivedFromManifest, selectedSceneKey, layer, activeAssets]);


  // ---------- Hover sampling ----------
  // Which paddock (if any) sits under the pointer, and which scene we would sample.
  const paddockAt = (lat: number, lng: number): typeof geoms[number] | null => {
    for (const g of visibleGeoms) {
      for (const poly of g.polys) {
        // Outer ring point-in-polygon (ignores holes — good enough for hover).
        const ring = poly[0];
        if (!ring || ring.length < 3) continue;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i].lng, yi = ring[i].lat;
          const xj = ring[j].lng, yj = ring[j].lat;
          const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
          if (intersect) inside = !inside;
        }
        if (inside) return g;
      }
    }
    return null;
  };

  const readAnalyticalCell = (raster: DecodedAnalyticalRaster, lat: number, lng: number): {
    value: number | null;
    message: string | null;
    cellRect: { north: number; south: number; east: number; west: number } | null;
  } => {
    const { west, east, south, north } = raster.bounds;
    const xRatio = (lng - west) / (east - west);
    const yRatio = (north - lat) / (north - south);
    const pixelX = Math.floor(xRatio * raster.width);
    const pixelY = Math.floor(yRatio * raster.height);
    if (pixelX < 0 || pixelY < 0 || pixelX >= raster.width || pixelY >= raster.height) {
      return { value: null, message: "Outside paddock", cellRect: null };
    }
    const cellWest = west + (pixelX / raster.width) * (east - west);
    const cellEast = west + ((pixelX + 1) / raster.width) * (east - west);
    const cellNorth = north - (pixelY / raster.height) * (north - south);
    const cellSouth = north - ((pixelY + 1) / raster.height) * (north - south);
    const cellRect = { north: cellNorth, south: cellSouth, east: cellEast, west: cellWest };
    const raw = Number(raster.data[pixelY * raster.width + pixelX]);
    if (!Number.isFinite(raw)) {
      return { value: null, message: "No satellite data for this cell", cellRect };
    }
    if (raster.noData !== null && Math.abs(raw - raster.noData) < 1e-6) {
      return { value: null, message: "Cloud, shadow or no satellite data in this cell", cellRect };
    }
    return { value: raw * raster.scale, message: null, cellRect };
  };

  const hoverSuspended = (previewDate != null && previewDate !== selectedSceneKey) || isPlaying || interacting;

  // Pointer-move handler — no network request; reads the cached analytical raster.
  const handlePointerMove = (pt: { lat: number; lng: number; x: number; y: number } | null) => {
    if (!pt || hoverSuspended) {
      setHover(null);
      return;
    }
    const pad = paddockAt(pt.lat, pt.lng);
    // Locate the active scene for this paddock (matches current date + layer).
    const match = activeAssetPairs.find((x) => x.scene.paddock_id === pad?.id);
    const acq = match?.scene.acquired_at ?? null;
    let status: "idle" | "loading" | "ready" | "no_data" | "error" | "missing_analytical" =
      pad && acq && layer !== "TRUE_COLOUR" ? "loading" : "idle";
    let value: number | null = null;
    let message: string | null = null;
    let cellRect: { north: number; south: number; east: number; west: number } | null = null;
    let cellResM: number | null = null;

    if (pad && acq && layer !== "TRUE_COLOUR") {
      const analytical = match?.analyticalAsset;
      if (!analytical) {
        status = "missing_analytical";
        message = "Cell readings have not been generated for this image yet.";
      } else {
        const key = analyticalCacheKey(pad.id, match.scene.id, layer, analytical.processing_version);
        const cached = analyticalCacheRef.current.get(key);
        if (!cached) {
          status = "loading";
          message = "Loading cell data…";
        } else if (cached instanceof Promise) {
          status = "loading";
          message = "Loading cell data…";
        } else if ("error" in cached) {
          status = "error";
          message = cached.error;
        } else {
          const sampled = readAnalyticalCell(cached, pt.lat, pt.lng);
          value = sampled.value;
          message = sampled.message;
          cellRect = sampled.cellRect;
          cellResM = analytical.native_resolution_m ?? activeLayer.nativeResM;
          status = value == null ? "no_data" : "ready";
        }
      }
    }

    // Estimate row number from stored row geometry (guard against far-away matches).
    let estRow: number | null = null;
    if (pad) {
      const rows = rowsByPaddock.get(pad.id);
      if (rows && rows.length > 0) {
        const nearest = estimateRowNumberAt(rows, { lat: pt.lat, lng: pt.lng });
        if (nearest && nearest.distanceM <= 25) estRow = nearest.number;
      }
    }

    setHover({
      lat: pt.lat, lng: pt.lng, x: pt.x, y: pt.y,
      paddockId: pad?.id ?? null,
      paddockName: pad?.name ?? null,
      acquiredAt: acq,
      status,
      value,
      message,
      cellResM,
      cellRect,
      estRow,
    });
  };

  // ---------- Actions ----------

  type RefreshVars = { paddockIds?: string[]; isRetry?: boolean; force?: boolean } | undefined;
  const retryInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const autoRanForVineyardRef = useRef<string | null>(null);

  const checkForNewImage = useMutation({
    mutationFn: async (vars: RefreshVars) => {
      if (!activeVineyardId) throw new Error("No vineyard selected");
      if (refreshInFlightRef.current) throw new Error("Refresh already running");
      // Provider-freshness gate: skip routine refresh if Copernicus was
      // checked within the interval, unless caller passes force=true.
      if (!vars?.force && !vars?.isRetry
          && providerFreshness?.provider_check_status === "checked_recently") {
        toast({
          title: "Copernicus was checked recently",
          description: "No routine refresh is required yet. Use Force provider check to run one now.",
        });
        return {
          results: [], skippedNoGeometry: 0, skippedComplete: 0,
          providerCallsAvoided: 0, repairedItems: 0,
          isRetry: false, noWorkNeeded: true,
          report: { perPaddock: [], totals: { totalPaddocks: 0, completePaddocks: 0, missingPaddocks: 0, incompletePaddocks: 0, oldVersionPaddocks: 0, missingDisplay: 0, missingAnalytical: 0, missingSummaries: 0, totalMissing: 0 } },
        } as any;
      }
      refreshInFlightRef.current = true;
      setSearchError(null);

      // Build completeness from the manifest (single source of truth).
      const report = reportFromManifest(
        geoms.map((g) => ({ id: g.id, name: g.name })),
        (manifestQuery.data?.paddocks ?? []) as any,
      );


      // Scope the report to whatever the user selected.
      const explicitIds = vars?.paddockIds;
      let inScopeAll = report.perPaddock;
      if (explicitIds) {
        inScopeAll = report.perPaddock.filter((p) => explicitIds.includes(p.paddockId));
      } else if (paddockId !== "all") {
        inScopeAll = report.perPaddock.filter((p) => p.paddockId === paddockId);
      }

      const inScopeNeedingWork = inScopeAll.filter((p) => p.state !== "complete");
      const skippedComplete = inScopeAll.length - inScopeNeedingWork.length;
      const skippedNoGeometry = paddockId === "all" && !explicitIds
        ? Math.max(0, paddocks.length - geoms.length)
        : 0;
      const providerCallsAvoided = inScopeNeedingWork.filter(
        (p) => p.state !== "missing_latest_scene",
      ).length;

      type ResultStatus = "complete" | "partial" | "insufficient_coverage" | "rate_limited" | "no_scenes" | "failed" | "skipped";
      const results: Array<{ paddock_id: string; status: ResultStatus; message?: string; repairedIndices?: SatelliteIndexType[] }> = [];
      let stopQueue = false;

      // Nothing to do → return early with an "up to date" result set.
      if (inScopeNeedingWork.length === 0) {
        setRefreshProgress(null);
        return {
          results,
          skippedNoGeometry,
          skippedComplete,
          providerCallsAvoided: 0,
          repairedItems: 0,
          isRetry: !!vars?.isRetry,
          noWorkNeeded: true,
          report,
        };
      }

      // Preflight toast so the user sees exactly what will run.
      const preflightParts = [
        `${report.totals.completePaddocks} complete`,
        `${inScopeNeedingWork.length} needing work`,
      ];
      if (report.totals.missingDisplay > 0) preflightParts.push(`${report.totals.missingDisplay} display`);
      if (report.totals.missingAnalytical > 0) preflightParts.push(`${report.totals.missingAnalytical} analytical`);
      if (report.totals.missingSummaries > 0) preflightParts.push(`${report.totals.missingSummaries} summaries`);
      toast({
        title: "Imagery refresh check",
        description: preflightParts.join(" · ") + ". Only missing items will be processed.",
      });

      // Seed rich progress: every in-scope paddock has a row; complete ones
      // start in `skipped`, work items start in `waiting`.
      const initialOrder: string[] = inScopeAll.map((p) => p.paddockId);
      const nameFor = (pid: string) => geoms.find((g) => g.id === pid)?.name ?? paddocks.find((pp) => pp.id === pid)?.name ?? pid.slice(0, 8);
      // Snapshot old scene/version/asset per paddock so we can reconcile after
      // processing (Updated / Reprocessed / Already current / No newer).
      const manifestSnap = manifestQuery.data;
      const oldByPaddock = new Map<string, { sceneId: string | null; procVersion: string | null; assetId: string | null }>();
      const layerNow = layer;
      for (const p of inScopeAll) {
        const mp = (manifestSnap?.paddocks ?? []).find((x: any) => x.paddock_id === p.paddockId);
        // Look up the asset id for the current layer, if present in date_coverage.
        let assetId: string | null = null;
        if (mp?.latest_display_scene_id) {
          for (const entry of manifestSnap?.date_coverage ?? []) {
            const found = entry.paddocks.find((x) => x.scene_id === mp.latest_display_scene_id);
            if (found) {
              assetId = found.layers.find((l) => l.index_type === layerNow)?.display?.asset_id ?? null;
              break;
            }
          }
        }
        oldByPaddock.set(p.paddockId, {
          sceneId: mp?.latest_display_scene_id ?? null,
          procVersion: mp?.latest_processing_version ?? null,
          assetId,
        });
      }
      const initialPaddocks: Record<string, PadProgress> = {};
      for (const p of inScopeAll) {
        const old = oldByPaddock.get(p.paddockId);
        initialPaddocks[p.paddockId] = {
          id: p.paddockId,
          name: nameFor(p.paddockId),
          stage: p.state === "complete" ? "skipped" : "waiting",
          errorKind: null,
          outcome: p.state === "complete" ? "already_current" : undefined,
          oldSceneId: old?.sceneId ?? null,
          oldProcessingVersion: old?.procVersion ?? null,
          oldAssetId: old?.assetId ?? null,
        };
      }
      setRefreshProgress({
        running: true,
        total: inScopeNeedingWork.length,
        order: initialOrder,
        paddocks: initialPaddocks,
      });

      const patchPad = (pid: string, patch: Partial<PadProgress>) => setRefreshProgress((prev) => {
        if (!prev) return prev;
        const cur = prev.paddocks[pid];
        if (!cur) return prev;
        return { ...prev, paddocks: { ...prev.paddocks, [pid]: { ...cur, ...patch } } };
      });
      const recordProcessingFailure = (
        pid: string,
        paddockName: string | null,
        parsed: ReturnType<typeof parseSatelliteFunctionError>,
        fallbackMessage: string,
      ) => {
        const message = parsed.message || fallbackMessage;
        const failure: ProcessingFailureDiagnostic = {
          paddockId: pid,
          paddockName,
          httpStatus: parsed.httpStatus,
          code: parsed.code,
          status: parsed.status,
          failedStage: parsed.failedStage,
          failedLayer: parsed.failedLayer,
          providerStatus: parsed.providerStatus,
          message,
          failedLayers: parsed.failedLayers,
        };
        setProcessingFailures((prev) => [failure, ...prev.filter((x) => x.paddockId !== pid)].slice(0, 12));
        patchPad(pid, {
          processingHttpStatus: parsed.httpStatus,
          processingCode: parsed.code,
          processingStatus: parsed.status,
          failedStage: parsed.failedStage,
          failedLayer: parsed.failedLayer,
          providerStatus: parsed.providerStatus,
          failedLayers: parsed.failedLayers,
          errorMessage: message,
        });
      };
      const setPad = (pid: string, s: PadStatus) => {
        // Bridge legacy statuses to the rich stage model.
        const map: Record<PadStatus, Partial<PadProgress>> = {
          queued: { stage: "waiting" },
          searching: { stage: "searching" },
          processing: { stage: "processing" },
          complete: { stage: "complete" },
          insufficient_coverage: { stage: "no_imagery", errorKind: "no_newer_capture", outcome: "no_newer" },
          rate_limited: { stage: "failed", errorKind: "provider_unavailable", outcome: "failed" },
          failed: { stage: "failed", errorKind: "processing_failed", outcome: "failed" },
          skipped: { stage: "skipped", outcome: "skipped" },
        };
        patchPad(pid, map[s] ?? {});
      };
      const bumpDone = () => { /* per-paddock counters derive from the paddocks map now */ };

      // Wait for MapKit to actually mount an overlay for this paddock after a
      // manifest refetch. Returns true on mount, false on timeout.
      async function waitForOverlayMount(pid: string, timeoutMs = 8000): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          for (const [k, life] of overlayLifecycleRef.current) {
            if (life.phase === "mounted" && k.startsWith(`${pid}|`)) return true;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      }

      // Refetch the manifest, then reconcile old vs new asset for this paddock
      // and set the outcome + drive the overlay-load stage.
      async function reconcilePaddock(pid: string, providerSaidNoScenes: boolean): Promise<void> {
        patchPad(pid, { stage: "manifest" });
        await qc.invalidateQueries({ queryKey: ["satellite-manifest", activeVineyardId] });
        const refreshed = await qc.refetchQueries({
          queryKey: ["satellite-manifest", activeVineyardId, activePaddockIds.join(",")],
        });
        const data = refreshed?.[0]?.data as ManifestResponse | undefined;
        const mp = (data?.paddocks ?? []).find((x: any) => x.paddock_id === pid) as any;
        const newSceneId: string | null = mp?.latest_display_scene_id ?? null;
        const newProc: string | null = mp?.latest_processing_version ?? null;
        let newAssetId: string | null = null;
        if (newSceneId) {
          for (const entry of data?.date_coverage ?? []) {
            const found = entry.paddocks.find((x) => x.scene_id === newSceneId);
            if (found) {
              newAssetId = found.layers.find((l) => l.index_type === layerNow)?.display?.asset_id ?? null;
              break;
            }
          }
        }
        const old = oldByPaddock.get(pid) ?? { sceneId: null, procVersion: null, assetId: null };
        patchPad(pid, { newSceneId, newProcessingVersion: newProc, newAssetId });

        // Case D: provider search yielded nothing and the scene id did not change.
        if (providerSaidNoScenes && newSceneId === old.sceneId) {
          patchPad(pid, { stage: "no_imagery", outcome: "no_newer", errorKind: "no_newer_capture" });
          return;
        }
        // Case A: identical scene AND version → already up to date.
        if (newSceneId === old.sceneId && newProc === old.procVersion) {
          patchPad(pid, { stage: "complete", outcome: "already_current" });
          return;
        }
        // Case C: same scene, new processing version → reprocessed.
        // Case B: new scene id → updated.
        const outcome: PadOutcome = newSceneId !== old.sceneId ? "updated" : "reprocessed";
        patchPad(pid, { stage: "loading_overlay", outcome });

        // Invalidate the browser cache entry for the OLD asset if a new one
        // has replaced it (safety net; new asset ids don't collide with old).
        let cacheInvalidated = false;
        if (old.assetId && old.assetId !== newAssetId) {
          try { await deleteCachedAsset(old.assetId, old.procVersion ?? null); cacheInvalidated = true; } catch { /* ignore */ }
          const url = objectUrlsRef.current.get(old.assetId);
          if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } objectUrlsRef.current.delete(old.assetId); }
          assetBlobsRef.current.delete(`${old.assetId}:${old.procVersion ?? "unknown"}`);
        }
        patchPad(pid, { cacheInvalidated });

        // Auto-select the newest saved date so overlays mount promptly.
        const newest = data?.newest_saved_date ?? null;
        if (newest) setSelectedSceneKey((prev) => (prev === newest ? prev : newest));

        // Wait for MapKit to mount the new overlay for this paddock.
        const mounted = await waitForOverlayMount(pid);
        if (mounted) {
          patchPad(pid, { stage: "complete", overlayRemounted: true, overlayMountedAt: new Date().toISOString() });
        } else {
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "overlay_failed", errorMessage: "Overlay did not mount within 8s" });
        }
      }


      async function processMissingScene(p: PaddockCompleteness): Promise<void> {
        const pid = p.paddockId;
        const targetPaddock = geoms.find((g) => g.id === pid);
        setPad(pid, "searching");
        const search = await invokeSatelliteFn("satellite-search-scenes", {
          vineyard_id: activeVineyardId,
          paddock_id: pid,
          limit: 20,
        });
        if (search.error) {
          const parsed = parseSatelliteFunctionError(search.error);
          if (parsed.code === "rate_limited" || parsed.code === "catalog_rate_limited") {
            stopQueue = true;
            results.push({ paddock_id: pid, status: "rate_limited", message: "Satellite provider is temporarily limiting requests. Try again in a few minutes." });
            setSearchError((prev) => prev ?? { code: parsed.code, providerStatus: parsed.providerStatus, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: "Satellite provider is temporarily limiting requests. Try again in a few minutes." });
            patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "provider_unavailable", errorMessage: "Satellite provider is temporarily limiting requests." });
            return;
          }
          setSearchError((prev) => prev ?? { code: parsed.code, providerStatus: parsed.providerStatus, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: parsed.message });
          results.push({ paddock_id: pid, status: "failed", message: parsed.message });
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "provider_unavailable", errorMessage: parsed.message });
          return;
        }
        const candidates: any[] = (search.data as any)?.candidates ?? [];
        if (candidates.length === 0) {
          results.push({ paddock_id: pid, status: "no_scenes", message: "No newer capture available" });
          patchPad(pid, { stage: "no_imagery", outcome: "no_newer", errorKind: "no_newer_capture", errorMessage: "No newer capture from Copernicus" });
          return;
        }
        patchPad(pid, { stage: "found" });
        const sorted = [...candidates].sort((a, b) => {
          const ca = Number(a?.scene_cloud_cover_pct ?? 100);
          const cb = Number(b?.scene_cloud_cover_pct ?? 100);
          const ap = ca <= 20 ? 0 : 1; const bp = cb <= 20 ? 0 : 1;
          if (ap !== bp) return ap - bp;
          if (ca !== cb) return ca - cb;
          return String(b?.acquired_at ?? "").localeCompare(String(a?.acquired_at ?? ""));
        });

        patchPad(pid, { stage: "downloading" });
        let finalStatus: ResultStatus = "failed";
        let finalMsg = "Processing did not complete.";
        const maxTries = Math.min(4, sorted.length);
        for (let i = 0; i < maxTries; i++) {
          const c = sorted[i];
          patchPad(pid, { stage: "processing" });
          const process = await invokeSatelliteFn("satellite-process-scene", {
            vineyard_id: activeVineyardId,
            paddock_id: pid,
            provider_scene_id: c.provider_scene_id,
            acquired_at: c.acquired_at,
            scene_cloud_cover_pct: c.scene_cloud_cover_pct,
            // A brand-new scene must carry the full required layer set so it is
            // "complete" per the completeness contract.
            requested_index_types: REQUIRED_INDICES,
          });
          if (process.error) {
            const parsed = parseSatelliteFunctionError(process.error);
            finalMsg = parsed.message ?? process.error.message ?? finalMsg;
            recordProcessingFailure(pid, targetPaddock?.name ?? null, parsed, finalMsg);
            if (parsed.code === "rate_limited") {
              finalStatus = "rate_limited"; stopQueue = true;
              setSearchError((prev) => prev ?? { code: parsed.code, providerStatus: parsed.providerStatus, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: finalMsg });
              break;
            }
            continue;
          }
          const procStatus = String((process.data as any)?.status ?? "");
          if (procStatus && procStatus !== "complete" && procStatus !== "partial") {
            const failedLayers = Array.isArray((process.data as any)?.failed_layers)
              ? (process.data as any).failed_layers
              : Array.isArray((process.data as any)?.failures)
                ? (process.data as any).failures
                : undefined;
            recordProcessingFailure(pid, targetPaddock?.name ?? null, {
              code: (process.data as any)?.code ?? failedLayers?.[0]?.code ?? null,
              providerStatus: (process.data as any)?.provider_status ?? null,
              httpStatus: 200,
              status: procStatus,
              failedLayer: failedLayers?.[0]?.index ?? null,
              failedStage: (process.data as any)?.failed_stage ?? (failedLayers?.length ? "layer_processing" : null),
              failedLayers,
              message: (process.data as any)?.message ?? failedLayers?.[0]?.message ?? procStatus,
            }, procStatus);
          }
          if (procStatus === "complete") { finalStatus = "complete"; break; }
          if (procStatus === "partial") {
            const failedLayers = Array.isArray((process.data as any)?.failed_layers)
              ? (process.data as any).failed_layers
              : Array.isArray((process.data as any)?.failures)
                ? (process.data as any).failures
                : undefined;
            if (failedLayers?.length) {
              recordProcessingFailure(pid, targetPaddock?.name ?? null, {
                code: "partial_layers",
                providerStatus: null,
                httpStatus: 200,
                status: "partial",
                failedLayer: failedLayers[0]?.index ?? null,
                failedStage: "layer_processing",
                failedLayers,
                message: failedLayers.map((f: any) => `${f.index ?? "layer"}: ${f.message ?? f.code ?? "failed"}`).join("; "),
              }, "Some layers were skipped.");
            }
            finalStatus = "partial"; finalMsg = "Some layers were skipped."; break;
          }
          if (procStatus === "rate_limited") {
            finalStatus = "rate_limited";
            finalMsg = (process.data as any)?.message ?? "Satellite provider is temporarily limiting requests. Try again in a few minutes.";
            stopQueue = true;
            setSearchError((prev) => prev ?? { code: "rate_limited", providerStatus: null, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: finalMsg });
            break;
          }
          if (procStatus === "insufficient_coverage") {
            const pct = (process.data as any)?.valid_coverage_pct;
            finalStatus = "insufficient_coverage";
            finalMsg = `Selected scene had ${pct != null ? Number(pct).toFixed(0) : "0"}% valid pixels.`;
            continue;
          }
          finalMsg = procStatus || finalMsg;
        }

        results.push({ paddock_id: pid, status: finalStatus, message: finalMsg });
        if (finalStatus === "complete" || finalStatus === "partial") {
          patchPad(pid, { stage: "saving" });
          await reconcilePaddock(pid, false);
        } else if (finalStatus === "insufficient_coverage") {
          patchPad(pid, { stage: "no_imagery", outcome: "no_newer", errorKind: "no_newer_capture", errorMessage: finalMsg });
        } else if (finalStatus === "rate_limited") {
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "provider_unavailable", errorMessage: finalMsg });
        } else {
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "processing_failed" });
        }
      }

      async function repairScene(p: PaddockCompleteness): Promise<void> {
        const pid = p.paddockId;
        const targetPaddock = geoms.find((g) => g.id === pid);
        if (!p.latestProviderSceneId || !p.latestAcquiredAt) {
          // Should be unreachable — repair states always carry a latest scene.
          results.push({ paddock_id: pid, status: "failed", message: "No latest scene to repair." });
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "processing_failed", errorMessage: "No latest scene to repair." });
          return;
        }
        patchPad(pid, { stage: "processing" });
        const process = await invokeSatelliteFn("satellite-process-scene", {
          vineyard_id: activeVineyardId,
          paddock_id: pid,
          provider_scene_id: p.latestProviderSceneId,
          acquired_at: p.latestAcquiredAt,
          scene_cloud_cover_pct: p.latestSceneCloudCoverPct,
          requested_index_types: p.indicesRequiringWork,
        });
        if (process.error) {
          const parsed = parseSatelliteFunctionError(process.error);
          const msg = parsed.message ?? process.error.message ?? "Repair failed";
          recordProcessingFailure(pid, targetPaddock?.name ?? null, parsed, msg);
          if (parsed.code === "rate_limited") {
            stopQueue = true;
            setSearchError((prev) => prev ?? { code: parsed.code, providerStatus: parsed.providerStatus, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: msg });
            results.push({ paddock_id: pid, status: "rate_limited", message: msg });
            patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "provider_unavailable", errorMessage: msg });
            return;
          }
          results.push({ paddock_id: pid, status: "failed", message: msg });
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "processing_failed", errorMessage: msg });
          return;
        }
        const procStatus = String((process.data as any)?.status ?? "");
        if (procStatus && procStatus !== "complete" && procStatus !== "partial") {
          const failedLayers = Array.isArray((process.data as any)?.failed_layers)
            ? (process.data as any).failed_layers
            : Array.isArray((process.data as any)?.failures)
              ? (process.data as any).failures
              : undefined;
          recordProcessingFailure(pid, targetPaddock?.name ?? null, {
            code: (process.data as any)?.code ?? failedLayers?.[0]?.code ?? null,
            providerStatus: (process.data as any)?.provider_status ?? null,
            httpStatus: 200,
            status: procStatus,
            failedLayer: failedLayers?.[0]?.index ?? null,
            failedStage: (process.data as any)?.failed_stage ?? (failedLayers?.length ? "layer_processing" : null),
            failedLayers,
            message: (process.data as any)?.message ?? failedLayers?.[0]?.message ?? procStatus,
          }, procStatus);
        }
        const finalStatus: ResultStatus =
          procStatus === "complete" ? "complete"
          : procStatus === "partial" ? "partial"
          : procStatus === "rate_limited" ? "rate_limited"
          : "failed";
        if (finalStatus === "rate_limited") {
          stopQueue = true;
          setSearchError((prev) => prev ?? { code: "rate_limited", providerStatus: null, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: (process.data as any)?.message ?? "Provider paused" });
        }
        results.push({
          paddock_id: pid,
          status: finalStatus,
          repairedIndices: finalStatus === "complete" || finalStatus === "partial" ? p.indicesRequiringWork : [],
        });
        if (finalStatus === "complete" || finalStatus === "partial") {
          patchPad(pid, { stage: "saving" });
          await reconcilePaddock(pid, false);
        } else if (finalStatus === "rate_limited") {
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "provider_unavailable" });
        } else {
          patchPad(pid, { stage: "failed", outcome: "failed", errorKind: "processing_failed" });
        }
      }


      async function processOne(p: PaddockCompleteness): Promise<void> {
        if (stopQueue) {
          results.push({ paddock_id: p.paddockId, status: "skipped", message: "Skipped after the satellite provider paused requests." });
          setPad(p.paddockId, "skipped"); bumpDone(); return;
        }
        if (p.state === "missing_latest_scene") await processMissingScene(p);
        else await repairScene(p);
      }

      const queue = [...inScopeNeedingWork];
      const CONC = 1;
      const workers = Array.from({ length: Math.min(CONC, queue.length) }, async () => {
        while (queue.length) {
          const p = queue.shift();
          if (!p) return;
          try { await processOne(p); }
          catch (e: any) {
            results.push({ paddock_id: p.paddockId, status: "failed", message: String(e?.message ?? e) });
            setPad(p.paddockId, "failed"); bumpDone();
          }
        }
      });
      await Promise.all(workers);

      const repairedItems = results.reduce((n, r) => n + (r.repairedIndices?.length ?? 0), 0);

      return {
        results, skippedNoGeometry, skippedComplete, providerCallsAvoided,
        repairedItems, isRetry: !!vars?.isRetry, noWorkNeeded: false, report,
      };
    },
    onSettled: () => { refreshInFlightRef.current = false; },
    onSuccess: async ({ results, skippedNoGeometry, skippedComplete, providerCallsAvoided, repairedItems, isRetry, noWorkNeeded }) => {
      if (noWorkNeeded) {
        setLastRefreshSummary({
          at: new Date().toISOString(),
          processedPaddocks: 0,
          repairedItems: 0,
          skippedPaddocks: skippedComplete,
          providerCallsAvoided: 0,
        });
        retryInFlightRef.current = false;
        // Persist a completion panel so the user sees explicit "Already current".
        const expected = geoms.length;
        setRefreshProgress({
          running: false,
          total: 0,
          order: geoms.map((g) => g.id),
          paddocks: Object.fromEntries(
            geoms.map((g) => [g.id, {
              id: g.id, name: g.name, stage: "complete" as PadStage,
              outcome: "already_current" as PadOutcome, errorKind: null,
            }]),
          ),
          summary: { updated: 0, reprocessed: 0, alreadyCurrent: expected, noNewer: 0, failed: 0, displayed: mountedPaddockCount, expected },
        });
        toast({
          title: "No updates required",
          description: "All current imagery and analytical layers are complete.",
        });
        return;
      }

      const complete = results.filter((r) => r.status === "complete" || r.status === "partial").length;
      const cloud = results.filter((r) => r.status === "insufficient_coverage").length;
      const rateLimited = results.filter((r) => r.status === "rate_limited").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const failed = results.filter((r) => r.status === "failed" || r.status === "no_scenes").length;

      // Refresh + wait for the manifest to reflect any new scenes. Reconcile
      // already ran per-paddock, but keep this fallback so a fully-empty
      // manifest gets an extra tick before we render the summary.
      let loaded = false;
      let latestManifest: ManifestResponse | undefined = manifestQuery.data;
      for (let i = 0; i < 3 && complete > 0 && !loaded; i++) {
        await qc.invalidateQueries({ queryKey: ["satellite-manifest", activeVineyardId] });
        const refreshed = await qc.refetchQueries({
          queryKey: ["satellite-manifest", activeVineyardId, activePaddockIds.join(",")],
        });
        const data = refreshed?.[0]?.data as ManifestResponse | undefined;
        latestManifest = data ?? latestManifest;
        if ((data?.date_coverage?.length ?? 0) > 0) { loaded = true; break; }
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Auto-select the newest date the refresh just produced (if any) — the
      // per-paddock reconcile already advances this, but confirm at the end.
      if (complete > 0) {
        const newestDate = latestManifest?.newest_saved_date
          ?? (latestManifest?.date_coverage?.[0]?.acquisition_date ?? null);
        if (newestDate) setSelectedSceneKey(newestDate);
      }

      // Auto-retry once for any paddocks that are still incomplete after this pass.
      if (!isRetry && rateLimited === 0) {
        const nextReport = reportFromManifest(
          geoms.map((g) => ({ id: g.id, name: g.name })),
          (latestManifest?.paddocks ?? []) as any,
        );
        const residual = nextReport.perPaddock
          .filter((p) => p.state !== "complete")
          .filter((p) => (paddockId === "all" ? true : p.paddockId === paddockId))
          .map((p) => p.paddockId);
        if (residual.length > 0) {
          retryInFlightRef.current = true;
          checkForNewImage.mutate({ paddockIds: residual, isRetry: true });
          return;
        }
      }
      retryInFlightRef.current = false;

      setLastRefreshSummary({
        at: new Date().toISOString(),
        processedPaddocks: complete,
        repairedItems,
        skippedPaddocks: skippedComplete,
        providerCallsAvoided,
      });

      // Finalize the persistent progress panel: derive summary from the
      // per-paddock outcomes recorded during reconciliation.
      setRefreshProgress((prev) => {
        if (!prev) return prev;
        const list = Object.values(prev.paddocks);
        const updated = list.filter((p) => p.outcome === "updated").length;
        const reprocessed = list.filter((p) => p.outcome === "reprocessed").length;
        const alreadyCurrent = list.filter((p) => p.outcome === "already_current").length;
        const noNewer = list.filter((p) => p.outcome === "no_newer").length;
        const failedN = list.filter((p) => p.outcome === "failed").length;
        return {
          ...prev,
          running: false,
          summary: {
            updated, reprocessed, alreadyCurrent, noNewer, failed: failedN,
            displayed: mountedPaddockCount, expected: geoms.length,
          },
        };
      });

      const parts: string[] = [];
      parts.push(`${complete} paddock${complete === 1 ? "" : "s"} processed`);
      if (skippedComplete > 0) parts.push(`${skippedComplete} complete paddock${skippedComplete === 1 ? "" : "s"} skipped`);
      if (providerCallsAvoided > 0) parts.push(`${providerCallsAvoided} provider call${providerCallsAvoided === 1 ? "" : "s"} avoided`);
      if (repairedItems > 0) parts.push(`${repairedItems} missing item${repairedItems === 1 ? "" : "s"} repaired`);
      if (cloud > 0) parts.push(`${cloud} had insufficient clear coverage`);
      if (rateLimited > 0) parts.push("provider paused requests");
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (skippedNoGeometry > 0) parts.push(`${skippedNoGeometry} had no valid boundary`);
      const description = parts.join(", ") + ".";

      if (rateLimited > 0) {
        toast({ title: "Satellite imagery paused", description: `${description} Wait a few minutes, then refresh again.`, variant: "destructive" });
      } else if (complete > 0 && loaded) {
        toast({ title: "Satellite imagery updated", description });
      } else if (complete > 0 && !loaded) {
        toast({ title: "Processed, but result not yet visible", description, variant: "destructive" });
      } else {
        toast({ title: "No new imagery available", description, variant: "destructive" });
      }
    },
    onError: (e: any) => {
      retryInFlightRef.current = false;
      const msg = String(e?.message ?? e ?? "Unknown error");
      // "Refresh already running" is a lock conflict, not a Copernicus
      // search failure. Show it as a neutral toast — do not raise the red
      // "Crop Health Maps search failed" panel, and do not clobber any
      // real search error currently displayed.
      if (/refresh already running/i.test(msg)) {
        toast({
          title: "Imagery refresh in progress",
          description: "Another refresh is running. Existing imagery is still available.",
        });
        return;
      }
      setSearchError({
        code: null,
        providerStatus: null,
        paddockId: paddockId === "all" ? geoms[0]?.id ?? null : paddockId,
        paddockName: paddockId === "all" ? geoms[0]?.name ?? null : geoms.find((g) => g.id === paddockId)?.name ?? null,
        message: msg,
      });
      toast({
        title: "Crop Health Maps refresh failed",
        description: msg,
        variant: "destructive",
      });
    },

  });


  // System-admin backfill: generate any missing display/analytical/summary
  // assets for the new 11-layer package on scenes that were processed under
  // an older processing version. Idempotent server-side.
  const backfillLayers = useMutation({
    mutationFn: async () => {
      if (!activeVineyardId) throw new Error("No vineyard selected");
      type BackfillResponse = {
        scanned: number;
        backfilled: number;
        skipped: number;
        has_more?: boolean;
        remaining_work_items?: number;
        halted?: string;
        failures?: Array<{ scene_id: string; index: string; work_key?: string; message: string }>;
      };
      const aggregate = { scanned: 0, backfilled: 0, skipped: 0, halted: null as string | null, failures: [] as NonNullable<BackfillResponse["failures"]> };
      const excludedWorkKeys = new Set<string>();

      for (let pass = 0; pass < 120; pass++) {
        const { data, error } = await invokeSatelliteFn("satellite-backfill-analytical", {
          vineyard_id: activeVineyardId,
          paddock_id: paddockId,
          max_work_items: 1,
          exclude_work_keys: Array.from(excludedWorkKeys),
        });
        if (error) throw error;
        const result = data as BackfillResponse;
        aggregate.scanned = Math.max(aggregate.scanned, result.scanned ?? 0);
        aggregate.backfilled += result.backfilled ?? 0;
        aggregate.skipped += result.skipped ?? 0;
        for (const failure of result.failures ?? []) {
          aggregate.failures.push(failure);
          if (failure.work_key) excludedWorkKeys.add(failure.work_key);
        }
        if (result.halted) aggregate.halted = result.halted;
        if (!result.has_more || result.halted === "rate_limited") break;
      }

      return aggregate;
    },
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["satellite-manifest", activeVineyardId] });
      analyticalCacheRef.current.clear();

      // Invalidate only the blob-cache entries for currently visible assets so
      // any repaired/replaced bytes are re-downloaded, without wiping the full
      // browser cache. New scenes/versions naturally miss the cache (new IDs).
      for (const { asset } of [...activeAssets, ...activeAnalyticalAssets]) {
        try { await deleteCachedAsset(asset.id, asset.processing_version ?? null); } catch { /* ignore */ }
        const url = objectUrlsRef.current.get(asset.id);
        if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } objectUrlsRef.current.delete(asset.id); }
        assetBlobsRef.current.delete(`${asset.id}:${asset.processing_version ?? "unknown"}`);
      }
      setSignedUrls({});
      setRasterCacheVersion((v) => v + 1);
      const failed = data?.failures?.length ?? 0;
      const paused = data?.halted === "rate_limited";
      toast({
        title: paused ? "Crop Health Maps · backfill paused" : "Crop Health Maps · backfill complete",
        description: paused
          ? `Provider rate limit reached after generating ${data.backfilled} assets. Run it again in a few minutes.`
          : `Scanned ${data.scanned} scenes, generated ${data.backfilled} assets${failed ? `, ${failed} failures` : ""}.`,
        variant: failed && !data.backfilled ? "destructive" : "default",
      });
    },
    onError: (e: any) => {
      toast({
        title: "Crop Health Maps · backfill failed",
        description: String(e?.message ?? e ?? "Unknown error"),
        variant: "destructive",
      });
    },
  });

  // Auto-run on page load: if any paddock has no imagery in the last 3 days,
  // silently trigger a refresh for just those paddocks. Cooled down per vineyard
  // across mounts so bouncing in and out of the page doesn't refire it.
  // NOTE: automatic Refresh Imagery on page load has been removed.
  // Refreshing must only happen in response to an explicit user click on
  // the Refresh Imagery button — opening the page must never fire
  // satellite-search-scenes or satellite-process-scene. Saved imagery is
  // rendered from stored metadata; provider calls are user-initiated only.
  useEffect(() => {
    if (!activeVineyardId) return;
    autoRanForVineyardRef.current = activeVineyardId;
  }, [activeVineyardId]);




  // manifestQuery + activePaddockIds are declared near scenesQuery above so
  // both the date-coverage memo and the completeness report can consume them.


  // Live completeness snapshot for the diagnostics panel and the missing
  // paddock chip. Always derived from the server manifest.
  const liveReport: CompletenessReport = useMemo(() => {
    const paddockInputs = geoms.map((g) => ({ id: g.id, name: g.name }));
    const manifestRows = manifestQuery.data?.paddocks ?? [];
    return reportFromManifest(paddockInputs, manifestRows as any);
  }, [geoms, manifestQuery.data]);

  const [missingDetailOpen, setMissingDetailOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("details");
  const [mapFocus, setMapFocus] = useState(false);
  const openDrawer = useCallback((t: DrawerTab) => { setDrawerTab(t); setDrawerOpen(true); }, []);

  // Escape exits map-focus when no drawer is open (drawer handles its own Escape).
  useEffect(() => {
    if (!mapFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !drawerOpen) setMapFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapFocus, drawerOpen]);

  const refreshCounts = useMemo(() => {
    if (!refreshProgress) return null;
    const list = Object.values(refreshProgress.paddocks);
    const terminal = list.filter((p) => p.stage === "complete" || p.stage === "failed" || p.stage === "no_imagery" || p.stage === "skipped");
    return { list, doneCount: terminal.filter((p) => p.outcome !== "skipped").length, total: refreshProgress.total };
  }, [refreshProgress]);

  const busy = checkForNewImage.isPending;
  const isRetryPass = busy && retryInFlightRef.current;
  const refreshLabel = busy
    ? (isRetryPass
        ? "Retrying skipped…"
        : (refreshCounts
            ? `Refreshing ${Math.min(refreshCounts.doneCount + 1, refreshCounts.total)} / ${refreshCounts.total}…`
            : "Refreshing…"))
    : (refreshProgress?.summary ? "Refresh Imagery" : "Refresh Imagery");

  // Summary for the currently hovered paddock (used to build the tooltip's
  // paddock-relative interpretation and to show the current-scene range/median
  // in the legend).
  const hoverSummary = hover?.paddockId ? summaryByPaddock.get(hover.paddockId) : undefined;
  const legendSummary = hoverSummary ?? (summaryByPaddock.size === 1 ? Array.from(summaryByPaddock.values())[0] : undefined);




  // ---------- Slice 2 map-first layout ----------
  // Panels below are declared as JSX chunks so the map workspace can host them
  // in the drawer / overlays without duplicating logic. All numbers still come
  // from useCropHealthViewModel.

  const detailsPanel = (
    <div className="space-y-3 text-xs">
      <div className="rounded-md border bg-muted/30 p-3 space-y-1">
        <div className="text-sm font-semibold text-foreground">{activeLayer.label}</div>
        <div className="text-muted-foreground">{activeLayer.description}</div>
        <div className="text-[11px] text-muted-foreground pt-1 italic">
          Native input resolution: {activeLayer.nativeResM} m{activeLayer.resamplingNote ? " (20 m native data, resampled for display)" : ""}. {LAYER_DISCLAIMER}
        </div>
        {layer === "PSRI" && (
          <div className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">{PSRI_CAUTION}</div>
        )}
      </div>

      <div className="rounded-md border bg-muted/20 p-3 space-y-1">
        <div className="text-sm font-semibold text-foreground">Selected date</div>
        {(() => {
          const s = viewModel.summary;
          const pct = Number.isInteger(s.coveragePercent) ? `${s.coveragePercent}` : s.coveragePercent.toFixed(1);
          return (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
              <div>Date: <span className="text-foreground">{selectedSceneKey ? formatDate(selectedSceneKey) : "—"}</span></div>
              <div>Layer: <span className="text-foreground">{activeLayer.short}</span></div>
              <div>Paddocks displayed: <span className="text-foreground">{s.overlaysMounted}</span></div>
              <div>Unavailable: <span className="text-foreground">{s.unavailable}</span></div>
              <div>Active paddocks: <span className="text-foreground">{s.activePaddocks}</span></div>
              <div>Coverage: <span className="text-foreground">{pct}%</span></div>
            </div>
          );
        })()}
      </div>

      {selectedSceneKey && (() => {
        const missing = viewModel.paddocks.filter(
          (p) => p.availabilityReason === "no_scene_for_date"
            || p.availabilityReason === "selected_layer_missing"
            || p.availabilityReason === "scene_incomplete",
        );
        if (missing.length === 0) return null;
        return (
          <div className="rounded-md border bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-1">
            <div className="text-xs font-semibold text-foreground">Paddocks without imagery</div>
            <div>
              No imagery saved for {formatDate(selectedSceneKey)} on these paddocks. Their outlines remain visible on the map.
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {missing.map((p) => (
                <span key={p.paddockId} className="inline-flex items-center rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[10px]">
                  {p.paddockName}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
        <div className="text-xs font-semibold text-foreground">Per-paddock status</div>
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-sm bg-background/60 p-2">
          {viewModel.paddocks.map((p) => {
            const badge = reasonToCustomerMessage(p.availabilityReason, p.selectedLayer);
            const tone: "ok" | "warn" | "err" =
              p.availabilityReason === "displayed" ? "ok"
              : (p.availabilityReason === "asset_load_failed" || p.availabilityReason === "overlay_mount_failed") ? "err"
              : "warn";
            const toneCls = tone === "err" ? "text-destructive"
              : tone === "warn" ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground";
            return (
              <div key={p.paddockId} className="text-[11px] leading-tight">
                <span className="font-medium text-foreground">{p.paddockName}</span>
                <span className={`ml-1 ${toneCls}`}>— {badge}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
        <label className="text-xs font-semibold text-foreground block">
          Overlay Transparency — {opacity}%
        </label>
        <Slider
          className="w-full min-w-0"
          value={[opacity]}
          onValueChange={(v) => setOpacity(v[0])}
          min={0}
          max={100}
          step={1}
        />
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(20)}>20%</Button>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(65)}>65%</Button>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(95)}>95%</Button>
        </div>
      </div>
    </div>
  );

  const historyPanel = (
    (manifestQuery.data?.total_saved_dates ?? dateOptions.length) > 0 ? (
      <SavedImageryHistory
        entries={dateOptions}
        committedDate={selectedSceneKey}
        onSelectDate={(d) => {
          setIsPlaying(false);
          setPreviewDate(null);
          setSelectedSceneKey(d);
        }}
        totalPaddocks={totalPaddocks}
      />
    ) : (
      <div className="text-xs text-muted-foreground p-3">No saved imagery yet. Use "Check for New Imagery" to look for a Copernicus capture.</div>
    )
  );

  const adminPanel = (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={disableCropOverlays ? "secondary" : "outline"}
          onClick={() => setDisableCropOverlays((v) => !v)}
          title="Temporarily render Apple Maps and paddock boundaries without crop-health rasters."
        >
          Disable Crop Overlays: {disableCropOverlays ? "On" : "Off"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || backfillLayers.isPending || !activeVineyardId}
          onClick={() => backfillLayers.mutate()}
          title="Generate any missing display / analytical / summary assets on already-stored scenes."
        >
          {backfillLayers.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <SatelliteIcon className="h-3.5 w-3.5 mr-1.5" />}
          {backfillLayers.isPending ? "Repairing…" : "Repair Missing Assets"}
        </Button>
        {providerFreshness?.provider_check_status === "checked_recently" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || geoms.length === 0}
            onClick={() => checkForNewImage.mutate({ force: true })}
            title="Force a Copernicus search even though a recent check exists."
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Force provider check
          </Button>
        )}
      </div>

      <div className="rounded-md border bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-1">
        <div className="text-xs font-semibold text-foreground">Copernicus status</div>
        {(() => {
          const pf = providerFreshness;
          const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "—";
          const statusLabel = (() => {
            switch (pf?.provider_check_status) {
              case "checked_recently": return "Checked recently";
              case "check_due": return "Check due";
              case "checking": return "Checking Copernicus for newer imagery…";
              case "failed": return "Last check failed";
              case "never_checked": return "Never checked";
              default: return "—";
            }
          })();
          return (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div>Last checked: <span className="text-foreground">{fmt(pf?.last_provider_check_at ?? null)}</span></div>
              <div>Next recommended: <span className="text-foreground">{fmt(pf?.next_recommended_provider_check_at ?? null)}</span></div>
              <div>Status: <span className="text-foreground">{statusLabel}</span></div>
              <div>Interval: <span className="text-foreground">{pf?.provider_check_interval_days ?? 5} days</span></div>
              {pf?.active_job_id && (
                <div className="col-span-2">Active job: <span className="text-foreground">{pf.active_job_id.slice(0, 8)}…</span></div>
              )}
            </div>
          );
        })()}
      </div>

      <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-3">
        <div className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5" />
          Diagnostics
        </div>

        <div className="space-y-1 pt-2 border-t">
          <div className="text-xs font-semibold text-foreground">MapKit readiness</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>State: <span className="text-foreground">{mapDiagnostics?.readinessState ?? "—"}</span></div>
            <div>Token HTTP: <span className="text-foreground">{mapDiagnostics?.tokenEndpointStatus ?? "—"}</span></div>
            <div>Token received: <span className="text-foreground">{mapDiagnostics?.tokenReceived ? "yes" : "no"}</span></div>
            <div>Token field: <span className="text-foreground">{mapDiagnostics?.tokenFieldName ?? "—"}</span></div>
            <div>Token length: <span className="text-foreground">{mapDiagnostics?.tokenLength ?? "—"}</span></div>
            <div>Global: <span className="text-foreground">{mapDiagnostics?.mapkitGlobalAvailable ? "yes" : "no"}</span></div>
            <div>Map instance: <span className="text-foreground">{mapDiagnostics?.mapInstanceCreated ? "yes" : "no"}</span></div>
            <div>Attached: <span className="text-foreground">{mapDiagnostics?.mapElementAttached ? "yes" : "no"}</span></div>
            <div>Container: <span className="text-foreground">{mapDiagnostics ? `${mapDiagnostics.containerWidth}×${mapDiagnostics.containerHeight}` : "—"}</span></div>
            <div>Subviews: <span className="text-foreground">{mapDiagnostics?.mapCanvasSubviewCount ?? "—"}</span></div>
            <div className="col-span-2">Top at centre: <span className="text-foreground">{mapDiagnostics?.elementAtCenter ?? "—"}</span></div>
            {mapDiagnostics?.lastError && <div className="col-span-2 text-destructive">{mapDiagnostics.lastError}</div>}
          </div>
        </div>

        <div className="space-y-1 pt-2 border-t">
          <div className="text-xs font-semibold text-foreground">Saved asset pipeline</div>
          <div className="max-h-36 overflow-y-auto space-y-1">
            {Object.values(assetDiagnostics).length === 0 ? (
              <div>No display asset requests recorded yet.</div>
            ) : Object.values(assetDiagnostics).slice(0, 8).map((d) => (
              <div key={d.assetId} className="rounded-sm bg-background/60 p-1.5">
                <div className="text-foreground">{d.layer} · {d.paddockId?.slice(0, 8) ?? "—"}</div>
                <div>asset: <span className="text-foreground">{d.assetId.slice(0, 8)}…</span> · HTTP <span className="text-foreground">{d.endpointStatus ?? "—"}</span> · blob <span className="text-foreground">{d.blobSize ?? "—"}</span> · {d.mimeType ?? "—"}</div>
                <div>object URL: <span className="text-foreground">{d.objectUrlCreated ? "yes" : "no"}</span> · image: <span className="text-foreground">{d.imageStatus}</span> · final: <span className="text-foreground">{d.finalStatus}</span></div>
                {d.error && <div className="text-destructive">{d.error}</div>}
              </div>
            ))}
          </div>
        </div>

        {processingFailures.length > 0 && (
          <div className="space-y-1 pt-2 border-t">
            <div className="text-xs font-semibold text-foreground">Processing failures</div>
            <div className="max-h-36 overflow-y-auto space-y-1">
              {processingFailures.map((f) => (
                <div key={f.paddockId} className="rounded-sm bg-destructive/10 p-1.5">
                  <div className="text-foreground">{f.paddockName ?? f.paddockId.slice(0, 8)}</div>
                  <div>HTTP {f.httpStatus ?? "—"} · code {f.code ?? "—"} · status {f.status ?? "—"}</div>
                  <div>stage {f.failedStage ?? "—"} · layer {f.failedLayer ?? "—"} · provider {f.providerStatus ?? "—"}</div>
                  <div className="text-destructive">{f.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1 pt-2 border-t">
          <div className="text-xs font-semibold text-foreground">Saved history</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>Saved dates: <span className="text-foreground">{manifestQuery.data?.total_saved_dates ?? dateOptions.length}</span></div>
            <div>Newest: <span className="text-foreground">{manifestQuery.data?.newest_saved_date ?? "—"}</span></div>
            <div>Oldest: <span className="text-foreground">{manifestQuery.data?.oldest_saved_date ?? "—"}</span></div>
          </div>
        </div>

        <div className="space-y-1 pt-2 border-t">
          <div className="text-xs font-semibold text-foreground">Package health</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>Complete: <span className="text-foreground">{liveReport.totals.completePaddocks}</span></div>
            <div>Partial: <span className="text-foreground">{liveReport.totals.incompletePaddocks}</span></div>
            <div>Upgrade required: <span className="text-foreground">{liveReport.totals.oldVersionPaddocks}</span></div>
            <div>Missing display: <span className="text-foreground">{liveReport.totals.missingDisplay}</span></div>
            <div>Missing analytical: <span className="text-foreground">{liveReport.totals.missingAnalytical}</span></div>
            <div>Missing summaries: <span className="text-foreground">{liveReport.totals.missingSummaries}</span></div>
          </div>
        </div>

        <div className="space-y-1 pt-2 border-t">
          <div className="text-xs font-semibold text-foreground">Browser cache</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>Display requested: <span className="text-foreground">{cacheStatsRef.current.displayRequested}</span></div>
            <div>Display hits: <span className="text-foreground">{cacheStatsRef.current.displayHits}</span></div>
            <div>Display misses: <span className="text-foreground">{cacheStatsRef.current.displayMisses}</span></div>
            <div>Analytical hits: <span className="text-foreground">{cacheStatsRef.current.analyticalHits}</span></div>
            <div>Analytical misses: <span className="text-foreground">{cacheStatsRef.current.analyticalMisses}</span></div>
            <div>Decoded hits: <span className="text-foreground">{cacheStatsRef.current.decodedHits}</span></div>
            <div>Object URLs: <span className="text-foreground">{objectUrlsRef.current.size}</span></div>
          </div>
        </div>

        <div className="pt-2 border-t grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          <div>Manifest version: <span className="text-foreground">{manifestQuery.data?.manifest_version ?? "—"}</span></div>
          <div>Manifest loaded: <span className="text-foreground">{manifestQuery.data ? "yes" : "no"}</span></div>
          <div>Processing version: <span className="text-foreground">{CURRENT_PROCESSING_VERSION}</span></div>
          <div>Asset requests: <span className="text-foreground">{cacheStatsRef.current.assetRequests}</span></div>
          <div>HTTP 304: <span className="text-foreground">{cacheStatsRef.current.http304}</span></div>
          <div>Bytes downloaded: <span className="text-foreground">{(cacheStatsRef.current.bytesDownloaded / 1024).toFixed(1)} KB</span></div>
          {lastRefreshSummary && (
            <>
              <div>Last refresh: <span className="text-foreground">{lastRefreshSummary.processedPaddocks} processed</span></div>
              <div>Provider calls avoided: <span className="text-foreground">{lastRefreshSummary.providerCallsAvoided}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="pt-1 border-t">
        <OverlayHealthPanel viewModel={viewModel} selectedLayer={layer} />
      </div>
    </div>
  );

  // Measured workspace height: the app portal has a sticky header, banners
  // and main padding above this page, so a raw `calc(100dvh - header)` grows
  // past the viewport and pushes the timeline below the fold. Instead we
  // measure the wrapper's top offset and size the wrapper to fit exactly
  // within the remaining viewport, with a 600px minimum for safety.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [wrapperHeight, setWrapperHeight] = useState<number | null>(null);
  useEffect(() => {
    if (mapFocus) { setWrapperHeight(null); return; }
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const avail = Math.floor(window.innerHeight - rect.top - 12);
      setWrapperHeight(Math.max(600, avail));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, [mapFocus]);

  const focusWrapperClass = mapFocus
    ? "fixed inset-0 z-40 bg-background flex flex-col"
    : "w-full flex flex-col";
  const focusWrapperStyle: CSSProperties = mapFocus
    ? {}
    : { height: wrapperHeight ? `${wrapperHeight}px` : undefined, minHeight: 600 };

  // ---------- Guards ----------
  if (adminLoading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isSystemAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div ref={wrapperRef} className={focusWrapperClass} style={focusWrapperStyle}>

      {!mapFocus && (
        <div className="px-3 pt-2 pb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="rounded-md bg-amber-500/15 p-1.5 text-amber-600 dark:text-amber-400">
              <SatelliteIcon className="h-4 w-4" />
            </div>
            <h1 className="text-lg font-semibold truncate">Crop Health Maps</h1>
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px]">
              System Admin · Beta
            </Badge>
          </div>
          <Button
            size="sm"
            disabled={busy || geoms.length === 0}
            onClick={() => checkForNewImage.mutate(undefined)}
            title="Search Copernicus for newer imagery. Skipped when a check ran within the last 5 days."
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {busy ? refreshLabel : "Check for New Imagery"}
          </Button>
        </div>
      )}

      {searchError && !mapFocus && (
        <Card className="mx-3 mb-2 border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Crop Health Maps search failed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              VineTrack could not search Copernicus imagery. The existing vineyard map remains available.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => checkForNewImage.mutate(undefined)}>
                {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Retry
              </Button>
              <span className="text-xs text-muted-foreground">{searchError.message}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Map workspace — all controls float over the map */}
      <div className={`relative flex-1 min-h-[600px] ${mapFocus ? "" : "mx-2 mb-2 rounded-lg border overflow-hidden"}`}>
        {paddocksLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading paddocks…
          </div>
        ) : visibleGeoms.length === 0 ? (
          <div className="h-full flex items-center justify-center p-8">
            <div className="text-center text-sm text-muted-foreground max-w-md">
              No paddock boundaries are available for this vineyard. Add paddock polygons in Setup to display them on the satellite map.
            </div>
          </div>
        ) : (
          <SatelliteMap
            className="absolute inset-0"
            paddocks={visibleGeoms.map((g) => ({
              id: g.id,
              name: g.name,
              polys: g.polys,
              color: paddockColor(g.id),
            }))}
            selectedPaddockId={paddockId === "all" ? null : paddockId}
            overlays={disableCropOverlays ? [] : mapOverlays}
            overlayOpacity={opacity / 100}
            overlayTransitionMs={prefersReducedMotion ? 0 : 220}
            cellRect={disableCropOverlays || hoverSuspended ? null : hover?.cellRect ?? null}
            onPaddockClick={(id) => setPaddockId(id)}
            onPointerMove={handlePointerMove}
            onOverlayLoad={handleOverlayLoad}
            onOverlayError={handleOverlayError}
            onOverlayMounted={handleOverlayMounted}
            onOverlayUnmounted={handleOverlayUnmounted}
            onDiagnosticsChange={setMapDiagnostics}
            showDiagnostics={isSystemAdmin}
          />
        )}

        {/* Top-left: compact map controls */}
        <div className="absolute top-3 left-3 z-[520] flex flex-wrap gap-2 max-w-[calc(100%-14rem)]">
          <div className="min-w-[140px]">
            <Select value={activeVineyardId ?? ""} onValueChange={(v) => { setVineyardId(v); setPaddockId("all"); setSelectedSceneKey(null); }}>
              <SelectTrigger className="h-9 bg-background/95 backdrop-blur shadow-sm"><SelectValue placeholder="Vineyard" /></SelectTrigger>
              <SelectContent>
                {memberships.map((m) => (
                  <SelectItem key={m.vineyard_id} value={m.vineyard_id}>
                    {m.vineyard_name ?? m.vineyard_id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <Select value={paddockId} onValueChange={(v) => { setPaddockId(v); setSelectedSceneKey(null); }}>
              <SelectTrigger className="h-9 bg-background/95 backdrop-blur shadow-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Paddocks</SelectItem>
                {geoms.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <Select value={layer} onValueChange={(v) => setLayer(v as SatelliteIndexType)}>
              <SelectTrigger className="h-9 bg-background/95 backdrop-blur shadow-sm"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[420px]">
                {LAYER_GROUPS.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </SelectLabel>
                    {group.ids.map((id) => {
                      const l = LAYERS.find((x) => x.id === id);
                      if (!l) return null;
                      return <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>;
                    })}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isSystemAdmin && (
            <Button
              size="sm"
              variant={disableCropOverlays ? "secondary" : "outline"}
              className="h-9 bg-background/95 backdrop-blur shadow-sm"
              onClick={() => setDisableCropOverlays((v) => !v)}
            >
              Disable Crop Overlays: {disableCropOverlays ? "On" : "Off"}
            </Button>
          )}
        </div>

        {/* Top-right: workspace actions */}
        <div className="absolute top-3 right-3 z-[520] flex flex-wrap gap-1.5 justify-end">
          <Button
            size="sm"
            variant="secondary"
            className="h-9 bg-background/95 backdrop-blur shadow-sm"
            onClick={() => openDrawer("details")}
            aria-label="Open details panel"
          >
            <PanelRight className="h-4 w-4 mr-1.5" />Details
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-9 bg-background/95 backdrop-blur shadow-sm"
            onClick={() => openDrawer("history")}
            aria-label="Open history panel"
          >
            <CalendarDays className="h-4 w-4 mr-1.5" />History
          </Button>
          {isSystemAdmin && (
            <Button
              size="sm"
              variant="secondary"
              className="h-9 bg-background/95 backdrop-blur shadow-sm"
              onClick={() => openDrawer("admin")}
              aria-label="Open admin panel"
            >
              <ShieldAlert className="h-4 w-4 mr-1.5" />Admin
            </Button>
          )}
          {/* Full-screen temporarily hidden during regression recovery. */}
          {false && (
          <Button
            size="sm"
            variant="secondary"
            className="h-9 bg-background/95 backdrop-blur shadow-sm"
            onClick={() => setMapFocus((v) => !v)}
            aria-label={mapFocus ? "Exit full screen" : "Enter full screen"}
            aria-pressed={mapFocus}
          >
            {mapFocus ? <Minimize2 className="h-4 w-4 mr-1.5" /> : <Maximize2 className="h-4 w-4 mr-1.5" />}
            {mapFocus ? "Exit Full Screen" : "Full Screen"}
          </Button>
          )}

        </div>

        {/* Refresh progress — shifted below the actions bar */}
        {refreshProgress && (
          <div className="absolute top-16 right-3 z-[560] [&>[role=status]]:!static">
            <RefreshProgressPanel
              progress={refreshProgress}
              isSystemAdmin={isSystemAdmin}
              mountedPaddockCount={mountedPaddockCount}
              expectedCount={geoms.length}
              onDismiss={() => setRefreshProgress(null)}
            />
          </div>
        )}

        {/* Playback / preview banner */}
        {(hoverSuspended || previewPending) && (
          <div
            className="pointer-events-none absolute left-1/2 top-14 z-[550] -translate-x-1/2 rounded-md border bg-background/95 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-md backdrop-blur"
            role="status"
            aria-live="polite"
          >
            {previewPending && effectiveDisplayDate
              ? `Loading imagery for ${new Date(effectiveDisplayDate + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}…`
              : isPlaying
                ? "Pause playback to inspect cell values."
                : "Release the timeline to inspect cell values."}
          </div>
        )}

        {/* Hover tooltip */}
        {hover && hover.paddockId && (() => {
          const dateLong = hover.acquiredAt
            ? new Date(hover.acquiredAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
            : null;
          return (
          <div
            className="pointer-events-none absolute z-[600] rounded-md border bg-background/95 backdrop-blur shadow-md px-3 py-2 text-xs min-w-[220px] max-w-[320px]"
            style={{
              left: Math.max(8, hover.x + 12),
              top: Math.max(8, hover.y - 72),
            }}
          >
            <div className="font-semibold text-foreground">{hover.paddockName ?? "Paddock"}</div>
            {hover.estRow != null && (
              <div className="text-[10px] text-muted-foreground">
                Est. Row: <span className="font-medium text-foreground tabular-nums">{hover.estRow}</span>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">
              {activeLayer.short}{dateLong ? ` · ${dateLong}` : ""}
            </div>
            <div className="mt-1">
              {layer === "TRUE_COLOUR" ? (
                <>
                  <div className="text-sm font-medium text-foreground">True-colour satellite image</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Resolution: 10 m — no numerical index value.</div>
                </>
              ) : !hover.acquiredAt ? (
                <span className="text-muted-foreground">No saved imagery for this date</span>
              ) : hover.status === "loading" ? (
                <span className="text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> {hover.message ?? "Loading cell data…"}
                </span>
              ) : hover.status === "missing_analytical" ? (
                <>
                  <div className="text-muted-foreground">{hover.message}</div>
                  <div className="text-[10px] text-muted-foreground mt-1 italic">
                    Use "Check for New Imagery" above.
                  </div>
                </>
              ) : hover.status === "ready" && hover.value != null ? (() => {
                  const value = hover.value;
                  const meaning =
                    generalBand(layer, value) ??
                    relativeMeaning(layer, value, hoverSummary) ??
                    "Value recorded for this cell";
                  return (
                    <>
                      <div className="text-sm font-medium text-foreground tabular-nums">Cell value: {value.toFixed(2)}</div>
                      <div className="text-[11px] font-semibold text-foreground mt-0.5">{meaning}</div>
                    </>
                  );
                })() : hover.status === "no_data" ? (
                <span className="text-muted-foreground">{hover.message ?? "No satellite data for this cell"}</span>
              ) : hover.status === "error" ? (
                <span className="text-destructive">{hover.message ?? "Sample failed"}</span>
              ) : null}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
              {hover.lat.toFixed(5)}, {hover.lng.toFixed(5)}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground italic">
              Each cell may include vines, inter-row vegetation, exposed soil and shadow.
            </div>
          </div>
          );
        })()}

        {/* Legend bottom-right */}
        <div className="absolute bottom-24 right-3 z-[500] w-72 max-w-[92%] md:bottom-3">
          <Collapsible open={legendOpen} onOpenChange={setLegendOpen}>
            <div className="rounded-md border bg-background/95 backdrop-blur shadow-md">
              <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <span className="truncate">
                    Legend — {activeLayer.short}
                    {!legendOpen && selectedSceneKey && (
                      <span className="ml-1 font-normal text-muted-foreground">· {formatDate(selectedSceneKey)}</span>
                    )}
                  </span>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                          aria-label={`What ${activeLayer.short} shows`}
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[280px] text-xs space-y-2 leading-snug">
                        <div><div className="font-semibold">What it shows</div><div className="text-muted-foreground">{activeLayer.infoWhat}</div></div>
                        <div><div className="font-semibold">Lower values</div><div className="text-muted-foreground">{activeLayer.infoLow}</div></div>
                        <div><div className="font-semibold">Higher values</div><div className="text-muted-foreground">{activeLayer.infoHigh}</div></div>
                        <div><div className="font-semibold">Native resolution</div><div className="text-muted-foreground">{activeLayer.nativeResM} m</div></div>
                        <div><div className="font-semibold">Important</div><div className="text-muted-foreground">{activeLayer.infoImportant}</div></div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${legendOpen ? "" : "-rotate-90"}`} />
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="px-3 pb-3 space-y-2">
                  <div className="h-2.5 w-full rounded-sm" style={{
                    background: `linear-gradient(to right, ${activeLayer.legend.join(", ")})`,
                  }} />
                  {layer !== "TRUE_COLOUR" ? (
                    <>
                      <div className="flex justify-between gap-2 text-[10px]">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground tabular-nums">{fmt(activeLayer.displayMin)}</div>
                          <div className="text-muted-foreground leading-tight">{activeLayer.legendLow}</div>
                        </div>
                        <div className="flex-1 min-w-0 text-right">
                          <div className="font-medium text-foreground tabular-nums">{fmt(activeLayer.displayMax)}</div>
                          <div className="text-muted-foreground leading-tight">{activeLayer.legendHigh}</div>
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-snug">{activeLayer.legendNote}</div>
                      {activeLayer.extraCaution && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">{activeLayer.extraCaution}</div>
                      )}
                      {legendSummary && (legendSummary.median_value != null || legendSummary.percentile_10 != null) && (
                        <div className="text-[10px] text-muted-foreground border-t pt-1 space-y-0.5">
                          {legendSummary.percentile_10 != null && legendSummary.percentile_90 != null && (
                            <div>Current paddock range: <span className="tabular-nums text-foreground">{legendSummary.percentile_10.toFixed(2)}–{legendSummary.percentile_90.toFixed(2)}</span></div>
                          )}
                          {legendSummary.median_value != null && (
                            <div>Median: <span className="tabular-nums text-foreground">{legendSummary.median_value.toFixed(2)}</span></div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">Natural-colour Sentinel-2 image. No numerical index value.</div>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm border" style={{ background: "repeating-linear-gradient(45deg,#666,#666 2px,#999 2px,#999 4px)" }} />
                    No valid data
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white border ml-2" />
                    Cloud / shadow
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 text-[10px] text-muted-foreground border-t">
                    <div>Date</div><div className="text-right">{selectedSceneKey ?? "—"}</div>
                    <div>Provider</div><div className="text-right">Sentinel-2 L2A (CDSE)</div>
                    <div>Native resolution</div><div className="text-right">{activeLayer.nativeResM} m</div>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>

        {/* Acquisition date slider — bottom-centre, on top of the map */}
        <div
          className="absolute left-1/2 z-[540] -translate-x-1/2"
          style={{
            bottom: "96px",
            width: legendOpen ? "min(760px, calc(100% - 420px))" : "min(900px, calc(100% - 2rem))",
            minWidth: "min(520px, calc(100% - 2rem))",
          }}
        >

          {(() => {
            const scopedGroup = dateCoverage.find((g) => g.date === selectedSceneKey);
            const singlePaddock = paddockId !== "all";
            const layerAvailIds = scopedGroup?.layerCoverage?.[layer]?.available_paddock_ids;
            const scopedMissing = singlePaddock && scopedGroup
              ? (layerAvailIds ? !layerAvailIds.includes(paddockId) : !scopedGroup.sceneByPaddock.has(paddockId))
              : false;
            return (
              <div className="rounded-md bg-background/90 backdrop-blur shadow-md border">
                <SatelliteDateSlider
                  entries={dateOptions.map((d) => {
                    const group = dateCoverage.find((g) => g.date === d.date);
                    const availIds = group?.layerCoverage?.[layer]?.available_paddock_ids;
                    return {
                      date: d.date,
                      coveragePercent: d.coveragePercent,
                      paddockCount: singlePaddock
                        ? ((availIds ? availIds.includes(paddockId) : group?.sceneByPaddock.has(paddockId)) ? 1 : 0)
                        : d.paddockCount,
                      activeCount: singlePaddock ? 1 : d.activeCount,
                    };
                  })}
                  committedDate={selectedSceneKey}
                  previewDate={previewDate}
                  onPreviewChange={(d) => setPreviewDate(d)}
                  onCommit={(d) => { setPreviewDate(null); setSelectedSceneKey(d); }}
                  onInteractionStart={() => { setInteracting(true); setIsPlaying(false); }}
                  onInteractionEnd={() => setInteracting(false)}
                  isPlaying={isPlaying}
                  onTogglePlay={togglePlay}
                  totalPaddocks={singlePaddock ? 1 : totalPaddocks}
                  singlePaddockScope={singlePaddock}
                  scopedPaddockMissing={scopedMissing}
                  layerShortLabel={activeLayer.short}
                />
              </div>
            );
          })()}
        </div>

        {/* Right-side workspace drawer */}
        <MapWorkspaceDrawer
          open={drawerOpen}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={() => setDrawerOpen(false)}
          isSystemAdmin={isSystemAdmin}
          details={detailsPanel}
          history={historyPanel}
          admin={adminPanel}
        />
      </div>
    </div>
  );
}

// ---------- Compact saved-imagery history ----------
type HistoryFilter = "all" | "full" | "partial";
type HistoryEntry = { date: string; coveragePercent: number; paddockCount: number; activeCount: number };

function SavedImageryHistory({
  entries,
  committedDate,
  onSelectDate,
  totalPaddocks,
}: {
  entries: HistoryEntry[];
  committedDate: string | null;
  onSelectDate: (date: string) => void;
  totalPaddocks: number;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [monthOffset, setMonthOffset] = useState(0);

  const isFull = (e: HistoryEntry) => {
    const total = e.activeCount || totalPaddocks || 1;
    return e.paddockCount >= total && e.paddockCount > 0;
  };
  const passesFilter = useCallback((e: HistoryEntry) => {
    if (filter === "all") return true;
    return filter === "full" ? isFull(e) : !isFull(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, totalPaddocks]);

  // Group by month, newest first.
  const monthGroups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const key = e.date.slice(0, 7);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    const list = Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([ym, arr]) => {
        arr.sort((a, b) => b.date.localeCompare(a.date));
        const full = arr.filter(isFull).length;
        const partial = arr.length - full;
        return { ym, entries: arr, full, partial };
      });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, totalPaddocks]);

  const filteredMonths = useMemo(
    () => monthGroups
      .map((m) => ({ ...m, entries: m.entries.filter(passesFilter) }))
      .filter((m) => m.entries.length > 0),
    [monthGroups, passesFilter],
  );

  const PAGE = 6;
  const total = filteredMonths.length;
  const start = Math.max(0, Math.min(monthOffset, Math.max(0, total - PAGE)));
  const visible = filteredMonths.slice(start, start + PAGE);

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  };
  const fmtDate = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });

  const toggleMonth = (ym: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym); else next.add(ym);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-semibold">Saved imagery</CardTitle>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter saved imagery">
          {(["all", "full", "partial"] as HistoryFilter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "secondary" : "ghost"}
              className="h-7 px-2 text-[11px]"
              onClick={() => { setFilter(f); setMonthOffset(0); }}
              aria-pressed={filter === f}
            >
              {f === "all" ? "All captures" : f === "full" ? "Full coverage" : "Partial coverage"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.length === 0 ? (
          <div className="text-xs text-muted-foreground">No saved captures match the selected filter.</div>
        ) : (
          visible.map(({ ym, entries: monthEntries, full, partial }) => {
            const isOpen = expanded.has(ym);
            return (
              <div key={ym} className="rounded-md border bg-muted/10">
                <button
                  type="button"
                  onClick={() => toggleMonth(ym)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                  aria-expanded={isOpen}
                  aria-controls={`month-${ym}`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">{monthLabel(ym)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {monthEntries.length} capture{monthEntries.length === 1 ? "" : "s"}
                      {full > 0 && <> · {full} full coverage</>}
                      {partial > 0 && <> · {partial} partial</>}
                    </div>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                </button>
                {isOpen && (
                  <div id={`month-${ym}`} className="border-t divide-y">
                    {monthEntries.map((e) => {
                      const sel = e.date === committedDate;
                      const total = e.activeCount || totalPaddocks || 1;
                      const covers = isFull(e)
                        ? `All ${total} paddock${total === 1 ? "" : "s"}`
                        : `${e.paddockCount} of ${total} paddock${total === 1 ? "" : "s"}`;
                      return (
                        <button
                          type="button"
                          key={e.date}
                          onClick={() => onSelectDate(e.date)}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[11px] ${sel ? "bg-primary/10" : "hover:bg-muted/40"}`}
                          aria-current={sel ? "date" : undefined}
                        >
                          <span className="font-medium text-foreground">{fmtDate(e.date)}</span>
                          <span className="text-muted-foreground">{covers}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
        {total > PAGE && (
          <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={start <= 0}
              onClick={() => setMonthOffset(Math.max(0, start - PAGE))}
            >
              Newer months
            </Button>
            <span>
              Showing {start + 1}–{Math.min(start + PAGE, total)} of {total} months
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={start + PAGE >= total}
              onClick={() => setMonthOffset(start + PAGE)}
            >
              Older months
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}




