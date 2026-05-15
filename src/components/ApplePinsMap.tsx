import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";
import { initMapKit } from "@/lib/mapkit";
import { pinStyle, pinDisplayCoords, applyPinStatusFilter, pinDisplayTitle } from "@/lib/pinStyle";
import MapSourceBadge from "@/components/MapSourceBadge";
import { Card } from "@/components/ui/card";
import PinDetailPanel, { PinRecord } from "@/components/PinDetailPanel";
import { parsePolygonPoints, LatLng } from "@/lib/paddockGeometry";
import { validCoord } from "@/lib/pinsDiagnostics";
import { useDiagnosticPanel } from "@/lib/systemAdmin";

interface Props {
  onUnavailable: (reason: string) => void;
  statusFilter?: "active" | "completed" | "all";
}

interface Paddock {
  id: string;
  name: string | null;
  polygon_points: any;
  row_direction?: number | null;
}

function makePinElement(hex: string) {
  const el = document.createElement("div");
  el.style.cssText = `
    width:18px;height:18px;border-radius:50%;
    background:${hex};border:2px solid white;
    box-shadow:0 1px 4px rgba(0,0,0,0.4);
    cursor:pointer;
  `;
  return el;
}

export default function ApplePinsMap({ onUnavailable, statusFilter = "active" }: Props) {
  const { selectedVineyardId } = useVineyard();
  const showMapPinDiagnostics = useDiagnosticPanel("show_map_pin_diagnostics");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const annsRef = useRef<any[]>([]);
  const overlaysRef = useRef<any[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const lastFitKeyRef = useRef<string | null>(null);

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
    staleTime: 5 * 60_000,
  });

  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);

  const { data: pinsResult, isLoading, error } = useQuery({
    queryKey: ["pins", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPinsForVineyard(selectedVineyardId!, paddockIds),
    staleTime: 5 * 60_000,
  });
  const allPins = pinsResult?.pins ?? [];
  const pins = useMemo(() => applyPinStatusFilter(allPins, statusFilter), [allPins, statusFilter]);

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);

  const paddockRowDirById = useMemo(() => {
    const m = new Map<string, number | null>();
    paddocks.forEach((p) => {
      const v = p.row_direction;
      m.set(p.id, v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    });
    return m;
  }, [paddocks]);

  const paddockPolygons = useMemo(
    () =>
      paddocks
        .map((p) => parsePolygonPoints(p.polygon_points))
        .filter((pts): pts is LatLng[] => pts.length >= 3),
    [paddocks],
  );

  const withCoords = useMemo(
    () =>
      pins.flatMap((p) => {
        const c = pinDisplayCoords(p as any);
        return c ? [{ ...p, latitude: c.lat, longitude: c.lng, _coordSource: c.source }] : [];
      }),
    [pins],
  );

  if (import.meta.env.DEV && showMapPinDiagnostics) {
    const renderedIds = new Set(withCoords.map((p) => p.id));
    // eslint-disable-next-line no-console
    console.table(
      pins.map((p: any) => {
        const c = pinDisplayCoords(p);
        return {
          id: p.id,
          title: pinDisplayTitle(p),
          latitude: p.latitude,
          longitude: p.longitude,
          snapped_latitude: p.snapped_latitude,
          snapped_longitude: p.snapped_longitude,
          markerLat: c?.lat ?? null,
          markerLng: c?.lng ?? null,
          coordSource: c?.source ?? null,
          rendered: renderedIds.has(p.id),
          skipReason: c ? "" : "no valid coords (snapped+raw both invalid/out-of-range)",
        };
      }),
    );
  }

  useEffect(() => {
    let cancelled = false;
    initMapKit()
      .then((mapkit) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new mapkit.Map(containerRef.current, {
          mapType: mapkit.Map.MapTypes.Hybrid,
          showsZoomControl: true,
          showsUserLocationControl: false,
        });
        setMapReady(true);
      })
      .catch((e) => !cancelled && onUnavailable(e?.message || "MapKit init failed"));
    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch { /* noop */ }
      mapRef.current = null;
      setMapReady(false);
    };
  }, [onUnavailable]);

  // Render paddock outlines (faint).
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;

    if (overlaysRef.current.length) {
      try { map.removeOverlays(overlaysRef.current); } catch { /* noop */ }
      overlaysRef.current = [];
    }
    const newOverlays: any[] = [];
    for (const poly of paddockPolygons) {
      try {
        const coords = poly.map((p) => new mapkit.Coordinate(p.lat, p.lng));
        const style = new mapkit.Style({
          strokeColor: "#34C759",
          strokeOpacity: 0.7,
          lineWidth: 1,
          fillColor: "#34C759",
          fillOpacity: 0.08,
        });
        const overlay = new mapkit.PolygonOverlay(coords, { style });
        newOverlays.push(overlay);
      } catch { /* noop */ }
    }
    if (newOverlays.length) {
      try { map.addOverlays(newOverlays); } catch { /* noop */ }
      overlaysRef.current = newOverlays;
    }
  }, [paddockPolygons, mapReady]);

  // Render pin annotations + fit bounds.
  useEffect(() => {
    const map = mapRef.current;
    const mapkit = (window as any).mapkit;
    if (!mapReady || !map || !mapkit) return;

    if (annsRef.current.length) {
      try { map.removeAnnotations(annsRef.current); } catch { /* noop */ }
      annsRef.current = [];
    }

    const newAnns: any[] = [];
    for (const pin of withCoords) {
      const hex = pinStyle(pin.mode, (pin as any).button_color, (pin as any).category).hex;
      const ann = new mapkit.Annotation(
        new mapkit.Coordinate(pin.latitude!, pin.longitude!),
        () => makePinElement(hex),
        { title: pinDisplayTitle(pin as any) },
      );
      try {
        ann.addEventListener?.("select", () => setSelectedId(pin.id));
      } catch { /* noop */ }
      newAnns.push(ann);
    }
    if (newAnns.length) {
      map.addAnnotations(newAnns);
      annsRef.current = newAnns;
    }

    // Re-fit when vineyard or geometry changes.
    const fitKey = `${selectedVineyardId}|p:${withCoords.length}|g:${paddockPolygons.length}`;
    if (lastFitKeyRef.current !== fitKey) {
      const pts: { lat: number; lng: number }[] = [];
      let boundsSource: "pins" | "paddocks" | "fallback" = "fallback";
      if (withCoords.length) {
        withCoords.forEach((p) => pts.push({ lat: p.latitude!, lng: p.longitude! }));
        boundsSource = "pins";
      } else if (paddockPolygons.length) {
        paddockPolygons.forEach((poly) => poly.forEach((pt) => pts.push(pt)));
        boundsSource = "paddocks";
      }
      if (import.meta.env.DEV && showMapPinDiagnostics) {
        // eslint-disable-next-line no-console
        console.debug("[ApplePinsMap] fit", {
          selectedVineyardId,
          paddockCount: paddockPolygons.length,
          pinsCount: pins.length,
          pinsWithCoords: withCoords.length,
          boundsSource,
        });
      }
      if (pts.length) {
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const p of pts) {
          minLat = Math.min(minLat, p.lat);
          maxLat = Math.max(maxLat, p.lat);
          minLng = Math.min(minLng, p.lng);
          maxLng = Math.max(maxLng, p.lng);
        }
        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;
        const latDelta = Math.max((maxLat - minLat) * 1.5, 0.005);
        const lngDelta = Math.max((maxLng - minLng) * 1.5, 0.005);
        try {
          map.region = new mapkit.CoordinateRegion(
            new mapkit.Coordinate(centerLat, centerLng),
            new mapkit.CoordinateSpan(latDelta, lngDelta),
          );
          lastFitKeyRef.current = fitKey;
        } catch { /* noop */ }
      }
    }
  }, [withCoords, paddockPolygons, mapReady, selectedVineyardId, pins.length]);

  const selected = pins.find((p) => p.id === selectedId) ?? null;

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view its pins.</div>;
  }

  const noGeometry = withCoords.length === 0 && paddockPolygons.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card className="overflow-hidden">
        <div className="relative h-[600px] w-full bg-muted">
          <div ref={containerRef} className="h-full w-full" />
          <MapSourceBadge source="apple" />
          {(isLoading || !mapReady) && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/60">
              {!mapReady ? "Loading Apple Maps…" : "Loading pins…"}
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-destructive bg-background/60">
              {(error as Error).message}
            </div>
          )}
          {!isLoading && mapReady && noGeometry && pins.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/60 text-center px-4">
              No pins recorded for this vineyard yet.
            </div>
          )}
          {!isLoading && mapReady && noGeometry && pins.length > 0 && (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              Pins found, but none have map coordinates.
            </div>
          )}
          {!isLoading && mapReady && pins.length > 0 && withCoords.length === 0 && paddockPolygons.length > 0 && (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              Pins found, but none have map coordinates.
            </div>
          )}
          {!isLoading && mapReady && pins.length === 0 && paddockPolygons.length > 0 && (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              No pins recorded for this vineyard yet.
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        {selected ? (
          <PinDetailPanel
            pin={selected}
            paddockName={selected.paddock_id ? paddockNameById.get(selected.paddock_id) ?? null : null}
            paddockRowDirection={selected.paddock_id ? paddockRowDirById.get(selected.paddock_id) ?? null : null}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <Card className="p-4 text-sm text-muted-foreground">
            Click a pin to see details. {withCoords.length} pin{withCoords.length === 1 ? "" : "s"} on map.
          </Card>
        )}
      </div>
    </div>
  );
}
