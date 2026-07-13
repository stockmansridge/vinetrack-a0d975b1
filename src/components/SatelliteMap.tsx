import { useEffect, useMemo, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import { LatLng } from "@/lib/paddockGeometry";

export interface SatelliteMapPaddock {
  id: string;
  name: string;
  /** Array of polygons; each polygon is array of rings (outer first, holes after). */
  polys: LatLng[][][];
  color?: string;
}

export interface SatelliteRasterOverlay {
  paddockId: string;
  url: string;
  bounds: { north: number; south: number; east: number; west: number };
  opacity?: number;
  /** Optional stable identity. Defaults to `${paddockId}:${url}`. Different keys can co-exist during crossfade. */
  key?: string;
}

export interface SatelliteMapProps {
  paddocks: SatelliteMapPaddock[];
  selectedPaddockId?: string | null;
  /** Multiple raster overlays (one per paddock). Preferred. */
  overlays?: SatelliteRasterOverlay[];
  /** Legacy single overlay — used only when `overlays` is not provided. */
  overlayUrl?: string | null;
  overlayBounds?: { north: number; south: number; east: number; west: number } | null;
  /** 0..1 */
  overlayOpacity?: number;
  /** Crossfade duration in ms applied via CSS transition on overlay opacity. 0 disables animation. */
  overlayTransitionMs?: number;
  /** Optional rectangle drawn above raster overlays to highlight the hovered analytical cell. */
  cellRect?: { north: number; south: number; east: number; west: number } | null;
  onPaddockClick?: (id: string) => void;
  onMapReady?: () => void;
  onUnavailable?: (msg: string) => void;
  /** Fires with the map coordinate under the pointer (or null on leave). `x`/`y` are relative to the map container. */
  onPointerMove?: (coord: { lat: number; lng: number; x: number; y: number } | null) => void;
  className?: string;
}

/**
 * Apple MapKit JS adapter for VineTrack satellite mapping.
 * - Renders paddock polygons (Polygon/MultiPolygon + holes best-effort).
 * - Overlays a raster PNG aligned to WGS84 bounds via a DOM <img> reprojected
 *   on every frame during panning/zooming.
 * - Fits all paddocks, or a single selected paddock with padding.
 */
export default function SatelliteMap(props: SatelliteMapProps) {
  const {
    paddocks,
    selectedPaddockId,
    overlays,
    overlayUrl,
    overlayBounds,
    overlayOpacity = 0.7,
    overlayTransitionMs = 0,
    cellRect,
    onPaddockClick,
    onMapReady,
    onUnavailable,
    onPointerMove,
    className,
  } = props;

  // Normalise to a single overlays[] list. Legacy overlayUrl/overlayBounds
  // become a one-item list so the rendering loop is uniform.
  const effectiveOverlays: SatelliteRasterOverlay[] = useMemo(() => {
    if (overlays && overlays.length) return overlays;
    if (overlayUrl && overlayBounds) {
      return [{ paddockId: "__single__", url: overlayUrl, bounds: overlayBounds, opacity: overlayOpacity }];
    }
    return [];
  }, [overlays, overlayUrl, overlayBounds, overlayOpacity]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgLayerRef = useRef<HTMLDivElement | null>(null);
  const imgRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const cellRectRef = useRef<HTMLDivElement | null>(null);
  const cellRectValueRef = useRef<{ north: number; south: number; east: number; west: number } | null>(null);
  const mapRef = useRef<any>(null);
  const lastFitSigRef = useRef<string | null>(null);
  const paddocksRef = useRef(paddocks);
  const onPaddockClickRef = useRef(onPaddockClick);
  paddocksRef.current = paddocks;
  onPaddockClickRef.current = onPaddockClick;
  const overlaysRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Init map
  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          isRotationEnabled: false,
          showsCompass: mapkit.FeatureVisibility.Adaptive,
          showsScale: mapkit.FeatureVisibility.Adaptive,
          showsZoomControl: true,
          showsUserLocationControl: false,
        });
        setReady(true);
        onMapReady?.();
      })
      .catch((e) => {
        const msg = e?.message || "Apple Maps failed to load";
        if (!cancelled) {
          setError(msg);
          onUnavailable?.(msg);
        }
      });
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signature to rebuild overlays only when inputs change
  const sig = useMemo(() => {
    return paddocks.map((p) => p.id + ":" + p.polys.length).join("|") + "#" + (selectedPaddockId ?? "");
  }, [paddocks, selectedPaddockId]);

  // Render polygons + fit region
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;

    // Clear
    if (overlaysRef.current.length) {
      try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ }
      overlaysRef.current = [];
    }

    const all: LatLng[] = [];
    const selectedPts: LatLng[] = [];
    const newOverlays: any[] = [];

    for (const p of paddocksRef.current) {
      const isSel = p.id === selectedPaddockId;
      const color = p.color || "#34C759";
      for (const poly of p.polys) {
        if (!poly.length) continue;
        // Outer ring only (MapKit JS PolygonOverlay accepts array of coords for single ring;
        // holes: passing multiple rings creates a polygon with holes).
        const ringsCoords = poly
          .filter((r) => r.length >= 3)
          .map((ring) =>
            ring
              .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
              .map((pt) => new mapkit.Coordinate(pt.lat, pt.lng)),
          );
        if (!ringsCoords.length) continue;

        const overlay = new mapkit.PolygonOverlay(
          ringsCoords.length === 1 ? ringsCoords[0] : ringsCoords,
          {
            style: new mapkit.Style({
              strokeColor: "#ffffff",
              strokeOpacity: 1,
              lineWidth: isSel ? 3 : 2,
              fillColor: color,
              fillOpacity: isSel ? 0.15 : 0.05,
              lineJoin: "round",
            }),
            data: { id: p.id },
          },
        );
        overlay.addEventListener("select", () => onPaddockClickRef.current?.(p.id));
        newOverlays.push(overlay);

        for (const ring of poly) {
          for (const pt of ring) {
            all.push(pt);
            if (isSel) selectedPts.push(pt);
          }
        }
      }
    }

    if (newOverlays.length) {
      map.addOverlays(newOverlays);
      overlaysRef.current = newOverlays;
    }

    // Only refit region when the paddock set or selection actually changed
    // (tracked by `sig`). This preserves the user's manual zoom/pan across
    // hover-driven re-renders.
    if (lastFitSigRef.current !== sig) {
      lastFitSigRef.current = sig;
      const fitPts = selectedPts.length ? selectedPts : all;
      if (fitPts.length) {
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const pt of fitPts) {
          if (pt.lat < minLat) minLat = pt.lat;
          if (pt.lat > maxLat) maxLat = pt.lat;
          if (pt.lng < minLng) minLng = pt.lng;
          if (pt.lng > maxLng) maxLng = pt.lng;
        }
        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;
        const latDelta = Math.max((maxLat - minLat) * 1.6, 0.002);
        const lngDelta = Math.max((maxLng - minLng) * 1.6, 0.002);
        try {
          map.region = new mapkit.CoordinateRegion(
            new mapkit.Coordinate(centerLat, centerLng),
            new mapkit.CoordinateSpan(latDelta, lngDelta),
          );
        } catch { /* noop */ }
      }
    }
  }, [ready, sig, selectedPaddockId]);

  // Raster overlay reprojection loop — handles N overlays.
  useEffect(() => {
    const map = mapRef.current;
    const layer = imgLayerRef.current;
    const container = containerRef.current;
    if (!ready || !map || !layer || !container) return;

    // Key overlays by (paddockId, url) — or caller-supplied `key` — so during
    // date crossfade the outgoing and incoming rasters co-exist as separate
    // <img> elements whose opacity animates independently.
    const keyFor = (o: SatelliteRasterOverlay) => o.key ?? `${o.paddockId}:${o.url}`;

    // Remove <img> elements for overlays no longer present.
    const activeIds = new Set(effectiveOverlays.map(keyFor));
    for (const [id, el] of Array.from(imgRefs.current.entries())) {
      if (!activeIds.has(id)) {
        try { el.remove(); } catch { /* noop */ }
        imgRefs.current.delete(id);
      }
    }

    if (effectiveOverlays.length === 0) {
      layer.style.display = "none";
      return;
    }
    layer.style.display = "block";

    const prefersReducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const fadeMs = prefersReducedMotion ? 0 : Math.max(0, overlayTransitionMs);

    // Ensure an <img> exists for each overlay and set its src / opacity.
    for (const o of effectiveOverlays) {
      const key = keyFor(o);
      let img = imgRefs.current.get(key);
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.className = "pointer-events-none absolute top-0 left-0";
        img.style.transform = "translate(-9999px,-9999px)";
        img.style.transformOrigin = "top left";
        img.style.imageRendering = "pixelated";
        img.style.willChange = "opacity, transform";
        layer.appendChild(img);
        imgRefs.current.set(key, img);
      }
      // CSS transition applies to opacity only — geometry updates every frame
      // must remain instant.
      img.style.transition = fadeMs > 0 ? `opacity ${fadeMs}ms linear` : "none";
      if (img.src !== o.url) img.src = o.url;
      img.style.opacity = String(o.opacity ?? overlayOpacity);
    }

    const update = () => {
      try {
        const mapkit = (window as any).mapkit;
        const rect = container.getBoundingClientRect();
        for (const o of effectiveOverlays) {
          const key = o.key ?? `${o.paddockId}:${o.url}`;
          const img = imgRefs.current.get(key);
          if (!img) continue;
          const nw = new mapkit.Coordinate(o.bounds.north, o.bounds.west);
          const se = new mapkit.Coordinate(o.bounds.south, o.bounds.east);
          const p1 = map.convertCoordinateToPointOnPage(nw);
          const p2 = map.convertCoordinateToPointOnPage(se);
          const x = p1.x - rect.left - window.scrollX;
          const y = p1.y - rect.top - window.scrollY;
          const w = p2.x - p1.x;
          const h = p2.y - p1.y;
          img.style.transform = `translate(${x}px, ${y}px)`;
          img.style.width = `${Math.max(0, w)}px`;
          img.style.height = `${Math.max(0, h)}px`;
        }
        const cr = cellRectValueRef.current;
        const cellEl = cellRectRef.current;
        if (cellEl) {
          if (cr) {
            const nw = new mapkit.Coordinate(cr.north, cr.west);
            const se = new mapkit.Coordinate(cr.south, cr.east);
            const p1 = map.convertCoordinateToPointOnPage(nw);
            const p2 = map.convertCoordinateToPointOnPage(se);
            const x = p1.x - rect.left - window.scrollX;
            const y = p1.y - rect.top - window.scrollY;
            const w = Math.max(0, p2.x - p1.x);
            const h = Math.max(0, p2.y - p1.y);
            cellEl.style.display = "block";
            cellEl.style.transform = `translate(${x}px, ${y}px)`;
            cellEl.style.width = `${w}px`;
            cellEl.style.height = `${h}px`;
          } else {
            cellEl.style.display = "none";
          }
        }
      } catch { /* noop */ }
    };

    update();
    let running = true;
    const tick = () => {
      if (!running) return;
      update();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { running = false; };
  }, [ready, effectiveOverlays, overlayOpacity, overlayTransitionMs]);

  // Sync the highlighted-cell rectangle into the animation loop.
  useEffect(() => {
    cellRectValueRef.current = cellRect ?? null;
  }, [cellRect]);


  // Pointer tracking → forward map coordinate under pointer to parent.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!ready || !map || !container || !onPointerMove) return;
    const mapkit = (window as any).mapkit;

    const handleMove = (ev: PointerEvent) => {
      try {
        const rect = container.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
          onPointerMove(null);
          return;
        }
        // MapKit exposes convertPointOnPageToCoordinate — pointer coords are
        // relative to the page (viewport + scroll).
        const pagePt = new (window as any).DOMPoint(ev.clientX + window.scrollX, ev.clientY + window.scrollY);
        const coord = map.convertPointOnPageToCoordinate(pagePt);
        if (coord && Number.isFinite(coord.latitude) && Number.isFinite(coord.longitude)) {
          onPointerMove({ lat: coord.latitude, lng: coord.longitude, x, y });
        }
      } catch { /* noop */ }
    };
    const handleLeave = () => onPointerMove(null);

    container.addEventListener("pointermove", handleMove);
    container.addEventListener("pointerleave", handleLeave);
    return () => {
      container.removeEventListener("pointermove", handleMove);
      container.removeEventListener("pointerleave", handleLeave);
    };
    // mapkit reference kept to force effect after script load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, onPointerMove]);


  return (
    <div className={`relative isolate ${className ?? ""}`} style={{ zIndex: 0 }}>
      <div ref={containerRef} className="h-full w-full" style={{ zIndex: 0 }} />
      {/* Raster overlay layer — sits above map tiles but below Radix portals. */}
      <div
        ref={imgLayerRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 5 }}
      />
      {/* Highlighted native satellite cell — sits above rasters but below the tooltip. */}
      <div
        ref={cellRectRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0"
        style={{
          zIndex: 6,
          display: "none",
          border: "1.5px solid rgba(255,255,255,0.95)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.55) inset",
          background: "rgba(255,255,255,0.05)",
          transformOrigin: "top left",
        }}
      />

      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
