import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import {
  deriveMetrics,
  parsePolygonPoints,
  parseRows,
  polygonCentroid,
  LatLng,
} from "@/lib/paddockGeometry";
import { initMapKit } from "@/lib/mapkit";
import { paddockColor } from "@/lib/paddockColor";
import MapSourceBadge from "@/components/MapSourceBadge";
import "@/components/map/mapChips.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";

interface Paddock {
  id: string;
  name: string | null;
  polygon_points: any;
  rows: any;
  variety_allocations: any;
  vine_spacing?: number | null;
  intermediate_post_spacing?: number | null;
  emitter_spacing?: number | null;
  vine_count_override?: number | null;
  row_width?: number | null;
}

const ROW_GREEN = "#34C759";
const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

interface AppleMapPaddockMapProps {
  onUnavailable: (reason: string) => void;
}

export default function AppleMapPaddockMap({ onUnavailable }: AppleMapPaddockMapProps) {
  const { selectedVineyardId } = useVineyard();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const annotationsRef = useRef<any[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["paddocks-applemap", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
  });

  const paddocks = data ?? [];
  const parsed = useMemo(
    () =>
      paddocks.map((p) => {
        const polygon = parsePolygonPoints(p.polygon_points);
        return {
          paddock: p,
          polygon,
          rows: parseRows(p.rows),
          color: paddockColor(p.id),
          centroid: polygonCentroid(polygon),
          metrics: deriveMetrics(p),
        };
      }),
    [paddocks],
  );
  const withGeometry = parsed.filter((p) => p.polygon.length >= 3);
  const withoutGeometry = parsed.filter((p) => p.polygon.length < 3);
  const selected = parsed.find((p) => p.paddock.id === selectedId) ?? null;

  // Init MapKit map (Hybrid)
  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          isRotationEnabled: true,
          showsCompass: mapkit.FeatureVisibility.Adaptive,
          showsScale: mapkit.FeatureVisibility.Adaptive,
          showsZoomControl: true,
          showsUserLocationControl: false,
        });
        setMapReady(true);
      })
      .catch((e) => {
        if (!cancelled) onUnavailable(e?.message || "MapKit init failed");
      });
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setMapReady(false);
    };
  }, [onUnavailable]);

  // Render overlays + annotations + fit region
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;

    if (overlaysRef.current.length) {
      try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ }
      overlaysRef.current = [];
    }
    if (annotationsRef.current.length) {
      try { map.removeAnnotations(annotationsRef.current); } catch { /* noop */ }
      annotationsRef.current = [];
    }

    const newOverlays: any[] = [];
    const newAnnotations: any[] = [];
    const allPts: LatLng[] = [];

    const validPt = (pt: LatLng) =>
      Number.isFinite(pt.lat) && Number.isFinite(pt.lng) &&
      pt.lat >= -90 && pt.lat <= 90 && pt.lng >= -180 && pt.lng <= 180;

    for (const p of withGeometry) {
      const isSelected = p.paddock.id === selectedId;
      const validPolyPts = p.polygon.filter(validPt);
      if (validPolyPts.length < 3) continue;
      const coords = validPolyPts.map((pt) => new mapkit.Coordinate(pt.lat, pt.lng));
      allPts.push(...validPolyPts);

      const poly = new mapkit.PolygonOverlay(coords, {
        style: new mapkit.Style({
          strokeColor: p.color,
          fillColor: p.color,
          fillOpacity: isSelected ? 0.35 : 0.25,
          strokeOpacity: isSelected ? 1.0 : 0.9,
          lineWidth: isSelected ? 3.5 : 2.5,
          lineJoin: "round",
          lineCap: "round",
        }),
        data: { id: p.paddock.id },
      });
      poly.addEventListener("select", () => setSelectedId(p.paddock.id));
      newOverlays.push(poly);

      const rowSegments = p.rows
        .map((r: any) => {
          if (r.start && r.end) return { start: r.start, end: r.end };
          if (r.points && r.points.length >= 2) {
            return { start: r.points[0], end: r.points[r.points.length - 1] };
          }
          return null;
        })
        .filter((s): s is { start: LatLng; end: LatLng } =>
          !!s && validPt(s.start) && validPt(s.end));

      rowSegments.forEach((seg, i) => {
        newOverlays.push(
          new mapkit.PolylineOverlay(
            [
              new mapkit.Coordinate(seg.start.lat, seg.start.lng),
              new mapkit.Coordinate(seg.end.lat, seg.end.lng),
            ],
            {
              style: new mapkit.Style({
                strokeColor: ROW_GREEN,
                strokeOpacity: 0.85,
                lineWidth: 1.5,
                lineCap: "round",
              }),
            },
          ),
        );
        const isFirst = i === 0;
        const isLast = i === rowSegments.length - 1;
        if (isFirst || isLast) {
          const num = i + 1;
          const ann = new mapkit.Annotation(
            new mapkit.Coordinate(seg.start.lat, seg.start.lng),
            () => {
              const el = document.createElement("div");
              el.className = "vt-row-chip";
              el.textContent = String(num);
              return el;
            },
            { anchorOffset: new DOMPoint(0, -6) },
          );
          newAnnotations.push(ann);
        }
      });

      if (p.centroid && validPt(p.centroid) && p.paddock.name) {
        const name = p.paddock.name;
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(p.centroid.lat, p.centroid.lng),
          () => {
            const el = document.createElement("div");
            el.className = "vt-name-chip";
            el.textContent = name;
            return el;
          },
        );
        newAnnotations.push(ann);
      }
    }

    if (newOverlays.length) {
      map.addOverlays(newOverlays);
      overlaysRef.current = newOverlays;
    }
    if (newAnnotations.length) {
      map.addAnnotations(newAnnotations);
      annotationsRef.current = newAnnotations;
    }

    // Manual bounds-based region fit (more reliable than fromCoordinates).
    let bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null = null;
    if (allPts.length) {
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const pt of allPts) {
        if (pt.lat < minLat) minLat = pt.lat;
        if (pt.lat > maxLat) maxLat = pt.lat;
        if (pt.lng < minLng) minLng = pt.lng;
        if (pt.lng > maxLng) maxLng = pt.lng;
      }
      bounds = { minLat, maxLat, minLng, maxLng };
      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;
      const latDelta = Math.max((maxLat - minLat) * 1.5, 0.002);
      const lngDelta = Math.max((maxLng - minLng) * 1.5, 0.002);
      try {
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(centerLat, centerLng),
          new mapkit.CoordinateSpan(latDelta, lngDelta),
        );
      } catch (err) {
        console.warn("[AppleMap] region set failed", err);
      }
    }

    console.info("[AppleMap] render", {
      selectedVineyardId,
      paddocks: paddocks.length,
      withGeometry: withGeometry.length,
      pointsUsed: allPts.length,
      overlaysAdded: newOverlays.length,
      annotationsAdded: newAnnotations.length,
      bounds,
    });
  }, [withGeometry, selectedId, mapReady, paddocks.length, selectedVineyardId]);

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view its map.</div>;
  }

  const noGeometryAtAll = !isLoading && !error && parsed.length > 0 && withGeometry.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="relative h-[600px] w-full bg-muted">
          <div ref={containerRef} className="h-full w-full" />
          <MapSourceBadge source="apple" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/60">
              Loading map…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-destructive bg-background/60">
              {(error as Error).message}
            </div>
          )}
          {noGeometryAtAll && (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              No mapped paddock geometry found.
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        {selected ? (
          <DetailPanel data={selected} onClose={() => setSelectedId(null)} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Map</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Click a paddock to see derived metrics. {withGeometry.length} paddock
              {withGeometry.length === 1 ? "" : "s"} on map.
            </CardContent>
          </Card>
        )}

        {withoutGeometry.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No map boundary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {withoutGeometry.map((p) => (
                <div key={p.paddock.id} className="flex items-center justify-between">
                  <span className="truncate">{p.paddock.name ?? "Unnamed"}</span>
                  <Badge variant="outline" className="text-xs">no polygon</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ data, onClose }: { data: any; onClose: () => void }) {
  const { paddock, metrics } = data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[380px] sm:w-[380px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{paddock.name ?? "Unnamed paddock"}</SheetTitle>
          <SheetDescription>Read-only derived metrics</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 text-sm">
          <Row label="Area" value={`${fmt(metrics.areaHa, 3)} ha`} />
          <Row label="Rows" value={String(metrics.rowCount)} />
          <Row label="Total row length" value={`${fmt(metrics.totalRowLengthM, 0)} m`} />
          <Row
            label="Vines"
            value={
              metrics.vineCount == null
                ? "—"
                : `${metrics.vineCount.toLocaleString()} (${metrics.vineCountSource})`
            }
          />
          <Row
            label="Intermediate posts"
            value={metrics.intermediatePostCount == null ? "—" : metrics.intermediatePostCount.toLocaleString()}
          />
          <Row
            label="Emitters"
            value={metrics.emitterCount == null ? "—" : metrics.emitterCount.toLocaleString()}
          />
          <Row label="Row width" value={paddock.row_width ? `${paddock.row_width} m` : "—"} />
          <Row label="Vine spacing" value={paddock.vine_spacing ? `${paddock.vine_spacing} m` : "—"} />
          <div className="pt-3 border-t">
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to={`/setup/paddocks/${paddock.id}`}>
                Open full detail <ExternalLink className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
