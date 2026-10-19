import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { initMapKit } from "@/lib/mapkit";
import MapSourceBadge from "@/components/MapSourceBadge";

export interface ScoutMapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  /** CSS colour for the marker dot. */
  colour: string;
}

interface Props {
  /** Measured GPS markers only — never fabricated coordinates. */
  markers: ScoutMapMarker[];
  /** Block boundary polygons (context), as [lat, lng] rings. */
  boundaries?: { id: string; name: string | null; ring: [number, number][] }[];
}

type Provider = "checking" | "apple" | "unavailable";

/**
 * Context map for a Scout Report: block boundaries plus measured
 * stop/observation/photo GPS markers. Renders an honest empty state when
 * there is nothing measured to show — no centroid fabrication.
 */
export default function ScoutStopsMap({ markers, boundaries = [] }: Props) {
  const [provider, setProvider] = useState<Provider>("checking");
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProvider("checking");
    initMapKit()
      .then(() => !cancelled && setProvider("apple"))
      .catch(() => !cancelled && setProvider("unavailable"));
    return () => {
      cancelled = true;
    };
  }, []);

  const hasAnything = markers.length > 0 || boundaries.some((b) => b.ring.length > 2);

  useEffect(() => {
    if (!el || provider !== "apple" || !hasAnything) return;
    const mapkit = (window as any).mapkit;
    if (!mapkit) return;
    let map: any;
    try {
      map = new mapkit.Map(el, {
        mapType: mapkit.Map.MapTypes.Hybrid,
        showsZoomControl: true,
        showsUserLocationControl: false,
      });

      const coords: any[] = [];
      for (const b of boundaries) {
        if (b.ring.length < 3) continue;
        const points = b.ring.map(([lat, lng]) => {
          const c = new mapkit.Coordinate(lat, lng);
          coords.push(c);
          return c;
        });
        const overlay = new mapkit.PolygonOverlay([points], {
          style: new mapkit.Style({
            strokeColor: "#FFFFFF",
            strokeOpacity: 0.8,
            lineWidth: 1.5,
            fillOpacity: 0.05,
          }),
        });
        map.addOverlay(overlay);
      }

      const annotations = markers.map((m) => {
        const dot = document.createElement("div");
        dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${m.colour};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
        const c = new mapkit.Coordinate(m.lat, m.lng);
        coords.push(c);
        return new mapkit.Annotation(c, () => dot, { title: m.title });
      });
      if (annotations.length) map.addAnnotations(annotations);

      if (coords.length) {
        const lats = coords.map((c) => c.latitude);
        const lngs = coords.map((c) => c.longitude);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
          new mapkit.CoordinateSpan(
            Math.max((maxLat - minLat) * 1.3, 0.002),
            Math.max((maxLng - minLng) * 1.3, 0.002),
          ),
        );
      }
    } catch {
      /* map is best-effort context */
    }
    return () => {
      try {
        map?.destroy?.();
      } catch {
        /* noop */
      }
    };
  }, [el, provider, markers, boundaries, hasAnything]);

  const markerSummary = useMemo(
    () => `${markers.length} measured location${markers.length === 1 ? "" : "s"}`,
    [markers.length],
  );

  if (!hasAnything) {
    return (
      <Card className="p-3 text-xs text-muted-foreground">
        No measured GPS locations or block boundaries are available for this visit.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative h-[280px] w-full bg-muted">
        {provider === "apple" ? (
          <>
            <div ref={setEl} className="h-full w-full" />
            <MapSourceBadge source="apple" />
          </>
        ) : provider === "checking" ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading map…
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
            <div className="text-sm font-medium text-foreground">Map preview unavailable</div>
            <div className="text-xs text-muted-foreground">
              Measured coordinates are listed with each observation below.
            </div>
          </div>
        )}
      </div>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        {markerSummary} recorded on this visit. Markers show measured GPS only.
      </div>
    </Card>
  );
}
