import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polygon, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";
import { pinStyle, pinDisplayCoords, applyPinStatusFilter, pinDisplayTitle } from "@/lib/pinStyle";
import MapSourceBadge from "@/components/MapSourceBadge";
import { Card } from "@/components/ui/card";
import PinDetailPanel, { PinRecord } from "@/components/PinDetailPanel";
import { parsePolygonPoints, LatLng } from "@/lib/paddockGeometry";
import { validCoord } from "@/lib/pinsDiagnostics";

interface Paddock {
  id: string;
  name: string | null;
  polygon_points: any;
  row_direction?: number | null;
}

const pinIcon = (hex: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${hex};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      try {
        const lb = L.latLngBounds(bounds as L.LatLngBoundsLiteral).pad(0.25);
        map.fitBounds(lb, { padding: [16, 16] });
      } catch { /* noop */ }
    }
  }, [bounds, map]);
  return null;
}

export default function PinsMap({ statusFilter = "active" }: { statusFilter?: "active" | "completed" | "all" } = {}) {
  const { selectedVineyardId } = useVineyard();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
  });

  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);

  const { data: pinsResult, isLoading, error } = useQuery({
    queryKey: ["pins", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPinsForVineyard(selectedVineyardId!, paddockIds),
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
        return c && validCoord(c.lat, c.lng) ? [{ ...p, latitude: c.lat, longitude: c.lng, _coordSource: c.source }] : [];
      }),
    [pins],
  );

  if (import.meta.env.DEV) {
    const renderedIds = new Set(withCoords.map((p) => p.id));
    // eslint-disable-next-line no-console
    console.table(
      pins.map((p: any) => {
        const c = pinDisplayCoords(p);
        return {
          id: p.id,
          title: pinDisplayTitle(p as any),
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

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (withCoords.length) {
      return L.latLngBounds(withCoords.map((p) => [p.latitude!, p.longitude!] as [number, number]));
    }
    if (paddockPolygons.length) {
      const all: [number, number][] = [];
      paddockPolygons.forEach((poly) => poly.forEach((pt) => all.push([pt.lat, pt.lng])));
      if (all.length) return L.latLngBounds(all);
    }
    return null;
  }, [withCoords, paddockPolygons]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[PinsMap] diagnostics", {
      selectedVineyardId,
      paddockCount: paddocks.length,
      paddockPolygonCount: paddockPolygons.length,
      pinsCount: pins.length,
      pinsWithCoords: withCoords.length,
      pinsSource: pinsResult?.source ?? "n/a",
      boundsSource: withCoords.length ? "pins" : paddockPolygons.length ? "paddocks" : "fallback",
    });
  }

  const selected = pins.find((p) => p.id === selectedId) ?? null;
  const hasMap = !!bounds;
  const initialCenter: [number, number] = withCoords[0]
    ? [withCoords[0].latitude!, withCoords[0].longitude!]
    : paddockPolygons[0]
      ? [paddockPolygons[0][0].lat, paddockPolygons[0][0].lng]
      : [0, 0];

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view its pins.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card className="overflow-hidden">
        <div className="relative h-[600px] w-full bg-muted">
          {isLoading && (
            <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
          )}
          {error && (
            <div className="h-full flex items-center justify-center text-destructive">
              {(error as Error).message}
            </div>
          )}
          {!isLoading && !error && !hasMap && (
            <div className="h-full flex items-center justify-center text-muted-foreground text-center px-4">
              {pins.length === 0
                ? "No pins recorded for this vineyard yet. No paddock geometry to display."
                : "No mapped pins or paddock geometry found."}
            </div>
          )}
          {!isLoading && !error && hasMap && (
            <>
              <MapContainer
                center={initialCenter}
                zoom={15}
                scrollWheelZoom
                className="h-full w-full"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  maxZoom={19}
                />
                <FitBounds bounds={bounds} />
                {paddockPolygons.map((poly, i) => (
                  <Polygon
                    key={`pad-${i}`}
                    positions={poly.map((p) => [p.lat, p.lng]) as [number, number][]}
                    pathOptions={{ color: "#34C759", weight: 1, opacity: 0.6, fillOpacity: 0.08 }}
                  />
                ))}
                {withCoords.map((p) => (
                  <Marker
                    key={p.id}
                    position={[p.latitude!, p.longitude!]}
                    icon={pinIcon(pinStyle(p.mode, (p as any).button_color, (p as any).category).hex)}
                    title={pinDisplayTitle(p as any)}
                    eventHandlers={{ click: () => setSelectedId(p.id) }}
                  />
                ))}
              </MapContainer>
              {pins.length > 0 && withCoords.length === 0 && (
                <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
                  Pins found, but none have map coordinates.
                </div>
              )}
              {pins.length === 0 && (
                <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/80 px-3 py-1 text-sm text-muted-foreground">
                  No pins recorded for this vineyard yet.
                </div>
              )}
            </>
          )}
          <MapSourceBadge source="fallback" />
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
