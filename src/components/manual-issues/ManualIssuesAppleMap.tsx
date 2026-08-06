// Apple MapKit map used by the Manual Issues page and dialog.
import { useEffect, useMemo, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import MapSourceBadge from "@/components/MapSourceBadge";
import type { LatLng } from "@/lib/paddockGeometry";

export interface IssueMarker {
  id: string;
  lat: number;
  lng: number;
  colour: string;
  title?: string;
}

interface Props {
  markers: IssueMarker[];
  polygons: { id: string; pts: LatLng[] }[];
  onSelect?: (id: string) => void;
  onPick?: (lat: number, lng: number) => void;
  fitKey?: string;
  className?: string;
}

function markerElement(hex: string) {
  const el = document.createElement("div");
  el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${hex};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:pointer;`;
  return el;
}

export default function ManualIssuesAppleMap({
  markers,
  polygons,
  onSelect,
  onPick,
  fitKey,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const annsRef = useRef<any[]>([]);
  const overlaysRef = useRef<any[]>([]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const lastFitRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          showsZoomControl: true,
          showsUserLocationControl: false,
        });
        map.addEventListener("single-tap", (e: any) => {
          if (!pickRef.current) return;
          try {
            const coord = map.convertPointOnPageToCoordinate(
              new DOMPoint(e.pointOnPage.x, e.pointOnPage.y),
            );
            pickRef.current(coord.latitude, coord.longitude);
          } catch { /* noop */ }
        });
        mapRef.current = map;
        setReady(true);
      })
      .catch((e) => !cancelled && setError(e?.message || "Apple Maps unavailable"));
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Block outlines.
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;
    if (overlaysRef.current.length) {
      try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ }
      overlaysRef.current = [];
    }
    const next: any[] = [];
    for (const poly of polygons) {
      try {
        const style = new mapkit.Style({
          strokeColor: "#34C759",
          strokeOpacity: 0.7,
          lineWidth: 1,
          fillColor: "#34C759",
          fillOpacity: 0.08,
        });
        next.push(
          new mapkit.PolygonOverlay(
            poly.pts.map((p) => new mapkit.Coordinate(p.lat, p.lng)),
            { style },
          ),
        );
      } catch { /* noop */ }
    }
    if (next.length) {
      try { map.addOverlays(next); } catch { /* noop */ }
      overlaysRef.current = next;
    }
  }, [polygons, ready]);

  const markerSig = useMemo(
    () => markers.map((m) => `${m.id}:${m.lat}:${m.lng}:${m.colour}`).join("|"),
    [markers],
  );

  // Markers + fit.
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;
    if (annsRef.current.length) {
      try { map.removeAnnotations(annsRef.current); } catch { /* noop */ }
      annsRef.current = [];
    }
    const next: any[] = [];
    for (const m of markers) {
      const ann = new mapkit.Annotation(
        new mapkit.Coordinate(m.lat, m.lng),
        () => markerElement(m.colour),
        { title: m.title ?? "" },
      );
      try { ann.addEventListener?.("select", () => selectRef.current?.(m.id)); } catch { /* noop */ }
      next.push(ann);
    }
    if (next.length) {
      map.addAnnotations(next);
      annsRef.current = next;
    }

    const key = `${fitKey ?? ""}|m:${markers.length}|g:${polygons.length}`;
    if (lastFitRef.current === key) return;
    const pts: { lat: number; lng: number }[] = [];
    markers.forEach((m) => pts.push({ lat: m.lat, lng: m.lng }));
    if (!pts.length) polygons.forEach((p) => p.pts.forEach((pt) => pts.push(pt)));
    if (!pts.length) return;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of pts) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    try {
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
        new mapkit.CoordinateSpan(
          Math.max((maxLat - minLat) * 1.4, 0.003),
          Math.max((maxLng - minLng) * 1.4, 0.003),
        ),
      );
      lastFitRef.current = key;
    } catch { /* noop */ }
  }, [markerSig, polygons, ready, fitKey, markers]);

  return (
    <div className={`relative h-full w-full bg-muted ${className ?? ""}`}>
      <div ref={containerRef} className="h-full w-full" />
      {ready && <MapSourceBadge source="apple" />}
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
          Loading Apple Maps…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 px-4 text-center text-sm text-muted-foreground">
          Map unavailable — {error}
        </div>
      )}
    </div>
  );
}
