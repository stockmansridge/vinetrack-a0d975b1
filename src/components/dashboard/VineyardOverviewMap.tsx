// Interactive vineyard overview map for /dashboard.
// Apple MapKit hybrid base. Overlays:
//   - Paddock polygons (clickable)
//   - Recent trip routes (last N days, clickable)
//   - Pins (colour-mapped from iOS, clickable)
// Detail panel renders to the right on large screens, below on small.
// READ-ONLY — no writes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Crosshair, ExternalLink, Layers, X } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";
import { extractPathPoints } from "@/lib/tripReport";
import {
  deriveMetrics,
  parsePolygonPoints,
  polygonCentroid,
  type LatLng,
} from "@/lib/paddockGeometry";
import { paddockColor } from "@/lib/paddockColor";
import { pinStyle, formatRowNumber, formatAttachedRow, formatDrivingPath, pinDisplayCoords } from "@/lib/pinStyle";
import { initMapKit } from "@/lib/mapkit";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { usePinPhoto } from "@/hooks/usePinPhoto";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PaddockDetailContent } from "@/components/PaddockDetailPanel";
import type { PinRecord } from "@/components/PinDetailPanel";

// ---------- Trip function helpers ----------

const TRIP_FUNCTION_LABELS: Record<string, string> = {
  spray: "Spray",
  mowing: "Mowing",
  slashing: "Slashing",
  harrowing: "Harrowing",
  seeding: "Seeding",
  spreading: "Spreading",
  fertiliser: "Fertiliser",
  pruning: "Pruning",
  shootThinning: "Shoot thinning",
  canopyWork: "Canopy work",
  irrigationCheck: "Irrigation check",
  repairs: "Repairs",
  other: "Other",
};
const TRIP_FUNCTION_COLORS: Record<string, string> = {
  spray: "#AF52DE",
  mowing: "#34C759",
  slashing: "#30B0C7",
  harrowing: "#A2845E",
  seeding: "#FF9500",
  spreading: "#FFCC00",
  fertiliser: "#FFD60A",
  pruning: "#5AC8FA",
  shootThinning: "#5AC8FA",
  canopyWork: "#32ADE6",
  irrigationCheck: "#0A84FF",
  repairs: "#FF3B30",
  other: "#1E5AC8",
};
const tripFnLabel = (v?: string | null) =>
  v ? TRIP_FUNCTION_LABELS[v] ?? v : "Trip";
const tripColor = (v?: string | null) =>
  (v && TRIP_FUNCTION_COLORS[v]) || "#1E5AC8";
const tripDisplay = (t: Trip) =>
  t.trip_title?.trim() || tripFnLabel(t.trip_function);

// Distinct, stable color per-trip for the overview map.
// Avoids paddock greens and common pin reds/yellows by sweeping HSL hues
// while skipping a green band.
function buildTripPalette(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const n = Math.max(ids.length, 1);
  const hues: number[] = [];
  // Generate evenly spaced hues, skipping 90-160 (green band shared with paddocks).
  const step = 360 / Math.max(n + 2, 6);
  let h = 200;
  while (hues.length < n) {
    const hh = ((h % 360) + 360) % 360;
    if (!(hh >= 90 && hh <= 160)) hues.push(hh);
    h += step;
  }
  ids.forEach((id, i) => {
    const hue = hues[i % hues.length];
    // High saturation, mid-light for visibility on satellite imagery.
    out.set(id, `hsl(${hue.toFixed(0)} 85% 55%)`);
  });
  return out;
}

const fmtShortDate = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const fmtDateTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};
const fmtDuration = (start?: string | null, end?: string | null) => {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (isNaN(s) || isNaN(e) || e < s) return "—";
  const mins = Math.floor((e - s) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtDistance = (m?: number | null) =>
  Number.isFinite(Number(m)) ? `${(Number(m) / 1000).toFixed(2)} km` : "—";

// ---------- Selection model ----------

type Selection =
  | { kind: "paddock"; id: string }
  | { kind: "trip"; id: string }
  | { kind: "pin"; id: string }
  | null;

interface Props {
  daysDefault?: number;
  height?: number;
}

export default function VineyardOverviewMap({
  daysDefault = 14,
  height = 520,
}: Props) {
  const { selectedVineyardId } = useVineyard();
  const [selection, setSelection] = useState<Selection>(null);
  const [showPaddocks, setShowPaddocks] = useState(true);
  const [showTrips, setShowTrips] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [days, setDays] = useState<number>(daysDefault);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const annotationsRef = useRef<any[]>([]);
  const didFitRef = useRef(false);

  // ---------- Data ----------

  const paddocksQ = useQuery({
    queryKey: ["overview-map-paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<any>("paddocks", selectedVineyardId!),
    staleTime: 5 * 60_000,
  });
  const paddocks = paddocksQ.data ?? [];
  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);

  const tripsQ = useQuery({
    queryKey: ["overview-map-trips", selectedVineyardId, paddockIds.join("|")],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, paddockIds),
    staleTime: 60_000,
  });
  const trips = tripsQ.data?.trips ?? [];

  const pinsQ = useQuery({
    queryKey: ["overview-map-pins", selectedVineyardId, paddockIds.join("|")],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPinsForVineyard(selectedVineyardId!, paddockIds),
    staleTime: 60_000,
  });
  const pins = pinsQ.data?.pins ?? [];

  // Recent trips: filter by start_time within `days`.
  const recentTrips = useMemo(() => {
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    return trips
      .filter((t) => {
        const s = t.start_time ? new Date(t.start_time).getTime() : NaN;
        return Number.isFinite(s) && s >= cutoff;
      })
      .slice(0, 100); // safety cap
  }, [trips, days]);

  // Pre-parse paddock geometry once.
  const parsedPaddocks = useMemo(() => {
    return paddocks.map((p: any) => {
      const polygon = parsePolygonPoints(p.polygon_points);
      return {
        paddock: p,
        polygon,
        centroid: polygonCentroid(polygon),
        color: paddockColor(p.id),
        metrics: deriveMetrics(p),
      };
    });
  }, [paddocks]);

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string>();
    paddocks.forEach((p: any) => m.set(p.id, p.name ?? "Unnamed"));
    return m;
  }, [paddocks]);

  const pinsWithCoords = useMemo(
    () =>
      pins
        .map((p) => ({ pin: p, coords: pinDisplayCoords(p as any) }))
        .filter((x): x is { pin: typeof pins[number]; coords: { lat: number; lng: number } } => !!x.coords),
    [pins],
  );

  // Pre-parse trip paths once per recentTrips; sort newest first.
  const parsedTrips = useMemo(() => {
    const validPt = (pt: LatLng) =>
      Number.isFinite(pt.lat) && Number.isFinite(pt.lng) &&
      pt.lat >= -90 && pt.lat <= 90 && pt.lng >= -180 && pt.lng <= 180;
    const arr = recentTrips.map((t) => {
      const pts = extractPathPoints(t.path_points).filter(validPt);
      return { trip: t, points: pts };
    });
    arr.sort((a, b) => {
      const ta = a.trip.start_time ? new Date(a.trip.start_time).getTime() : 0;
      const tb = b.trip.start_time ? new Date(b.trip.start_time).getTime() : 0;
      return tb - ta;
    });
    return arr;
  }, [recentTrips]);

  // Stable per-trip color palette for current view.
  const tripPalette = useMemo(
    () => buildTripPalette(parsedTrips.map((t) => t.trip.id)),
    [parsedTrips],
  );

  // Helpers for fitting the camera.
  const fitToBounds = useCallback((pts: LatLng[]) => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!map || !mapkit || !pts.length) return false;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const pt of pts) {
      if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) continue;
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lng < minLng) minLng = pt.lng;
      if (pt.lng > maxLng) maxLng = pt.lng;
    }
    if (!Number.isFinite(minLat)) return false;
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = Math.max((maxLat - minLat) * 1.4, 0.002);
    const lngDelta = Math.max((maxLng - minLng) * 1.4, 0.002);
    try {
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate(centerLat, centerLng),
        new mapkit.CoordinateSpan(latDelta, lngDelta),
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  // Compute the vineyard "home" extent: paddocks → trips/pins.
  const vineyardExtent = useMemo<LatLng[]>(() => {
    const validPt = (pt: LatLng) =>
      Number.isFinite(pt.lat) && Number.isFinite(pt.lng);
    const polyPts: LatLng[] = [];
    for (const p of parsedPaddocks) {
      for (const pt of p.polygon) if (validPt(pt)) polyPts.push(pt);
    }
    if (polyPts.length) return polyPts;
    const fallback: LatLng[] = [];
    for (const t of parsedTrips) for (const pt of t.points) fallback.push(pt);
    for (const pin of pinsWithCoords) {
      fallback.push({ lat: Number(pin.latitude), lng: Number(pin.longitude) });
    }
    return fallback;
  }, [parsedPaddocks, parsedTrips, pinsWithCoords]);

  const recenterVineyard = useCallback(() => {
    fitToBounds(vineyardExtent);
  }, [fitToBounds, vineyardExtent]);

  // ---------- Init MapKit ----------

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
      .catch((e) => !cancelled && setMapError(e?.message || "Apple Maps unavailable"));
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // ---------- Render overlays ----------

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

    const validPt = (pt: LatLng) =>
      Number.isFinite(pt.lat) && Number.isFinite(pt.lng) &&
      pt.lat >= -90 && pt.lat <= 90 && pt.lng >= -180 && pt.lng <= 180;

    const newOverlays: any[] = [];
    const newAnnotations: any[] = [];
    const allPts: LatLng[] = [];

    // Paddock polygons
    if (showPaddocks) {
      for (const p of parsedPaddocks) {
        const valid = p.polygon.filter(validPt);
        if (valid.length < 3) continue;
        allPts.push(...valid);
        const isSelected =
          selection?.kind === "paddock" && selection.id === p.paddock.id;
        const coords = valid.map((pt) => new mapkit.Coordinate(pt.lat, pt.lng));
        const poly = new mapkit.PolygonOverlay(coords, {
          style: new mapkit.Style({
            strokeColor: p.color,
            fillColor: p.color,
            fillOpacity: isSelected ? 0.4 : 0.2,
            strokeOpacity: isSelected ? 1.0 : 0.85,
            lineWidth: isSelected ? 3 : 2,
            lineJoin: "round",
          }),
        });
        const id = p.paddock.id;
        poly.addEventListener("select", () => setSelection({ kind: "paddock", id }));
        newOverlays.push(poly);

        if (p.centroid && validPt(p.centroid) && p.paddock.name) {
          const name = p.paddock.name;
          const ann = new mapkit.Annotation(
            new mapkit.Coordinate(p.centroid.lat, p.centroid.lng),
            () => {
              const el = document.createElement("div");
              el.className = "vt-name-chip";
              el.style.cssText =
                "background:rgba(0,0,0,0.55);color:white;font-size:11px;padding:2px 6px;border-radius:4px;cursor:pointer;white-space:nowrap;";
              el.textContent = name;
              el.addEventListener("click", (ev) => {
                ev.stopPropagation();
                setSelection({ kind: "paddock", id });
              });
              return el;
            },
          );
          newAnnotations.push(ann);
        }
      }
    }

    // Trip polylines — per-trip color, dim non-selected when one is selected.
    if (showTrips) {
      const hasSelectedTrip = selection?.kind === "trip";
      for (const { trip: t, points: pts } of parsedTrips) {
        if (pts.length < 2) continue;
        allPts.push(...pts);
        const isSelected = hasSelectedTrip && selection!.id === t.id;
        const dim = hasSelectedTrip && !isSelected;
        const color = tripPalette.get(t.id) ?? "#1E5AC8";
        const coords = pts.map((p) => new mapkit.Coordinate(p.lat, p.lng));
        const line = new mapkit.PolylineOverlay(coords, {
          style: new mapkit.Style({
            strokeColor: color,
            strokeOpacity: isSelected ? 1.0 : dim ? 0.25 : 0.85,
            lineWidth: isSelected ? 6 : dim ? 2 : 3,
            lineCap: "round",
            lineJoin: "round",
          }),
        });
        const id = t.id;
        line.addEventListener("select", () => setSelection({ kind: "trip", id }));
        newOverlays.push(line);
      }
    }

    // Pin annotations
    if (showPins) {
      for (const pin of pinsWithCoords) {
        const lat = Number(pin.latitude);
        const lng = Number(pin.longitude);
        if (!validPt({ lat, lng })) continue;
        allPts.push({ lat, lng });
        const style = pinStyle(pin.mode, pin.button_color, pin.category);
        const isSelected =
          selection?.kind === "pin" && selection.id === pin.id;
        const id = pin.id;
        const ann = new mapkit.Annotation(
          new mapkit.Coordinate(lat, lng),
          () => {
            const el = document.createElement("div");
            const size = isSelected ? 16 : 12;
            el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${style.hex};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);cursor:pointer;`;
            el.title = pin.title ?? style.label;
            el.addEventListener("click", (ev) => {
              ev.stopPropagation();
              setSelection({ kind: "pin", id });
            });
            return el;
          },
          { anchorOffset: new DOMPoint(0, 0) },
        );
        try {
          ann.addEventListener?.("select", () => setSelection({ kind: "pin", id }));
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

    // Initial fit: prefer the vineyard extent (paddocks → trips/pins).
    if (!didFitRef.current) {
      const extent = vineyardExtent.length ? vineyardExtent : allPts;
      if (extent.length && fitToBounds(extent)) {
        didFitRef.current = true;
      }
    }
  }, [
    mapReady,
    parsedPaddocks,
    parsedTrips,
    tripPalette,
    pinsWithCoords,
    showPaddocks,
    showTrips,
    showPins,
    selection,
    vineyardExtent,
    fitToBounds,
  ]);

  // Reset fit when vineyard switches.
  useEffect(() => {
    didFitRef.current = false;
    setSelection(null);
  }, [selectedVineyardId]);

  // When a trip becomes selected, zoom to its route.
  useEffect(() => {
    if (selection?.kind !== "trip") return;
    const entry = parsedTrips.find((t) => t.trip.id === selection.id);
    if (entry && entry.points.length >= 2) {
      fitToBounds(entry.points);
    }
  }, [selection, parsedTrips, fitToBounds]);

  // ---------- Selected entities ----------

  const selectedPaddock = useMemo(
    () =>
      selection?.kind === "paddock"
        ? parsedPaddocks.find((p) => p.paddock.id === selection.id) ?? null
        : null,
    [selection, parsedPaddocks],
  );
  const selectedTrip = useMemo(
    () =>
      selection?.kind === "trip"
        ? trips.find((t) => t.id === selection.id) ?? null
        : null,
    [selection, trips],
  );
  const selectedPin = useMemo(
    () =>
      selection?.kind === "pin"
        ? pins.find((p) => p.id === selection.id) ?? null
        : null,
    [selection, pins],
  );

  // ---------- Render ----------

  if (!selectedVineyardId) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Vineyard map</CardTitle>
          <p className="text-xs text-muted-foreground">
            Blocks, recent trips and pins. Click anything for details.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <Toggle label="Blocks" checked={showPaddocks} onChange={setShowPaddocks} />
            <Toggle label="Trips" checked={showTrips} onChange={setShowTrips} />
            <Toggle label="Pins" checked={showPins} onChange={setShowPins} />
          </div>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Trips: 3 days</SelectItem>
              <SelectItem value="7">Trips: 7 days</SelectItem>
              <SelectItem value="14">Trips: 14 days</SelectItem>
              <SelectItem value="30">Trips: 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid lg:grid-cols-[1fr_360px]">
          <div className="relative bg-muted" style={{ height }}>
            <div ref={containerRef} className="absolute inset-0" />
            {mapReady && (
              <Button
                size="sm"
                variant="secondary"
                className="absolute left-3 top-3 h-8 gap-1.5 shadow-md"
                onClick={recenterVineyard}
                disabled={!vineyardExtent.length}
                title="Re-centre on vineyard extent"
              >
                <Crosshair className="h-3.5 w-3.5" />
                Re-centre
              </Button>
            )}
            {!mapReady && !mapError && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/60">
                Loading satellite map…
              </div>
            )}
            {mapError && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive bg-background/80 px-4 text-center">
                Map unavailable — {mapError}
              </div>
            )}
            {mapReady && parsedPaddocks.length === 0 && !paddocksQ.isLoading && (
              <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/90 px-3 py-1 text-xs text-muted-foreground">
                No block map data available
              </div>
            )}
          </div>
          <div
            className="border-t lg:border-l lg:border-t-0 overflow-y-auto"
            style={{ maxHeight: height }}
          >
            {selection == null ? (
              <EmptyPanel
                paddockCount={parsedPaddocks.length}
                tripCount={parsedTrips.length}
                pinCount={pinsWithCoords.length}
                showPins={showPins}
                showTrips={showTrips}
              />
            ) : selectedPaddock ? (
              <PanelShell
                title={selectedPaddock.paddock.name ?? "Unnamed block"}
                subtitle="Block details"
                onClose={() => setSelection(null)}
                accentColor={selectedPaddock.color}
              >
                <PaddockDetailContent
                  paddock={selectedPaddock.paddock}
                  metrics={selectedPaddock.metrics}
                  parsedRowsCount={0}
                  rawRowsCount={
                    Array.isArray(selectedPaddock.paddock.rows)
                      ? selectedPaddock.paddock.rows.length
                      : 0
                  }
                  polygonPointCount={selectedPaddock.polygon.length}
                />
              </PanelShell>
            ) : selectedTrip ? (
              <PanelShell
                title={tripDisplay(selectedTrip)}
                subtitle="Trip details"
                onClose={() => setSelection(null)}
                accentColor={tripPalette.get(selectedTrip.id)}
              >
                <TripPanelBody
                  trip={selectedTrip}
                  paddockName={
                    selectedTrip.paddock_id
                      ? paddockNameById.get(selectedTrip.paddock_id) ?? selectedTrip.paddock_name ?? null
                      : selectedTrip.paddock_name ?? null
                  }
                  swatchColor={tripPalette.get(selectedTrip.id)}
                />
              </PanelShell>
            ) : selectedPin ? (
              <PanelShell
                title={selectedPin.title || pinStyle(selectedPin.mode, selectedPin.button_color, selectedPin.category).label}
                subtitle="Pin details"
                onClose={() => setSelection(null)}
              >
                <PinPanelBody
                  pin={selectedPin}
                  paddockName={
                    selectedPin.paddock_id
                      ? paddockNameById.get(selectedPin.paddock_id) ?? null
                      : null
                  }
                />
              </PanelShell>
            ) : (
              <EmptyPanel
                paddockCount={parsedPaddocks.length}
                tripCount={parsedTrips.length}
                pinCount={pinsWithCoords.length}
                showPins={showPins}
                showTrips={showTrips}
              />
            )}

            {showTrips && (
              <RecentTripsList
                days={days}
                entries={parsedTrips}
                palette={tripPalette}
                paddockNameById={paddockNameById}
                selectedTripId={selection?.kind === "trip" ? selection.id : null}
                onSelect={(id) => setSelection({ kind: "trip", id })}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Sub-components ----------

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Label className="flex items-center gap-1.5 cursor-pointer text-xs font-normal">
      <Switch checked={checked} onCheckedChange={onChange} className="h-4 w-7" />
      {label}
    </Label>
  );
}

function PanelShell({
  title,
  subtitle,
  onClose,
  children,
  accentColor,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  accentColor?: string;
}) {
  return (
    <div
      className="p-4 transition-colors"
      style={
        accentColor
          ? {
              borderLeft: `4px solid ${accentColor}`,
              boxShadow: `inset 0 0 0 1px ${accentColor}33`,
              background: `linear-gradient(to right, ${accentColor}14, transparent 40%)`,
            }
          : undefined
      }
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {accentColor && (
            <span
              aria-hidden
              className="mt-1.5 inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/10"
              style={{ background: accentColor }}
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{title}</div>
            {subtitle && (
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function EmptyPanel({
  paddockCount,
  tripCount,
  pinCount,
  showPins,
  showTrips,
}: {
  paddockCount: number;
  tripCount: number;
  pinCount: number;
  showPins: boolean;
  showTrips: boolean;
}) {
  return (
    <div className="space-y-3 p-4 text-sm">
      <div className="text-muted-foreground">
        Click a block, trip route or pin on the map for details.
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Blocks" value={paddockCount} />
        <Stat label="Recent trips" value={tripCount} muted={!showTrips} />
        <Stat label="Pins" value={pinCount} muted={!showPins} />
      </div>
      {showTrips && tripCount === 0 && (
        <div className="text-xs text-muted-foreground">No recent trips to display.</div>
      )}
      {showPins && pinCount === 0 && (
        <div className="text-xs text-muted-foreground">No pins to display.</div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-muted/30 p-2 ${muted ? "opacity-50" : ""}`}
    >
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-words">{value}</span>
    </div>
  );
}

function TripPanelBody({
  trip,
  paddockName,
  swatchColor,
}: {
  trip: Trip;
  paddockName: string | null;
  swatchColor?: string;
}) {
  const completed = Array.isArray(trip.completed_paths) ? trip.completed_paths.length : 0;
  const planned = Array.isArray(trip.row_sequence) ? trip.row_sequence.length : 0;
  return (
    <div className="space-y-2">
      {swatchColor && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="inline-block h-2.5 w-6 rounded-full"
            style={{ background: swatchColor }}
            aria-hidden
          />
          Route colour on map
        </div>
      )}
      <Row label="Type" value={tripFnLabel(trip.trip_function)} />
      <Row label="Block" value={paddockName ?? trip.paddock_name ?? "—"} />
      <Row label="Operator" value={trip.person_name ?? "—"} />
      <Row label="Started" value={fmtDateTime(trip.start_time)} />
      <Row label="Finished" value={trip.end_time ? fmtDateTime(trip.end_time) : "In progress"} />
      <Row label="Duration" value={fmtDuration(trip.start_time, trip.end_time)} />
      <Row label="Distance" value={fmtDistance(trip.total_distance ?? null)} />
      {planned > 0 && (
        <Row label="Rows" value={`${completed} / ${planned}`} />
      )}
      <div className="pt-3">
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link to={`/trips`}>
            Open in Trips <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function PinPanelBody({
  pin,
  paddockName,
}: {
  pin: PinRecord;
  paddockName: string | null;
}) {
  const style = pinStyle(pin.mode, pin.button_color, pin.category);
  const photoPath = pin.photo_path ?? pin.attachment_path ?? null;
  const directPhotoUrl = pin.photo_url ?? pin.image_url ?? pin.attachment_url ?? null;
  const signed = usePinPhoto(photoPath ?? undefined);
  const photoUrl = directPhotoUrl ?? signed;

  const { resolve } = useTeamLookup(pin.vineyard_id);
  const resolveName = (raw?: string | null) => {
    const v = (raw ?? "").trim();
    if (!v) return null;
    if (UUID_RE.test(v)) return resolve(v) ?? "Unknown member";
    return v;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 rounded-full border border-white shadow"
          style={{ background: style.hex }}
        />
        <Badge variant="outline" className="text-xs">{style.label}</Badge>
        {pin.is_completed ? (
          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
            Completed
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">Open</Badge>
        )}
      </div>
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className="w-full rounded-md border object-cover"
          style={{ maxHeight: 180 }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <Row label="Type" value={pin.mode ?? pin.category ?? "—"} />
      <Row label="Status" value={pin.status ?? (pin.is_completed ? "Completed" : "Open")} />
      <Row label="Block" value={paddockName ?? "—"} />
      <Row label="Row" value={formatRowNumber(pin.row_number)} />
      <Row label="Created by" value={resolveName(pin.created_by) ?? "—"} />
      <Row label="Created" value={fmtDateTime(pin.created_at)} />
      {pin.is_completed && (
        <>
          <Row label="Completed by" value={resolveName(pin.completed_by) ?? "—"} />
          <Row label="Completed" value={fmtDateTime(pin.completed_at)} />
        </>
      )}
      {pin.notes && (
        <div className="pt-1">
          <div className="text-xs text-muted-foreground mb-0.5">Notes</div>
          <div className="rounded-md border bg-muted/30 p-2 text-sm whitespace-pre-wrap">
            {pin.notes}
          </div>
        </div>
      )}
      <div className="pt-3">
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link to={`/pins`}>
            Open in Pins <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------- Recent trips list ----------

function RecentTripsList({
  days,
  entries,
  palette,
  paddockNameById,
  selectedTripId,
  onSelect,
}: {
  days: number;
  entries: { trip: Trip; points: LatLng[] }[];
  palette: Map<string, string>;
  paddockNameById: Map<string, string>;
  selectedTripId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="border-t p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent trips — last {days} days
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {entries.length}
        </Badge>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
          No trips in this period
        </div>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(({ trip, points }) => {
            const isSelected = trip.id === selectedTripId;
            const color = palette.get(trip.id) ?? "#1E5AC8";
            const block =
              (trip.paddock_id && paddockNameById.get(trip.paddock_id)) ||
              trip.paddock_name ||
              null;
            const operator = trip.person_name?.trim() || null;
            const date = fmtShortDate(trip.start_time);
            const hasRoute = points.length >= 2;
            return (
              <li key={trip.id}>
                <button
                  type="button"
                  onClick={() => onSelect(trip.id)}
                  className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  <span
                    className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      {tripDisplay(trip)}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {[
                        tripFnLabel(trip.trip_function),
                        block,
                        operator,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      {date && <span>{date}</span>}
                      {!hasRoute && (
                        <span className="rounded bg-muted px-1 py-0.5">
                          No route recorded
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
