// Boundary draw map for the New Paddock wizard (also reused as a
// read-only satellite preview on the Rows step).
//
// Parity goal with iOS:
//   - Apple-style satellite/hybrid imagery (MapKit JS when available,
//     Esri World Imagery tiles via Leaflet as a fallback).
//   - Centre on user → vineyard shared location → existing paddock
//     centroid → safe default.
//   - Existing paddocks rendered as semi-transparent shaded outlines
//     for reference (never editable from this flow).
//   - Editable polygon (when not readonly): tap empty map to append,
//     drag a vertex to reposition, tap a midpoint handle to insert,
//     tap a vertex (with ≥4 pts) to delete.
//   - Optional row overlay (used by the Rows step preview).
//   - Polygon stored open (first vertex not repeated) per the
//     iOS-canonical contract.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { initMapKit } from "@/lib/mapkit";
import { fetchVineyardLocation } from "@/lib/vineyardLocationQuery";
import { fetchList } from "@/lib/queries";
import { useVineyard } from "@/context/VineyardContext";
import {
  parsePolygonPoints,
  polygonCentroid,
  type LatLng,
} from "@/lib/paddockGeometry";

// New (in-progress) paddock styling — bright, high-contrast.
const POLY_STROKE = "#34C759";
const POLY_FILL = "#34C759";
// Existing paddocks — muted, semi-transparent reference outlines.
const EXISTING_STROKE = "#E5E7EB";
const EXISTING_FILL = "#9CA3AF";
// Row preview styling — matches iOS yellow lines on satellite.
const ROW_STROKE = "#FFD60A";
const DEFAULT_CENTER: LatLng = { lat: -34.5, lng: 138.7 };

export interface RowOverlay {
  id?: string;
  number?: number;
  startPoint: { latitude: number; longitude: number };
  endPoint: { latitude: number; longitude: number };
}

interface Props {
  polygon: LatLng[];
  setPolygon?: (p: LatLng[]) => void;
  readonly?: boolean;
  rows?: RowOverlay[];
  excludePaddockId?: string;
}


// Compute axis-aligned bounding box for a polygon.
function polygonBBox(pts: LatLng[]): { sw: LatLng; ne: LatLng } | null {
  if (!pts.length) return null;
  let minLat = pts[0].lat, maxLat = pts[0].lat;
  let minLng = pts[0].lng, maxLng = pts[0].lng;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { sw: { lat: minLat, lng: minLng }, ne: { lat: maxLat, lng: maxLng } };
}

// Resolve initial centre. Priority (matches iOS):
//   1. Existing paddock polygon (if we're editing one) → instant focus.
//   2. Browser geolocation.
//   3. Shared vineyard location (SQL 80).
//   4. Centroid of other paddocks.
//   5. Safe default.
function useInitialCentre(
  vineyardId: string | null,
  paddocks: any[] | undefined,
  loc: any,
  initialPolygon: LatLng[],
): LatLng | null {
  const [centre, setCentre] = useState<LatLng | null>(() => {
    const c = polygonCentroid(initialPolygon);
    return c ?? null;
  });

  useEffect(() => {
    if (centre) return;
    let cancelled = false;
    let settled = false;

    const resolveFallback = () => {
      if (cancelled || settled) return;
      if (loc?.latitude != null && loc?.longitude != null) {
        setCentre({ lat: Number(loc.latitude), lng: Number(loc.longitude) });
        settled = true;
        return;
      }
      const pts: LatLng[] = [];
      for (const p of paddocks ?? []) {
        const c = polygonCentroid(parsePolygonPoints(p?.polygon_points));
        if (c) pts.push(c);
      }
      const c = polygonCentroid(pts);
      if (c) {
        setCentre(c);
        settled = true;
        return;
      }
      setCentre(DEFAULT_CENTER);
      settled = true;
    };

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      const timer = setTimeout(resolveFallback, 4000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          if (cancelled || settled) return;
          setCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          settled = true;
        },
        () => {
          clearTimeout(timer);
          resolveFallback();
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 4000 },
      );
    } else {
      resolveFallback();
    }
    return () => { cancelled = true; };
  }, [loc, paddocks, centre]);

  return centre;
}

export default function BoundaryDrawMap({ polygon, setPolygon, readonly = false, rows = [], excludePaddockId }: Props) {
  const { selectedVineyardId } = useVineyard();
  const { data: loc } = useQuery({
    queryKey: ["vineyard-location-centre", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardLocation(selectedVineyardId!),
    staleTime: 5 * 60_000,
  });
  const { data: paddocks } = useQuery({
    queryKey: ["paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<any>("paddocks", selectedVineyardId!),
    staleTime: 5 * 60_000,
  });

  // Capture the polygon snapshot at mount so we focus on the existing
  // boundary immediately, not on every edit.
  const initialPolygonRef = useRef<LatLng[]>(polygon);
  const centre = useInitialCentre(selectedVineyardId, paddocks, loc, initialPolygonRef.current);

  // Existing paddock polygons (reference outlines) — excluding the
  // currently-edited paddock so it doesn't overlap its own editable polygon.
  const existingPolygons = useMemo<LatLng[][]>(() => {
    const out: LatLng[][] = [];
    for (const p of paddocks ?? []) {
      if (excludePaddockId && p?.id === excludePaddockId) continue;
      const pts = parsePolygonPoints(p?.polygon_points);
      if (pts.length >= 3) out.push(pts);
    }
    return out;
  }, [paddocks, excludePaddockId]);

  // BBox to fit on initial render: prefer the polygon being edited, else
  // the union of existing paddocks so reference outlines are immediately
  // visible on a fresh New Paddock map.
  const initialBBox = useMemo(() => {
    const own = polygonBBox(initialPolygonRef.current);
    if (own) return own;
    const all: LatLng[] = [];
    for (const pts of existingPolygons) all.push(...pts);
    return polygonBBox(all);
  }, [existingPolygons]);

  // First / last row labels for the readonly preview map.
  const rowLabels = useMemo(() => {
    if (!rows.length) return [] as Array<{ n: number; lat: number; lng: number }>;
    const numbered = rows
      .map((r, i) => ({ n: typeof r.number === "number" ? r.number : i + 1, r }))
      .sort((a, b) => a.n - b.n);
    const first = numbered[0];
    const last = numbered[numbered.length - 1];
    const pick = first === last ? [first] : [first, last];
    return pick.map(({ n, r }) => ({
      n,
      lat: r.startPoint.latitude,
      lng: r.startPoint.longitude,
    }));
  }, [rows]);




  const [mode, setMode] = useState<"checking" | "apple" | "fallback">("checking");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMode("checking");
    initMapKit()
      .then(() => { if (!cancelled) setMode("apple"); })
      .catch((e) => {
        if (!cancelled) {
          setReason(e?.message || "MapKit unavailable");
          setMode("fallback");
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (!centre || mode === "checking") {
    return <div className="h-full w-full bg-muted animate-pulse" />;
  }

  const setPoly = setPolygon ?? (() => {});

  return (
    <div className="relative h-full w-full">
      {mode === "apple" ? (
        <AppleDrawMap
          centre={centre}
          initialBBox={initialBBox}
          polygon={polygon}
          setPolygon={setPoly}
          readonly={readonly}
          rows={rows}
          rowLabels={rowLabels}
          existingPolygons={existingPolygons}
        />
      ) : (
        <LeafletSatelliteDraw
          centre={centre}
          initialBBox={initialBBox}
          polygon={polygon}
          setPolygon={setPoly}
          readonly={readonly}
          rows={rows}
          rowLabels={rowLabels}
          existingPolygons={existingPolygons}
        />
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-2 py-1 text-[11px] text-foreground shadow">
        {mode === "apple" ? "Apple Maps · Hybrid" : "Satellite (Esri)"}
        {polygon.length > 0 && ` · ${polygon.length} pts`}
        {rows.length > 0 && ` · ${rows.length} rows`}
      </div>
      {!readonly && (
        <div className="pointer-events-none absolute left-2 bottom-2 right-2 rounded bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow">
          Tap empty map to add a point · <strong>click and hold (~1s) then drag</strong> a point to move it · tap a small <span className="inline-block w-2 h-2 rounded-full bg-white border border-[color:hsl(145_42%_28%)] align-middle" /> midpoint to insert · tap a numbered point to delete (needs ≥4)
        </div>
      )}
      {mode === "fallback" && reason && (
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow" title={reason}>
          Apple Maps unavailable — using satellite fallback
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Apple MapKit drawing surface (with editable polygon)
// ────────────────────────────────────────────────────────────────────────────

function AppleDrawMap({
  centre, initialBBox, polygon, setPolygon, readonly, rows, rowLabels, existingPolygons,
}: {
  centre: LatLng;
  initialBBox: { sw: LatLng; ne: LatLng } | null;
  polygon: LatLng[];
  setPolygon: (p: LatLng[]) => void;
  readonly: boolean;
  rows: RowOverlay[];
  rowLabels: { n: number; lat: number; lng: number }[];
  existingPolygons: LatLng[][];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const didInitialFitRef = useRef(false);
  const overlayRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const vertexAnnsRef = useRef<any[]>([]);
  const midAnnsRef = useRef<any[]>([]);
  const existingOverlaysRef = useRef<any[]>([]);
  const rowOverlaysRef = useRef<any[]>([]);
  const rowLabelAnnsRef = useRef<any[]>([]);
  const polygonRef = useRef<LatLng[]>(polygon);
  polygonRef.current = polygon;
  const setPolygonRef = useRef(setPolygon);
  setPolygonRef.current = setPolygon;
  const readonlyRef = useRef(readonly);
  readonlyRef.current = readonly;

  // Init once.
  useEffect(() => {
    let cancelled = false;
    initMapKit().then((mapkit) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new mapkit.Map(containerRef.current, {
        mapType: mapkit.Map.MapTypes.Hybrid,
        isRotationEnabled: true,
        showsCompass: mapkit.FeatureVisibility.Adaptive,
        showsScale: mapkit.FeatureVisibility.Adaptive,
        showsZoomControl: true,
      });
      mapRef.current = map;
      setMapReady(true);
      try {
        if (initialBBox) {
          const latSpan = Math.max(0.0008, (initialBBox.ne.lat - initialBBox.sw.lat) * 1.6);
          const lngSpan = Math.max(0.0008, (initialBBox.ne.lng - initialBBox.sw.lng) * 1.6);
          const cLat = (initialBBox.ne.lat + initialBBox.sw.lat) / 2;
          const cLng = (initialBBox.ne.lng + initialBBox.sw.lng) / 2;
          map.region = new mapkit.CoordinateRegion(
            new mapkit.Coordinate(cLat, cLng),
            new mapkit.CoordinateSpan(latSpan, lngSpan),
          );
        } else {
          map.region = new mapkit.CoordinateRegion(
            new mapkit.Coordinate(centre.lat, centre.lng),
            new mapkit.CoordinateSpan(0.004, 0.004),
          );
        }
      } catch { /* noop */ }

      const onTap = (e: any) => {
        if (readonlyRef.current) return;
        try {
          let coord: any = e?.coordinate ?? null;
          if (!coord) {
            const pt = e?.pointOnPage ?? e?.point ?? null;
            if (!pt) return;
            coord = map.convertPointOnPageToCoordinate(pt);
          }
          const lat = coord?.latitude;
          const lng = coord?.longitude;
          if (typeof lat !== "number" || typeof lng !== "number") return;
          setPolygonRef.current([...polygonRef.current, { lat, lng }]);
        } catch { /* noop */ }
      };
      map.addEventListener("single-tap", onTap);
    }).catch(() => { /* parent already handled unavailable */ });
    return () => {
      cancelled = true;
      setMapReady(false);
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit || didInitialFitRef.current) return;
    try {
      if (initialBBox) {
        const latSpan = Math.max(0.0008, (initialBBox.ne.lat - initialBBox.sw.lat) * 1.6);
        const lngSpan = Math.max(0.0008, (initialBBox.ne.lng - initialBBox.sw.lng) * 1.6);
        const cLat = (initialBBox.ne.lat + initialBBox.sw.lat) / 2;
        const cLng = (initialBBox.ne.lng + initialBBox.sw.lng) / 2;
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(cLat, cLng),
          new mapkit.CoordinateSpan(latSpan, lngSpan),
        );
      } else {
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(centre.lat, centre.lng),
          new mapkit.CoordinateSpan(0.004, 0.004),
        );
      }
      didInitialFitRef.current = true;
    } catch {
      /* noop */
    }
  }, [centre, initialBBox, mapReady]);

  // Existing paddock overlays (reference outlines).
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;
    if (existingOverlaysRef.current.length) {
      try { for (const o of existingOverlaysRef.current) map.removeOverlay(o); } catch { /* noop */ }
      existingOverlaysRef.current = [];
    }
    const next: any[] = [];
    for (const pts of existingPolygons) {
      const coords = pts.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      const overlay = new mapkit.PolygonOverlay(coords, {
        style: new mapkit.Style({
          strokeColor: EXISTING_STROKE,
          fillColor: EXISTING_FILL,
          fillOpacity: 0.18,
          strokeOpacity: 0.7,
          lineWidth: 1,
        }),
      });
      try { overlay.enabled = false; } catch { /* noop */ }
      map.addOverlay(overlay);
      next.push(overlay);
    }
    existingOverlaysRef.current = next;
  }, [existingPolygons, mapReady]);

  // Row overlay polylines.
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;
    if (rowOverlaysRef.current.length) {
      try { for (const o of rowOverlaysRef.current) map.removeOverlay(o); } catch { /* noop */ }
      rowOverlaysRef.current = [];
    }
    const next: any[] = [];
    for (const r of rows) {
      const line = new mapkit.PolylineOverlay(
        [
          new mapkit.Coordinate(r.startPoint.latitude, r.startPoint.longitude),
          new mapkit.Coordinate(r.endPoint.latitude, r.endPoint.longitude),
        ],
        { style: new mapkit.Style({ strokeColor: ROW_STROKE, lineWidth: 1.75, strokeOpacity: 0.95 }) },
      );
      try { line.enabled = false; } catch { /* noop */ }
      map.addOverlay(line);
      next.push(line);
    }
    rowOverlaysRef.current = next;
  }, [rows, mapReady]);

  // First/last row number labels.
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;
    if (rowLabelAnnsRef.current.length) {
      try { map.removeAnnotations(rowLabelAnnsRef.current); } catch { /* noop */ }
      rowLabelAnnsRef.current = [];
    }
    const next: any[] = [];
    for (const lbl of rowLabels) {
      const ann = new mapkit.Annotation(
        new mapkit.Coordinate(lbl.lat, lbl.lng),
        () => {
          const el = document.createElement("div");
          el.style.cssText =
            "background:#FFD60A;color:#1f1f1f;font-size:11px;font-weight:700;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 2px rgba(0,0,0,.5);transform:translate(-50%,-50%);white-space:nowrap;border:1px solid rgba(0,0,0,.25)";
          el.textContent = `Row ${lbl.n}`;
          return el;
        },
      );
      try { (ann as any).selectable = false; } catch { /* noop */ }
      next.push(ann);
    }
    if (next.length) {
      map.addAnnotations(next);
      rowLabelAnnsRef.current = next;
    }
  }, [rowLabels, mapReady]);


  // Re-render polygon overlay + vertex + midpoint annotations.
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;

    if (overlayRef.current) { try { map.removeOverlay(overlayRef.current); } catch { /* noop */ } overlayRef.current = null; }
    if (lineRef.current) { try { map.removeOverlay(lineRef.current); } catch { /* noop */ } lineRef.current = null; }
    if (vertexAnnsRef.current.length) {
      try { map.removeAnnotations(vertexAnnsRef.current); } catch { /* noop */ }
      vertexAnnsRef.current = [];
    }
    if (midAnnsRef.current.length) {
      try { map.removeAnnotations(midAnnsRef.current); } catch { /* noop */ }
      midAnnsRef.current = [];
    }

    if (polygon.length >= 3) {
      const coords = polygon.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      const overlay = new mapkit.PolygonOverlay(coords, {
        style: new mapkit.Style({
          strokeColor: POLY_STROKE,
          fillColor: POLY_FILL,
          fillOpacity: 0.25,
          strokeOpacity: 1,
          lineWidth: 2.5,
          lineJoin: "round",
        }),
      });
      try { overlay.enabled = false; } catch { /* noop */ }
      map.addOverlay(overlay);
      overlayRef.current = overlay;
    } else if (polygon.length === 2) {
      const line = new mapkit.PolylineOverlay(
        polygon.map((p) => new mapkit.Coordinate(p.lat, p.lng)),
        { style: new mapkit.Style({ strokeColor: POLY_STROKE, lineWidth: 2 }) },
      );
      try { line.enabled = false; } catch { /* noop */ }
      map.addOverlay(line);
      lineRef.current = line;
    }

    if (readonly) return; // no editable handles

    // Vertex annotations — draggable; tap deletes when ≥4 pts.
    const vertexAnns = polygon.map((p, i) => {
      const ann = new mapkit.Annotation(
        new mapkit.Coordinate(p.lat, p.lng),
        () => {
          const el = document.createElement("div");
          el.style.cssText =
            "background:#34C759;color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:grab";
          el.textContent = String(i + 1);
          return el;
        },
      );
      try { ann.draggable = true; } catch { /* noop */ }
      ann.addEventListener("drag-end", () => {
        try {
          const c = ann.coordinate;
          const next = polygonRef.current.slice();
          next[i] = { lat: c.latitude, lng: c.longitude };
          setPolygonRef.current(next);
        } catch { /* noop */ }
      });
      ann.addEventListener("select", () => {
        if (polygonRef.current.length <= 3) return;
        const next = polygonRef.current.slice();
        next.splice(i, 1);
        setPolygonRef.current(next);
      });
      return ann;
    });
    if (vertexAnns.length) {
      map.addAnnotations(vertexAnns);
      vertexAnnsRef.current = vertexAnns;
    }

    // Midpoint annotations — tap to insert a vertex between two points.
    if (polygon.length >= 2) {
      const midAnns: any[] = [];
      const n = polygon.length;
      const segCount = n >= 3 ? n : 1;
      for (let i = 0; i < segCount; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % n];
        const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(mid.lat, mid.lng),
          () => {
            const el = document.createElement("div");
            el.style.cssText =
              "width:10px;height:10px;border-radius:9999px;background:#fff;border:2px solid #34C759;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:pointer;opacity:.85";
            return el;
          },
        );
        const insertAt = i + 1;
        ann.addEventListener("select", () => {
          const next = polygonRef.current.slice();
          next.splice(insertAt, 0, mid);
          setPolygonRef.current(next);
        });
        midAnns.push(ann);
      }
      if (midAnns.length) {
        map.addAnnotations(midAnns);
        midAnnsRef.current = midAnns;
      }
    }
  }, [polygon, readonly, mapReady]);

  return <div ref={containerRef} className="h-full w-full" />;
}

// ────────────────────────────────────────────────────────────────────────────
// Leaflet satellite fallback (Esri World Imagery)
// ────────────────────────────────────────────────────────────────────────────

function LeafletSatelliteDraw({
  centre, initialBBox, polygon, setPolygon, readonly, rows, rowLabels, existingPolygons,
}: {
  centre: LatLng;
  initialBBox: { sw: LatLng; ne: LatLng } | null;
  polygon: LatLng[];
  setPolygon: (p: LatLng[]) => void;
  readonly: boolean;
  rows: RowOverlay[];
  rowLabels: { n: number; lat: number; lng: number }[];
  existingPolygons: LatLng[][];
}) {
  return (
    <MapContainer center={[centre.lat, centre.lng]} zoom={17} scrollWheelZoom className="h-full w-full">
      {initialBBox && <FitBoundsOnce bbox={initialBBox} />}
      <TileLayer
        attribution='Tiles &copy; Esri'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
      <TileLayer
        attribution=""
        url="https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
        opacity={0.85}
      />
      {/* Existing paddocks — reference outlines */}
      {existingPolygons.map((pts, i) => (
        <Polygon
          key={`existing-${i}`}
          positions={pts.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: EXISTING_STROKE, weight: 1, fillColor: EXISTING_FILL, fillOpacity: 0.18, opacity: 0.7 }}
          interactive={false}
        />
      ))}
      {!readonly && <ClickHandler polygon={polygon} setPolygon={setPolygon} />}
      {polygon.length >= 3 && (
        <Polygon
          positions={polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: POLY_STROKE, weight: 2.5, fillOpacity: 0.25 }}
          interactive={false}
        />
      )}
      {polygon.length === 2 && (
        <Polyline
          positions={polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: POLY_STROKE, weight: 2 }}
          interactive={false}
        />
      )}
      {/* Row overlay */}
      {rows.map((r, i) => (
        <Polyline
          key={`row-${r.id ?? i}`}
          positions={[
            [r.startPoint.latitude, r.startPoint.longitude],
            [r.endPoint.latitude, r.endPoint.longitude],
          ]}
          pathOptions={{ color: ROW_STROKE, weight: 1.75, opacity: 0.95 }}
          interactive={false}
        />
      ))}
      {/* First/last row number labels */}
      {rowLabels.map((lbl) => (
        <Marker
          key={`rownum-${lbl.n}`}
          position={[lbl.lat, lbl.lng]}
          icon={rowLabelIcon(lbl.n)}
          interactive={false}
        />
      ))}
      {/* Midpoint insert handles */}
      {!readonly && polygon.length >= 2 &&
        (() => {
          const n = polygon.length;
          const segCount = n >= 3 ? n : 1;
          const items: JSX.Element[] = [];
          for (let i = 0; i < segCount; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % n];
            const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
            const insertAt = i + 1;
            items.push(
              <Marker
                key={`mid-${i}`}
                position={[mid.lat, mid.lng]}
                icon={midIcon()}
                eventHandlers={{
                  click: () => {
                    const next = polygon.slice();
                    next.splice(insertAt, 0, mid);
                    setPolygon(next);
                  },
                }}
              />,
            );
          }
          return items;
        })()}
      {/* Vertex handles — draggable + click-to-delete */}
      {!readonly && polygon.map((p, i) => (
        <Marker
          key={`v-${i}`}
          position={[p.lat, p.lng]}
          icon={vertexIcon(i + 1)}
          draggable
          eventHandlers={{
            dragend: (e: any) => {
              const ll = e.target.getLatLng();
              const next = polygon.slice();
              next[i] = { lat: ll.lat, lng: ll.lng };
              setPolygon(next);
            },
            click: () => {
              if (polygon.length <= 3) return;
              const next = polygon.slice();
              next.splice(i, 1);
              setPolygon(next);
            },
          }}
        />
      ))}
    </MapContainer>
  );
}

function ClickHandler({ polygon, setPolygon }: { polygon: LatLng[]; setPolygon: (p: LatLng[]) => void }) {
  useMapEvents({
    click(e) {
      setPolygon([...polygon, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    },
  });
  return null;
}

// Fit the map to the existing paddock bounds once on mount so the
// boundary is visible immediately without requiring user interaction.
function FitBoundsOnce({ bbox }: { bbox: { sw: LatLng; ne: LatLng } }) {
  const map = useMap();
  const did = useRef(false);
  useEffect(() => {
    if (did.current) return;
    did.current = true;
    try {
      map.fitBounds(
        L.latLngBounds([bbox.sw.lat, bbox.sw.lng], [bbox.ne.lat, bbox.ne.lng]),
        { padding: [40, 40], maxZoom: 19 },
      );
    } catch { /* noop */ }
  }, [map, bbox]);
  return null;
}

function vertexIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#34C759;color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:grab">${n}</div>`,
    iconSize: [0, 0],
  });
}

function midIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:10px;height:10px;border-radius:9999px;background:#fff;border:2px solid #34C759;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:pointer;opacity:.85"></div>`,
    iconSize: [0, 0],
  });
}

function rowLabelIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#FFD60A;color:#1f1f1f;font-size:11px;font-weight:700;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 2px rgba(0,0,0,.5);transform:translate(-50%,-50%);white-space:nowrap;border:1px solid rgba(0,0,0,.25)">Row ${n}</div>`,
    iconSize: [0, 0],
  });
}
