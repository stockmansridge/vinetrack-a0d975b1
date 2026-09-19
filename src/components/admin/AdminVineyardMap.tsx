import { useEffect, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import MapSourceBadge from "@/components/MapSourceBadge";
import type { AdminPaddock } from "@/lib/adminApi";

const BLOCK_GREEN = "#A3E635";

/**
 * Read-only Apple Maps preview of a vineyard's paddock polygons,
 * used in System Admin so admin maps match the rest of the portal.
 */
export default function AdminVineyardMap({
  paddocks,
  height = 420,
}: {
  paddocks: AdminPaddock[];
  height?: number;
}) {
  const polys = paddocks
    .filter((p) => !p.deleted_at && (p.polygon_points?.length ?? 0) >= 3)
    .map((p) =>
      p.polygon_points!
        .filter(
          (pt) =>
            Number.isFinite(pt.latitude) &&
            Number.isFinite(pt.longitude) &&
            pt.latitude >= -90 &&
            pt.latitude <= 90 &&
            pt.longitude >= -180 &&
            pt.longitude <= 180,
        )
        .map((pt) => ({ lat: pt.latitude, lng: pt.longitude })),
    )
    .filter((pts) => pts.length >= 3);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (polys.length === 0) return;
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current) return;
        try { mapRef.current?.destroy?.(); } catch { /* noop */ }
        const map = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          showsCompass: mapkit.FeatureVisibility.Adaptive,
          showsScale: mapkit.FeatureVisibility.Adaptive,
          showsZoomControl: true,
          showsUserLocationControl: false,
        });
        mapRef.current = map;

        const overlays = polys.map(
          (pts) =>
            new mapkit.PolygonOverlay(
              pts.map((pt) => new mapkit.Coordinate(pt.lat, pt.lng)),
              {
                style: new mapkit.Style({
                  strokeColor: BLOCK_GREEN,
                  fillColor: BLOCK_GREEN,
                  fillOpacity: 0.35,
                  strokeOpacity: 1,
                  lineWidth: 2,
                  lineJoin: "round",
                }),
              },
            ),
        );
        map.addOverlays(overlays);

        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const pts of polys) {
          for (const pt of pts) {
            if (pt.lat < minLat) minLat = pt.lat;
            if (pt.lat > maxLat) maxLat = pt.lat;
            if (pt.lng < minLng) minLng = pt.lng;
            if (pt.lng > maxLng) maxLng = pt.lng;
          }
        }
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
          new mapkit.CoordinateSpan(
            Math.max((maxLat - minLat) * 1.4, 0.002),
            Math.max((maxLng - minLng) * 1.4, 0.002),
          ),
        );
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paddocks]);

  if (polys.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground border rounded h-40">
        No polygons available
      </div>
    );
  }

  return (
    <div className="relative rounded border overflow-hidden" style={{ height }}>
      <div ref={containerRef} className="h-full w-full bg-muted" />
      <MapSourceBadge source="apple" />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/60 text-sm">
          Loading Apple Maps…
        </div>
      )}
      {status === "failed" && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/60 text-sm">
          Apple Maps is unavailable right now.
        </div>
      )}
    </div>
  );
}
