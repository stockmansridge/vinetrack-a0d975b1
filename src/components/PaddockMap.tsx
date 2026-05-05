import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import {
  deriveMetrics,
  parsePolygonPoints,
  parseRows,
  polygonCentroid,
  LatLng,
} from "@/lib/paddockGeometry";
import { paddockColor } from "@/lib/paddockColor";
import MapSourceBadge from "@/components/MapSourceBadge";
import "@/components/map/mapChips.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PaddockDetailPanel from "@/components/PaddockDetailPanel";

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

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      try {
        // 1.5× span padding ≈ pad bounding box by 25% per side
        const lb = L.latLngBounds(bounds as L.LatLngBoundsLiteral).pad(0.25);
        map.fitBounds(lb, { padding: [16, 16] });
      } catch {
        /* noop */
      }
    }
  }, [bounds, map]);
  return null;
}



const nameIcon = (name: string) =>
  L.divIcon({
    className: "",
    html: `<div class="vt-name-chip">${escapeHtml(name)}</div>`,
    iconSize: [0, 0],
  });

const rowIcon = (n: number) =>
  L.divIcon({
    className: "",
    html: `<div class="vt-row-chip">${n}</div>`,
    iconSize: [0, 0],
  });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

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
        <div className="relative h-[600px] w-full bg-muted">
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
              No paddock geometry yet.
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
          <MapSourceBadge source="fallback" />
        </div>
      </Card>

      <div className="space-y-4">
        {selected ? (
          <PaddockDetailPanel
            paddock={selected.paddock}
            metrics={selected.metrics}
            parsedRowsCount={selected.rows.length}
            rawRowsCount={Array.isArray(selected.paddock.rows) ? selected.paddock.rows.length : 0}
            polygonPointCount={selected.polygon.length}
            onClose={() => setSelectedId(null)}
          />
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
  data: any;
  active: boolean;
  onClick: () => void;
}) {
  const { paddock, polygon, rows, color, centroid } = data;
  const positions = polygon.map((p: LatLng) => [p.lat, p.lng] as [number, number]);

  // Canonical iOS rows are start/end pairs with .number
  const rowSegments: { start: LatLng; end: LatLng; number?: number }[] = rows
    .map((r: any) =>
      r.start && r.end ? { start: r.start, end: r.end, number: r.number } : null,
    )
    .filter(Boolean);

  return (
    <>
      <Polygon
        positions={positions}
        pathOptions={{
          color,
          weight: active ? 3.5 : 2.5,
          opacity: active ? 1.0 : 0.9,
          fillColor: color,
          fillOpacity: active ? 0.35 : 0.25,
          lineJoin: "round",
          lineCap: "round",
        }}
        eventHandlers={{ click: onClick }}
      />

      {rowSegments.map((seg, i) => (
        <Polyline
          key={`row-${paddock.id}-${i}`}
          positions={[
            [seg.start.lat, seg.start.lng],
            [seg.end.lat, seg.end.lng],
          ]}
          pathOptions={{ color: ROW_GREEN, weight: 1.5, opacity: 0.85, lineCap: "round" }}
        />
      ))}

      {rowSegments.length > 0 && (
        <Marker
          position={[rowSegments[0].start.lat, rowSegments[0].start.lng]}
          icon={rowIcon(rowSegments[0].number ?? 1)}
          interactive={false}
        />
      )}
      {rowSegments.length > 1 && (
        <Marker
          position={[
            rowSegments[rowSegments.length - 1].start.lat,
            rowSegments[rowSegments.length - 1].start.lng,
          ]}
          icon={rowIcon(rowSegments[rowSegments.length - 1].number ?? rowSegments.length)}
          interactive={false}
        />
      )}

      {centroid && paddock.name && (
        <Marker
          position={[centroid.lat, centroid.lng]}
          icon={nameIcon(paddock.name)}
          eventHandlers={{ click: onClick }}
        />
      )}
    </>
  );
}
