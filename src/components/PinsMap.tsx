import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { pinStyle } from "@/lib/pinStyle";
import MapSourceBadge from "@/components/MapSourceBadge";
import { Card } from "@/components/ui/card";
import PinDetailPanel, { PinRecord } from "@/components/PinDetailPanel";

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

export default function PinsMap() {
  const { selectedVineyardId } = useVineyard();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: pins = [], isLoading, error } = useQuery({
    queryKey: ["pins", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PinRecord>("pins", selectedVineyardId!),
  });

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
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

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (!withCoords.length) return null;
    return L.latLngBounds(withCoords.map((p) => [p.latitude!, p.longitude!] as [number, number]));
  }, [withCoords]);

  const selected = pins.find((p) => p.id === selectedId) ?? null;

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
          {!isLoading && !error && pins.length === 0 && (
            <div className="h-full flex items-center justify-center text-muted-foreground text-center px-4">
              No pins for this vineyard.
            </div>
          )}
          {!isLoading && !error && pins.length > 0 && withCoords.length === 0 && (
            <div className="h-full flex items-center justify-center text-muted-foreground text-center px-4">
              No pins have coordinates.
            </div>
          )}
          {!isLoading && !error && withCoords.length > 0 && (
            <MapContainer
              center={[withCoords[0].latitude!, withCoords[0].longitude!]}
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
              {withCoords.map((p) => (
                <Marker
                  key={p.id}
                  position={[p.latitude!, p.longitude!]}
                  icon={pinIcon(pinStyle(p.mode).hex)}
                  eventHandlers={{ click: () => setSelectedId(p.id) }}
                />
              ))}
            </MapContainer>
          )}
          <MapSourceBadge source="fallback" />
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
