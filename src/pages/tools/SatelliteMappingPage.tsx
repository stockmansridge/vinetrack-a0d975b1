import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Info, RefreshCw, Satellite as SatelliteIcon, ChevronDown, Loader2 } from "lucide-react";
import { fromArrayBuffer } from "geotiff";
import SatelliteMap from "@/components/SatelliteMap";

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
  describePaddockMissingItems,
  REQUIRED_INDICES,
  CURRENT_PROCESSING_VERSION,
  type CompletenessReport,
  type PaddockCompleteness,
} from "@/lib/satelliteCompleteness";
import { fetchManifest } from "@/lib/satelliteManifest";

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

const assetKind = (a: DBAsset) => a.asset_type ?? (a.storage_path.endsWith(".png") ? "DISPLAY_RASTER" : "ANALYTICAL_RASTER");
const analyticalCacheKey = (paddockId: string, sceneId: string, indexType: SatelliteIndexType, processingVersion: string | null | undefined) =>
  `${paddockId}:${sceneId}:${indexType}:${processingVersion ?? "unknown"}`;

function parseSatelliteFunctionError(error: any): { code: string | null; providerStatus: number | null; message: string } {
  const fallback = String(error?.message ?? error ?? "Unknown error");
  const raw = error?.details ?? error?.context ?? fallback;
  if (typeof raw === "object" && raw) {
    if (raw instanceof Response) return { code: null, providerStatus: raw.status, message: fallback };
    return {
      code: raw.code ?? null,
      providerStatus: raw.provider_status ?? null,
      message: raw.error ?? raw.message ?? fallback,
    };
  }
  const text = String(raw);
  const match = text.match(/\{.*\}$/s);
  if (!match) return { code: null, providerStatus: null, message: fallback };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      code: parsed.code ?? null,
      providerStatus: parsed.provider_status ?? null,
      message: parsed.error ?? parsed.message ?? fallback,
    };
  } catch {
    return { code: null, providerStatus: null, message: fallback };
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

const STALE_DAYS = 3;

function computeStalePaddockIds(
  paddockIds: string[],
  scenes: DBScene[],
  assets: DBAsset[],
  layer: SatelliteIndexType,
): string[] {
  const cutoff = Date.now() - STALE_DAYS * 86400_000;
  // Newest completed scene per paddock.
  const newestByPad = new Map<string, DBScene>();
  for (const s of scenes) {
    if (s.processing_status !== "complete") continue;
    const cur = newestByPad.get(s.paddock_id);
    if (!cur || s.acquired_at > cur.acquired_at) newestByPad.set(s.paddock_id, s);
  }
  const analyticalBySceneLayer = new Set<string>();
  for (const a of assets) {
    const kind = a.asset_type ?? (a.storage_path.endsWith(".png") ? "DISPLAY_RASTER" : "ANALYTICAL_RASTER");
    if (kind === "ANALYTICAL_RASTER" && a.index_type === layer) {
      analyticalBySceneLayer.add(a.satellite_scene_id);
    }
  }
  const stale: string[] = [];
  for (const pid of paddockIds) {
    const s = newestByPad.get(pid);
    if (!s) { stale.push(pid); continue; }
    const acqMs = new Date(s.acquired_at).getTime();
    if (Number.isFinite(acqMs) && acqMs < cutoff) { stale.push(pid); continue; }
    if (layer !== "TRUE_COLOUR" && !analyticalBySceneLayer.has(s.id)) { stale.push(pid); continue; }
  }
  return stale;
}

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
  const [legendOpen, setLegendOpen] = useState<boolean>(true);
  const [selectedSceneKey, setSelectedSceneKey] = useState<string | null>(null); // YYYY-MM-DD acquisition date
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({}); // asset_id -> signed URL
  const [searchError, setSearchError] = useState<SatelliteSearchError | null>(null);
  const [rasterCacheVersion, setRasterCacheVersion] = useState(0);
  const analyticalCacheRef = useRef(new Map<string, DecodedAnalyticalRaster | Promise<DecodedAnalyticalRaster> | { error: string }>());

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

  // Batch progress for All-Paddocks processing.
  type PadStatus = "queued" | "searching" | "processing" | "complete" | "insufficient_coverage" | "rate_limited" | "failed" | "skipped";
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    done: number;
    statuses: Record<string, PadStatus>;
  } | null>(null);

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

  // Processed scenes for this vineyard/paddock
  const scenesQuery = useQuery({
    queryKey: ["satellite-scenes", activeVineyardId, paddockId],
    enabled: !!activeVineyardId && isSystemAdmin,
    queryFn: async () => {
      const { data, error } = await invokeSatelliteFn("satellite-list-scenes", {
        vineyard_id: activeVineyardId,
        paddock_id: paddockId,
      });
      if (error) throw error;
      return data as { scenes: DBScene[]; assets: DBAsset[]; summaries: DBSummary[] };
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Server manifest — source of truth for per-paddock completeness and the
  // date-coverage index. Declared here (before dateCoverage) so both memos
  // can consume it.
  const activePaddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);
  const manifestQuery = useQuery({
    queryKey: ["satellite-manifest", activeVineyardId, activePaddockIds.join(",")],
    queryFn: () => fetchManifest(activeVineyardId!, activePaddockIds),
    enabled: !!activeVineyardId,
    staleTime: 30_000,
  });

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
        };
      });
    }
    // Fallback: client-side reconstruction from scenesQuery.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[SatelliteMappingPage] Falling back to client-side date coverage; server date_coverage not present.");
    }
    const scenes = scenesQuery.data?.scenes ?? [];
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
      }));
  }, [manifestQuery.data, scenesQuery.data, activeVineyardId, geoms]);

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
    const pct = g.coveragePercent;
    const pctLabel = Number.isInteger(pct) ? `${pct}` : pct.toFixed(1);
    return {
      date: g.date,
      scenes: Array.from(g.sceneByPaddock.values()),
      paddockCount: g.paddockCount,
      activeCount: g.activeCount,
      coveragePercent: pct,
      label: `${formatDate(g.date)} · ${pctLabel}% coverage · ${g.paddockCount} of ${g.activeCount || totalPaddocks} paddocks`,
    };
  }), [dateCoverage, totalPaddocks]);

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

  // Persist user selection per vineyard so revisits keep the same date/layer.
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
    try {
      const saved = localStorage.getItem(`crop-health:layer:${activeVineyardId}`);
      if (saved) setLayer(saved as SatelliteIndexType);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVineyardId]);

  // Assets for the currently selected date + layer. Uses the best scene per
  // paddock for that date (see dateCoverage). Never mixes dates.
  const activeAssetPairs = useMemo(() => {
    if (!selectedSceneKey || !scenesQuery.data) return [];
    const { assets } = scenesQuery.data;
    const displayFor = (sceneId: string) => assets.find((x) =>
      x.satellite_scene_id === sceneId &&
      x.index_type === layer &&
      assetKind(x) === "DISPLAY_RASTER"
    );
    const analyticalFor = (sceneId: string) => assets.find((x) =>
      x.satellite_scene_id === sceneId &&
      x.index_type === layer &&
      assetKind(x) === "ANALYTICAL_RASTER"
    );
    const group = dateCoverage.find((g) => g.date === selectedSceneKey);
    if (!group) return [];
    const out: Array<{ displayAsset: DBAsset; analyticalAsset?: DBAsset; scene: DBScene }> = [];
    for (const scene of group.sceneByPaddock.values()) {
      const displayAsset = displayFor(scene.id);
      if (displayAsset) out.push({ displayAsset, analyticalAsset: analyticalFor(scene.id), scene });
    }
    return out;
  }, [scenesQuery.data, selectedSceneKey, layer, dateCoverage]);

  const activeAssets = useMemo(
    () => activeAssetPairs.map(({ displayAsset, scene }) => ({ asset: displayAsset, scene })),
    [activeAssetPairs],
  );

  const activeAnalyticalAssets = useMemo(
    () => activeAssetPairs
      .filter((x) => x.analyticalAsset)
      .map(({ analyticalAsset, scene }) => ({ asset: analyticalAsset!, scene })),
    [activeAssetPairs],
  );

  // Fetch signed URLs for visible assets. Signed URLs live ~10 min server-side;
  // route through React Query so they survive route changes within their TTL
  // and don't get re-signed on every page mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const { asset } of [...activeAssets, ...activeAnalyticalAssets]) {
        if (signedUrls[asset.id]) continue;
        try {
          const signed_url = await qc.fetchQuery({
            queryKey: ["satellite-signed-url", asset.id],
            queryFn: async () => {
              const { data, error } = await invokeSatelliteFn("satellite-get-asset-url", {
                asset_id: asset.id,
              });
              if (error) throw error;
              return (data as any)?.signed_url as string;
            },
            staleTime: 8 * 60_000,
            gcTime: 10 * 60_000,
          });
          if (!cancelled && signed_url) {
            setSignedUrls((prev) => ({ ...prev, [asset.id]: signed_url }));
          }
        } catch (e) {
          console.error("sign url failed", e);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssets, activeAnalyticalAssets]);

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
      if (existing) return;

      const promise = (async (): Promise<DecodedAnalyticalRaster> => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Analytical raster fetch failed (${res.status})`);
        const tiff = await fromArrayBuffer(await res.arrayBuffer());
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
      setRasterCacheVersion((v) => v + 1);
      try {
        const decoded = await promise;
        if (cancelled) return;
        analyticalCacheRef.current.set(key, decoded);
      } catch (e: any) {
        if (cancelled) return;
        analyticalCacheRef.current.set(key, { error: String(e?.message ?? e) });
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
    if (!scenesQuery.data || !selectedSceneKey) return map;
    const relevantScenes = scenesQuery.data.scenes.filter(
      (s) => s.acquired_at.slice(0, 10) === selectedSceneKey,
    );
    const bySceneId = new Map(relevantScenes.map((s) => [s.id, s]));
    for (const sum of scenesQuery.data.summaries) {
      if (sum.index_type !== layer) continue;
      const scene = bySceneId.get(sum.satellite_scene_id);
      if (scene) map.set(scene.paddock_id, sum);
    }
    return map;
  }, [scenesQuery.data, selectedSceneKey, layer, activeAssets]);


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

  // Pointer-move handler — no network request; reads the cached analytical raster.
  const handlePointerMove = (pt: { lat: number; lng: number; x: number; y: number } | null) => {
    if (!pt) {
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

      // Build completeness against currently-loaded scenes/assets/summaries.
      const scenesForReport = scenesQuery.data?.scenes ?? [];
      const assetsForReport = scenesQuery.data?.assets ?? [];
      const summariesForReport = scenesQuery.data?.summaries ?? [];
      const report = inspectCompleteness({
        paddocks: geoms.map((g) => ({ id: g.id, name: g.name })),
        scenes: scenesForReport,
        assets: assetsForReport,
        summaries: summariesForReport,
      });

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
        setBatchProgress(null);
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

      // Seed batch progress. Complete paddocks are shown as skipped so users
      // can see exactly what was NOT reprocessed.
      const initialStatuses: Record<string, PadStatus> = {};
      for (const p of inScopeAll) initialStatuses[p.paddockId] = p.state === "complete" ? "skipped" : "queued";
      setBatchProgress({ total: inScopeNeedingWork.length, done: 0, statuses: initialStatuses });

      const setPad = (pid: string, s: PadStatus) => setBatchProgress((prev) => prev
        ? { ...prev, statuses: { ...prev.statuses, [pid]: s } }
        : prev);
      const bumpDone = () => setBatchProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);

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
            setPad(pid, "rate_limited"); bumpDone(); return;
          }
          setSearchError((prev) => prev ?? { code: parsed.code, providerStatus: parsed.providerStatus, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: parsed.message });
          results.push({ paddock_id: pid, status: "failed", message: parsed.message });
          setPad(pid, "failed"); bumpDone(); return;
        }
        const candidates: any[] = (search.data as any)?.candidates ?? [];
        if (candidates.length === 0) {
          results.push({ paddock_id: pid, status: "no_scenes", message: "No scenes found" });
          setPad(pid, "failed"); bumpDone(); return;
        }
        const sorted = [...candidates].sort((a, b) => {
          const ca = Number(a?.scene_cloud_cover_pct ?? 100);
          const cb = Number(b?.scene_cloud_cover_pct ?? 100);
          const ap = ca <= 20 ? 0 : 1; const bp = cb <= 20 ? 0 : 1;
          if (ap !== bp) return ap - bp;
          if (ca !== cb) return ca - cb;
          return String(b?.acquired_at ?? "").localeCompare(String(a?.acquired_at ?? ""));
        });

        setPad(pid, "processing");
        let finalStatus: ResultStatus = "failed";
        let finalMsg = "Processing did not complete.";
        const maxTries = Math.min(4, sorted.length);
        for (let i = 0; i < maxTries; i++) {
          const c = sorted[i];
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
            if (parsed.code === "rate_limited") {
              finalStatus = "rate_limited"; stopQueue = true;
              setSearchError((prev) => prev ?? { code: parsed.code, providerStatus: parsed.providerStatus, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: finalMsg });
              break;
            }
            continue;
          }
          const procStatus = String((process.data as any)?.status ?? "");
          if (procStatus === "complete") { finalStatus = "complete"; break; }
          if (procStatus === "partial") { finalStatus = "partial"; finalMsg = "Some layers were skipped."; break; }
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
        setPad(pid, finalStatus === "complete" || finalStatus === "partial" ? "complete"
          : finalStatus === "insufficient_coverage" ? "insufficient_coverage"
          : finalStatus === "rate_limited" ? "rate_limited"
          : "failed");
        bumpDone();
      }

      async function repairScene(p: PaddockCompleteness): Promise<void> {
        const pid = p.paddockId;
        const targetPaddock = geoms.find((g) => g.id === pid);
        if (!p.latestProviderSceneId || !p.latestAcquiredAt) {
          // Should be unreachable — repair states always carry a latest scene.
          results.push({ paddock_id: pid, status: "failed", message: "No latest scene to repair." });
          setPad(pid, "failed"); bumpDone(); return;
        }
        setPad(pid, "processing");
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
          if (parsed.code === "rate_limited") {
            stopQueue = true;
            setSearchError((prev) => prev ?? { code: parsed.code, providerStatus: parsed.providerStatus, paddockId: pid, paddockName: targetPaddock?.name ?? null, message: msg });
            results.push({ paddock_id: pid, status: "rate_limited", message: msg });
            setPad(pid, "rate_limited"); bumpDone(); return;
          }
          results.push({ paddock_id: pid, status: "failed", message: msg });
          setPad(pid, "failed"); bumpDone(); return;
        }
        const procStatus = String((process.data as any)?.status ?? "");
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
        setPad(pid, finalStatus === "complete" || finalStatus === "partial" ? "complete"
          : finalStatus === "rate_limited" ? "rate_limited" : "failed");
        bumpDone();
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

      // Refresh + wait for the list query to reflect any new scenes.
      let loaded = false;
      let latestScenes: DBScene[] = scenesQuery.data?.scenes ?? [];
      let latestAssets: DBAsset[] = scenesQuery.data?.assets ?? [];
      let latestSummaries: DBSummary[] = scenesQuery.data?.summaries ?? [];
      for (let i = 0; i < 3 && complete > 0 && !loaded; i++) {
        await qc.invalidateQueries({ queryKey: ["satellite-scenes"] });
        await qc.invalidateQueries({ queryKey: ["satellite-manifest", activeVineyardId] });
        const refreshed = await qc.refetchQueries({ queryKey: ["satellite-scenes", activeVineyardId, paddockId] });
        const anyData = refreshed?.[0]?.data as { scenes?: DBScene[]; assets?: DBAsset[]; summaries?: DBSummary[] } | undefined;
        if ((anyData?.scenes ?? []).some((s) => s.processing_status === "complete")) {
          loaded = true;
          latestScenes = anyData?.scenes ?? [];
          latestAssets = anyData?.assets ?? [];
          latestSummaries = anyData?.summaries ?? [];
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Auto-select the newest date the refresh just produced (if any).
      if (complete > 0) {
        const newestDate = (latestScenes ?? [])
          .filter((s) => s.processing_status === "complete")
          .map((s) => s.acquired_at.slice(0, 10))
          .sort()
          .pop();
        if (newestDate) setSelectedSceneKey(newestDate);
      }

      // Auto-retry once for any paddocks that are still incomplete after this pass.
      if (!isRetry && rateLimited === 0) {
        const nextReport = inspectCompleteness({
          paddocks: geoms.map((g) => ({ id: g.id, name: g.name })),
          scenes: latestScenes,
          assets: latestAssets,
          summaries: latestSummaries,
        });
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
      await qc.invalidateQueries({ queryKey: ["satellite-scenes"] });
      await qc.invalidateQueries({ queryKey: ["satellite-manifest", activeVineyardId] });
      await qc.refetchQueries({ queryKey: ["satellite-scenes", activeVineyardId, paddockId] });
      analyticalCacheRef.current.clear();
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


  // Live completeness snapshot for the diagnostics panel and the
  // "Imagery missing" chip in Latest-per-paddock mode. Prefers the server
  // manifest so counts always match what's actually stored; falls back to the
  // legacy client-side recount if the manifest hasn't loaded yet.
  const liveReport: CompletenessReport = useMemo(() => {
    const paddockInputs = geoms.map((g) => ({ id: g.id, name: g.name }));
    const manifestRows = manifestQuery.data?.paddocks;
    if (manifestRows && manifestRows.length > 0) {
      return reportFromManifest(paddockInputs, manifestRows);
    }
    return inspectCompleteness({
      paddocks: paddockInputs,
      scenes: scenesQuery.data?.scenes ?? [],
      assets: scenesQuery.data?.assets ?? [],
      summaries: scenesQuery.data?.summaries ?? [],
    });
  }, [geoms, manifestQuery.data, scenesQuery.data]);
  const [missingDetailOpen, setMissingDetailOpen] = useState(false);
  const paddocksMissingLatestSet = useMemo(
    () => new Set(liveReport.perPaddock.filter((p) => p.state === "missing_latest_scene").map((p) => p.paddockId)),
    [liveReport],
  );

  // ---------- Guards ----------
  if (adminLoading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isSystemAdmin) return <Navigate to="/dashboard" replace />;

  const busy = checkForNewImage.isPending;
  const isRetryPass = busy && retryInFlightRef.current;
  const refreshLabel = busy
    ? (isRetryPass
        ? "Retrying skipped…"
        : (batchProgress ? `Refreshing ${Math.min(batchProgress.done + 1, batchProgress.total)} / ${batchProgress.total}…` : "Refreshing…"))
    : "Refresh Imagery";

  // Summary for the currently hovered paddock (used to build the tooltip's
  // paddock-relative interpretation and to show the current-scene range/median
  // in the legend).
  const hoverSummary = hover?.paddockId ? summaryByPaddock.get(hover.paddockId) : undefined;
  const legendSummary = hoverSummary ?? (summaryByPaddock.size === 1 ? Array.from(summaryByPaddock.values())[0] : undefined);




  return (
    <div className="w-full p-2 md:p-3 space-y-3 flex flex-col">
      {/* Compact header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-md bg-amber-500/15 p-1.5 text-amber-600 dark:text-amber-400">
            <SatelliteIcon className="h-4 w-4" />
          </div>
          <h1 className="text-lg font-semibold truncate">Crop Health Maps</h1>
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px]">
            System Admin · Beta
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || backfillLayers.isPending || !activeVineyardId}
            onClick={() => backfillLayers.mutate()}
            title="Generate any missing display / analytical / summary assets on already-stored scenes. Skips complete outputs."
          >
            {backfillLayers.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <SatelliteIcon className="h-3.5 w-3.5 mr-1.5" />}
            {backfillLayers.isPending ? "Repairing…" : "Repair Missing Assets"}
          </Button>
          <Button
            size="sm"
            disabled={busy || geoms.length === 0}
            onClick={() => checkForNewImage.mutate(undefined)}
            title="Search Copernicus for newer imagery. Skipped when a check ran within the last 5 days."
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {refreshLabel}
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
      </div>


      {searchError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Crop Health Maps search failed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              VineTrack could not search Copernicus imagery. The existing vineyard map remains available.
            </p>
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div>
                <div className="font-medium text-foreground">Error code</div>
                <div>{searchError.code ?? "—"}</div>
              </div>
              <div>
                <div className="font-medium text-foreground">Provider status</div>
                <div>{searchError.providerStatus ?? "—"}</div>
              </div>
              <div>
                <div className="font-medium text-foreground">Paddock</div>
                <div>{searchError.paddockName ?? searchError.paddockId ?? "—"}</div>
              </div>
            </div>
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

      {/* Map + controls — side-by-side on desktop, stacked on mobile */}
      <div className="flex flex-col lg:flex-row gap-3 lg:h-[calc(100vh-9rem)] lg:min-h-[520px]">
      {/* Toolbar */}
      <Card className="relative z-30 order-2 lg:order-2 w-full lg:w-[360px] lg:shrink-0 lg:overflow-y-auto">
        <CardContent className="p-3 md:p-4">

          <div
            className="grid gap-3 items-end"
            style={{
              gridTemplateColumns:
                "repeat(auto-fit, minmax(180px, 1fr))",
            }}
          >
            {/* Vineyard */}
            <div className="space-y-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground">Vineyard</label>
              <Select value={activeVineyardId ?? ""} onValueChange={(v) => { setVineyardId(v); setPaddockId("all"); setSelectedSceneKey(null); }}>
                <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Select vineyard" /></SelectTrigger>
                <SelectContent>
                  {memberships.map((m) => (
                    <SelectItem key={m.vineyard_id} value={m.vineyard_id}>
                      {m.vineyard_name ?? m.vineyard_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Paddock */}
            <div className="space-y-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground">Paddock</label>
              <Select value={paddockId} onValueChange={(v) => { setPaddockId(v); setSelectedSceneKey(null); }}>
                <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Paddocks</SelectItem>
                  {geoms.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Image date */}
            <div className="space-y-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground">Image Date</label>
              <Select
                value={selectedSceneKey ?? ""}
                onValueChange={setSelectedSceneKey}
                disabled={dateOptions.length === 0}
              >
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder={dateOptions.length ? "Select date" : "No saved imagery"} />
                </SelectTrigger>
                <SelectContent>
                  {dateOptions.map((d) => {
                    const pctLabel = Number.isInteger(d.coveragePercent)
                      ? `${d.coveragePercent}`
                      : d.coveragePercent.toFixed(1);
                    return (
                      <SelectItem key={d.date} value={d.date}>
                        {formatDate(d.date)} · {pctLabel}% coverage · {d.paddockCount}/{d.activeCount || totalPaddocks} paddocks
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>


            {/* Map Layer */}
            <div className="space-y-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                Map Layer
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      {activeLayer.description}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </label>
              <Select value={layer} onValueChange={(v) => setLayer(v as SatelliteIndexType)}>
                <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-[420px]">
                  {LAYER_GROUPS.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </SelectLabel>
                      {group.ids.map((id) => {
                        const l = LAYERS.find((x) => x.id === id);
                        if (!l) return null;
                        return (
                          <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                        );
                      })}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Opacity — must fit inside its own grid cell */}
            <div className="min-w-0 space-y-2">
              <label className="text-xs font-medium text-muted-foreground block">
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
              <div className="flex min-w-0 flex-wrap gap-1">
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(20)}>20%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(65)}>65%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(95)}>95%</Button>
              </div>
            </div>
          </div>



          {/* Batch progress */}
          {busy && (
            <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs space-y-2">
              <div className="font-medium text-foreground">
                {isRetryPass
                  ? "Retrying skipped paddocks…"
                  : batchProgress
                    ? `Checking imagery for ${Math.min(batchProgress.done + 1, batchProgress.total)} of ${batchProgress.total} paddocks…`
                    : "Preparing…"}
              </div>
              {batchProgress && (
                <>
                  <Progress
                    value={batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}
                    className="h-1.5"
                  />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                    <span>Completed: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "complete").length}</span></span>
                    <span>Processing: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "processing" || s === "searching").length}</span></span>
                    <span>Too cloudy: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "insufficient_coverage").length}</span></span>
                    <span>Provider paused: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "rate_limited").length}</span></span>
                    <span>Failed: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "failed").length}</span></span>
                    <span>Queued: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "queued").length}</span></span>
                  </div>
                </>
              )}
            </div>
          )}


          {/* Layer description panel */}
          <div className="mt-3 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold text-foreground">{activeLayer.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{activeLayer.description}</div>
            <div className="text-[11px] text-muted-foreground mt-2 italic">
              Native input resolution: {activeLayer.nativeResM} m{activeLayer.resamplingNote ? " (20 m native data, resampled for display; resampling does not improve real ground resolution)" : ""}. {LAYER_DISCLAIMER}
            </div>
            {layer === "PSRI" && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                {PSRI_CAUTION}
              </div>
            )}
            {selectedSceneKey && (() => {
              const group = dateCoverage.find((g) => g.date === selectedSceneKey);
              const missing = group
                ? geoms.filter((g) => !group.sceneByPaddock.has(g.id))
                : geoms;
              if (missing.length === 0) return null;
              return (
                <div className="text-[11px] text-muted-foreground mt-2 space-y-1">
                  <div>
                    No imagery saved for {formatDate(selectedSceneKey)} on these paddocks. Their outlines remain on the map; other dates may be available.
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {missing.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>


          {/* System-admin diagnostics — imagery completeness */}
          <div className="mt-3 rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-2">
            <div className="text-xs font-semibold text-foreground">Imagery completeness</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1">
              <div>Active paddocks: <span className="text-foreground">{liveReport.totals.totalPaddocks}</span></div>
              <div>With saved imagery: <span className="text-foreground">{liveReport.perPaddock.filter((p) => p.hasSavedDisplayImagery).length}</span></div>
              <div>No saved imagery: <span className="text-foreground">{liveReport.perPaddock.filter((p) => !p.hasSavedDisplayImagery).length}</span></div>
              <div>Complete packages: <span className="text-foreground">{liveReport.totals.completePaddocks}</span></div>
              <div>Partial packages: <span className="text-foreground">{liveReport.totals.incompletePaddocks}</span></div>
              <div>Refresh needed (stale): <span className="text-foreground">{liveReport.perPaddock.filter((p) => p.state === "missing_latest_scene" && p.hasSavedDisplayImagery).length}</span></div>
              <div>Old processing version: <span className="text-foreground">{liveReport.totals.oldVersionPaddocks}</span></div>
              <div>Missing display: <span className="text-foreground">{liveReport.totals.missingDisplay}</span></div>
              <div>Missing analytical: <span className="text-foreground">{liveReport.totals.missingAnalytical}</span></div>
              <div>Missing summaries: <span className="text-foreground">{liveReport.totals.missingSummaries}</span></div>

              {lastRefreshSummary && (
                <>
                  <div>Last refresh — processed: <span className="text-foreground">{lastRefreshSummary.processedPaddocks}</span></div>
                  <div>Last refresh — skipped: <span className="text-foreground">{lastRefreshSummary.skippedPaddocks}</span></div>
                  <div>Provider calls avoided: <span className="text-foreground">{lastRefreshSummary.providerCallsAvoided}</span></div>
                </>
              )}
            </div>
            <div className="pt-1 border-t grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[10px]">
              <div>Processing version: <span className="text-foreground">{CURRENT_PROCESSING_VERSION}</span></div>
              <div>Selected date: <span className="text-foreground">{selectedSceneKey ?? "—"}</span></div>
              <div>Selected layer: <span className="text-foreground">{layer}</span></div>
              <div>Signed URL: <span className="text-foreground">{activeAssets[0] && signedUrls[activeAssets[0].asset.id] ? "loaded" : "—"}</span></div>
            </div>
            <Collapsible open={missingDetailOpen} onOpenChange={setMissingDetailOpen}>
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-[11px] text-foreground/80 hover:text-foreground">
                <ChevronDown className={`h-3 w-3 transition-transform ${missingDetailOpen ? "" : "-rotate-90"}`} />
                Show missing item detail
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 max-h-56 overflow-y-auto space-y-1 rounded-sm bg-background/60 p-2">
                  {liveReport.perPaddock.length === 0 && (
                    <div className="text-[10px]">No paddocks with valid boundaries.</div>
                  )}
                  {liveReport.perPaddock.map((p) => (
                    <div key={p.paddockId} className="text-[11px] leading-tight">
                      <span className="font-medium text-foreground">{p.paddockName}</span>
                      <span className={`ml-1 ${p.state === "complete" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                        — {describePaddockMissingItems(p).join("; ")}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </CardContent>
      </Card>


      {/* Map */}
      <Card className="overflow-hidden order-1 lg:order-1 flex-1 min-w-0 lg:h-full">
        <CardContent className="p-0 relative h-full">
          <div className="h-[65vh] lg:h-full w-full relative">

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
                className="h-full w-full"
                paddocks={visibleGeoms.map((g) => ({
                  id: g.id,
                  name: g.name,
                  polys: g.polys,
                  color: paddockColor(g.id),
                }))}
                selectedPaddockId={paddockId === "all" ? null : paddockId}
                overlays={activeAssets
                  .filter(({ asset }) => asset.bounds && signedUrls[asset.id])
                  .map(({ asset, scene }) => ({
                    paddockId: scene.paddock_id,
                    url: signedUrls[asset.id],
                    bounds: asset.bounds!,
                    opacity: opacity / 100,
                  }))}
                overlayOpacity={opacity / 100}
                cellRect={hover?.cellRect ?? null}
                onPaddockClick={(id) => setPaddockId(id)}
                onPointerMove={handlePointerMove}
              />
            )}

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
                    <span className="text-muted-foreground">No processed image for this paddock</span>
                  ) : hover.status === "loading" ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> {hover.message ?? "Loading cell data…"}
                    </span>
                  ) : hover.status === "missing_analytical" ? (
                    <>
                      <div className="text-muted-foreground">{hover.message}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 italic">
                        Use “Refresh Imagery” above.
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
                          <div className="text-sm font-medium text-foreground tabular-nums">
                            Cell value: {value.toFixed(2)}
                          </div>
                          <div className="text-[11px] font-semibold text-foreground mt-0.5">
                            {meaning}
                          </div>
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




            {/* Legend */}
            <div className="absolute bottom-3 right-3 z-[500] w-72 max-w-[92%]">
              <Collapsible open={legendOpen} onOpenChange={setLegendOpen}>
                <div className="rounded-md border bg-background/95 backdrop-blur shadow-md">
                  <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      Legend — {activeLayer.short}
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
                            <div>
                              <div className="font-semibold">What it shows</div>
                              <div className="text-muted-foreground">{activeLayer.infoWhat}</div>
                            </div>
                            <div>
                              <div className="font-semibold">Lower values</div>
                              <div className="text-muted-foreground">{activeLayer.infoLow}</div>
                            </div>
                            <div>
                              <div className="font-semibold">Higher values</div>
                              <div className="text-muted-foreground">{activeLayer.infoHigh}</div>
                            </div>
                            <div>
                              <div className="font-semibold">Native resolution</div>
                              <div className="text-muted-foreground">{activeLayer.nativeResM} m</div>
                            </div>
                            <div>
                              <div className="font-semibold">Important</div>
                              <div className="text-muted-foreground">{activeLayer.infoImportant}</div>
                            </div>
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
                          <div className="text-[10px] text-muted-foreground leading-snug">
                            {activeLayer.legendNote}
                          </div>
                          {activeLayer.extraCaution && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
                              {activeLayer.extraCaution}
                            </div>
                          )}
                          {legendSummary && (legendSummary.median_value != null || legendSummary.percentile_10 != null) && (
                            <div className="text-[10px] text-muted-foreground border-t pt-1 space-y-0.5">
                              {legendSummary.percentile_10 != null && legendSummary.percentile_90 != null && (
                                <div>
                                  Current paddock range:{" "}
                                  <span className="tabular-nums text-foreground">
                                    {legendSummary.percentile_10.toFixed(2)}–{legendSummary.percentile_90.toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {legendSummary.median_value != null && (
                                <div>
                                  Median: <span className="tabular-nums text-foreground">{legendSummary.median_value.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-[10px] text-muted-foreground">
                          Natural-colour Sentinel-2 image. No numerical index value.
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm border" style={{ background: "repeating-linear-gradient(45deg,#666,#666 2px,#999 2px,#999 4px)" }} />
                        No valid data
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white border ml-2" />
                        Cloud / shadow
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 text-[10px] text-muted-foreground border-t">
                        <div>Date</div>
                        <div className="text-right">{selectedSceneKey ?? "—"}</div>
                        <div>Provider</div>
                        <div className="text-right">Sentinel-2 L2A (CDSE)</div>
                        <div>Native resolution</div>
                        <div className="text-right">{activeLayer.nativeResM} m</div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </div>

          </div>
        </CardContent>
      </Card>
      </div>

      {/* Timeline */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Image History — Last 12 Months</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-12 gap-1.5">
            {Array.from({ length: 12 }).map((_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - (11 - i));
              const label = d.toLocaleDateString(undefined, { month: "short" });
              const monthKey = d.toISOString().slice(0, 7);
              const monthScenes = (scenesQuery.data?.scenes ?? []).filter((s) => s.acquired_at.slice(0, 7) === monthKey && s.processing_status === "complete");
              return (
                <div key={i} className="rounded border border-dashed bg-muted/20 p-2 text-center text-[10px] text-muted-foreground">
                  <div className="font-medium text-foreground/70">{label}</div>
                  <div className="mt-1">{monthScenes.length > 0 ? `${monthScenes.length} scene${monthScenes.length === 1 ? "" : "s"}` : "—"}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {(scenesQuery.data?.scenes.length ?? 0) === 0
              ? "No satellite scenes have been processed for this vineyard yet. Click Refresh Imagery."
              : "Hover a paddock on the map for its per-paddock summary; select a date above to switch scenes."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
