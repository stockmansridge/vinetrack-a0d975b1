// Boundary draw map for the New Paddock wizard.
//
// Parity goal with iOS:
//   - Apple-style satellite/hybrid imagery (MapKit JS when available,
//     Esri World Imagery tiles via Leaflet as a fallback).
//   - Centre on user → vineyard shared location → existing paddock
//     centroid → safe default.
//   - Editable polygon: tap empty map to append a vertex, drag a vertex
//     to reposition, tap a midpoint handle to insert a vertex between
//     two existing points, tap a vertex (with ≥4 pts) to delete it.
//   - Polygon stored open (first vertex not repeated) per the
//     iOS-canonical contract.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { initMapKit } from "@/lib/mapkit";
import { fetchVineyardLocation } from "@/lib/vineyardLocationQuery";
import { fetchList } from "@/lib/queries";
import { useVineyard } from "@/context/VineyardContext";
import {
  parsePolygonPoints,
  polygonCentroid,
  type LatLng,
} from "@/lib/paddockGeometry";

const POLY_STROKE = "#34C759";
const POLY_FILL = "#34C759";
const DEFAULT_CENTER: LatLng = { lat: -34.5, lng: 138.7 };

interface Props {
  polygon: LatLng[];
  setPolygon: (p: LatLng[]) => void;
}

// Resolve initial centre: browser geolocation → vineyard.lat/lng →
// centroid of existing paddocks → safe default.
function useInitialCentre(vineyardId: string | null): LatLng | null {
  const [centre, setCentre] = useState<LatLng | null>(null);
  const { data: loc } = useQuery({
    queryKey: ["vineyard-location-centre", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchVineyardLocation(vineyardId!),
    staleTime: 5 * 60_000,
  });
  const { data: paddocks } = useQuery({
    queryKey: ["paddocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList<any>("paddocks", vineyardId!),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (centre) return;
    let cancelled = false;
    let settled = false;

    const resolveFallback = () => {
      if (cancelled || settled) return;
      if (loc?.latitude != null && loc?.longitude != null) {
        setCentre({ lat: Number(loc.latitude), lng: Number(loc.longitude) });
        settled = true;
        return;
      }
      const pts: LatLng[] = [];
      for (const p of paddocks ?? []) {
        const c = polygonCentroid(parsePolygonPoints(p?.polygon_points));
        if (c) pts.push(c);
      }
      const c = polygonCentroid(pts);
      if (c) {
        setCentre(c);
        settled = true;
        return;
      }
      setCentre(DEFAULT_CENTER);
      settled = true;
    };

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      const timer = setTimeout(resolveFallback, 4000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          if (cancelled || settled) return;
          setCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          settled = true;
        },
        () => {
          clearTimeout(timer);
          resolveFallback();
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 4000 },
      );
    } else {
      resolveFallback();
    }
    return () => { cancelled = true; };
  }, [loc, paddocks, centre]);

  return centre;
}

export default function BoundaryDrawMap({ polygon, setPolygon }: Props) {
  const { selectedVineyardId } = useVineyard();
  const centre = useInitialCentre(selectedVineyardId);
  const [mode, setMode] = useState<"checking" | "apple" | "fallback">("checking");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMode("checking");
    initMapKit()
      .then(() => { if (!cancelled) setMode("apple"); })
      .catch((e) => {
        if (!cancelled) {
          setReason(e?.message || "MapKit unavailable");
          setMode("fallback");
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (!centre || mode === "checking") {
    return <div className="h-full w-full bg-muted animate-pulse" />;
  }

  return (
    <div className="relative h-full w-full">
      {mode === "apple" ? (
        <AppleDrawMap centre={centre} polygon={polygon} setPolygon={setPolygon} />
      ) : (
        <LeafletSatelliteDraw centre={centre} polygon={polygon} setPolygon={setPolygon} />
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-2 py-1 text-[11px] text-foreground shadow">
        {mode === "apple" ? "Apple Maps · Hybrid" : "Satellite (Esri)"}
        {polygon.length > 0 && ` · ${polygon.length} pts`}
      </div>
      <div className="pointer-events-none absolute left-2 bottom-2 right-2 rounded bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow">
        Tap empty map to add a point · drag a point to move · tap a small <span className="inline-block w-2 h-2 rounded-full bg-white border border-[color:hsl(145_42%_28%)] align-middle" /> midpoint to insert · tap a numbered point to delete (needs ≥4)
      </div>
      {mode === "fallback" && reason && (
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow" title={reason}>
          Apple Maps unavailable — using satellite fallback
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Apple MapKit drawing surface (with editable polygon)
// ────────────────────────────────────────────────────────────────────────────

function AppleDrawMap({
  centre, polygon, setPolygon,
}: { centre: LatLng; polygon: LatLng[]; setPolygon: (p: LatLng[]) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const vertexAnnsRef = useRef<any[]>([]);
  const midAnnsRef = useRef<any[]>([]);
  const polygonRef = useRef<LatLng[]>(polygon);
  polygonRef.current = polygon;
  const setPolygonRef = useRef(setPolygon);
  setPolygonRef.current = setPolygon;

  // Init once.
  useEffect(() => {
    let cancelled = false;
    initMapKit().then((mapkit) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new mapkit.Map(containerRef.current, {
        mapType: mapkit.Map.MapTypes.Hybrid,
        isRotationEnabled: true,
        showsCompass: mapkit.FeatureVisibility.Adaptive,
        showsScale: mapkit.FeatureVisibility.Adaptive,
        showsZoomControl: true,
      });
      mapRef.current = map;
      try {
        map.region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(centre.lat, centre.lng),
          new mapkit.CoordinateSpan(0.004, 0.004),
        );
      } catch { /* noop */ }

      const onTap = (e: any) => {
        try {
          let coord: any = e?.coordinate ?? null;
          if (!coord) {
            const pt = e?.pointOnPage ?? e?.point ?? null;
            if (!pt) return;
            coord = map.convertPointOnPageToCoordinate(pt);
          }
          const lat = coord?.latitude;
          const lng = coord?.longitude;
          if (typeof lat !== "number" || typeof lng !== "number") return;
          setPolygonRef.current([...polygonRef.current, { lat, lng }]);
        } catch { /* noop */ }
      };
      map.addEventListener("single-tap", onTap);
    }).catch(() => { /* parent already handled unavailable */ });
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render polygon overlay + vertex + midpoint annotations.
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!map || !mapkit) return;

    if (overlayRef.current) { try { map.removeOverlay(overlayRef.current); } catch { /* noop */ } overlayRef.current = null; }
    if (lineRef.current) { try { map.removeOverlay(lineRef.current); } catch { /* noop */ } lineRef.current = null; }
    if (vertexAnnsRef.current.length) {
      try { map.removeAnnotations(vertexAnnsRef.current); } catch { /* noop */ }
      vertexAnnsRef.current = [];
    }
    if (midAnnsRef.current.length) {
      try { map.removeAnnotations(midAnnsRef.current); } catch { /* noop */ }
      midAnnsRef.current = [];
    }

    if (polygon.length >= 3) {
      const coords = polygon.map((p) => new mapkit.Coordinate(p.lat, p.lng));
      const overlay = new mapkit.PolygonOverlay(coords, {
        style: new mapkit.Style({
          strokeColor: POLY_STROKE,
          fillColor: POLY_FILL,
          fillOpacity: 0.25,
          strokeOpacity: 1,
          lineWidth: 2.5,
          lineJoin: "round",
        }),
      });
      try { overlay.enabled = false; } catch { /* noop */ }
      map.addOverlay(overlay);
      overlayRef.current = overlay;
    } else if (polygon.length === 2) {
      const line = new mapkit.PolylineOverlay(
        polygon.map((p) => new mapkit.Coordinate(p.lat, p.lng)),
        { style: new mapkit.Style({ strokeColor: POLY_STROKE, lineWidth: 2 }) },
      );
      try { line.enabled = false; } catch { /* noop */ }
      map.addOverlay(line);
      lineRef.current = line;
    }

    // Vertex annotations — draggable; tap deletes when ≥4 pts.
    const vertexAnns = polygon.map((p, i) => {
      const ann = new mapkit.Annotation(
        new mapkit.Coordinate(p.lat, p.lng),
        () => {
          const el = document.createElement("div");
          el.style.cssText =
            "background:#34C759;color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:grab";
          el.textContent = String(i + 1);
          return el;
        },
      );
      try { ann.draggable = true; } catch { /* noop */ }
      ann.addEventListener("drag-end", () => {
        try {
          const c = ann.coordinate;
          const next = polygonRef.current.slice();
          next[i] = { lat: c.latitude, lng: c.longitude };
          setPolygonRef.current(next);
        } catch { /* noop */ }
      });
      ann.addEventListener("select", () => {
        // Delete on select when we have enough vertices.
        if (polygonRef.current.length <= 3) return;
        const next = polygonRef.current.slice();
        next.splice(i, 1);
        setPolygonRef.current(next);
      });
      return ann;
    });
    if (vertexAnns.length) {
      map.addAnnotations(vertexAnns);
      vertexAnnsRef.current = vertexAnns;
    }

    // Midpoint annotations — tap to insert a vertex between two points.
    if (polygon.length >= 2) {
      const midAnns: any[] = [];
      const n = polygon.length;
      const segCount = n >= 3 ? n : 1; // open segment for 2 pts
      for (let i = 0; i < segCount; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % n];
        const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(mid.lat, mid.lng),
          () => {
            const el = document.createElement("div");
            el.style.cssText =
              "width:10px;height:10px;border-radius:9999px;background:#fff;border:2px solid #34C759;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:pointer;opacity:.85";
            return el;
          },
        );
        const insertAt = i + 1;
        ann.addEventListener("select", () => {
          const next = polygonRef.current.slice();
          next.splice(insertAt, 0, mid);
          setPolygonRef.current(next);
        });
        midAnns.push(ann);
      }
      if (midAnns.length) {
        map.addAnnotations(midAnns);
        midAnnsRef.current = midAnns;
      }
    }
  }, [polygon]);

  return <div ref={containerRef} className="h-full w-full" />;
}

// ────────────────────────────────────────────────────────────────────────────
// Leaflet satellite fallback (Esri World Imagery) — editable polygon
// ────────────────────────────────────────────────────────────────────────────

function LeafletSatelliteDraw({
  centre, polygon, setPolygon,
}: { centre: LatLng; polygon: LatLng[]; setPolygon: (p: LatLng[]) => void }) {
  return (
    <MapContainer center={[centre.lat, centre.lng]} zoom={17} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='Tiles &copy; Esri'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
      <TileLayer
        attribution=""
        url="https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
        opacity={0.85}
      />
      <ClickHandler polygon={polygon} setPolygon={setPolygon} />
      {polygon.length >= 3 && (
        <Polygon
          positions={polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: POLY_STROKE, weight: 2.5, fillOpacity: 0.25 }}
          interactive={false}
        />
      )}
      {polygon.length === 2 && (
        <Polyline
          positions={polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: POLY_STROKE, weight: 2 }}
          interactive={false}
        />
      )}
      {/* Midpoint insert handles */}
      {polygon.length >= 2 &&
        (() => {
          const n = polygon.length;
          const segCount = n >= 3 ? n : 1;
          const items: JSX.Element[] = [];
          for (let i = 0; i < segCount; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % n];
            const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
            const insertAt = i + 1;
            items.push(
              <Marker
                key={`mid-${i}`}
                position={[mid.lat, mid.lng]}
                icon={midIcon()}
                eventHandlers={{
                  click: () => {
                    const next = polygon.slice();
                    next.splice(insertAt, 0, mid);
                    setPolygon(next);
                  },
                }}
              />,
            );
          }
          return items;
        })()}
      {/* Vertex handles — draggable + click-to-delete */}
      {polygon.map((p, i) => (
        <Marker
          key={`v-${i}`}
          position={[p.lat, p.lng]}
          icon={vertexIcon(i + 1)}
          draggable
          eventHandlers={{
            dragend: (e: any) => {
              const ll = e.target.getLatLng();
              const next = polygon.slice();
              next[i] = { lat: ll.lat, lng: ll.lng };
              setPolygon(next);
            },
            click: () => {
              if (polygon.length <= 3) return;
              const next = polygon.slice();
              next.splice(i, 1);
              setPolygon(next);
            },
          }}
        />
      ))}
    </MapContainer>
  );
}

function ClickHandler({ polygon, setPolygon }: { polygon: LatLng[]; setPolygon: (p: LatLng[]) => void }) {
  useMapEvents({
    click(e) {
      setPolygon([...polygon, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    },
  });
  return null;
}

function vertexIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#34C759;color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:grab">${n}</div>`,
    iconSize: [0, 0],
  });
}

function midIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:10px;height:10px;border-radius:9999px;background:#fff;border:2px solid #34C759;box-shadow:0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);cursor:pointer;opacity:.85"></div>`,
    iconSize: [0, 0],
  });
}
