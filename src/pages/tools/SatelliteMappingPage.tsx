import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Info, RefreshCw, Satellite as SatelliteIcon, ChevronDown, Loader2 } from "lucide-react";
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

type SatelliteSearchError = {
  code: string | null;
  providerStatus: number | null;
  paddockId: string | null;
  paddockName: string | null;
  message: string;
};

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

  // Auto-select newest completed scene when none selected, or when a newer scene appears.
  useEffect(() => {
    if (dateOptions.length === 0) return;
    const newest = dateOptions[0].date;
    if (!selectedSceneKey || newest > selectedSceneKey) {
      setSelectedSceneKey(newest);
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
      setSearchError(null);
      // Determine which paddocks to process.
      const targetGeoms = paddockId === "all"
        ? geoms.slice(0, 1)
        : geoms.filter((g) => g.id === paddockId);
      const targetPaddocks = targetGeoms.map((g) => g.id);
      if (targetPaddocks.length === 0) throw new Error("No paddocks with geometry.");

      type ResultStatus = "complete" | "insufficient_coverage" | "no_scenes" | "failed";
      const results: Array<{ paddock_id: string; status: ResultStatus; message?: string }> = [];
      for (const pid of targetPaddocks) {
        const targetPaddock = geoms.find((g) => g.id === pid);
        // 1) Search
        const search = await invokeSatelliteFn("satellite-search-scenes", {
          vineyard_id: activeVineyardId,
          paddock_id: pid,
          limit: 20,
        });
        if (search.error) {
          const parsed = parseSatelliteFunctionError(search.error);
          setSearchError({
            code: parsed.code,
            providerStatus: parsed.providerStatus,
            paddockId: pid,
            paddockName: targetPaddock?.name ?? null,
            message: parsed.message,
          });
          results.push({ paddock_id: pid, status: "failed", message: parsed.message });
          continue;
        }
        const candidates: any[] = (search.data as any)?.candidates ?? [];
        if (candidates.length === 0) { results.push({ paddock_id: pid, status: "no_scenes", message: "No scenes found" }); continue; }
        // 2) Pick the LEAST-CLOUDY recent candidate (not just the newest); newest
        //    is often heavily clouded and fails the 80% valid-coverage check.
        const sorted = [...candidates].sort((a, b) => {
          const ca = Number(a?.scene_cloud_cover_pct ?? 100);
          const cb = Number(b?.scene_cloud_cover_pct ?? 100);
          if (ca !== cb) return ca - cb;
          return String(b?.acquired_at ?? "").localeCompare(String(a?.acquired_at ?? ""));
        });
        const c = sorted[0];
        const process = await invokeSatelliteFn("satellite-process-scene", {
          vineyard_id: activeVineyardId,
          paddock_id: pid,
          provider_scene_id: c.provider_scene_id,
          acquired_at: c.acquired_at,
          scene_cloud_cover_pct: c.scene_cloud_cover_pct,
        });
        if (process.error) {
          results.push({ paddock_id: pid, status: "failed", message: process.error.message });
          continue;
        }
        const procStatus = String((process.data as any)?.status ?? "");
        if (procStatus === "complete") {
          results.push({ paddock_id: pid, status: "complete" });
        } else if (procStatus === "insufficient_coverage") {
          const pct = (process.data as any)?.valid_coverage_pct;
          results.push({
            paddock_id: pid,
            status: "insufficient_coverage",
            message: `Selected scene had ${pct != null ? Number(pct).toFixed(0) : "0"}% valid pixels (cloud/shadow).`,
          });
        } else {
          results.push({ paddock_id: pid, status: "failed", message: procStatus || "Processing did not complete." });
        }
      }
      return results;
    },
    onSuccess: async (results) => {
      const complete = results.filter((r) => r.status === "complete").length;
      const cloud = results.filter((r) => r.status === "insufficient_coverage").length;
      const failed = results.filter((r) => r.status === "failed" || r.status === "no_scenes").length;

      // Refresh + wait for the list query to actually return the new scene.
      setSelectedSceneKey(null);
      let loaded = false;
      for (let i = 0; i < 3 && complete > 0 && !loaded; i++) {
        await qc.invalidateQueries({ queryKey: ["satellite-scenes"] });
        const refreshed = await qc.refetchQueries({ queryKey: ["satellite-scenes", activeVineyardId, paddockId] });
        const anyData = refreshed?.[0]?.data as { scenes?: DBScene[] } | undefined;
        if ((anyData?.scenes ?? []).some((s) => s.processing_status === "complete")) { loaded = true; break; }
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (complete > 0 && loaded) {
        toast({ title: "Satellite imagery processed and loaded", description: `${complete} paddock${complete === 1 ? "" : "s"} ready.` });
      } else if (complete > 0 && !loaded) {
        toast({
          title: "Processed, but result not yet visible",
          description: "Satellite imagery was processed, but VineTrack could not load the saved result. Try refreshing.",
          variant: "destructive",
        });
      } else if (cloud > 0) {
        toast({
          title: "No usable imagery for this paddock yet",
          description: "The most recent Sentinel-2 scenes were too cloudy for reliable analysis. Try again after the next clear pass.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Satellite processing failed",
          description: `${failed} paddock${failed === 1 ? "" : "s"} could not be processed.`,
          variant: "destructive",
        });
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

      {/* Toolbar */}
      <Card className="relative z-30">
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
                  {dateOptions.map((d) => {
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
            <div className="space-y-1 min-w-0" style={{ gridColumn: "span 1", minWidth: 220 }}>
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

            {/* Opacity */}
            <div className="space-y-1 min-w-0" style={{ minWidth: 220 }}>
              <label className="text-xs font-medium text-muted-foreground">
                Overlay Transparency — {opacity}%
              </label>
              <Slider value={[opacity]} onValueChange={(v) => setOpacity(v[0])} min={0} max={100} step={1} />
              <div className="flex flex-wrap gap-1 pt-1">
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(20)}>Satellite 20%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(65)}>Balanced 65%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(95)}>Overlay 95%</Button>
              </div>
            </div>

            {/* Check for new image */}
            <div className="space-y-1 min-w-0 flex flex-col">
              <label className="text-xs font-medium text-muted-foreground">Latest Capture</label>
              <Button
                variant="outline"
                className="w-full min-h-[44px] whitespace-nowrap"
                disabled={busy || geoms.length === 0}
                onClick={() => checkForNewImage.mutate()}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                {busy ? "Checking for suitable imagery…" : "Check for New Image"}
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

          {/* System-admin diagnostics */}
          <div className="mt-3 rounded-md border border-dashed bg-muted/20 p-2 text-[11px] text-muted-foreground grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1">
            <div>Scenes returned: <span className="text-foreground">{scenesQuery.data?.scenes.length ?? 0}</span></div>
            <div>Completed scenes: <span className="text-foreground">{(scenesQuery.data?.scenes ?? []).filter((s) => s.processing_status === "complete").length}</span></div>
            <div>Selected date: <span className="text-foreground">{selectedSceneKey ?? "—"}</span></div>
            <div>Selected layer: <span className="text-foreground">{layer}</span></div>
            <div>Matching asset: <span className="text-foreground">{activeAssets[0]?.asset.id ? "yes" : "no"}</span></div>
            <div>Signed URL: <span className="text-foreground">{activeAssets[0] && signedUrls[activeAssets[0].asset.id] ? "loaded" : "—"}</span></div>
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
              <SatelliteMap
                className="h-full w-full"
                paddocks={visibleGeoms.map((g) => ({
                  id: g.id,
                  name: g.name,
                  polys: g.polys,
                  color: paddockColor(g.id),
                }))}
                selectedPaddockId={paddockId === "all" ? null : paddockId}
                overlayUrl={
                  activeAssets[0] ? (signedUrls[activeAssets[0].asset.id] ?? null) : null
                }
                overlayBounds={activeAssets[0]?.asset.bounds ?? null}
                overlayOpacity={opacity / 100}
                onPaddockClick={(id) => setPaddockId(id)}
              />
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
