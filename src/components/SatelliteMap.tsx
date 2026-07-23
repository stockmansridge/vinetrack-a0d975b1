import { useEffect, useMemo, useRef, useState } from "react";
import { initMapKit, type MapKitReadinessState } from "@/lib/mapkit";
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
  /** Optional stable identity. Different keys can co-exist during crossfade. Required for view-model lookups. */
  key?: string;
  /** Metadata forwarded through overlay lifecycle callbacks so consumers never identify overlays by object URL alone. */
  sceneId?: string | null;
  indexType?: string | null;
  assetId?: string | null;
}

/** Payload passed to every overlay lifecycle callback. Identifies the overlay by stable ids — never by URL or DOM node. */
export interface OverlayCallbackInfo {
  paddockId: string;
  overlayKey: string;
  /** @deprecated Use `overlayKey`. Retained for backwards compatibility. */
  key: string;
  sceneId: string | null;
  indexType: string | null;
  assetId: string | null;
}

export interface SatelliteMapDiagnostics {
  readinessState: MapKitReadinessState;
  tokenRequestStatus: "not_started" | "loading" | "success" | "failed";
  tokenEndpointStatus: number | null;
  tokenReceived: boolean;
  tokenFieldName: string | null;
  tokenLength: number | null;
  tokenExpiresAt: number | null;
  tokenJsonShape: string[];
  tokenErrorBody: string | null;
  scriptStatus: "not_started" | "loading" | "loaded" | "failed" | "already_available" | "existing";
  scriptCount: number;
  mapkitGlobalAvailable: boolean;
  authCallbackInvoked: boolean;
  authCallbackResolved: boolean;
  mapInstanceCreated: boolean;
  mapElementAttached: boolean;
  mapReadyCallbackFired: boolean;
  containerWidth: number;
  containerHeight: number;
  childNodeCount: number;
  mapCanvasSubviewCount: number;
  computedVisibility: string;
  computedOpacity: string;
  computedZIndex: string;
  elementAtCenter: string | null;
  lastError: string | null;
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
  /** Fires when a raster overlay <img> successfully loads (bytes decoded). */
  onOverlayLoad?: (info: OverlayCallbackInfo) => void;
  /** Fires when a raster overlay <img> fails to load. */
  onOverlayError?: (info: OverlayCallbackInfo) => void;
  /** Fires when the overlay is loaded AND has been positioned with non-zero geometry (visible on map). */
  onOverlayMounted?: (info: OverlayCallbackInfo) => void;
  /** Fires when an overlay is removed from the DOM (crossfade complete / superseded). */
  onOverlayUnmounted?: (info: OverlayCallbackInfo) => void;
  onDiagnosticsChange?: (diagnostics: SatelliteMapDiagnostics) => void;
  showDiagnostics?: boolean;
  className?: string;
}

const initialDiagnostics: SatelliteMapDiagnostics = {
  readinessState: "not_started",
  tokenRequestStatus: "not_started",
  tokenEndpointStatus: null,
  tokenReceived: false,
  tokenFieldName: null,
  tokenLength: null,
  tokenExpiresAt: null,
  tokenJsonShape: [],
  tokenErrorBody: null,
  scriptStatus: "not_started",
  scriptCount: 0,
  mapkitGlobalAvailable: false,
  authCallbackInvoked: false,
  authCallbackResolved: false,
  mapInstanceCreated: false,
  mapElementAttached: false,
  mapReadyCallbackFired: false,
  containerWidth: 0,
  containerHeight: 0,
  childNodeCount: 0,
  mapCanvasSubviewCount: 0,
  computedVisibility: "—",
  computedOpacity: "—",
  computedZIndex: "—",
  elementAtCenter: null,
  lastError: null,
};

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
    onOverlayLoad,
    onOverlayError,
    onOverlayMounted,
    onOverlayUnmounted,
    onDiagnosticsChange,
    showDiagnostics = false,
    className,
  } = props;

  // Latest lifecycle callback refs so the animation-loop effect doesn't need them in deps.
  const onOverlayLoadRef = useRef(onOverlayLoad);
  const onOverlayErrorRef = useRef(onOverlayError);
  const onOverlayMountedRef = useRef(onOverlayMounted);
  const onOverlayUnmountedRef = useRef(onOverlayUnmounted);
  onOverlayLoadRef.current = onOverlayLoad;
  onOverlayErrorRef.current = onOverlayError;
  onOverlayMountedRef.current = onOverlayMounted;
  onOverlayUnmountedRef.current = onOverlayUnmounted;

  // Track which overlay keys have already fired 'mounted' so we don't double-emit
  // when the animation-loop resizes them each frame.
  const mountedKeysRef = useRef<Set<string>>(new Set());
  // Stable metadata by overlay key — used to populate lifecycle callback payloads
  // with paddockId/sceneId/indexType/assetId so consumers never identify overlays
  // by object URL or DOM node.
  type OverlayMeta = { paddockId: string; sceneId: string | null; indexType: string | null; assetId: string | null };
  const metaByKeyRef = useRef<Map<string, OverlayMeta>>(new Map());
  const makeInfo = (key: string): OverlayCallbackInfo => {
    const m = metaByKeyRef.current.get(key) ?? { paddockId: "", sceneId: null, indexType: null, assetId: null };
    return { paddockId: m.paddockId, overlayKey: key, key, sceneId: m.sceneId, indexType: m.indexType, assetId: m.assetId };
  };

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
  const [diagnostics, setDiagnostics] = useState<SatelliteMapDiagnostics>(initialDiagnostics);
  const diagnosticsRef = useRef(initialDiagnostics);
  const mapReadyCallbackFiredRef = useRef(false);

  const snapshotDomDiagnostics = () => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cs = window.getComputedStyle(container);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topEl = rect.width > 0 && rect.height > 0
      ? document.elementFromPoint(centerX, centerY)
      : null;
    const mapSubviews = container.querySelectorAll("canvas, img, svg, .mk-map-view, [class*='mk-'], [style*='translate3d']").length;
    const next: SatelliteMapDiagnostics = {
      ...diagnosticsRef.current,
      mapkitGlobalAvailable: !!(window as any).mapkit,
      mapInstanceCreated: !!map,
      mapElementAttached: !!container.isConnected,
      mapReadyCallbackFired: mapReadyCallbackFiredRef.current,
      containerWidth: Math.round(rect.width),
      containerHeight: Math.round(rect.height),
      childNodeCount: container.childNodes.length,
      mapCanvasSubviewCount: mapSubviews,
      computedVisibility: cs.visibility,
      computedOpacity: cs.opacity,
      computedZIndex: cs.zIndex,
      elementAtCenter: topEl ? `${topEl.tagName.toLowerCase()}${topEl.id ? `#${topEl.id}` : ""}${typeof (topEl as HTMLElement).className === "string" && (topEl as HTMLElement).className ? `.${String((topEl as HTMLElement).className).split(/\s+/).slice(0, 3).join(".")}` : ""}` : null,
    };
    diagnosticsRef.current = next;
    setDiagnostics(next);
    try { onDiagnosticsChange?.(next); } catch { /* diagnostics only */ }
  };

  const patchDiagnostics = (patch: Partial<SatelliteMapDiagnostics>) => {
    diagnosticsRef.current = { ...diagnosticsRef.current, ...patch };
    setDiagnostics(diagnosticsRef.current);
    try { onDiagnosticsChange?.(diagnosticsRef.current); } catch { /* diagnostics only */ }
  };

  // Init map
  useEffect(() => {
    let cancelled = false;
    patchDiagnostics({ readinessState: "not_started", lastError: null });
    initMapKit((event) => {
      if (cancelled) return;
      if (event.type === "state") {
        patchDiagnostics({ readinessState: event.state, lastError: event.error ?? diagnosticsRef.current.lastError });
      } else if (event.type === "script") {
        patchDiagnostics({
          scriptStatus: event.status,
          scriptCount: event.count ?? diagnosticsRef.current.scriptCount,
          mapkitGlobalAvailable: event.globalAvailable ?? !!(window as any).mapkit,
          lastError: event.error ?? diagnosticsRef.current.lastError,
        });
      } else if (event.type === "token") {
        patchDiagnostics({
          tokenRequestStatus: event.status === "loading" ? "loading" : event.status === "success" ? "success" : "failed",
          tokenEndpointStatus: event.endpointStatus ?? diagnosticsRef.current.tokenEndpointStatus,
          tokenReceived: event.status === "success" && (event.tokenLength ?? 0) > 0,
          tokenFieldName: event.tokenFieldName ?? diagnosticsRef.current.tokenFieldName,
          tokenLength: event.tokenLength ?? diagnosticsRef.current.tokenLength,
          tokenExpiresAt: event.expiresAt ?? diagnosticsRef.current.tokenExpiresAt,
          tokenJsonShape: event.shape ?? diagnosticsRef.current.tokenJsonShape,
          tokenErrorBody: event.errorBody ?? diagnosticsRef.current.tokenErrorBody,
          lastError: event.error ?? diagnosticsRef.current.lastError,
        });
      } else if (event.type === "auth_callback") {
        patchDiagnostics({
          authCallbackInvoked: event.status === "invoked" ? true : diagnosticsRef.current.authCallbackInvoked,
          authCallbackResolved: event.status === "resolved" ? true : diagnosticsRef.current.authCallbackResolved,
          lastError: event.error ?? diagnosticsRef.current.lastError,
        });
      }
    })
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        try {
          mapRef.current = new mapkit.Map(containerRef.current, {
            mapType: mapkit.Map.MapTypes.Hybrid,
            isRotationEnabled: false,
            showsCompass: mapkit.FeatureVisibility.Hidden,
            showsScale: mapkit.FeatureVisibility.Adaptive,
            showsZoomControl: true,
            showsUserLocationControl: false,
          });
        } catch (e: any) {
          const msg = e?.message || "Apple Maps render failed";
          patchDiagnostics({ readinessState: "render_failed", lastError: msg });
          throw e;
        }
        setReady(true);
        mapReadyCallbackFiredRef.current = true;
        patchDiagnostics({ readinessState: "ready", mapInstanceCreated: true, mapReadyCallbackFired: true, lastError: null });
        requestAnimationFrame(snapshotDomDiagnostics);
        onMapReady?.();
      })
      .catch((e) => {
        const msg = e?.message || "Apple Maps failed to load";
        if (!cancelled) {
          setError(msg);
          patchDiagnostics({ lastError: msg, readinessState: diagnosticsRef.current.readinessState === "ready" ? "render_failed" : diagnosticsRef.current.readinessState });
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

  // Keep diagnostics and MapKit sizing current as the workspace/drawers change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      try { mapRef.current?.resize?.(); } catch { /* MapKit versions vary */ }
      snapshotDomDiagnostics();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    const t = window.setInterval(update, 1000);
    return () => { ro.disconnect(); window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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
        if (mountedKeysRef.current.has(id)) {
          mountedKeysRef.current.delete(id);
          const info = makeInfo(id);
          metaByKeyRef.current.delete(id);
          try { onOverlayUnmountedRef.current?.(info); } catch { /* noop */ }
        } else {
          metaByKeyRef.current.delete(id);
        }
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
      metaByKeyRef.current.set(key, {
        paddockId: o.paddockId,
        sceneId: o.sceneId ?? null,
        indexType: o.indexType ?? null,
        assetId: o.assetId ?? null,
      });
      const targetOpacity = String(o.opacity ?? overlayOpacity);
      let img = imgRefs.current.get(key);
      const fresh = !img;
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.className = "pointer-events-none absolute top-0 left-0";
        img.style.transform = "translate(-9999px,-9999px)";
        img.style.transformOrigin = "top left";
        img.style.imageRendering = "pixelated";
        img.style.willChange = "opacity, transform";
        img.style.opacity = fadeMs > 0 ? "0" : targetOpacity;
        // Lifecycle callbacks — invoked once per <img> instance.
        const boundKey = key;
        img.addEventListener("load", () => {
          try { onOverlayLoadRef.current?.(makeInfo(boundKey)); } catch { /* noop */ }
          if (!mountedKeysRef.current.has(boundKey)) {
            mountedKeysRef.current.add(boundKey);
            try { onOverlayMountedRef.current?.(makeInfo(boundKey)); } catch { /* noop */ }
          }
        }, { once: false });
        img.addEventListener("error", () => {
          try { onOverlayErrorRef.current?.(makeInfo(boundKey)); } catch { /* noop */ }
        }, { once: false });
        layer.appendChild(img);
        imgRefs.current.set(key, img);
      }
      // CSS transition applies to opacity only — geometry updates every frame
      // must remain instant.
      img.style.transition = fadeMs > 0 ? `opacity ${fadeMs}ms linear` : "none";
      if (img.src !== o.url) img.src = o.url;
      if (fresh && fadeMs > 0) {
        // Apply target opacity next frame so the CSS transition animates 0→target.
        const target = targetOpacity;
        const el = img;
        requestAnimationFrame(() => { try { el.style.opacity = target; } catch { /* noop */ } });
      } else {
        img.style.opacity = targetOpacity;
      }
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
    <div className={`isolate h-full min-h-[600px] w-full ${className ?? ""}`} style={{ zIndex: 0 }}>
      <div ref={containerRef} className="absolute inset-0 min-h-[600px] w-full" style={{ zIndex: 0, background: "transparent" }} />
      {/* Raster overlay layer — sits above map tiles but below Radix portals. */}
      <div
        ref={imgLayerRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 5, background: "transparent" }}
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

      {showDiagnostics && (
        <div className="absolute left-3 top-16 z-[700] max-h-[calc(100%-5rem)] w-[360px] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-md border bg-background/95 p-3 text-[11px] shadow-lg backdrop-blur">
          <div className="mb-2 text-xs font-semibold text-foreground">MapKit diagnostics</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            <div>MapKit state</div><div className="text-foreground">{diagnostics.readinessState}</div>
            <div>Token request</div><div className="text-foreground">{diagnostics.tokenRequestStatus}</div>
            <div>Token HTTP</div><div className="text-foreground">{diagnostics.tokenEndpointStatus ?? "—"}</div>
            <div>Token received</div><div className="text-foreground">{diagnostics.tokenReceived ? "yes" : "no"}</div>
            <div>Token field</div><div className="text-foreground">{diagnostics.tokenFieldName ?? "—"}</div>
            <div>Token length</div><div className="text-foreground">{diagnostics.tokenLength ?? "—"}</div>
            <div>Token expiry</div><div className="text-foreground">{diagnostics.tokenExpiresAt ? new Date(diagnostics.tokenExpiresAt).toLocaleTimeString() : "—"}</div>
            <div>JSON shape</div><div className="text-foreground truncate">{diagnostics.tokenJsonShape.join(", ") || "—"}</div>
            <div>Script status</div><div className="text-foreground">{diagnostics.scriptStatus}</div>
            <div>Script count</div><div className="text-foreground">{diagnostics.scriptCount}</div>
            <div>Global available</div><div className="text-foreground">{diagnostics.mapkitGlobalAvailable ? "yes" : "no"}</div>
            <div>Auth callback</div><div className="text-foreground">{diagnostics.authCallbackInvoked ? (diagnostics.authCallbackResolved ? "resolved" : "invoked") : "no"}</div>
            <div>Map instance</div><div className="text-foreground">{diagnostics.mapInstanceCreated ? "yes" : "no"}</div>
            <div>Element attached</div><div className="text-foreground">{diagnostics.mapElementAttached ? "yes" : "no"}</div>
            <div>Container</div><div className="text-foreground">{diagnostics.containerWidth} × {diagnostics.containerHeight}</div>
            <div>Children</div><div className="text-foreground">{diagnostics.childNodeCount}</div>
            <div>Canvas/subviews</div><div className="text-foreground">{diagnostics.mapCanvasSubviewCount}</div>
            <div>Ready callback</div><div className="text-foreground">{diagnostics.mapReadyCallbackFired ? "yes" : "no"}</div>
            <div>Visibility</div><div className="text-foreground">{diagnostics.computedVisibility}</div>
            <div>Opacity</div><div className="text-foreground">{diagnostics.computedOpacity}</div>
            <div>Z-index</div><div className="text-foreground">{diagnostics.computedZIndex}</div>
            <div>Top at centre</div><div className="text-foreground truncate">{diagnostics.elementAtCenter ?? "—"}</div>
          </div>
          {(diagnostics.lastError || diagnostics.tokenErrorBody) && (
            <div className="mt-2 rounded-sm bg-destructive/10 p-2 text-[10px] text-destructive">
              {diagnostics.lastError ?? diagnostics.tokenErrorBody}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
