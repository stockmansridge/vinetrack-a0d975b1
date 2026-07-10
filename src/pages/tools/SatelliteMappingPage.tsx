import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MapContainer,
  TileLayer,
  Polygon,
  useMap,
  Tooltip as LeafletTooltip,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigate } from "react-router-dom";
import { Info, RefreshCw, Satellite as SatelliteIcon, ChevronDown } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { fetchList } from "@/lib/queries";
import { parsePolygonPoints, LatLng } from "@/lib/paddockGeometry";
import { paddockColor } from "@/lib/paddockColor";

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
  // low → high colour ramp for legend (visual reference only, no data)
  legend: string[];
  legendLow: string;
  legendHigh: string;
};

const LAYERS: LayerOption[] = [
  {
    id: "TRUE_COLOUR",
    label: "Satellite Image",
    short: "True colour",
    description:
      "A natural-colour view of the vineyard from the selected satellite capture.",
    legend: ["#3b2f1e", "#7a6a48", "#c7b98a", "#e9e2c7", "#ffffff"],
    legendLow: "Darker",
    legendHigh: "Brighter",
  },
  {
    id: "NDVI",
    label: "NDVI — General Vine Vigour",
    short: "NDVI",
    description:
      "Shows overall green vegetation and canopy vigour. Useful for locating stronger and weaker areas across a paddock.",
    legend: ["#8b3a2b", "#c98a3f", "#e6d36a", "#7ec26b", "#1e6b2e"],
    legendLow: "Lower relative value",
    legendHigh: "Higher relative value",
  },
  {
    id: "NDRE",
    label: "NDRE — Canopy Chlorophyll",
    short: "NDRE",
    description:
      "Shows differences in canopy chlorophyll. It can be useful in established or denser canopies and later growth stages.",
    legend: ["#4a2c6a", "#7f5aa8", "#c4a8d6", "#8fd18f", "#1e6b2e"],
    legendLow: "Lower relative value",
    legendHigh: "Higher relative value",
  },
  {
    id: "MSAVI",
    label: "MSAVI — Vigour with Soil Adjustment",
    short: "MSAVI",
    description:
      "Measures vegetation while reducing the influence of exposed soil. This is useful where vines or canopy cover are sparse.",
    legend: ["#7a4a2b", "#b98a55", "#e0cc99", "#a3c977", "#2f6b2e"],
    legendLow: "Lower relative value",
    legendHigh: "Higher relative value",
  },
  {
    id: "RECI",
    label: "RECI — Chlorophyll Activity",
    short: "RECI",
    description:
      "Highlights relative differences in leaf chlorophyll and may help identify developing variation requiring field inspection.",
    legend: ["#4b2e2e", "#a06b3f", "#e4c26a", "#7fbf6a", "#1e5b2e"],
    legendLow: "Lower relative value",
    legendHigh: "Higher relative value",
  },
  {
    id: "NDMI",
    label: "NDMI — Canopy Moisture",
    short: "NDMI",
    description:
      "Shows relative canopy-moisture variation and may help identify areas that should be inspected for water stress or irrigation issues.",
    legend: ["#7a3b1e", "#c98a4f", "#e6dcb0", "#7fb7d1", "#1e4f7a"],
    legendLow: "Drier",
    legendHigh: "Wetter",
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

// ---------- Map helpers ----------
function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useMemo(() => {
    if (!bounds) return;
    try {
      const lb = L.latLngBounds(bounds as L.LatLngBoundsLiteral).pad(0.2);
      map.fitBounds(lb, { padding: [24, 24] });
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);
  return null;
}

function polyBounds(rings: LatLng[][]): L.LatLngBoundsExpression | null {
  const pts: [number, number][] = [];
  for (const r of rings) for (const p of r) pts.push([p.lat, p.lng]);
  if (pts.length === 0) return null;
  return pts as L.LatLngBoundsExpression;
}

// Normalise polygon_points into an array of rings so both Polygon and
// MultiPolygon shapes render. If the raw value is an array whose first item
// looks like a ring (array of points), treat it as MultiPolygon.
function parseGeometry(raw: any): LatLng[][] {
  if (!raw) return [];
  let val: any = raw;
  if (typeof raw === "string") {
    try {
      val = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(val) || val.length === 0) return [];
  const first = val[0];
  const isRing = Array.isArray(first) && first.length > 0 && !("lat" in (first[0] ?? {})) === false;
  // Detect MultiPolygon: array-of-arrays of points
  if (Array.isArray(first) && first[0] && (typeof first[0] === "object") && ("lat" in first[0] || "latitude" in first[0])) {
    const rings = (val as any[]).map((ring) => parsePolygonPoints(ring)).filter((r) => r.length >= 3);
    return rings;
  }
  const single = parsePolygonPoints(val);
  return single.length >= 3 ? [single] : [];
}

// ---------- Page ----------
export default function SatelliteMappingPage() {
  const { isAdmin: isSystemAdmin, loading: adminLoading } = useIsSystemAdmin();
  const { selectedVineyardId, memberships } = useVineyard();

  const [vineyardId, setVineyardId] = useState<string | null>(selectedVineyardId);
  const activeVineyardId = vineyardId ?? selectedVineyardId;

  const [paddockId, setPaddockId] = useState<string>("all");
  const [layer, setLayer] = useState<SatelliteIndexType>("NDVI");
  const [opacity, setOpacity] = useState<number>(70);
  const [legendOpen, setLegendOpen] = useState<boolean>(true);

  const { data: paddocks = [], isLoading: paddocksLoading } = useQuery({
    queryKey: ["satellite-paddocks", activeVineyardId],
    enabled: !!activeVineyardId && isSystemAdmin,
    queryFn: () => fetchList<Paddock>("paddocks", activeVineyardId!),
  });

  const activeLayer = LAYERS.find((l) => l.id === layer)!;

  // Parse and filter paddock geometry
  const geoms = useMemo(() => {
    return paddocks
      .map((p) => ({
        id: p.id,
        name: p.name ?? "Unnamed paddock",
        rings: parseGeometry(p.polygon_points),
      }))
      .filter((g) => g.rings.length > 0);
  }, [paddocks]);

  const visibleGeoms = useMemo(() => {
    if (paddockId === "all") return geoms;
    return geoms.filter((g) => g.id === paddockId);
  }, [geoms, paddockId]);

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (visibleGeoms.length === 0) return null;
    const pts: [number, number][] = [];
    for (const g of visibleGeoms) for (const r of g.rings) for (const p of r) pts.push([p.lat, p.lng]);
    return pts.length ? (pts as L.LatLngBoundsExpression) : null;
  }, [visibleGeoms]);

  // Guards ---------------------------------------------------------------
  if (adminLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  }
  if (!isSystemAdmin) {
    return <Navigate to="/dashboard" replace />;
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
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              >
                System Admin Only
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              View current and historical satellite observations across your vineyard paddocks.
            </p>
          </div>
        </div>
      </div>

      {/* Dev notice */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-2 py-3 text-sm">
          <Info className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            Satellite Mapping is under development and is currently available only to
            VineTrack system administrators.
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
              <Select
                value={activeVineyardId ?? ""}
                onValueChange={(v) => {
                  setVineyardId(v);
                  setPaddockId("all");
                }}
              >
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
              <Select value={paddockId} onValueChange={setPaddockId}>
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
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Select disabled value="">
                        <SelectTrigger><SelectValue placeholder="No images yet" /></SelectTrigger>
                        <SelectContent />
                      </Select>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Available once Copernicus data is connected.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
              <Slider
                value={[opacity]}
                onValueChange={(v) => setOpacity(v[0])}
                min={0}
                max={100}
                step={1}
              />
              <div className="flex gap-1 pt-1">
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(20)}>Satellite 20%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(65)}>Balanced 65%</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOpacity(95)}>Overlay 95%</Button>
              </div>
            </div>

            {/* Check for new image */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Latest Capture</label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="outline" size="sm" disabled className="w-full">
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        Check for New Image
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Checks for the latest suitable cloud-free satellite capture.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Layer description panel */}
          <div className="mt-3 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold text-foreground">{activeLayer.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{activeLayer.description}</div>
            <div className="text-[11px] text-muted-foreground mt-2 italic">{LAYER_DISCLAIMER}</div>
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
                  No paddock boundaries are available for this vineyard. Add paddock
                  polygons in Setup to display them on the satellite map.
                </div>
              </div>
            ) : (
              <MapContainer
                key={activeVineyardId ?? "none"}
                center={[0, 0]}
                zoom={2}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
              >
                <TileLayer
                  attribution='Imagery © Esri'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />

                {/*
                  Prepared clipped-overlay layer slot: real index overlays will be
                  inserted here as <ImageOverlay> clipped to visibleGeoms.rings.
                  Nothing is rendered now — no simulated overlay is drawn.
                */}

                {/* Paddock polygons stay above future overlays */}
                {visibleGeoms.map((g) =>
                  g.rings.map((ring, idx) => (
                    <Polygon
                      key={`${g.id}-${idx}`}
                      positions={ring.map((p) => [p.lat, p.lng]) as any}
                      pathOptions={{
                        color: "#ffffff",
                        weight: 2.5,
                        opacity: 1,
                        fillColor: paddockColor(g.id),
                        fillOpacity: 0.05,
                      }}
                    >
                      <LeafletTooltip sticky direction="top" opacity={0.95}>
                        <div className="text-xs">
                          <div className="font-semibold">{g.name}</div>
                          <div className="text-muted-foreground">
                            {activeLayer.short}: Satellite reading not loaded
                          </div>
                        </div>
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
                        <div>Date</div><div className="text-right">—</div>
                        <div>Provider</div><div className="text-right">Sentinel-2</div>
                        <div>Native resolution</div><div className="text-right">10 m</div>
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
              return (
                <div
                  key={i}
                  className="rounded border border-dashed bg-muted/20 p-2 text-center text-[10px] text-muted-foreground"
                >
                  <div className="font-medium text-foreground/70">{label}</div>
                  <div className="mt-1">—</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            No satellite image history has been loaded for this vineyard.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
