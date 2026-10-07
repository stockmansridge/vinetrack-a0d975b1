// Apple MapKit JS map used by the Contour Row Mapping (Beta) pilot.
// Declarative wrapper: callers pass shapes/markers; overlays are rebuilt on change.
//
// Zoom: native camera zoom first (explicit CameraZoomRange with a small
// minimum distance). When Apple clamps native zoom, "precision" magnification
// (2×/4×) renders the map into a 1/k-sized element scaled up by k. In that
// mode all pointer input (taps, marker drags, line picks, panning) is handled
// here and converted with MapKit's own Mercator MapPoint maths against the
// visible map rect, so coordinates stay geographically aligned.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { initMapKit } from "@/lib/mapkit";
import MapSourceBadge from "@/components/MapSourceBadge";
import { Button } from "@/components/ui/button";

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
  /** Test-harness only: receives the MapKit map instance. Not used in production. */
  mapInstanceRef?: { current: any };
}

export const MAGNIFICATIONS = [1, 2, 4] as const;
export const MIN_CAMERA_DISTANCE_M = 2;
const EARTH_M = 40075016.686;

/** Visible Mercator rect (MapKit map units, 0..1 world) + unscaled element size + magnification. */
export interface ViewFrame { ox: number; oy: number; w: number; h: number; elW: number; elH: number; k: number }
/** Screen offset (px from the untransformed wrapper's top-left) → map units. */
export const screenToMapUnits = (f: ViewFrame, sx: number, sy: number) =>
  ({ x: f.ox + (sx / f.k / f.elW) * f.w, y: f.oy + (sy / f.k / f.elH) * f.h });
/** Map units → screen offset px. */
export const mapUnitsToScreen = (f: ViewFrame, x: number, y: number) =>
  ({ sx: ((x - f.ox) / f.w) * f.elW * f.k, sy: ((y - f.oy) / f.h) * f.elH * f.k });
/** Ground metres per screen pixel at latitude. */
export const metresPerScreenPx = (f: ViewFrame, lat: number) => (f.w * EARTH_M * Math.cos((lat * Math.PI) / 180)) / (f.elW * f.k);

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function ContourAppleMap({ centre, shapes, markers, onMapClick, fitPoints, fitNonce, mapInstanceRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [mag, setMag] = useState<number>(1);
  const magRef = useRef(1); magRef.current = mag;
  const [mpp, setMpp] = useState<number | null>(null);
  // Bumped after MapKit has processed a magnification resize so annotations
  // are rebuilt against the new element size (stale positions otherwise).
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [, setViewTick] = useState(0);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const clickRef = useRef(onMapClick); clickRef.current = onMapClick;
  const shapeClicks = useRef(new Map<any, () => void>());
  const overlaysRef = useRef<any[]>([]);
  const annsRef = useRef<any[]>([]);
  const suppressTapUntil = useRef(0);
  const fitAfterMag = useRef(false);
  const latestShapes = useRef(shapes); latestShapes.current = shapes;
  const latestMarkers = useRef(markers); latestMarkers.current = markers;
  const fitRef = useRef(fitPoints); fitRef.current = fitPoints;
  const shapeKey = JSON.stringify(shapes.map(({ onClick, ...r }) => ({ ...r, c: !!onClick })));
  const markerKey = JSON.stringify(markers.map(({ onClick, onDragEnd, ...r }) => ({ ...r, c: !!onClick, d: !!onDragEnd })));

  const frame = useCallback((): ViewFrame | null => {
    const map = mapRef.current, el = containerRef.current;
    if (!map || !el) return null;
    try {
      const r = map.visibleMapRect;
      return { ox: r.origin.x, oy: r.origin.y, w: r.size.width, h: r.size.height, // offsetWidth/Height (integers) are what MapKit sizes its canvas to; a
      // browser harness at 703.5 px confirmed <0.02 px error off-centre.
      elW: el.offsetWidth || 1, elH: el.offsetHeight || 1, k: magRef.current };
    } catch { return null; }
  }, []);
  const updateReadout = useCallback(() => {
    const f = frame(), map = mapRef.current;
    if (f && map) { try { setMpp(metresPerScreenPx(f, map.center.latitude)); } catch { /* noop */ } }
  }, [frame]);

  useEffect(() => {
    let cancelled = false;
    initMapKit().then((mapkit) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new mapkit.Map(containerRef.current, {
        mapType: mapkit.Map.MapTypes.Hybrid,
        showsCompass: mapkit.FeatureVisibility.Adaptive,
        showsScale: mapkit.FeatureVisibility.Adaptive,
        showsZoomControl: false, // replaced by our single +/− control
        showsUserLocationControl: false,
      });
      try { map.cameraZoomRange = new mapkit.CameraZoomRange({ minCameraDistance: MIN_CAMERA_DISTANCE_M }); }
      catch { try { map.cameraZoomRange = new mapkit.CameraZoomRange(MIN_CAMERA_DISTANCE_M, Infinity); } catch { /* older MapKit */ } }
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
        if (magRef.current !== 1 || Date.now() < suppressTapUntil.current) return;
        try {
          const pt = e?.pointOnPage;
          const c = e?.coordinate ?? (pt ? map.convertPointOnPageToCoordinate(pt) : null);
          if (c && typeof c.latitude === "number") clickRef.current({ lat: c.latitude, lng: c.longitude });
        } catch { /* noop */ }
      });
      map.addEventListener("region-change-end", () => { updateReadout(); refreshAtMax(); setViewTick((n) => n + 1); });
      mapRef.current = map;
      if (mapInstanceRef) mapInstanceRef.current = map;
      setReady(true);
    }).catch((e) => { if (!cancelled) setFailed(String(e?.message ?? e)); });
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      if (mapInstanceRef) mapInstanceRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doFit = useCallback(() => {
    const map = mapRef.current; const mapkit = (window as any).mapkit; const pts = fitRef.current;
    if (!map || !mapkit || !pts.length) return;
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    try {
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
        new mapkit.CoordinateSpan(Math.max(0.0006, (maxLat - minLat) * 1.3), Math.max(0.0006, (maxLng - minLng) * 1.3)),
      );
    } catch { /* noop */ }
    updateReadout();
  }, [updateReadout]);

  // Fit (only on ready / explicit Fit): also resets precision magnification.
  useEffect(() => {
    if (!ready) return;
    if (magRef.current !== 1) { fitAfterMag.current = true; setMag(1); return; }
    doFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitNonce]);

  // Magnification change: keep the centre, disable rotation while magnified.
  const prevMag = useRef(1);
  const centreBeforeMag = useRef<any>(null);
  const changeMag = (k: number) => {
    if (k === magRef.current) return;
    if (k < 4) setAtMax(false);
    try { centreBeforeMag.current = mapRef.current?.center ?? null; } catch { centreBeforeMag.current = null; }
    setMag(k);
  };
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map || prevMag.current === mag) return;
    prevMag.current = mag;
    try { map.isRotationEnabled = mag === 1; if (mag !== 1) map.rotation = 0; } catch { /* noop */ }
    // Let MapKit pick up the new element size, then restore the centre.
    try { window.dispatchEvent(new Event("resize")); } catch { /* noop */ }
    requestAnimationFrame(() => {
      if (fitAfterMag.current) { fitAfterMag.current = false; doFit(); }
      else {
        const c = centreBeforeMag.current;
        if (c) { try { map.setCenterAnimated(c, false); } catch { /* noop */ } }
        updateReadout();
      }
      requestAnimationFrame(() => setLayoutNonce((n) => n + 1));
    });
  }, [mag, doFit, updateReadout]);

  // Native camera distance at which Apple clamped (null until observed).
  const clampDist = useRef<number | null>(null);
  const [atMax, setAtMax] = useState(false);
  const refreshAtMax = useCallback(() => {
    let d = NaN; try { d = Number(mapRef.current?.cameraDistance); } catch { /* noop */ }
    const c = clampDist.current;
    setAtMax(magRef.current >= 4 && c != null && d <= c * 1.05);
  }, []);
  // + always tries native zoom first (at any magnification); digital
  // magnification steps up only when native zoom has genuinely clamped.
  const zoomIn = () => {
    const map = mapRef.current; if (!map) return;
    const before = Number(map.cameraDistance);
    try { map.setCameraDistanceAnimated ? map.setCameraDistanceAnimated(before / 2, false) : (map.cameraDistance = before / 2); } catch { /* noop */ }
    requestAnimationFrame(() => {
      const after = Number(map.cameraDistance);
      if (!(after < before * 0.9)) {
        clampDist.current = after;
        if (magRef.current < 4) changeMag(Math.min(4, magRef.current * 2));
      }
      updateReadout(); refreshAtMax();
    });
  };
  // − reverses: digital magnification first, then native zoom.
  const zoomOut = () => {
    const map = mapRef.current; if (!map) return;
    if (magRef.current > 1) { changeMag(magRef.current / 2); setAtMax(false); return; }
    const d = Number(map.cameraDistance) * 2;
    try { map.setCameraDistanceAnimated ? map.setCameraDistanceAnimated(d, false) : (map.cameraDistance = d); } catch { /* noop */ }
    requestAnimationFrame(() => { updateReadout(); refreshAtMax(); });
  };

  // Shapes (line widths compensated for magnification so they look the same on screen)
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
        strokeColor: s.color, lineWidth: s.width / mag, strokeOpacity: s.opacity ?? 1,
        fillColor: s.color, fillOpacity: s.fillOpacity ?? 0, lineDash: (s.dash ?? []).map((d) => d / mag), lineJoin: "round", lineCap: "round",
      });
      const ov = s.kind === "polygon" && s.points.length >= 3
        ? new mapkit.PolygonOverlay(coords, { style })
        : new mapkit.PolylineOverlay(coords, { style });
      try { ov.enabled = !!s.onClick && mag === 1; } catch { /* noop */ }
      if (s.onClick) { const id = s.id; shapeClicks.current.set(ov, () => latestShapes.current.find((x) => x.id === id)?.onClick?.()); }
      list.push(ov);
    }
    try { map.addOverlays(list); } catch { /* noop */ }
    overlaysRef.current = list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shapeKey, mag]);

  // Markers (visual size compensated for magnification; native drag only at 1×)
  useEffect(() => {
    const map = mapRef.current; const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;
    if (annsRef.current.length) { try { map.removeAnnotations(annsRef.current); } catch { /* noop */ } }
    const native = mag === 1;
    // At k>1 MapKit's DOM annotations are misplaced inside the CSS-scaled
    // element (measured in a browser harness), so markers are drawn by the
    // precision surface instead, from the same maths used for hit-testing.
    const list = native ? markers.map((m) => {
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
        latestMarkers.current.find((x) => x.id === m.id)?.onClick?.();
      });
      if (m.onDragEnd) ann.addEventListener("drag-end", () => {
        suppressTapUntil.current = Date.now() + 300;
        latestMarkers.current.find((x) => x.id === m.id)?.onDragEnd?.({ lat: ann.coordinate.latitude, lng: ann.coordinate.longitude });
      });
      return ann;
    }) : [];
    try { map.addAnnotations(list); } catch { /* noop */ }
    annsRef.current = list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markerKey, mag, layoutNonce]);

  // ---- Precision-mode input (k > 1) ----
  const mapkitAt = (sx: number, sy: number): CLatLng | null => {
    const f = frame(); const mapkit = (window as any).mapkit;
    if (!f || !mapkit) return null;
    const u = screenToMapUnits(f, sx, sy);
    const c = new mapkit.MapPoint(u.x, u.y).toCoordinate();
    return { lat: c.latitude, lng: c.longitude };
  };
  const toScreen = (f: ViewFrame, p: CLatLng) => {
    const mp = new (window as any).mapkit.Coordinate(p.lat, p.lng).toMapPoint();
    return mapUnitsToScreen(f, mp.x, mp.y);
  };
  const drag = useRef<null | { id: string | null; sx: number; sy: number; moved: boolean; draggable: boolean; centre: any }>(null);
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = wrapRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const hitMarker = (x: number, y: number) => {
    const f = frame(); if (!f) return null;
    let best: { m: CMarker; d: number } | null = null;
    for (const m of latestMarkers.current) {
      if (!m.onClick && !m.draggable) continue;
      const s = toScreen(f, m.point); const d = Math.hypot(s.sx - x, s.sy - y);
      const tol = Math.max(10, m.size / 2 + 4);
      if (d <= tol && (!best || d < best.d || (m.draggable && !best.m.draggable && d <= best.d + 2))) best = { m, d };
    }
    return best?.m ?? null;
  };
  const hitShape = (x: number, y: number) => {
    const f = frame(); if (!f) return null;
    let best: { s: CShape; d: number } | null = null;
    for (const s of latestShapes.current) {
      if (!s.onClick) continue;
      const pts = s.points.map((p) => toScreen(f, p));
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSeg(x, y, pts[i].sx, pts[i].sy, pts[i + 1].sx, pts[i + 1].sy);
        if (d <= 8 && (!best || d < best.d)) best = { s, d };
      }
    }
    return best?.s ?? null;
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = local(e); const m = hitMarker(p.x, p.y);
    let centre: any = null; try { centre = mapRef.current.center.toMapPoint(); } catch { /* noop */ }
    drag.current = { id: m?.id ?? null, sx: p.x, sy: p.y, moved: false, draggable: !!m?.draggable && !!m?.onDragEnd, centre };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = local(e);
    if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < 4) return;
    d.moved = true;
    if (d.draggable) { setGhost(p); return; }
    const f = frame(); const mapkit = (window as any).mapkit;
    if (!f || !d.centre || !mapkit) return;
    const dx = ((p.x - d.sx) / f.k / f.elW) * f.w, dy = ((p.y - d.sy) / f.k / f.elH) * f.h;
    try { mapRef.current.setCenterAnimated(new mapkit.MapPoint(d.centre.x - dx, d.centre.y - dy).toCoordinate(), false); } catch { /* noop */ }
    setViewTick((n) => n + 1);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; setGhost(null);
    if (!d) return;
    const p = local(e);
    const m = d.id ? latestMarkers.current.find((x) => x.id === d.id) : null;
    if (d.moved) {
      if (d.draggable && m?.onDragEnd) { const c = mapkitAt(p.x, p.y); if (c) m.onDragEnd(c); }
      updateReadout();
      return;
    }
    if (m?.onClick) { m.onClick(); return; }
    const s = hitShape(p.x, p.y);
    if (s?.onClick) { s.onClick(); return; }
    const c = mapkitAt(p.x, p.y); if (c) clickRef.current(c);
  };
  const lastWheel = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    const now = Date.now(); if (now - lastWheel.current < 300) return; lastWheel.current = now;
    if (e.deltaY < 0) zoomIn(); else if (e.deltaY > 0) zoomOut();
  };

  const fmtScale = (m: number) => (m < 0.01 ? `${(m * 1000).toFixed(1)} mm` : m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden" data-magnification={mag}>
      <div ref={containerRef} style={mag === 1 ? { width: "100%", height: "100%" }
        : { width: `${100 / mag}%`, height: `${100 / mag}%`, transform: `scale(${mag})`, transformOrigin: "0 0" }} />
      {mag > 1 && ready && (
        <div className="absolute inset-0 z-[300] touch-none" style={{ cursor: ghost ? "grabbing" : "crosshair" }} aria-label="Precision map surface"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setGhost(null); }} onWheel={onWheel}>
          {(() => {
            const f = frame(); if (!f || !(window as any).mapkit) return null;
            return markers.map((m) => {
              if (ghost && drag.current?.id === m.id) return null;
              const p = toScreen(f, m.point);
              return <div key={m.id} className="pointer-events-none absolute" style={m.labelOffsetX
                ? { left: p.sx + m.labelOffsetX, top: p.sy, transform: "translateY(-50%)" }
                : { left: p.sx, top: p.sy, transform: "translate(-50%,-50%)" }}
                dangerouslySetInnerHTML={{ __html: m.html }} />;
            });
          })()}
          {ghost && <div className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-destructive" style={{ left: ghost.x, top: ghost.y }} />}
        </div>
      )}
      {ready && (
        <div className="absolute right-3 top-14 z-[400] flex flex-col items-end gap-1">
          <div className="flex flex-col overflow-hidden rounded-md border bg-background/95 shadow">
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-none" aria-label="Zoom in" disabled={atMax} title={atMax ? "Maximum zoom reached" : undefined} onClick={zoomIn}><Plus className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-none border-t" aria-label="Zoom out" onClick={zoomOut}><Minus className="h-4 w-4" /></Button>
          </div>
          <div className="flex overflow-hidden rounded-md border bg-background/95 text-xs shadow" role="group" aria-label="Precision magnification">
            {MAGNIFICATIONS.map((k) => (
              <button key={k} type="button" aria-pressed={mag === k} onClick={() => changeMag(k)}
                className={`px-2 py-1 ${mag === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{k}×</button>
            ))}
          </div>
          {mpp != null && <div className="rounded bg-background/90 px-2 py-0.5 text-[11px] shadow" data-testid="mpp">≈ {fmtScale(mpp)} per pixel</div>}
          {mag > 1 && <div className="max-w-[180px] rounded bg-background/90 px-2 py-0.5 text-right text-[11px] shadow">Precision {mag}× — image may blur. Drag to pan.</div>}
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80 p-6 text-center text-sm">
          Apple Maps couldn't load. Please reload the page.
        </div>
      )}
      <MapSourceBadge source="apple" />
    </div>
  );
}
