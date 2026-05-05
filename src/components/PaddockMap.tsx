import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

const PALETTE = [
  "hsl(20 90% 50%)",
  "hsl(160 70% 40%)",
  "hsl(280 60% 55%)",
  "hsl(200 80% 45%)",
  "hsl(40 90% 50%)",
  "hsl(340 70% 50%)",
];

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      try {
        map.fitBounds(bounds, { padding: [24, 24] });
      } catch {
        /* noop */
      }
    }
  }, [bounds, map]);
  return null;
}

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

export default function PaddockMap() {
  const { selectedVineyardId } = useVineyard();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["paddocks-map", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
  });

  const paddocks = data ?? [];

  const parsed = useMemo(
    () =>
      paddocks.map((p, i) => {
        const polygon = parsePolygonPoints(p.polygon_points);
        const rows = parseRows(p.rows);
        const allocations = parseVarietyAllocations(p.variety_allocations);
        return {
          paddock: p,
          polygon,
          rows,
          allocations,
          color: PALETTE[i % PALETTE.length],
          centroid: polygonCentroid(polygon),
          metrics: deriveMetrics(p),
        };
      }),
    [paddocks],
  );

  const withGeometry = parsed.filter((p) => p.polygon.length >= 3);
  const withoutGeometry = parsed.filter((p) => p.polygon.length < 3);

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (!withGeometry.length) return null;
    const all: [number, number][] = [];
    for (const p of withGeometry) {
      for (const pt of p.polygon) all.push([pt.lat, pt.lng]);
    }
    if (!all.length) return null;
    return L.latLngBounds(all);
  }, [withGeometry]);

  const selected = parsed.find((p) => p.paddock.id === selectedId) ?? null;

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view its map.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="h-[600px] w-full bg-muted">
          {isLoading && (
            <div className="h-full flex items-center justify-center text-muted-foreground">Loading map…</div>
          )}
          {error && (
            <div className="h-full flex items-center justify-center text-destructive">
              {(error as Error).message}
            </div>
          )}
          {!isLoading && !error && !withGeometry.length && (
            <div className="h-full flex items-center justify-center text-muted-foreground text-center px-4">
              No paddocks have map boundaries yet. If expected records are missing, check that
              the selected vineyard is correct and that this user has owner/manager access.
            </div>
          )}
          {!isLoading && !error && withGeometry.length > 0 && (
            <MapContainer
              center={[
                withGeometry[0].centroid?.lat ?? 0,
                withGeometry[0].centroid?.lng ?? 0,
              ]}
              zoom={16}
              scrollWheelZoom
              className="h-full w-full"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />
              <FitBounds bounds={bounds} />
              {withGeometry.map((p) => (
                <PaddockLayer
                  key={p.paddock.id}
                  data={p}
                  active={p.paddock.id === selectedId}
                  onClick={() => setSelectedId(p.paddock.id)}
                />
              ))}
            </MapContainer>
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

function PaddockLayer({
  data,
  active,
  onClick,
}: {
  data: ReturnType<typeof useMemo> extends never ? never : any;
  active: boolean;
  onClick: () => void;
}) {
  const { paddock, polygon, rows, allocations, color, centroid } = data;
  const positions = polygon.map((p: LatLng) => [p.lat, p.lng] as [number, number]);

  return (
    <>
      <Polygon
        positions={positions}
        pathOptions={{
          color,
          weight: active ? 3 : 2,
          fillOpacity: active ? 0.35 : 0.18,
        }}
        eventHandlers={{ click: onClick }}
      >
        {centroid && (
          <Tooltip
            direction="center"
            permanent
            className="!bg-transparent !border-0 !shadow-none !text-foreground !font-medium"
          >
            {paddock.name ?? "Unnamed"}
          </Tooltip>
        )}
      </Polygon>

      {allocations
        .filter((a: any) => a.polygon && a.polygon.length >= 3)
        .map((a: any, i: number) => (
          <Polygon
            key={`alloc-${paddock.id}-${i}`}
            positions={a.polygon.map((p: LatLng) => [p.lat, p.lng])}
            pathOptions={{
              color: PALETTE[(i + 2) % PALETTE.length],
              weight: 1,
              fillOpacity: 0.25,
              dashArray: "4,4",
            }}
          />
        ))}

      {rows.map((r: any, i: number) => {
        const pts: [number, number][] = [];
        if (r.points && r.points.length >= 2) {
          for (const p of r.points) pts.push([p.lat, p.lng]);
        } else if (r.start && r.end) {
          pts.push([r.start.lat, r.start.lng], [r.end.lat, r.end.lng]);
        }
        if (pts.length < 2) return null;
        return (
          <Polyline
            key={`row-${paddock.id}-${i}`}
            positions={pts}
            pathOptions={{ color, weight: 1, opacity: 0.6 }}
          />
        );
      })}
    </>
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
