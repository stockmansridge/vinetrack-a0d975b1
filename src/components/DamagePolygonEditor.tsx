// Interactive Apple MapKit polygon editor for Damage Records (Phase 2).
//
// - Click/tap on the map to add a vertex.
// - Drag any vertex marker to refine.
// - Undo / Clear / Redraw to manage the polygon.
// - Warns (does not block) when a vertex lies outside the selected paddock.
// - Polygon state lives entirely in the parent via the `value` / `onChange`
//   props — this component never writes to Supabase.
//
// Output coordinates use the same { lat, lng } shape as the rest of the app;
// the parent serialises to the iOS-canonical { latitude, longitude } shape
// before saving to `damage_records.polygon_points`.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { initMapKit } from "@/lib/mapkit";
import { polygonCentroid, type LatLng } from "@/lib/paddockGeometry";

interface Props {
  paddockPolygon: LatLng[];
  value: LatLng[];
  onChange: (next: LatLng[]) => void;
  height?: number;
  /** Called with `true` when any vertex lies outside the paddock polygon. */
  onOutsideChange?: (outside: boolean) => void;
}

const PADDOCK_COLOR = "#2E7D32";
const DAMAGE_COLOR = "#E53935";
const DAMAGE_OUTSIDE_COLOR = "#F59E0B";

export default function DamagePolygonEditor({
  paddockPolygon,
  value,
  onChange,
  height = 320,
  onOutsideChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const polygonOverlayRef = useRef<any>(null);
  const paddockOverlayRef = useRef<any>(null);
  const vertexAnnotationsRef = useRef<any[]>([]);
  const tapHandlerRef = useRef<((e: any) => void) | null>(null);
  const valueRef = useRef<LatLng[]>(value);
  const drawRef = useRef(true);
  // Set true while a vertex marker is being dragged so the map's single-tap
  // handler doesn't add a spurious vertex when MapKit also fires a tap.
  const draggingVertexRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(true);
  const [outside, setOutside] = useState(false);

  // Keep refs in sync so the long-lived map listener always sees latest state.
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { drawRef.current = drawing; }, [drawing]);

  // ---- Init map once ----
  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          isRotationEnabled: false,
          showsCompass: mapkit.FeatureVisibility.Hidden,
          showsScale: mapkit.FeatureVisibility.Adaptive,
          showsZoomControl: true,
        });
        mapRef.current = map;

        const onTap = (e: any) => {
          if (!drawRef.current) return;
          try {
            // Defensive: prefer a coordinate the event already carries; fall
            // back to converting the page point. Older MapKit JS builds expose
            // `coordinate`, newer builds only `pointOnPage`.
            let coord: any = e?.coordinate ?? null;
            if (!coord) {
              const pt = e?.pointOnPage ?? e?.point ?? null;
              if (!pt) return;
              coord = map.convertPointOnPageToCoordinate(pt);
            }
            const lat = coord?.latitude;
            const lng = coord?.longitude;
            if (typeof lat !== "number" || typeof lng !== "number") return;
            onChange([...valueRef.current, { lat, lng }]);
          } catch { /* noop */ }
        };
        tapHandlerRef.current = onTap;
        map.addEventListener("single-tap", onTap);

        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Map unavailable");
      });
    return () => {
      cancelled = true;
      try {
        if (tapHandlerRef.current) {
          mapRef.current?.removeEventListener("single-tap", tapHandlerRef.current);
        }
        mapRef.current?.destroy?.();
      } catch { /* noop */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Render paddock outline & fit on first paint ----
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;

    if (paddockOverlayRef.current) {
      try { map.removeOverlay(paddockOverlayRef.current); } catch { /* noop */ }
      paddockOverlayRef.current = null;
    }

    if (paddockPolygon.length >= 3) {
      const coords = paddockPolygon.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      const overlay = new mapkit.PolygonOverlay(coords, {
        style: new mapkit.Style({
          strokeColor: PADDOCK_COLOR,
          fillColor: PADDOCK_COLOR,
          fillOpacity: 0.1,
          strokeOpacity: 0.95,
          lineWidth: 2,
        }),
      });
      overlay.enabled = false;
      map.addOverlay(overlay);
      paddockOverlayRef.current = overlay;

      // Fit once on initial render of the paddock polygon (or when paddock changes).
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const pt of paddockPolygon) {
        if (pt.lat < minLat) minLat = pt.lat;
        if (pt.lat > maxLat) maxLat = pt.lat;
        if (pt.lng < minLng) minLng = pt.lng;
        if (pt.lng > maxLng) maxLng = pt.lng;
      }
      const c = polygonCentroid(paddockPolygon) ?? {
        lat: (minLat + maxLat) / 2,
        lng: (minLng + maxLng) / 2,
      };
      const latDelta = Math.max((maxLat - minLat) * 1.6, 0.001);
      const lngDelta = Math.max((maxLng - minLng) * 1.6, 0.001);
      try {
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(c.lat, c.lng),
          new mapkit.CoordinateSpan(latDelta, lngDelta),
        );
      } catch { /* noop */ }
    }
  }, [ready, paddockPolygon]);

  // ---- Render damage polygon + draggable vertices ----
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;

    // Remove previous overlay + annotations.
    if (polygonOverlayRef.current) {
      try { map.removeOverlay(polygonOverlayRef.current); } catch { /* noop */ }
      polygonOverlayRef.current = null;
    }
    if (vertexAnnotationsRef.current.length) {
      try { map.removeAnnotations(vertexAnnotationsRef.current); } catch { /* noop */ }
      vertexAnnotationsRef.current = [];
    }

    const anyOutside =
      paddockPolygon.length >= 3 &&
      value.some((p) => !pointInPolygon(p, paddockPolygon));
    if (anyOutside !== outside) setOutside(anyOutside);
    onOutsideChange?.(anyOutside);

    if (value.length >= 3) {
      const coords = value.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      const color = anyOutside ? DAMAGE_OUTSIDE_COLOR : DAMAGE_COLOR;
      const overlay = new mapkit.PolygonOverlay(coords, {
        style: new mapkit.Style({
          strokeColor: color,
          fillColor: color,
          fillOpacity: 0.35,
          strokeOpacity: 1,
          lineWidth: 2,
        }),
      });
      overlay.enabled = false;
      map.addOverlay(overlay);
      polygonOverlayRef.current = overlay;
    }

    // One draggable marker per vertex.
    const annotations = value.map((p, idx) => {
      const ann = new mapkit.MarkerAnnotation(new mapkit.Coordinate(p.lat, p.lng), {
        color: anyOutside ? DAMAGE_OUTSIDE_COLOR : DAMAGE_COLOR,
        glyphText: String(idx + 1),
        title: `Vertex ${idx + 1}`,
        draggable: true,
        animates: false,
      });
      ann.addEventListener("drag-end", () => {
        const c = ann.coordinate;
        const next = valueRef.current.map((v, i) =>
          i === idx ? { lat: c.latitude, lng: c.longitude } : v,
        );
        onChange(next);
      });
      return ann;
    });
    if (annotations.length) {
      map.addAnnotations(annotations);
      vertexAnnotationsRef.current = annotations;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, value, paddockPolygon]);

  const undo = () => onChange(value.slice(0, -1));
  const clear = () => onChange([]);
  const redraw = () => { onChange([]); setDrawing(true); };

  return (
    <div className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-md border bg-muted"
        style={{ height, cursor: drawing && ready ? "crosshair" : "grab" }}
      >
        <div ref={containerRef} className="h-full w-full" />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive bg-background/70">
            {error}
          </div>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background/40">
            Loading map…
          </div>
        )}
        {ready && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-2 py-1 text-[11px] text-foreground shadow">
            {drawing
              ? value.length === 0
                ? "Tap on the paddock to start drawing the damage polygon"
                : `Tap to add vertex · drag a marker to adjust (${value.length} pts)`
              : "Drag markers to adjust · enable Draw to add more vertices"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={drawing ? "default" : "outline"}
          onClick={() => setDrawing((d) => !d)}
          disabled={!ready}
        >
          {drawing ? "Drawing on" : "Draw"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={undo}
          disabled={!ready || value.length === 0}
        >
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={clear}
          disabled={!ready || value.length === 0}
        >
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={redraw}
          disabled={!ready}
        >
          Redraw
        </Button>
        {value.length > 0 && value.length < 3 && (
          <span className="text-[11px] text-muted-foreground">
            Need at least 3 vertices to form a polygon.
          </span>
        )}
        {outside && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            ⚠ Some vertices are outside the paddock boundary.
          </span>
        )}
      </div>
    </div>
  );
}

// Standard ray-casting point-in-polygon (Wikipedia / W. Randolph Franklin).
// Treats lat/lng as a 2D plane — accurate enough for vineyard-scale polygons.
// Tolerates a closed ring (last point == first point) and ignores degenerate
// horizontal edges. No epsilon hacks: the strict-greater comparisons handle
// vertex-on-ray ambiguity consistently.
function pointInPolygon(pt: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  // Drop a closing duplicate so we don't process a zero-length edge.
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  const ring =
    polygon.length > 3 && first.lat === last.lat && first.lng === last.lng
      ? polygon.slice(0, -1)
      : polygon;

  const x = pt.lng;
  const y = pt.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    if (yi === yj) continue; // skip horizontal edges
    const crosses = (yi > y) !== (yj > y);
    if (!crosses) continue;
    const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < xCross) inside = !inside;
  }
  return inside;
}
