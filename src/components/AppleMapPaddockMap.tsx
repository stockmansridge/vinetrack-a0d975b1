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
  updated_at?: string | null;
}

const ROW_GREEN = "#34C759";

interface AppleMapPaddockMapProps {
  onUnavailable: (reason: string) => void;
}

// Module-level memo: parsed geometry per (id + updated_at).
const geomCache = new Map<string, ReturnType<typeof buildParsed>>();
function buildParsed(p: Paddock) {
  const polygon = parsePolygonPoints(p.polygon_points);
  const rows = parseRows(p.rows);
  return {
    polygon,
    rows,
    centroid: polygonCentroid(polygon),
    color: paddockColor(p.id),
    metrics: deriveMetrics(p),
  };
}
function getParsed(p: Paddock) {
  const key = `${p.id}:${p.updated_at ?? ""}`;
  let v = geomCache.get(key);
  if (!v) {
    v = buildParsed(p);
    geomCache.set(key, v);
  }
  return v;
}

export default function AppleMapPaddockMap({ onUnavailable }: AppleMapPaddockMapProps) {
  const { selectedVineyardId } = useVineyard();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [mapReady, setMapReady] = useState(false);
  const [renderPhase, setRenderPhase] = useState<"loading-mapkit" | "rendering" | "ready">(
    "loading-mapkit",
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const annotationsRef = useRef<any[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
    staleTime: 5 * 60_000,
  });

  const paddocks = data ?? [];
  const parsed = useMemo(
    () => paddocks.map((p) => ({ paddock: p, ...getParsed(p) })),
    [paddocks],
  );
  const withGeometry = parsed.filter((p) => p.polygon.length >= 3);
  const withoutGeometry = parsed.filter((p) => p.polygon.length < 3);
  const selected = parsed.find((p) => p.paddock.id === selectedId) ?? null;

  // Init MapKit map
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
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
        console.info("[AppleMap] mapkit ready", {
          ms: Math.round(performance.now() - t0),
        });
        setMapReady(true);
        setRenderPhase("rendering");
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
    const t0 = performance.now();

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

    let totalParsedRows = 0;

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

      // Row segments — canonical iOS shape uses start/end (parsed) only.
      type Seg = { start: LatLng; end: LatLng; number?: number };
      const rowSegments: Seg[] = p.rows
        .map((r): Seg | null =>
          r.start && r.end ? { start: r.start, end: r.end, number: r.number } : null,
        )
        .filter((s): s is Seg => !!s && validPt(s.start) && validPt(s.end));

      totalParsedRows += rowSegments.length;

      // Render row lines for selected paddock OR when ≤200 total rows in view.
      const renderRowsForThis = isSelected || withGeometry.length <= 1 || (p.rows.length <= 200);

      if (renderRowsForThis) {
        rowSegments.forEach((seg) => {
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
        });

        // Label first + last row only at startPoint.
        const labelTargets =
          rowSegments.length === 0
            ? []
            : rowSegments.length === 1
            ? [{ seg: rowSegments[0], n: rowSegments[0].number ?? 1 }]
            : [
                { seg: rowSegments[0], n: rowSegments[0].number ?? 1 },
                {
                  seg: rowSegments[rowSegments.length - 1],
                  n: rowSegments[rowSegments.length - 1].number ?? rowSegments.length,
                },
              ];
        for (const { seg, n } of labelTargets) {
          newAnnotations.push(
            new mapkit.Annotation(
              new mapkit.Coordinate(seg.start.lat, seg.start.lng),
              () => {
                const el = document.createElement("div");
                el.className = "vt-row-chip";
                el.textContent = String(n);
                return el;
              },
              { anchorOffset: new DOMPoint(0, -6) },
            ),
          );
        }
      }

      // Clickable name annotation
      if (p.centroid && validPt(p.centroid) && p.paddock.name) {
        const name = p.paddock.name;
        const id = p.paddock.id;
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(p.centroid.lat, p.centroid.lng),
          () => {
            const el = document.createElement("div");
            el.className = "vt-name-chip";
            el.style.pointerEvents = "auto";
            el.style.cursor = "pointer";
            el.textContent = name;
            el.addEventListener("click", (ev) => {
              ev.stopPropagation();
              setSelectedId(id);
            });
            return el;
          },
        );
        // Also hook MapKit's own select event
        try {
          ann.addEventListener?.("select", () => setSelectedId(id));
        } catch { /* noop */ }
        newAnnotations.push(ann);
      }
    }

    // Batch add
    if (newOverlays.length) {
      map.addOverlays(newOverlays);
      overlaysRef.current = newOverlays;
    }
    if (newAnnotations.length) {
      map.addAnnotations(newAnnotations);
      annotationsRef.current = newAnnotations;
    }

    // Manual bounds-based region fit (only when no selection / first render)
    let bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null = null;
    if (allPts.length && !selectedIdRef.current) {
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

    setRenderPhase("ready");
    console.info("[AppleMap] render", {
      ms: Math.round(performance.now() - t0),
      paddocks: paddocks.length,
      withGeometry: withGeometry.length,
      pointsUsed: allPts.length,
      overlaysAdded: newOverlays.length,
      annotationsAdded: newAnnotations.length,
      totalParsedRows,
      bounds,
    });
  }, [withGeometry, selectedId, mapReady, paddocks.length]);

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view its map.</div>;
  }

  const noGeometryAtAll = !isLoading && !error && parsed.length > 0 && withGeometry.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card className="overflow-hidden">
        <div className="relative h-[600px] w-full bg-muted">
          <div ref={containerRef} className="h-full w-full" />
          <MapSourceBadge source="apple" />
          {(isLoading || !mapReady) && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/60">
              {!mapReady ? "Loading Apple Maps…" : "Rendering paddocks…"}
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
              Click a paddock or its name label to see details. {withGeometry.length} paddock
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
