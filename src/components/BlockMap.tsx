// Block-scoped Apple MapKit map. Shows only the selected paddock's boundary,
// with optional overlays for pins (this block) and recent trip routes (this
// block). READ-ONLY — clicking a pin opens its sheet, clicking a trip route
// navigates to the trip detail page. Polygon clicks do nothing (you're
// already on the Block Detail page).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin as MapPinIcon } from "lucide-react";

import { initMapKit } from "@/lib/mapkit";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import { paddockColor } from "@/lib/paddockColor";
import { pinStyle, pinDisplayCoords, pinDisplayTitle } from "@/lib/pinStyle";
import { extractPathPoints } from "@/lib/tripReport";
import type { Trip } from "@/lib/tripsQuery";
import PinDetailSheet from "@/components/PinDetailSheet";
import type { PinRecord } from "@/components/PinDetailPanel";
import MapSourceBadge from "@/components/MapSourceBadge";
import { Badge } from "@/components/ui/badge";

interface Props {
  paddock: any;
  pins: any[];
  trips: Trip[];
  vineyardName?: string | null;
  height?: number;
}

type FilterKey = "pins" | "trips";

export default function BlockMap({
  paddock,
  pins,
  trips,
  vineyardName,
  height = 420,
}: Props) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const annotationsRef = useRef<any[]>([]);
  const didFitRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    pins: true,
    trips: true,
  });
  const [activePin, setActivePin] = useState<PinRecord | null>(null);

  const polygon = useMemo(
    () => parsePolygonPoints(paddock?.polygon_points),
    [paddock?.polygon_points],
  );
  const hasGeometry = polygon.length >= 3;

  const pinsWithCoords = useMemo(
    () =>
      pins
        .map((p) => ({ pin: p, coords: pinDisplayCoords(p as any) }))
        .filter(
          (x): x is { pin: any; coords: NonNullable<ReturnType<typeof pinDisplayCoords>> } =>
            !!x.coords,
        ),
    [pins],
  );

  const tripsWithPath = useMemo(() => {
    const validPt = (pt: LatLng) =>
      Number.isFinite(pt.lat) && Number.isFinite(pt.lng) &&
      pt.lat >= -90 && pt.lat <= 90 && pt.lng >= -180 && pt.lng <= 180;
    return trips
      .map((t) => ({ trip: t, points: extractPathPoints(t.path_points).filter(validPt) }))
      .filter((x) => x.points.length >= 2);
  }, [trips]);

  const fitToPolygon = useCallback(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!map || !mapkit || !polygon.length) return;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const pt of polygon) {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lng < minLng) minLng = pt.lng;
      if (pt.lng > maxLng) maxLng = pt.lng;
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    // Small padding (20%) to keep the polygon comfortably inside the view.
    const latDelta = Math.max((maxLat - minLat) * 1.2, 0.0015);
    const lngDelta = Math.max((maxLng - minLng) * 1.2, 0.0015);
    try {
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate(centerLat, centerLng),
        new mapkit.CoordinateSpan(latDelta, lngDelta),
      );
    } catch {
      /* noop */
    }
  }, [polygon]);

  // Init MapKit
  useEffect(() => {
    if (!hasGeometry) return;
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          isRotationEnabled: true,
          showsCompass: mapkit.FeatureVisibility.Adaptive,
          showsScale: mapkit.FeatureVisibility.Adaptive,
          showsZoomControl: true,
          showsUserLocationControl: false,
        });
        setMapReady(true);
      })
      .catch((e) => !cancelled && setMapError(e?.message || "Apple Maps unavailable"));
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setMapReady(false);
      didFitRef.current = false;
    };
  }, [hasGeometry]);

  // Render overlays
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;

    if (overlaysRef.current.length) {
      try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ }
      overlaysRef.current = [];
    }
    if (annotationsRef.current.length) {
      try { map.removeAnnotations(annotationsRef.current); } catch { /* noop */ }
      annotationsRef.current = [];
    }

    const newOverlays: any[] = [];
    const newAnnotations: any[] = [];

    // Block polygon (always shown, non-interactive selection-wise)
    if (polygon.length >= 3) {
      const color = paddockColor(paddock.id);
      const coords = polygon.map((pt) => new mapkit.Coordinate(pt.lat, pt.lng));
      const poly = new mapkit.PolygonOverlay(coords, {
        style: new mapkit.Style({
          strokeColor: color,
          fillColor: color,
          fillOpacity: 0.3,
          strokeOpacity: 1.0,
          lineWidth: 3,
          lineJoin: "round",
        }),
      });
      newOverlays.push(poly);
    }

    // Trip polylines
    if (filters.trips) {
      for (const { trip, points } of tripsWithPath) {
        const coords = points.map((p) => new mapkit.Coordinate(p.lat, p.lng));
        const line = new mapkit.PolylineOverlay(coords, {
          style: new mapkit.Style({
            strokeColor: "#FF9500",
            strokeOpacity: 0.9,
            lineWidth: 3,
            lineCap: "round",
            lineJoin: "round",
          }),
        });
        const id = trip.id;
        line.addEventListener("select", () =>
          navigate(`/trips?paddock=${paddock.id}&trip=${id}`),
        );
        newOverlays.push(line);
      }
    }

    // Pin annotations
    if (filters.pins) {
      for (const { pin, coords } of pinsWithCoords) {
        const style = pinStyle(pin.mode, pin.button_color, pin.category);
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(coords.lat, coords.lng),
          () => {
            const el = document.createElement("div");
            el.style.cssText =
              `width:14px;height:14px;border-radius:50%;background:${style.hex};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);cursor:pointer;`;
            el.title = pinDisplayTitle(pin);
            el.addEventListener("click", (ev) => {
              ev.stopPropagation();
              setActivePin(pin as PinRecord);
            });
            return el;
          },
          { anchorOffset: new DOMPoint(0, 0) },
        );
        try {
          ann.addEventListener?.("select", () => setActivePin(pin as PinRecord));
        } catch { /* noop */ }
        newAnnotations.push(ann);
      }
    }

    if (newOverlays.length) {
      map.addOverlays(newOverlays);
      overlaysRef.current = newOverlays;
    }
    if (newAnnotations.length) {
      map.addAnnotations(newAnnotations);
      annotationsRef.current = newAnnotations;
    }

    if (!didFitRef.current) {
      fitToPolygon();
      didFitRef.current = true;
    }
  }, [
    mapReady,
    polygon,
    paddock?.id,
    filters.pins,
    filters.trips,
    pinsWithCoords,
    tripsWithPath,
    navigate,
    fitToPolygon,
  ]);

  if (!hasGeometry) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed bg-muted/30 text-sm text-muted-foreground"
        style={{ height }}
      >
        <div className="text-center px-4">
          <MapPinIcon className="mx-auto h-6 w-6 opacity-60 mb-2" />
          No block boundary is available for this paddock yet.
        </div>
      </div>
    );
  }

  const toggle = (k: FilterKey) =>
    setFilters((f) => ({ ...f, [k]: !f[k] }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Pins"
          count={pinsWithCoords.length}
          active={filters.pins}
          onClick={() => toggle("pins")}
        />
        <FilterChip
          label="Trips"
          count={tripsWithPath.length}
          active={filters.trips}
          onClick={() => toggle("trips")}
        />
        {vineyardName && (
          <span className="ml-auto text-xs text-muted-foreground">{vineyardName}</span>
        )}
      </div>
      <div className="relative overflow-hidden rounded-md border bg-muted" style={{ height }}>
        <div ref={containerRef} className="absolute inset-0" />
        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-muted-foreground p-4 text-center">
            Map unavailable: {mapError}
          </div>
        )}
        {!mapError && <MapSourceBadge source="apple" />}
      </div>
      <PinDetailSheet
        open={!!activePin}
        onOpenChange={(o) => !o && setActivePin(null)}
        pin={activePin}
        paddockName={paddock?.name ?? null}
        vineyardName={vineyardName ?? null}
        paddockRowDirection={
          Number.isFinite(Number(paddock?.row_direction))
            ? Number(paddock.row_direction)
            : null
        }
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
      ].join(" ")}
      aria-pressed={active}
    >
      <span>{label}</span>
      <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
        {count}
      </Badge>
    </button>
  );
}
