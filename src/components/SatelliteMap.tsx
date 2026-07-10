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
  onPaddockClick?: (id: string) => void;
  onMapReady?: () => void;
  onUnavailable?: (msg: string) => void;
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
    onPaddockClick,
    onMapReady,
    onUnavailable,
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
  const mapRef = useRef<any>(null);
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

    for (const p of paddocks) {
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
        overlay.addEventListener("select", () => onPaddockClick?.(p.id));
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
  }, [ready, sig, paddocks, selectedPaddockId, onPaddockClick]);

  // Raster overlay reprojection loop
  useEffect(() => {
    const map = mapRef.current;
    const layer = imgLayerRef.current;
    const img = imgRef.current;
    const container = containerRef.current;
    if (!ready || !map || !layer || !img || !container) return;
    if (!overlayUrl || !overlayBounds) {
      layer.style.display = "none";
      return;
    }
    layer.style.display = "block";
    img.src = overlayUrl;
    img.style.opacity = String(overlayOpacity);

    let raf = 0;
    const update = () => {
      raf = 0;
      try {
        const mapkit = (window as any).mapkit;
        const nw = new mapkit.Coordinate(overlayBounds.north, overlayBounds.west);
        const se = new mapkit.Coordinate(overlayBounds.south, overlayBounds.east);
        const p1 = map.convertCoordinateToPointOnPage(nw);
        const p2 = map.convertCoordinateToPointOnPage(se);
        const rect = container.getBoundingClientRect();
        const x = p1.x - rect.left - window.scrollX;
        const y = p1.y - rect.top - window.scrollY;
        const w = p2.x - p1.x;
        const h = p2.y - p1.y;
        img.style.transform = `translate(${x}px, ${y}px)`;
        img.style.width = `${Math.max(0, w)}px`;
        img.style.height = `${Math.max(0, h)}px`;
      } catch { /* noop */ }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    const events = ["region-change-start", "region-change-end", "scroll-start", "scroll-end", "zoom-start", "zoom-end"];
    for (const ev of events) {
      try { map.addEventListener(ev, schedule); } catch { /* noop */ }
    }
    // Continuous RAF loop while overlay visible so pan/zoom track smoothly.
    let running = true;
    const tick = () => {
      if (!running) return;
      update();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      for (const ev of events) {
        try { map.removeEventListener(ev, schedule); } catch { /* noop */ }
      }
    };
  }, [ready, overlayUrl, overlayBounds, overlayOpacity]);

  return (
    <div className={`relative isolate ${className ?? ""}`} style={{ zIndex: 0 }}>
      <div ref={containerRef} className="h-full w-full" style={{ zIndex: 0 }} />
      {/* Raster overlay layer — sits above map tiles but below Radix portals. */}
      <div
        ref={imgLayerRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 5 }}
      >
        <img
          ref={imgRef}
          alt=""
          className="pointer-events-none absolute top-0 left-0"
          style={{ transform: "translate(-9999px,-9999px)", transformOrigin: "top left", imageRendering: "pixelated" }}
        />
      </div>
      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
