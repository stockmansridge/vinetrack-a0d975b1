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
  labStatusMapColor,
  soilMapLabelSpec,
  DEFAULT_SOIL_MAP_LABEL_MODE,
  type SoilMapLabelMode,
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
  /** Smart (default): short low-priority labels MapKit may hide on collision. */
  labelMode?: SoilMapLabelMode;
  height?: number | string;
}

export function SoilReportMap({
  rows,
  mode,
  unit,
  selectedId,
  onSelect,
  labelMode = DEFAULT_SOIL_MAP_LABEL_MODE,
  // Responsive tall viewport: ~65–72vh on desktop, floored so the map stays
  // usable on short screens and capped so it never runs away on very tall
  // displays. Width comes from the full-width Reports container.
  height = "min(72vh, 880px)",
}: Props) {
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

      // Value label at the centroid. Polygons stay clickable even when a
      // label is hidden by MapKit collision handling or labels are Off.
      const spec = soilMapLabelSpec(p.row, { mode: labelMode, selected: isSelected, unit });
      if (spec && p.centroid && validPt(p.centroid)) {
        const id = p.row.paddock_id;
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(p.centroid.lat, p.centroid.lng),
          () => {
            const el = document.createElement("div");
            el.className = "vt-name-chip";
            el.style.pointerEvents = "auto";
            el.style.cursor = "pointer";
            if (spec.selected) {
              el.style.fontWeight = "700";
              el.style.outline = "2px solid #1f2937";
            }
            el.textContent = spec.text;
            el.addEventListener("click", (ev) => {
              ev.stopPropagation();
              onSelect(id);
            });
            return el;
          },
          {
            collisionMode: mapkit.Annotation.CollisionMode.Rectangle,
            displayPriority:
              spec.priority === "required"
                ? mapkit.Annotation.DisplayPriority.Required
                : mapkit.Annotation.DisplayPriority.Low,
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
  }, [mapReady, parsed, mode, unit, selectedId, min, max, labelMode]);

  useEffect(() => {
    didFitRef.current = false;
  }, [rows]);

  if (mapError) {
    return (
      <div
        className="flex items-center justify-center rounded-md border bg-muted/30 px-6 text-center text-sm text-muted-foreground"
        style={{ height, minHeight: 560 }}
      >
        The map is unavailable: {mapError}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full rounded-md border"
        style={{ height, minHeight: 560 }}
      />
      <div className="absolute right-2 top-2">
        <MapSourceBadge source="apple" />
      </div>
    </div>
  );
}
