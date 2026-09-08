// Apple MapKit JS hybrid satellite map for a trip route.
//
// Style `spray-route-red-green-v1` (shared with the exported route PNG):
// chronological red → orange → yellow → lime → green polyline, red Start
// (oldest point) and green Finish (newest point). The interactive map and the
// PDF image therefore tell the same story about direction of travel.
import { useEffect, useMemo, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import { extractPathPoints } from "@/lib/tripReport";
import {
  routeChronologySegments,
  SPRAY_ROUTE_START_COLOUR,
  SPRAY_ROUTE_FINISH_COLOUR,
} from "@/lib/satelliteRouteMap";

interface Props {
  pathPoints: any;
  height?: number;
}

export default function TripRouteAppleMap({ pathPoints, height = 280 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const points = useMemo(() => extractPathPoints(pathPoints), [pathPoints]);
  // Redraw whenever the actual coordinates change, not just their count.
  const pointsKey = useMemo(
    () => points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|"),
    [points],
  );

  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          showsZoomControl: true,
          showsUserLocationControl: false,
          showsCompass: (mapkit.FeatureVisibility?.Hidden) ?? undefined,
        });
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

  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit || points.length < 2) return;

    try {
      map.removeOverlays(map.overlays ?? []);
      map.removeAnnotations(map.annotations ?? []);
    } catch { /* noop */ }

    const coords = points.map((p) => new mapkit.Coordinate(p.lat, p.lng));

    // Chronological gradient: one overlay per contiguous same-colour run, so
    // the whole route is covered without gaps and stays time-ordered.
    const overlays = routeChronologySegments(coords.length).map((seg) => {
      const style = new mapkit.Style({
        strokeColor: seg.colour,
        strokeOpacity: 0.95,
        lineWidth: 4,
      });
      return new mapkit.PolylineOverlay(
        coords.slice(seg.startIndex, seg.endIndex + 1),
        { style },
      );
    });
    try { map.addOverlays ? map.addOverlays(overlays) : overlays.forEach((o) => map.addOverlay(o)); }
    catch { /* noop */ }

    const makeDot = (hex: string) => () => {
      const el = document.createElement("div");
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${hex};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.45);`;
      return el;
    };
    const start = new mapkit.Annotation(coords[0], makeDot(SPRAY_ROUTE_START_COLOUR), {
      title: "Start",
    });
    const end = new mapkit.Annotation(
      coords[coords.length - 1],
      makeDot(SPRAY_ROUTE_FINISH_COLOUR),
      { title: "Finish" },
    );
    try { map.addAnnotations([start, end]); } catch { /* noop */ }

    // Fit bounds
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = Math.max((maxLat - minLat) * 1.4, 0.002);
    const lngDelta = Math.max((maxLng - minLng) * 1.4, 0.002);
    try {
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate(centerLat, centerLng),
        new mapkit.CoordinateSpan(latDelta, lngDelta),
      );
    } catch { /* noop */ }
  }, [ready, pointsKey, points]);

  if (points.length < 2) {
    return (
      <div
        className="rounded-md border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        No route recorded.
      </div>
    );
  }

  return (
    <div className="relative rounded-md overflow-hidden border" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background/60">
          Loading satellite map…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive bg-background/80 px-3 text-center">
          Satellite map unavailable — {error}
        </div>
      )}
      <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: SPRAY_ROUTE_START_COLOUR }}
        />
        Start
        <span className="mx-1">→</span>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: SPRAY_ROUTE_FINISH_COLOUR }}
        />
        Finish
      </div>
    </div>
  );
}
