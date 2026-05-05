import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import {
  deriveMetrics,
  parsePolygonPoints,
  parseRows,
  parseVarietyAllocations,
  polygonCentroid,
  LatLng,
} from "@/lib/paddockGeometry";
import { initMapKit } from "@/lib/mapkit";
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

const PALETTE = ["#E55934", "#23967F", "#9B5DE5", "#1F8FCD", "#F2A341", "#D7457E"];
const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

interface AppleMapPaddockMapProps {
  onUnavailable: (reason: string) => void;
}

export default function AppleMapPaddockMap({ onUnavailable }: AppleMapPaddockMapProps) {
  const { selectedVineyardId } = useVineyard();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["paddocks-applemap", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
  });

  const paddocks = data ?? [];
  const parsed = useMemo(
    () =>
      paddocks.map((p, i) => ({
        paddock: p,
        polygon: parsePolygonPoints(p.polygon_points),
        rows: parseRows(p.rows),
        allocations: parseVarietyAllocations(p.variety_allocations),
        color: PALETTE[i % PALETTE.length],
        centroid: polygonCentroid(parsePolygonPoints(p.polygon_points)),
        metrics: deriveMetrics(p),
      })),
    [paddocks],
  );
  const withGeometry = parsed.filter((p) => p.polygon.length >= 3);
  const withoutGeometry = parsed.filter((p) => p.polygon.length < 3);
  const selected = parsed.find((p) => p.paddock.id === selectedId) ?? null;

  // Initialise MapKit + map instance
  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current) return;
        if (mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          showsZoomControl: true,
          showsCompass: mapkit.FeatureVisibility.Adaptive,
          mapType: mapkit.Map.MapTypes.Hybrid,
          isRotationEnabled: false,
        });
      })
      .catch((e) => {
        if (!cancelled) onUnavailable(e?.message || "MapKit init failed");
      });
    return () => {
      cancelled = true;
      try {
        mapRef.current?.destroy?.();
      } catch {
        /* noop */
      }
      mapRef.current = null;
    };
  }, [onUnavailable]);

  // Render overlays whenever data changes
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!map || !mapkit) return;

    // Clear previous overlays
    if (overlaysRef.current.length) {
      try {
        map.removeOverlays(overlaysRef.current);
      } catch {
        /* noop */
      }
      overlaysRef.current = [];
    }

    const newOverlays: any[] = [];
    const allCoords: any[] = [];

    for (const p of withGeometry) {
      const coords = p.polygon.map((pt: LatLng) => new mapkit.Coordinate(pt.lat, pt.lng));
      allCoords.push(...coords);
      const style = new mapkit.Style({
        strokeColor: p.color,
        fillColor: p.color,
        fillOpacity: 0.25,
        lineWidth: 2,
      });
      const poly = new mapkit.PolygonOverlay(coords, { style, data: { id: p.paddock.id } });
      poly.addEventListener("select", () => setSelectedId(p.paddock.id));
      newOverlays.push(poly);

      // Allocation polygons
      p.allocations
        .filter((a: any) => a.polygon && a.polygon.length >= 3)
        .forEach((a: any, i: number) => {
          const ac = a.polygon.map((pt: LatLng) => new mapkit.Coordinate(pt.lat, pt.lng));
          newOverlays.push(
            new mapkit.PolygonOverlay(ac, {
              style: new mapkit.Style({
                strokeColor: PALETTE[(i + 2) % PALETTE.length],
                fillColor: PALETTE[(i + 2) % PALETTE.length],
                fillOpacity: 0.3,
                lineWidth: 1,
                lineDash: [4, 4],
              }),
            }),
          );
        });

      // Rows as polylines
      for (const r of p.rows) {
        const pts: any[] = [];
        if (r.points && r.points.length >= 2) {
          for (const pt of r.points) pts.push(new mapkit.Coordinate(pt.lat, pt.lng));
        } else if (r.start && r.end) {
          pts.push(
            new mapkit.Coordinate(r.start.lat, r.start.lng),
            new mapkit.Coordinate(r.end.lat, r.end.lng),
          );
        }
        if (pts.length >= 2) {
          newOverlays.push(
            new mapkit.PolylineOverlay(pts, {
              style: new mapkit.Style({ strokeColor: p.color, lineWidth: 1, strokeOpacity: 0.6 }),
            }),
          );
        }
      }
    }

    if (newOverlays.length) {
      map.addOverlays(newOverlays);
      overlaysRef.current = newOverlays;
    }

    if (allCoords.length) {
      try {
        const region = mapkit.CoordinateRegion.fromCoordinates(allCoords);
        map.region = region;
      } catch {
        /* noop */
      }
    }
  }, [withGeometry]);

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view its map.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="relative h-[600px] w-full bg-muted">
          <div ref={containerRef} className="h-full w-full" />
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
