import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Info, RefreshCw, Satellite as SatelliteIcon, ChevronDown, Loader2 } from "lucide-react";
import { fromArrayBuffer } from "geotiff";
import SatelliteMap from "@/components/SatelliteMap";

import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { fetchList } from "@/lib/queries";
import { parsePolygonPoints, LatLng } from "@/lib/paddockGeometry";
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
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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

// ---------- Layer definitions ----------
type LayerOption = {
  id: SatelliteIndexType;
  label: string;
  short: string;
  description: string;
  nativeResM: number;
  resamplingNote: boolean;
  legend: string[];
  legendLow: string;
  legendHigh: string;
};

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

const LAYERS: LayerOption[] = [
  {
    id: "TRUE_COLOUR", label: "Satellite Image", short: "True colour", nativeResM: 10, resamplingNote: false,
    description: "A natural-colour view of the vineyard from the selected Sentinel-2 capture. Uses native 10 m visible bands.",
    legend: ["#3b2f1e", "#7a6a48", "#c7b98a", "#e9e2c7", "#ffffff"],
    legendLow: "Darker", legendHigh: "Brighter",
  },
  {
    id: "NDVI", label: "NDVI — General Vine Vigour", short: "NDVI", nativeResM: 10, resamplingNote: false,
    description: "Overall canopy vigour. Uses native 10 m red (B04) and near-infrared (B08) data.",
    legend: ["#8b3a2b", "#c98a3f", "#e6d36a", "#7ec26b", "#1e6b2e"],
    legendLow: "Lower relative value", legendHigh: "Higher relative value",
  },
  {
    id: "NDRE", label: "NDRE — Canopy Chlorophyll", short: "NDRE", nativeResM: 20, resamplingNote: true,
    description: "Canopy chlorophyll differences, useful in denser canopies. Uses 20 m native red-edge (B05) and 10 m NIR (B08); result is on a 10 m display grid.",
    legend: ["#4a2c6a", "#7f5aa8", "#c4a8d6", "#8fd18f", "#1e6b2e"],
    legendLow: "Lower relative value", legendHigh: "Higher relative value",
  },
  {
    id: "MSAVI", label: "MSAVI — Vigour with Soil Adjustment", short: "MSAVI", nativeResM: 10, resamplingNote: false,
    description: "Reduces soil influence for sparse canopies. Uses native 10 m red (B04) and NIR (B08).",
    legend: ["#7a4a2b", "#b98a55", "#e0cc99", "#a3c977", "#2f6b2e"],
    legendLow: "Lower relative value", legendHigh: "Higher relative value",
  },
  {
    id: "RECI", label: "RECI — Chlorophyll Activity", short: "RECI", nativeResM: 20, resamplingNote: true,
    description: "Relative differences in leaf chlorophyll. Uses 20 m native red-edge (B05) and 10 m NIR (B08); result is on a 10 m display grid.",
    legend: ["#4b2e2e", "#a06b3f", "#e4c26a", "#7fbf6a", "#1e5b2e"],
    legendLow: "Lower relative value", legendHigh: "Higher relative value",
  },
  {
    id: "NDMI", label: "NDMI — Canopy Moisture", short: "NDMI", nativeResM: 20, resamplingNote: true,
    description: "Relative canopy-moisture variation. Uses 10 m NIR (B08) and 20 m native SWIR (B11); result is on a 10 m display grid.",
    legend: ["#7a3b1e", "#c98a4f", "#e6dcb0", "#7fb7d1", "#1e4f7a"],
    legendLow: "Drier", legendHigh: "Wetter",
  },
];

const LAYER_DISCLAIMER =
  "Satellite indices indicate relative variation and do not by themselves diagnose disease, water stress, nutrient deficiency or vine health.";

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
  const raw = error?.context ?? error?.details ?? fallback;
  if (typeof raw === "object" && raw) {
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
  const [selectedSceneKey, setSelectedSceneKey] = useState<string | null>(null); // date | "latest"
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
      }
  >(null);

  // Batch progress for All-Paddocks processing.
  type PadStatus = "queued" | "searching" | "processing" | "complete" | "insufficient_coverage" | "failed" | "skipped";
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    done: number;
    statuses: Record<string, PadStatus>;
  } | null>(null);

  // Paddocks list
  const { data: paddocks = [], isLoading: paddocksLoading } = useQuery({
    queryKey: ["satellite-paddocks", activeVineyardId],
    enabled: !!activeVineyardId && isSystemAdmin,
    queryFn: () => fetchList<Paddock>("paddocks", activeVineyardId!),
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

  const visibleGeoms = useMemo(() => {
    if (paddockId === "all") return geoms;
    return geoms.filter((g) => g.id === paddockId);
  }, [geoms, paddockId]);

  // Bounds no longer needed — SatelliteMap fits the visible paddocks itself.

  // Available acquisition dates for the current paddock filter.
  // In All Paddocks mode, count how many paddocks have a completed scene per date.
  const dateOptions = useMemo(() => {
    const scenes = scenesQuery.data?.scenes ?? [];
    const map = new Map<string, DBScene[]>();
    for (const s of scenes) {
      if (s.processing_status !== "complete") continue;
      const d = s.acquired_at.slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, s]) => ({
        date,
        scenes: s,
        paddockCount: new Set(s.map((x) => x.paddock_id)).size,
      }));
  }, [scenesQuery.data]);

  const isAllPaddocks = paddockId === "all";
  const totalPaddocks = geoms.length;

  // Auto-select: prefer "latest" per paddock in All mode; newest date otherwise.
  useEffect(() => {
    if (dateOptions.length === 0) return;
    if (isAllPaddocks) {
      if (!selectedSceneKey) setSelectedSceneKey("latest");
    } else {
      const newest = dateOptions[0].date;
      if (!selectedSceneKey || (selectedSceneKey !== "latest" && newest > selectedSceneKey)) {
        setSelectedSceneKey(newest);
      }
    }
  }, [dateOptions, selectedSceneKey, isAllPaddocks]);

  // Assets for the currently selected date + layer.
  // "latest" mode: newest completed asset per paddock (dates may differ).
  const activeAssetPairs = useMemo(() => {
    if (!selectedSceneKey || !scenesQuery.data) return [];
    const { scenes, assets } = scenesQuery.data;
    const completed = scenes.filter((s) => s.processing_status === "complete");

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

    if (selectedSceneKey === "latest") {
      // Pick each paddock's newest completed scene, then its asset for this layer.
      const newestByPaddock = new Map<string, DBScene>();
      for (const s of completed) {
        const cur = newestByPaddock.get(s.paddock_id);
        if (!cur || s.acquired_at > cur.acquired_at) newestByPaddock.set(s.paddock_id, s);
      }
      const out: Array<{ displayAsset: DBAsset; analyticalAsset?: DBAsset; scene: DBScene }> = [];
      for (const scene of newestByPaddock.values()) {
        const displayAsset = displayFor(scene.id);
        if (displayAsset) out.push({ displayAsset, analyticalAsset: analyticalFor(scene.id), scene });
      }
      return out;
    }

    const scenesForDate = completed.filter((s) => s.acquired_at.slice(0, 10) === selectedSceneKey);
    return scenesForDate.flatMap((scene) => {
      const displayAsset = displayFor(scene.id);
      return displayAsset ? [{ displayAsset, analyticalAsset: analyticalFor(scene.id), scene }] : [];
    });
  }, [scenesQuery.data, selectedSceneKey, layer]);

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

  // Fetch signed URLs for visible assets
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const { asset } of [...activeAssets, ...activeAnalyticalAssets]) {
        if (signedUrls[asset.id]) continue;
        try {
          const { data, error } = await invokeSatelliteFn("satellite-get-asset-url", {
            asset_id: asset.id,
          });
          if (error) throw error;
          if (!cancelled && data?.signed_url) {
            setSignedUrls((prev) => ({ ...prev, [asset.id]: data.signed_url }));
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
    const relevantScenes = selectedSceneKey === "latest"
      ? activeAssets.map((x) => x.scene)
      : scenesQuery.data.scenes.filter((s) => s.acquired_at.slice(0, 10) === selectedSceneKey);
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
    });
  };

  // ---------- Actions ----------

  const checkForNewImage = useMutation({
    mutationFn: async () => {
      if (!activeVineyardId) throw new Error("No vineyard selected");
      setSearchError(null);

      // Every valid-geometry paddock in the vineyard when "all"; otherwise the one selected.
      const targetGeoms = paddockId === "all"
        ? geoms
        : geoms.filter((g) => g.id === paddockId);
      const allVineyardPaddocks = paddockId === "all" ? paddocks.length : 1;
      const skippedNoGeometry = paddockId === "all"
        ? Math.max(0, allVineyardPaddocks - targetGeoms.length)
        : 0;

      if (targetGeoms.length === 0) throw new Error("No paddocks with valid boundaries.");

      type ResultStatus = "complete" | "insufficient_coverage" | "no_scenes" | "failed" | "skipped";
      const results: Array<{ paddock_id: string; status: ResultStatus; message?: string }> = [];

      // Seed batch progress.
      const initialStatuses: Record<string, PadStatus> = {};
      for (const g of targetGeoms) initialStatuses[g.id] = "queued";
      setBatchProgress({ total: targetGeoms.length, done: 0, statuses: initialStatuses });

      const setPad = (pid: string, s: PadStatus) => setBatchProgress((prev) => prev
        ? { ...prev, statuses: { ...prev.statuses, [pid]: s } }
        : prev);
      const bumpDone = () => setBatchProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);

      async function processOne(pid: string): Promise<void> {
        const targetPaddock = geoms.find((g) => g.id === pid);
        setPad(pid, "searching");
        const search = await invokeSatelliteFn("satellite-search-scenes", {
          vineyard_id: activeVineyardId,
          paddock_id: pid,
          limit: 20,
        });
        if (search.error) {
          const parsed = parseSatelliteFunctionError(search.error);
          // Only surface the first error banner (don't clobber earlier ones).
          setSearchError((prev) => prev ?? {
            code: parsed.code,
            providerStatus: parsed.providerStatus,
            paddockId: pid,
            paddockName: targetPaddock?.name ?? null,
            message: parsed.message,
          });
          results.push({ paddock_id: pid, status: "failed", message: parsed.message });
          setPad(pid, "failed");
          bumpDone();
          return;
        }
        const candidates: any[] = (search.data as any)?.candidates ?? [];
        if (candidates.length === 0) {
          results.push({ paddock_id: pid, status: "no_scenes", message: "No scenes found" });
          setPad(pid, "failed");
          bumpDone();
          return;
        }
        // Prefer clearer scenes (≤20% scene cloud), then newest.
        const sorted = [...candidates].sort((a, b) => {
          const ca = Number(a?.scene_cloud_cover_pct ?? 100);
          const cb = Number(b?.scene_cloud_cover_pct ?? 100);
          const ap = ca <= 20 ? 0 : 1;
          const bp = cb <= 20 ? 0 : 1;
          if (ap !== bp) return ap - bp;
          if (ca !== cb) return ca - cb;
          return String(b?.acquired_at ?? "").localeCompare(String(a?.acquired_at ?? ""));
        });

        setPad(pid, "processing");
        // Walk candidates until one completes with sufficient coverage (max 4 tries).
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
          });
          if (process.error) {
            finalMsg = process.error.message ?? finalMsg;
            continue;
          }
          const procStatus = String((process.data as any)?.status ?? "");
          if (procStatus === "complete") { finalStatus = "complete"; break; }
          if (procStatus === "insufficient_coverage") {
            const pct = (process.data as any)?.valid_coverage_pct;
            finalStatus = "insufficient_coverage";
            finalMsg = `Selected scene had ${pct != null ? Number(pct).toFixed(0) : "0"}% valid pixels.`;
            continue; // try next candidate
          }
          finalMsg = procStatus || finalMsg;
        }

        results.push({ paddock_id: pid, status: finalStatus, message: finalMsg });
        setPad(pid, finalStatus === "complete" ? "complete"
          : finalStatus === "insufficient_coverage" ? "insufficient_coverage"
          : "failed");
        bumpDone();
      }

      // Concurrency-limited worker pool (3 in flight).
      const queue = targetGeoms.map((g) => g.id);
      const CONC = 3;
      const workers = Array.from({ length: Math.min(CONC, queue.length) }, async () => {
        while (queue.length) {
          const pid = queue.shift();
          if (!pid) return;
          try { await processOne(pid); }
          catch (e: any) {
            results.push({ paddock_id: pid, status: "failed", message: String(e?.message ?? e) });
            setPad(pid, "failed");
            bumpDone();
          }
        }
      });
      await Promise.all(workers);

      return { results, skippedNoGeometry };
    },
    onSuccess: async ({ results, skippedNoGeometry }) => {
      const complete = results.filter((r) => r.status === "complete").length;
      const cloud = results.filter((r) => r.status === "insufficient_coverage").length;
      const failed = results.filter((r) => r.status === "failed" || r.status === "no_scenes").length;

      // Refresh + wait for the list query to reflect any new scenes.
      let loaded = false;
      for (let i = 0; i < 3 && complete > 0 && !loaded; i++) {
        await qc.invalidateQueries({ queryKey: ["satellite-scenes"] });
        const refreshed = await qc.refetchQueries({ queryKey: ["satellite-scenes", activeVineyardId, paddockId] });
        const anyData = refreshed?.[0]?.data as { scenes?: DBScene[] } | undefined;
        if ((anyData?.scenes ?? []).some((s) => s.processing_status === "complete")) { loaded = true; break; }
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Backfill analytical rasters for any completed scenes still missing them.
      try {
        await invokeSatelliteFn("satellite-backfill-analytical", {
          vineyard_id: activeVineyardId,
          paddock_id: paddockId,
        });
        await qc.invalidateQueries({ queryKey: ["satellite-scenes"] });
        await qc.refetchQueries({ queryKey: ["satellite-scenes", activeVineyardId, paddockId] });
        analyticalCacheRef.current.clear();
        setRasterCacheVersion((v) => v + 1);
      } catch (e) {
        console.warn("analytical backfill after processing failed", e);
      }


      // After an All-Paddocks batch, default to "Latest per paddock" view.
      if (paddockId === "all" && complete > 0) setSelectedSceneKey("latest");

      const parts: string[] = [];
      parts.push(`${complete} paddock${complete === 1 ? "" : "s"} processed`);
      if (cloud > 0) parts.push(`${cloud} had insufficient clear coverage`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (skippedNoGeometry > 0) parts.push(`${skippedNoGeometry} had no valid boundary`);
      const description = parts.join(", ") + ".";

      if (complete > 0 && loaded) {
        toast({ title: "Satellite processing complete", description });
      } else if (complete > 0 && !loaded) {
        toast({ title: "Processed, but result not yet visible", description, variant: "destructive" });
      } else {
        toast({ title: "No new imagery available", description, variant: "destructive" });
      }
    },
    onError: (e: any) => {
      setSearchError({
        code: null,
        providerStatus: null,
        paddockId: paddockId === "all" ? geoms[0]?.id ?? null : paddockId,
        paddockName: paddockId === "all" ? geoms[0]?.name ?? null : geoms.find((g) => g.id === paddockId)?.name ?? null,
        message: String(e?.message ?? e ?? "Unknown error"),
      });
      toast({
        title: "Satellite processing failed",
        description: String(e?.message ?? e ?? "Unknown error"),
        variant: "destructive",
      });
    },
  });

  // Backfill analytical (cell) rasters for existing completed scenes that have
  // display PNGs but no analytical GeoTIFFs. Reuses the existing display asset.
  const backfillAnalytical = useMutation({
    mutationFn: async () => {
      if (!activeVineyardId) throw new Error("No vineyard selected");
      const { data, error } = await invokeSatelliteFn("satellite-backfill-analytical", {
        vineyard_id: activeVineyardId,
        paddock_id: paddockId,
      });
      if (error) throw error;
      return data as { scanned: number; backfilled: number; skipped: number; failures: any[]; halted?: string };
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["satellite-scenes"] });
      await qc.refetchQueries({ queryKey: ["satellite-scenes", activeVineyardId, paddockId] });
      // Force a re-decode by clearing analytical cache.
      analyticalCacheRef.current.clear();
      setRasterCacheVersion((v) => v + 1);
      const halted = res?.halted ? ` (paused: ${res.halted})` : "";
      toast({
        title: "Cell readings generated",
        description: `${res?.backfilled ?? 0} cell rasters added across ${res?.scanned ?? 0} scenes${halted}.`,
      });
    },
    onError: (e: any) => {
      toast({
        title: "Cell reading backfill failed",
        description: String(e?.message ?? e ?? "Unknown error"),
        variant: "destructive",
      });
    },
  });


  // ---------- Guards ----------
  if (adminLoading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isSystemAdmin) return <Navigate to="/dashboard" replace />;

  const busy = checkForNewImage.isPending;
  const backfilling = backfillAnalytical.isPending;

  // Per-index plain-English descriptions, always relative to this paddock's
  // own distribution (the pixel includes vine canopy, mid-row, soil, shadow).
  const CLASSIFY_WORDS: Record<SatelliteIndexType, [string, string, string, string, string]> = {
    NDVI: [
      "Very sparse vegetation relative to this paddock",
      "Lower vine or ground-cover vigour relative to this paddock",
      "Typical vegetation vigour for this paddock",
      "Higher vegetation vigour relative to this paddock",
      "Very high vegetation vigour relative to this paddock",
    ],
    NDRE: [
      "Very low chlorophyll signal relative to this paddock",
      "Lower chlorophyll signal relative to this paddock",
      "Typical chlorophyll signal for this paddock",
      "Higher chlorophyll signal relative to this paddock",
      "Very high chlorophyll signal relative to this paddock",
    ],
    MSAVI: [
      "Very low soil-adjusted vegetation signal relative to this paddock",
      "Lower soil-adjusted vegetation signal relative to this paddock",
      "Typical soil-adjusted vegetation signal for this paddock",
      "Higher soil-adjusted vegetation signal relative to this paddock",
      "Very high soil-adjusted vegetation signal relative to this paddock",
    ],
    RECI: [
      "Very low relative chlorophyll activity for this paddock",
      "Lower relative chlorophyll activity for this paddock",
      "Typical relative chlorophyll activity for this paddock",
      "Higher relative chlorophyll activity for this paddock",
      "Very high relative chlorophyll activity for this paddock",
    ],
    NDMI: [
      "Very low relative canopy moisture signal for this paddock",
      "Lower relative canopy moisture signal for this paddock",
      "Typical relative canopy moisture signal for this paddock",
      "Higher relative canopy moisture signal for this paddock",
      "Very high relative canopy moisture signal for this paddock",
    ],
    TRUE_COLOUR: ["—", "—", "—", "—", "—"],
  };
  function classify(value: number | null, s: DBSummary | undefined): string {
    if (value == null || !s) return "—";
    const words = CLASSIFY_WORDS[layer] ?? CLASSIFY_WORDS.NDVI;
    if (s.percentile_10 == null) return words[2];
    if (value <= (s.percentile_10 ?? 0)) return words[0];
    if (value <= (s.percentile_25 ?? 0)) return words[1];
    if (value <= (s.percentile_75 ?? 0)) return words[2];
    if (value <= (s.percentile_90 ?? 0)) return words[3];
    return words[4];
  }

  return (
    <div className="w-full p-2 md:p-3 space-y-3 flex flex-col">
      {/* Compact header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-md bg-amber-500/15 p-1.5 text-amber-600 dark:text-amber-400">
            <SatelliteIcon className="h-4 w-4" />
          </div>
          <h1 className="text-lg font-semibold truncate">Satellite Mapping</h1>
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px]">
            System Admin · Beta
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || geoms.length === 0}
            onClick={() => checkForNewImage.mutate()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {busy ? (isAllPaddocks ? "Processing…" : "Processing…") : "Process Latest Imagery"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || backfilling || geoms.length === 0}
            onClick={() => backfillAnalytical.mutate()}
          >
            {backfilling ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {backfilling ? "Generating…" : "Generate Cell Readings"}
          </Button>
        </div>
      </div>


      {searchError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Satellite search failed</CardTitle>
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
              <Button variant="outline" size="sm" disabled={busy} onClick={() => checkForNewImage.mutate()}>
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
                  <SelectValue placeholder={dateOptions.length ? "Select date" : "No processed images"} />
                </SelectTrigger>
                <SelectContent>
                  {isAllPaddocks && dateOptions.length > 0 && (
                    <SelectItem value="latest">Latest available per paddock</SelectItem>
                  )}
                  {dateOptions.map((d) => {
                    if (isAllPaddocks) {
                      return (
                        <SelectItem key={d.date} value={d.date}>
                          {d.date} · {d.paddockCount} of {totalPaddocks} paddocks
                        </SelectItem>
                      );
                    }
                    const s = d.scenes[0];
                    const cloud = s?.scene_cloud_cover_pct;
                    const cov = s?.paddock_valid_coverage_pct;
                    return (
                      <SelectItem key={d.date} value={d.date}>
                        {d.date}
                        {cloud != null ? ` · ${Number(cloud).toFixed(0)}% cloud` : ""}
                        {cov != null ? ` · ${Number(cov).toFixed(0)}% valid` : ""}
                        {s?.quality_status ? ` · ${s.quality_status}` : ""}
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
                <SelectContent>
                  {LAYERS.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
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



          {/* Batch progress (All Paddocks) */}
          {busy && batchProgress && (
            <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium text-foreground">
                Checking imagery for {Math.min(batchProgress.done + 1, batchProgress.total)} of {batchProgress.total} paddocks…
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                <span>Completed: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "complete").length}</span></span>
                <span>Processing: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "processing" || s === "searching").length}</span></span>
                <span>Too cloudy: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "insufficient_coverage").length}</span></span>
                <span>Failed: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "failed").length}</span></span>
                <span>Queued: <span className="text-foreground">{Object.values(batchProgress.statuses).filter((s) => s === "queued").length}</span></span>
              </div>
            </div>
          )}

          {/* Layer description panel */}
          <div className="mt-3 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold text-foreground">{activeLayer.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{activeLayer.description}</div>
            <div className="text-[11px] text-muted-foreground mt-2 italic">
              Native input resolution: {activeLayer.nativeResM} m{activeLayer.resamplingNote ? " (resampled for display; resampling does not improve real ground resolution)" : ""}. {LAYER_DISCLAIMER}
            </div>
            {selectedSceneKey === "latest" && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                Latest available imagery per paddock — capture dates may differ. Hover a paddock to see its acquisition date.
              </div>
            )}
          </div>


          {/* System-admin diagnostics */}
          <div className="mt-3 rounded-md border border-dashed bg-muted/20 p-2 text-[11px] text-muted-foreground grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1">
            <div>Scenes returned: <span className="text-foreground">{scenesQuery.data?.scenes.length ?? 0}</span></div>
            <div>Completed scenes: <span className="text-foreground">{(scenesQuery.data?.scenes ?? []).filter((s) => s.processing_status === "complete").length}</span></div>
            <div>Selected date: <span className="text-foreground">{selectedSceneKey ?? "—"}</span></div>
            <div>Selected layer: <span className="text-foreground">{layer}</span></div>
            <div>Display asset: <span className="text-foreground">{activeAssets[0]?.asset.id ? "yes" : "no"}</span></div>
            <div>Analytical asset: <span className="text-foreground">{activeAnalyticalAssets[0]?.asset.id ? "yes" : "no"}</span></div>
            <div>Signed URL: <span className="text-foreground">{activeAssets[0] && signedUrls[activeAssets[0].asset.id] ? "loaded" : "—"}</span></div>
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

            {/* Hover readout — local analytical cell sample at pointer */}
            {hover && hover.paddockId && (
              <div
                className="pointer-events-none absolute z-[600] rounded-md border bg-background/95 backdrop-blur shadow-md px-3 py-2 text-xs min-w-[200px] max-w-[260px]"
                style={{
                  left: Math.max(8, hover.x + 12),
                  top: Math.max(8, hover.y - 72),
                }}
              >
                <div className="font-semibold text-foreground">{hover.paddockName ?? "Paddock"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {activeLayer.short}{hover.acquiredAt ? ` · ${hover.acquiredAt.slice(0, 10)}` : ""}
                </div>
                <div className="mt-1">
                  {layer === "TRUE_COLOUR" ? (
                    <>
                      <div className="text-sm font-medium text-foreground">True-colour satellite image</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Resolution: 10 m</div>
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
                        Use “Generate Cell Readings” above.
                      </div>
                    </>
                  ) : hover.status === "ready" && hover.value != null ? (
                    <>
                      <div className="text-base font-semibold text-foreground tabular-nums">
                        {activeLayer.short} cell value: {hover.value.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {classify(hover.value, summaryByPaddock.get(hover.paddockId))}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Cell resolution: {hover.cellResM ?? activeLayer.nativeResM} m
                      </div>
                      <div className="text-[10px] text-muted-foreground italic mt-0.5">
                        Each value represents the satellite cell containing this location.
                      </div>
                    </>
                  ) : hover.status === "no_data" ? (
                    <span className="text-muted-foreground">{hover.message ?? "No satellite data for this cell"}</span>
                  ) : hover.status === "error" ? (
                    <span className="text-destructive">{hover.message ?? "Sample failed"}</span>
                  ) : null}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                  {hover.lat.toFixed(5)}, {hover.lng.toFixed(5)}
                </div>
              </div>
            )}



            {/* Legend */}
            <div className="absolute bottom-3 right-3 z-[500] w-64 max-w-[90%]">
              <Collapsible open={legendOpen} onOpenChange={setLegendOpen}>
                <div className="rounded-md border bg-background/95 backdrop-blur shadow-md">
                  <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold">
                    <span>Legend — {activeLayer.short}</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${legendOpen ? "" : "-rotate-90"}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 space-y-2">
                      <div className="h-2.5 w-full rounded-sm" style={{
                        background: `linear-gradient(to right, ${activeLayer.legend.join(", ")})`,
                      }} />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{activeLayer.legendLow}</span>
                        <span>Typical</span>
                        <span>{activeLayer.legendHigh}</span>
                      </div>
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
              ? "No satellite scenes have been processed for this vineyard yet. Click Check for New Image."
              : "Hover a paddock on the map for its per-paddock summary; select a date above to switch scenes."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
