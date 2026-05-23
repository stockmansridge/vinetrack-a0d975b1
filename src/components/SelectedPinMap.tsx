import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ApplePinsMap from "@/components/ApplePinsMap";
import { initMapKit } from "@/lib/mapkit";
import MapSourceBadge from "@/components/MapSourceBadge";
import { pinDisplayCoords, pinStyle, pinDisplayTitle } from "@/lib/pinStyle";
import type { PinRecord } from "@/components/PinDetailPanel";

interface Props {
  pin: PinRecord;
}

const pinIcon = (hex: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${hex};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    try {
      map.setView([lat, lng], Math.max(map.getZoom(), 17));
    } catch { /* noop */ }
  }, [lat, lng, map]);
  return null;
}

type Provider = "checking" | "apple" | "osm";

export default function SelectedPinMap({ pin }: Props) {
  const coords = useMemo(() => pinDisplayCoords(pin as any), [pin]);
  const [provider, setProvider] = useState<Provider>("checking");

  useEffect(() => {
    let cancelled = false;
    setProvider("checking");
    initMapKit()
      .then(() => !cancelled && setProvider("apple"))
      .catch(() => !cancelled && setProvider("osm"));
    return () => { cancelled = true; };
  }, []);

  if (!coords) {
    return (
      <Card className="p-3 text-xs text-muted-foreground">
        This pin has no map coordinates.
      </Card>
    );
  }

  const style = pinStyle(pin.mode, (pin as any).button_color, (pin as any).category);
  const title = pinDisplayTitle(pin as any);

  return (
    <Card className="overflow-hidden">
      <div className="relative h-[220px] w-full bg-muted">
        {provider === "apple" ? (
          <SingleApplePinMap lat={coords.lat} lng={coords.lng} hex={style.hex} title={title} />
        ) : provider === "osm" ? (
          <MapContainer
            center={[coords.lat, coords.lng]}
            zoom={17}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={false}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[coords.lat, coords.lng]} icon={pinIcon(style.hex)} />
            <Recenter lat={coords.lat} lng={coords.lng} />
            <div className="absolute top-2 left-2 z-[400]">
              <MapSourceBadge source="osm" />
            </div>
          </MapContainer>
        ) : (
          <div className="h-full w-full animate-pulse" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
        </span>
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
        >
          <a
            href={`https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=18/${coords.lat}/${coords.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in map
          </a>
        </Button>
      </div>
    </Card>
  );
}

function SingleApplePinMap({
  lat,
  lng,
  hex,
  title,
}: {
  lat: number;
  lng: number;
  hex: string;
  title: string;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!el) return;
    const mapkit = (window as any).mapkit;
    if (!mapkit) return;
    let map: any;
    try {
      map = new mapkit.Map(el, {
        mapType: mapkit.Map.MapTypes.Hybrid,
        showsZoomControl: true,
        showsUserLocationControl: false,
      });
      const dot = document.createElement("div");
      dot.style.cssText = `width:18px;height:18px;border-radius:50%;background:${hex};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
      const ann = new mapkit.Annotation(new mapkit.Coordinate(lat, lng), () => dot, { title });
      map.addAnnotation(ann);
      map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate(lat, lng),
        new mapkit.CoordinateSpan(0.003, 0.003),
      );
    } catch { /* noop */ }
    return () => {
      try { map?.destroy?.(); } catch { /* noop */ }
    };
  }, [el, lat, lng, hex, title]);

  return (
    <>
      <div ref={setEl} className="h-full w-full" />
      <MapSourceBadge source="apple" />
    </>
  );
}
