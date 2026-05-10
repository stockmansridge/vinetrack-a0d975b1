// Read-only Apple MapKit view showing one paddock polygon and (optionally)
// a damage polygon overlaid on top. Shared between the Damage Records detail
// drawer (display) and the create/edit drawer (preview of the saved polygon).
import { useEffect, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import { polygonCentroid, type LatLng } from "@/lib/paddockGeometry";

interface DamageMapViewProps {
  paddockPolygon: LatLng[];
  damagePolygon: LatLng[];
  className?: string;
  height?: number;
}

const PADDOCK_COLOR = "#2E7D32";
const DAMAGE_COLOR = "#E53935";

export default function DamageMapView({
  paddockPolygon,
  damagePolygon,
  className,
  height = 280,
}: DamageMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          isRotationEnabled: false,
          showsCompass: mapkit.FeatureVisibility.Hidden,
          showsScale: mapkit.FeatureVisibility.Adaptive,
          showsZoomControl: true,
        });
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Map unavailable");
      });
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!ready || !map || !mapkit) return;

    if (overlaysRef.current.length) {
      try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ }
      overlaysRef.current = [];
    }

    const overlays: any[] = [];
    const allPts: LatLng[] = [];

    if (paddockPolygon.length >= 3) {
      const coords = paddockPolygon.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      overlays.push(
        new mapkit.PolygonOverlay(coords, {
          style: new mapkit.Style({
            strokeColor: PADDOCK_COLOR,
            fillColor: PADDOCK_COLOR,
            fillOpacity: 0.12,
            strokeOpacity: 0.95,
            lineWidth: 2,
          }),
        }),
      );
      allPts.push(...paddockPolygon);
    }

    if (damagePolygon.length >= 3) {
      const coords = damagePolygon.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      overlays.push(
        new mapkit.PolygonOverlay(coords, {
          style: new mapkit.Style({
            strokeColor: DAMAGE_COLOR,
            fillColor: DAMAGE_COLOR,
            fillOpacity: 0.4,
            strokeOpacity: 1,
            lineWidth: 2,
          }),
        }),
      );
      allPts.push(...damagePolygon);
    }

    if (overlays.length) {
      map.addOverlays(overlays);
      overlaysRef.current = overlays;
    }

    if (allPts.length) {
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const pt of allPts) {
        if (pt.lat < minLat) minLat = pt.lat;
        if (pt.lat > maxLat) maxLat = pt.lat;
        if (pt.lng < minLng) minLng = pt.lng;
        if (pt.lng > maxLng) maxLng = pt.lng;
      }
      const c = polygonCentroid(allPts) ?? { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
      const latDelta = Math.max((maxLat - minLat) * 1.6, 0.001);
      const lngDelta = Math.max((maxLng - minLng) * 1.6, 0.001);
      try {
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(c.lat, c.lng),
          new mapkit.CoordinateSpan(latDelta, lngDelta),
        );
      } catch { /* noop */ }
    }
  }, [ready, paddockPolygon, damagePolygon]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border bg-muted ${className ?? ""}`}
      style={{ height }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive bg-background/70">
          {error}
        </div>
      )}
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background/40">
          Loading map…
        </div>
      )}
    </div>
  );
}
