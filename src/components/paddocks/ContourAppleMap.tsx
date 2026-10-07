// Apple MapKit JS map used by the Contour Row Mapping (Beta) pilot.
// Declarative wrapper: callers pass shapes/markers; overlays are rebuilt on change.
import { useEffect, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import MapSourceBadge from "@/components/MapSourceBadge";

export interface CLatLng { lat: number; lng: number }
export interface CShape {
  id: string;
  kind: "polygon" | "polyline";
  points: CLatLng[];
  color: string;
  width: number;
  opacity?: number;
  fillOpacity?: number;
  dash?: number[];
  onClick?: () => void;
}
export interface CMarker {
  id: string;
  point: CLatLng;
  html: string;
  size: number;
  /** pixel offset of element's left edge from coordinate (for labels) */
  labelOffsetX?: number;
  draggable?: boolean;
  onClick?: () => void;
  onDragEnd?: (p: CLatLng) => void;
}

interface Props {
  centre: CLatLng;
  shapes: CShape[];
  markers: CMarker[];
  onMapClick: (p: CLatLng) => void;
  fitPoints: CLatLng[];
  fitNonce: number;
}

export default function ContourAppleMap({ centre, shapes, markers, onMapClick, fitPoints, fitNonce }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const clickRef = useRef(onMapClick); clickRef.current = onMapClick;
  const shapeClicks = useRef(new Map<any, () => void>());
  const overlaysRef = useRef<any[]>([]);
  const annsRef = useRef<any[]>([]);
  const suppressTapUntil = useRef(0);

  useEffect(() => {
    let cancelled = false;
    initMapKit().then((mapkit) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new mapkit.Map(containerRef.current, {
        mapType: mapkit.Map.MapTypes.Hybrid,
        showsCompass: mapkit.FeatureVisibility.Adaptive,
        showsScale: mapkit.FeatureVisibility.Adaptive,
        showsZoomControl: true,
        showsUserLocationControl: false,
      });
      map.region = new mapkit.CoordinateRegion(new mapkit.Coordinate(centre.lat, centre.lng), new mapkit.CoordinateSpan(0.004, 0.004));
      map.addEventListener("select", (e: any) => {
        const ov = e?.overlay;
        if (ov) {
          const fn = shapeClicks.current.get(ov);
          suppressTapUntil.current = Date.now() + 300;
          try { map.selectedOverlay = null; } catch { /* noop */ }
          fn?.();
        }
      });
      map.addEventListener("single-tap", (e: any) => {
        if (Date.now() < suppressTapUntil.current) return;
        try {
          const pt = e?.pointOnPage;
          const c = e?.coordinate ?? (pt ? map.convertPointOnPageToCoordinate(pt) : null);
          if (c && typeof c.latitude === "number") clickRef.current({ lat: c.latitude, lng: c.longitude });
        } catch { /* noop */ }
      });
      mapRef.current = map;
      setReady(true);
    }).catch((e) => { if (!cancelled) setFailed(String(e?.message ?? e)); });
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit
  useEffect(() => {
    const map = mapRef.current; const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit || !fitPoints.length) return;
    const lats = fitPoints.map((p) => p.lat), lngs = fitPoints.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    try {
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
        new mapkit.CoordinateSpan(Math.max(0.0006, (maxLat - minLat) * 1.3), Math.max(0.0006, (maxLng - minLng) * 1.3)),
      );
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitNonce]);

  // Shapes
  useEffect(() => {
    const map = mapRef.current; const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;
    if (overlaysRef.current.length) { try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ } }
    shapeClicks.current.clear();
    const list: any[] = [];
    for (const s of shapes) {
      if (s.points.length < 2) continue;
      const coords = s.points.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      const style = new mapkit.Style({
        strokeColor: s.color, lineWidth: s.width, strokeOpacity: s.opacity ?? 1,
        fillColor: s.color, fillOpacity: s.fillOpacity ?? 0, lineDash: s.dash ?? [], lineJoin: "round", lineCap: "round",
      });
      const ov = s.kind === "polygon" && s.points.length >= 3
        ? new mapkit.PolygonOverlay(coords, { style })
        : new mapkit.PolylineOverlay(coords, { style });
      try { ov.enabled = !!s.onClick; } catch { /* noop */ }
      if (s.onClick) shapeClicks.current.set(ov, s.onClick);
      list.push(ov);
    }
    try { map.addOverlays(list); } catch { /* noop */ }
    overlaysRef.current = list;
  }, [ready, shapes]);

  // Markers
  useEffect(() => {
    const map = mapRef.current; const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;
    if (annsRef.current.length) { try { map.removeAnnotations(annsRef.current); } catch { /* noop */ } }
    const list = markers.map((m) => {
      const ann = new mapkit.Annotation(new mapkit.Coordinate(m.point.lat, m.point.lng), () => {
        const el = document.createElement("div");
        el.innerHTML = m.html;
        el.style.cursor = m.draggable ? "grab" : m.onClick ? "pointer" : "default";
        if (!m.onClick && !m.draggable) el.style.pointerEvents = "none";
        return el;
      });
      // MapKit anchors element bottom-centre; positive y moves up.
      try { ann.anchorOffset = new DOMPoint(m.labelOffsetX ?? 0, -m.size / 2); } catch { /* noop */ }
      try { ann.draggable = !!m.draggable; ann.enabled = !!(m.onClick || m.draggable); } catch { /* noop */ }
      ann.addEventListener("select", () => {
        suppressTapUntil.current = Date.now() + 300;
        try { ann.selected = false; } catch { /* noop */ }
        m.onClick?.();
      });
      if (m.onDragEnd) ann.addEventListener("drag-end", () => {
        suppressTapUntil.current = Date.now() + 300;
        m.onDragEnd?.({ lat: ann.coordinate.latitude, lng: ann.coordinate.longitude });
      });
      return ann;
    });
    try { map.addAnnotations(list); } catch { /* noop */ }
    annsRef.current = list;
  }, [ready, markers]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80 p-6 text-center text-sm">
          Apple Maps couldn't load. Please reload the page.
        </div>
      )}
      <MapSourceBadge source="apple" />
    </div>
  );
}
