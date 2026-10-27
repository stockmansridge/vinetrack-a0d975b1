// Vineyard soil map — reuses the existing VineTrack Apple MapKit stack
// (initMapKit + parsePolygonPoints, same as the paddock/crop-health maps).
// Colours only the actual mapped block polygons: blocks with a confirmed
// numeric value use the sequential value scale (or the lab-status colours in
// Lab status mode); blocks with no confirmed value stay neutral grey. No
// interpolation and no fake spatial surface.
import { useEffect, useMemo, useRef, useState } from "react";
import { initMapKit } from "@/lib/mapkit";
import { parsePolygonPoints, polygonCentroid, type LatLng } from "@/lib/paddockGeometry";
import {
  SOIL_MAP_NO_DATA_COLOR,
  formatMapValue,
  labStatusMapColor,
  valueScaleColor,
  type SoilMapReportRow,
} from "@/lib/soilAnalysis";
import MapSourceBadge from "@/components/MapSourceBadge";
import "@/components/map/mapChips.css";

export type SoilMapMode = "value" | "status";

interface Props {
  rows: SoilMapReportRow[];
  mode: SoilMapMode;
  unit: string | null;
  selectedId: string | null;
  onSelect: (paddockId: string) => void;
  height?: number | string;
}

export function SoilReportMap({ rows, mode, unit, selectedId, onSelect, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const annotationsRef = useRef<any[]>([]);
  const didFitRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const values = useMemo(
    () =>
      rows
        .map((r) => r.value_numeric)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v)),
    [rows],
  );
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  const colorFor = (row: SoilMapReportRow): string => {
    if (mode === "status") {
      return row.value_numeric == null && !row.lab_status
        ? SOIL_MAP_NO_DATA_COLOR
        : labStatusMapColor(row.lab_status);
    }
    if (row.value_numeric == null || min == null || max == null) return SOIL_MAP_NO_DATA_COLOR;
    return valueScaleColor(row.value_numeric, min, max);
  };

  const parsed = useMemo(
    () =>
      rows.map((row) => ({
        row,
        polygon: parsePolygonPoints(row.polygon_points),
        centroid: polygonCentroid(parsePolygonPoints(row.polygon_points)),
      })),
    [rows],
  );

  useEffect(() => {
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
      .catch((e) => {
        if (!cancelled) setMapError(e?.message || "MapKit init failed");
      });
    return () => {
      cancelled = true;
      try {
        mapRef.current?.destroy?.();
      } catch {
        /* noop */
      }
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;

    if (overlaysRef.current.length) {
      try {
        map.removeOverlays(overlaysRef.current);
      } catch {
        /* noop */
      }
      overlaysRef.current = [];
    }
    if (annotationsRef.current.length) {
      try {
        map.removeAnnotations(annotationsRef.current);
      } catch {
        /* noop */
      }
      annotationsRef.current = [];
    }

    const newOverlays: any[] = [];
    const newAnnotations: any[] = [];
    const allPts: LatLng[] = [];

    const validPt = (pt: LatLng) =>
      Number.isFinite(pt.lat) &&
      Number.isFinite(pt.lng) &&
      pt.lat >= -90 &&
      pt.lat <= 90 &&
      pt.lng >= -180 &&
      pt.lng <= 180;

    for (const p of parsed) {
      const validPolyPts = p.polygon.filter(validPt);
      if (validPolyPts.length < 3) continue;
      allPts.push(...validPolyPts);
      const isSelected = p.row.paddock_id === selectedId;
      const fill = colorFor(p.row);

      const poly = new mapkit.PolygonOverlay(
        validPolyPts.map((pt) => new mapkit.Coordinate(pt.lat, pt.lng)),
        {
          style: new mapkit.Style({
            strokeColor: isSelected ? "#1f2937" : fill,
            fillColor: fill,
            fillOpacity: isSelected ? 0.55 : 0.45,
            strokeOpacity: isSelected ? 1 : 0.85,
            lineWidth: isSelected ? 3.5 : 2,
            lineJoin: "round",
            lineCap: "round",
          }),
          data: { id: p.row.paddock_id },
        },
      );
      poly.addEventListener("select", () => onSelect(p.row.paddock_id));
      newOverlays.push(poly);

      // Block name + value chip at the centroid when there is room.
      if (p.centroid && validPt(p.centroid) && p.row.paddock_name) {
        const name = p.row.paddock_name;
        const id = p.row.paddock_id;
        const valueLabel =
          p.row.value_numeric != null
            ? `${name} · ${formatMapValue(p.row.value_numeric)}${unit ? ` ${unit}` : ""}`
            : name;
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(p.centroid.lat, p.centroid.lng),
          () => {
            const el = document.createElement("div");
            el.className = "vt-name-chip";
            el.style.pointerEvents = "auto";
            el.style.cursor = "pointer";
            el.textContent = valueLabel;
            el.addEventListener("click", (ev) => {
              ev.stopPropagation();
              onSelect(id);
            });
            return el;
          },
        );
        try {
          ann.addEventListener?.("select", () => onSelect(id));
        } catch {
          /* noop */
        }
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

    if (!didFitRef.current && allPts.length > 0) {
      const lats = allPts.map((p) => p.lat);
      const lngs = allPts.map((p) => p.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const padLat = Math.max((maxLat - minLat) * 0.15, 0.0005);
      const padLng = Math.max((maxLng - minLng) * 0.15, 0.0005);
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
        new mapkit.CoordinateSpan(maxLat - minLat + padLat * 2, maxLng - minLng + padLng * 2),
      );
      didFitRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, parsed, mode, unit, selectedId, min, max]);

  useEffect(() => {
    didFitRef.current = false;
  }, [rows]);

  if (mapError) {
    return (
      <div
        className="flex items-center justify-center rounded-md border bg-muted/30 px-6 text-center text-sm text-muted-foreground"
        style={{ height }}
      >
        The map is unavailable: {mapError}
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full rounded-md border" style={{ height }} />
      <div className="absolute right-2 top-2">
        <MapSourceBadge source="apple" />
      </div>
    </div>
  );
}
