import { useEffect, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import { elColourCss, formatEl } from "@/lib/growthHeatmap";
import type { HeatMapViewProps } from "@/components/growth/heatMapTypes";

interface Props extends HeatMapViewProps {
  onUnavailable: (reason: string) => void;
}

function pinElement(hex: string, outlined: boolean, stale: boolean) {
  const el = document.createElement("div");
  el.style.cssText = `
    width:${stale ? 12 : 16}px;height:${stale ? 12 : 16}px;border-radius:50%;
    background:${outlined ? "transparent" : hex};
    border:2px ${stale ? "dashed" : "solid"} #ffffff;
    opacity:${stale ? 0.55 : 1};
    box-shadow:0 1px 4px rgba(0,0,0,0.45);
    cursor:pointer;
  `;
  return el;
}


function labelElement(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    color:#fff;font-size:11px;font-weight:600;white-space:nowrap;
    text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none;
  `;
  return el;
}

/**
 * Apple MapKit renderer for the Ripeness Heatmap.
 *
 * MapKit JS has no image-overlay primitive, so the per-block heat rasters
 * (already clipped to each polygon) are painted onto a canvas layered over
 * the map and re-projected whenever the region changes.
 */
export default function AppleHeatMap({
  blocks,
  overlays,
  observations,
  staleIds,
  fitPoints,
  fitKey,
  showBoundaries,
  onSelect,
  onUnavailable,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const annsRef = useRef<any[]>([]);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [ready, setReady] = useState(false);

  // Keep the latest callback without re-running the init effect (the parent
  // passes an inline arrow, so its identity changes on every render).
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  // --- map init ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit: any) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          showsZoomControl: true,
          showsUserLocationControl: false,
          isRotationEnabled: false,
        });
        setReady(true);
      })
      .catch((e: Error) => !cancelled && unavailableRef.current(e?.message || "MapKit init failed"));
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setReady(false);
    };
  }, []);


  // --- heat canvas ---------------------------------------------------------
  const draw = () => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    const host = containerRef.current;
    if (!map || !canvas || !host) return;
    const rect = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const mapkit = (window as any).mapkit;
    if (!mapkit) return;

    for (const o of overlays) {
      const img = imagesRef.current.get(o.url);
      if (!img || !img.complete || !img.naturalWidth) continue;
      try {
        const nw = map.convertCoordinateToPointOnPage(new mapkit.Coordinate(o.bounds[1][0], o.bounds[0][1]));
        const se = map.convertCoordinateToPointOnPage(new mapkit.Coordinate(o.bounds[0][0], o.bounds[1][1]));
        // convertCoordinateToPointOnPage returns page coordinates (viewport + scroll).
        const x = nw.x - (rect.left + window.scrollX);
        const y = nw.y - (rect.top + window.scrollY);

        const w = se.x - nw.x;
        const h = se.y - nw.y;
        if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) continue;
        ctx.drawImage(img, x, y, w, h);
      } catch { /* noop */ }
    }
  };

  // Preload the rasters, then repaint.
  useEffect(() => {
    let cancelled = false;
    const wanted = new Set(overlays.map((o) => o.url));
    imagesRef.current.forEach((_v, k) => { if (!wanted.has(k)) imagesRef.current.delete(k); });
    const pending = overlays.filter((o) => !imagesRef.current.has(o.url));
    if (!pending.length) { draw(); return; }
    let left = pending.length;
    pending.forEach((o) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        imagesRef.current.set(o.url, img);
        if (--left <= 0) draw();
      };
      img.onerror = () => { if (--left <= 0 && !cancelled) draw(); };
      img.src = o.url;
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, ready]);

  // Repaint while the user pans/zooms and on resize.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let raf = 0;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    const start = () => { if (!raf) raf = requestAnimationFrame(loop); };
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } draw(); };
    map.addEventListener("region-change-start", start);
    map.addEventListener("region-change-end", stop);
    const ro = new ResizeObserver(() => draw());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", draw);
    draw();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      try {
        map.removeEventListener("region-change-start", start);
        map.removeEventListener("region-change-end", stop);
      } catch { /* noop */ }
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // --- boundaries + labels -------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;

    if (overlaysRef.current.length) {
      try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ }
      overlaysRef.current = [];
    }
    if (!showBoundaries) return;

    const next: any[] = [];
    for (const b of blocks) {
      if (b.polygon.length < 3) continue;
      try {
        const coords = b.polygon.map((p) => new mapkit.Coordinate(p.lat, p.lng));
        const style = new mapkit.Style({
          strokeColor: "#ffffff",
          strokeOpacity: 0.9,
          lineWidth: 2,
          fillColor: "#ffffff",
          fillOpacity: b.mode === "none" || b.mode === "stale" ? 0.06 : 0,
        });
        next.push(new mapkit.PolygonOverlay(coords, { style }));
      } catch { /* noop */ }
    }
    if (next.length) {
      try { map.addOverlays(next); } catch { /* noop */ }
      overlaysRef.current = next;
    }
  }, [blocks, showBoundaries, ready]);

  // --- observation pins (+ optional block name labels) ---------------------
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;

    if (annsRef.current.length) {
      try { map.removeAnnotations(annsRef.current); } catch { /* noop */ }
      annsRef.current = [];
    }

    const next: any[] = [];
    for (const o of observations) {
      try {
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(o.lat, o.lng),
          () => pinElement(elColourCss(o.el), !(o.assigned && o.paddockId), staleIds.has(o.id)),
          { title: "" },
        );
        ann.addEventListener?.("select", () => onSelect(o));
        next.push(ann);
      } catch { /* noop */ }
    }

    if (showBoundaries) {
      for (const b of blocks) {
        if (b.polygon.length < 3) continue;
        const lat = b.polygon.reduce((s, p) => s + p.lat, 0) / b.polygon.length;
        const lng = b.polygon.reduce((s, p) => s + p.lng, 0) / b.polygon.length;
        try {
          next.push(
            new mapkit.Annotation(
              new mapkit.Coordinate(lat, lng),
              () => labelElement(
                `${b.paddockName}${
                  b.mode === "none"
                    ? " · No observations"
                    : b.mode === "stale"
                      ? " · No current observations"
                      : b.medianEl != null
                        ? ` · ${formatEl(b.medianEl)}`
                        : ""
                }`,
              ),
              { collisionMode: mapkit.Annotation.CollisionMode.None },
            ),
          );
        } catch { /* noop */ }
      }
    }

    if (next.length) {
      try { map.addAnnotations(next); } catch { /* noop */ }
      annsRef.current = next;
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observations, blocks, showBoundaries, ready, onSelect, staleIds]);

  // --- fit -----------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit || !fitPoints.length) return;
    const lats = fitPoints.map((p) => p.lat);
    const lngs = fitPoints.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    try {
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
        new mapkit.CoordinateSpan(
          Math.max(0.0015, (maxLat - minLat) * 1.3),
          Math.max(0.0015, (maxLng - minLng) * 1.3),
        ),
      );
    } catch { /* noop */ }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready, fitPoints.length]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
