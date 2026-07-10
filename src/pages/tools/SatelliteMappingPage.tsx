import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MapContainer,
  TileLayer,
  Polygon,
  ImageOverlay,
  useMap,
  Tooltip as LeafletTooltip,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigate } from "react-router-dom";
import { Info, RefreshCw, Satellite as SatelliteIcon, ChevronDown, Loader2 } from "lucide-react";

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
  storage_path: string;
  bounds: { north: number; south: number; east: number; west: number } | null;
  native_resolution_m: number | null;
  display_resolution_m: number | null;
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

// ---------- Map helpers ----------
function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try {
      const lb = L.latLngBounds(bounds as L.LatLngBoundsLiteral).pad(0.2);
      map.fitBounds(lb, { padding: [24, 24] });
    } catch { /* noop */ }
  }, [bounds, map]);
  return null;
}

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
  const [selectedSceneKey, setSelectedSceneKey] = useState<string | null>(null); // "acquired_at|paddock_id"
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({}); // asset_id -> signed URL

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
      const { data, error } = await supabase.functions.invoke("satellite-list-scenes", {
        body: { vineyard_id: activeVineyardId, paddock_id: paddockId },
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

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const pts: [number, number][] = [];
    for (const g of visibleGeoms)
      for (const poly of g.polys)
        for (const ring of poly)
          for (const p of ring) pts.push([p.lat, p.lng]);
    return pts.length ? (pts as L.LatLngBoundsExpression) : null;
  }, [visibleGeoms]);

  // Available acquisition dates for the current paddock filter
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
      .map(([date, s]) => ({ date, scenes: s }));
  }, [scenesQuery.data]);

  // Default to newest scene when list first loads
  useEffect(() => {
    if (!selectedSceneKey && dateOptions.length > 0) {
      setSelectedSceneKey(dateOptions[0].date);
    }
  }, [dateOptions, selectedSceneKey]);

  // Assets for the currently selected date + layer
  const activeAssets = useMemo(() => {
    if (!selectedSceneKey || !scenesQuery.data) return [];
    const scenesForDate = scenesQuery.data.scenes.filter((s) => s.acquired_at.slice(0, 10) === selectedSceneKey && s.processing_status === "complete");
    const bySceneId = new Set(scenesForDate.map((s) => s.id));
    return scenesQuery.data.assets.filter((a) => bySceneId.has(a.satellite_scene_id) && a.index_type === layer)
      .map((a) => ({ asset: a, scene: scenesForDate.find((s) => s.id === a.satellite_scene_id)! }));
  }, [scenesQuery.data, selectedSceneKey, layer]);

  // Fetch signed URLs for visible assets
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const { asset } of activeAssets) {
        if (signedUrls[asset.id]) continue;
        try {
          const { data, error } = await supabase.functions.invoke("satellite-get-asset-url", {
            body: { asset_id: asset.id },
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
  }, [activeAssets]);

  // Summaries lookup by paddock (for hover + selected-scene classification)
  const summaryByPaddock = useMemo(() => {
    const map = new Map<string, DBSummary>();
    if (!scenesQuery.data || !selectedSceneKey) return map;
    const scenesForDate = scenesQuery.data.scenes.filter((s) => s.acquired_at.slice(0, 10) === selectedSceneKey);
    const bySceneId = new Map(scenesForDate.map((s) => [s.id, s]));
    for (const sum of scenesQuery.data.summaries) {
      if (sum.index_type !== layer) continue;
      const scene = bySceneId.get(sum.satellite_scene_id);
      if (scene) map.set(scene.paddock_id, sum);
    }
    return map;
  }, [scenesQuery.data, selectedSceneKey, layer]);

  // ---------- Actions ----------
  const checkForNewImage = useMutation({
    mutationFn: async () => {
      if (!activeVineyardId) throw new Error("No vineyard selected");
      // Determine which paddocks to process.
      const targetPaddocks = paddockId === "all"
        ? geoms.map((g) => g.id)
        : [paddockId];
      if (targetPaddocks.length === 0) throw new Error("No paddocks with geometry.");

      const results: Array<{ paddock_id: string; ok: boolean; message?: string }> = [];
      for (const pid of targetPaddocks) {
        // 1) Search
        const search = await supabase.functions.invoke("satellite-search-scenes", {
          body: {
            vineyard_id: activeVineyardId,
            paddock_id: pid,
            date_start: new Date(Date.now() - 30 * 86400_000).toISOString(),
            date_end: new Date().toISOString(),
            max_cloud_cover: 60,
            limit: 5,
          },
        });
        if (search.error) { results.push({ paddock_id: pid, ok: false, message: search.error.message }); continue; }
        const candidates: any[] = (search.data as any)?.candidates ?? [];
        if (candidates.length === 0) { results.push({ paddock_id: pid, ok: false, message: "No scenes found" }); continue; }
        // 2) Process newest candidate
        const c = candidates[0];
        const process = await supabase.functions.invoke("satellite-process-scene", {
          body: {
            vineyard_id: activeVineyardId,
            paddock_id: pid,
            provider_scene_id: c.provider_scene_id,
            acquired_at: c.acquired_at,
            scene_cloud_cover_pct: c.scene_cloud_cover_pct,
          },
        });
        if (process.error) results.push({ paddock_id: pid, ok: false, message: process.error.message });
        else results.push({ paddock_id: pid, ok: true, message: (process.data as any)?.status });
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      toast({
        title: "Satellite processing finished",
        description: `${ok} succeeded, ${failed} failed. Reloading scene list…`,
      });
      qc.invalidateQueries({ queryKey: ["satellite-scenes"] });
      setSelectedSceneKey(null);
    },
    onError: (e: any) => {
      toast({
        title: "Satellite processing failed",
        description: String(e?.message ?? e ?? "Unknown error"),
        variant: "destructive",
      });
    },
  });

  // ---------- Guards ----------
  if (adminLoading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isSystemAdmin) return <Navigate to="/dashboard" replace />;

  const busy = checkForNewImage.isPending;

  // Classification helper
  function classify(value: number | null, s: DBSummary | undefined): string {
    if (value == null || !s) return "—";
    if (s.percentile_10 == null) return "Typical for this paddock";
    if (value <= (s.percentile_10 ?? 0)) return "Very low relative value";
    if (value <= (s.percentile_25 ?? 0)) return "Low relative value";
    if (value <= (s.percentile_75 ?? 0)) return "Typical for this paddock";
    if (value <= (s.percentile_90 ?? 0)) return "High relative value";
    return "Very high relative value";
  }

  return (
    <div className="w-full p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
            <SatelliteIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">Satellite Mapping</h1>
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                System Admin Only
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Live Sentinel-2 imagery via the Copernicus Data Space Ecosystem. Processed on-demand and clipped to each paddock.
            </p>
          </div>
        </div>
      </div>

      {/* Dev notice */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-2 py-3 text-sm">
          <Info className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            Satellite Mapping is under active development and is currently available only to VineTrack system administrators.
          </span>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            {/* Vineyard */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Vineyard</label>
              <Select value={activeVineyardId ?? ""} onValueChange={(v) => { setVineyardId(v); setPaddockId("all"); setSelectedSceneKey(null); }}>
                <SelectTrigger><SelectValue placeholder="Select vineyard" /></SelectTrigger>
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
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Paddock</label>
              <Select value={paddockId} onValueChange={(v) => { setPaddockId(v); setSelectedSceneKey(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Paddocks</SelectItem>
                  {geoms.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Image date */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Image Date</label>
              <Select value={selectedSceneKey ?? ""} onValueChange={setSelectedSceneKey}>
                <SelectTrigger>
                  <SelectValue placeholder={dateOptions.length ? "Select date" : "No images yet"} />
                </SelectTrigger>
                <SelectContent>
                  {dateOptions.map((d) => (
                    <SelectItem key={d.date} value={d.date}>
                      {d.date} · {d.scenes.length} paddock{d.scenes.length === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Map Layer */}
            <div className="space-y-1">
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LAYERS.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Opacity */}
            <div className="space-y-1 lg:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">
                Overlay Transparency — {opacity}%
              </label>
              <Slider value={[opacity]} onValueChange={(v) => setOpacity(v[0])} min={0} max={100} step={1} />
              <div className="flex gap-1 pt-1">
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(20)}>Satellite 20%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(65)}>Balanced 65%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(95)}>Overlay 95%</Button>
              </div>
            </div>

            {/* Check for new image */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Latest Capture</label>
              <Button
                variant="outline" size="sm" className="w-full"
                disabled={busy || geoms.length === 0}
                onClick={() => checkForNewImage.mutate()}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                {busy ? "Processing…" : "Check for New Image"}
              </Button>
            </div>
          </div>

          {/* Layer description panel */}
          <div className="mt-3 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold text-foreground">{activeLayer.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{activeLayer.description}</div>
            <div className="text-[11px] text-muted-foreground mt-2 italic">
              Native input resolution: {activeLayer.nativeResM} m{activeLayer.resamplingNote ? " (resampled for display; resampling does not improve real ground resolution)" : ""}. {LAYER_DISCLAIMER}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Map */}
      <Card className="overflow-hidden">
        <CardContent className="p-0 relative">
          <div className="h-[560px] w-full relative">
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
              <MapContainer
                key={activeVineyardId ?? "none"}
                center={[0, 0]} zoom={2}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
              >
                <TileLayer
                  attribution='Imagery © Esri · Analysis © Copernicus Sentinel-2'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />

                {/* Real Sentinel-2 overlays (clipped to paddock by the evalscript). */}
                {activeAssets.map(({ asset }) => {
                  const url = signedUrls[asset.id];
                  if (!url || !asset.bounds) return null;
                  const b: L.LatLngBoundsExpression = [
                    [asset.bounds.south, asset.bounds.west],
                    [asset.bounds.north, asset.bounds.east],
                  ];
                  return (
                    <ImageOverlay
                      key={asset.id}
                      url={url}
                      bounds={b}
                      opacity={opacity / 100}
                    />
                  );
                })}

                {/* Paddock outlines sit above rasters. */}
                {visibleGeoms.map((g) =>
                  g.polys.map((poly, pi) => (
                    <Polygon
                      key={`${g.id}-${pi}`}
                      positions={poly.map((ring) => ring.map((p) => [p.lat, p.lng])) as any}
                      pathOptions={{
                        color: "#ffffff", weight: 2.5, opacity: 1,
                        fillColor: paddockColor(g.id), fillOpacity: 0.05,
                      }}
                    >
                      <LeafletTooltip sticky direction="top" opacity={0.95}>
                        {(() => {
                          const s = summaryByPaddock.get(g.id);
                          const scene = scenesQuery.data?.scenes.find((sc) => sc.paddock_id === g.id && sc.acquired_at.slice(0, 10) === selectedSceneKey);
                          const value = s?.mean_value ?? null;
                          return (
                            <div className="text-xs">
                              <div className="font-semibold">{g.name}</div>
                              <div className="text-muted-foreground">{activeLayer.short}</div>
                              {value != null ? (
                                <>
                                  <div>Mean: {value.toFixed(2)}</div>
                                  <div>{classify(value, s)}</div>
                                </>
                              ) : (
                                <div>No processed value for this scene</div>
                              )}
                              {scene?.acquired_at && (
                                <div className="text-muted-foreground mt-1">
                                  {scene.acquired_at.slice(0, 10)} · native {activeLayer.nativeResM} m
                                </div>
                              )}
                              {scene?.quality_status && (
                                <div className="text-muted-foreground">Quality: {scene.quality_status}</div>
                              )}
                            </div>
                          );
                        })()}
                      </LeafletTooltip>
                    </Polygon>
                  )),
                )}

                {bounds && <FitBounds bounds={bounds} />}
              </MapContainer>
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
