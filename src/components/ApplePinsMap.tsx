import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { initMapKit } from "@/lib/mapkit";
import { pinStyle } from "@/lib/pinStyle";
import MapSourceBadge from "@/components/MapSourceBadge";
import { Card } from "@/components/ui/card";
import PinDetailPanel, { PinRecord } from "@/components/PinDetailPanel";

interface Props {
  onUnavailable: (reason: string) => void;
}

interface PaddockLite {
  id: string;
  name: string | null;
}

const validCoord = (lat?: number | null, lng?: number | null) =>
  lat != null &&
  lng != null &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

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

export default function ApplePinsMap({ onUnavailable }: Props) {
  const { selectedVineyardId } = useVineyard();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const annsRef = useRef<any[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const didFitRef = useRef(false);

  const { data: pins = [], isLoading, error } = useQuery({
    queryKey: ["pins", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PinRecord>("pins", selectedVineyardId!),
    staleTime: 5 * 60_000,
  });

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
    staleTime: 5 * 60_000,
  });

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);

  const withCoords = useMemo(
    () => pins.filter((p) => validCoord(p.latitude, p.longitude)),
    [pins],
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
      const hex = pinStyle(pin.mode).hex;
      const ann = new mapkit.Annotation(
        new mapkit.Coordinate(pin.latitude!, pin.longitude!),
        () => makePinElement(hex),
        { title: pin.title ?? "" },
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

    if (!didFitRef.current && withCoords.length) {
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const p of withCoords) {
        minLat = Math.min(minLat, p.latitude!);
        maxLat = Math.max(maxLat, p.latitude!);
        minLng = Math.min(minLng, p.longitude!);
        maxLng = Math.max(maxLng, p.longitude!);
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
        didFitRef.current = true;
      } catch { /* noop */ }
    }
  }, [withCoords, mapReady]);

  const selected = pins.find((p) => p.id === selectedId) ?? null;

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view its pins.</div>;
  }

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
          {!isLoading && mapReady && pins.length > 0 && withCoords.length === 0 && (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              No pins have coordinates.
            </div>
          )}
          {!isLoading && pins.length === 0 && (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              No pins for this vineyard.
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        {selected ? (
          <PinDetailPanel
            pin={selected}
            paddockName={selected.paddock_id ? paddockNameById.get(selected.paddock_id) ?? null : null}
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
