import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import OpenExternalMapButton from "@/components/OpenExternalMapButton";

import { initMapKit } from "@/lib/mapkit";
import MapSourceBadge from "@/components/MapSourceBadge";
import { pinDisplayCoords, pinStyle, pinDisplayTitle } from "@/lib/pinStyle";
import type { PinRecord } from "@/components/PinDetailPanel";

interface Props {
  pin: PinRecord;
}

type Provider = "checking" | "apple" | "unavailable";

export default function SelectedPinMap({ pin }: Props) {
  const coords = useMemo(() => pinDisplayCoords(pin as any), [pin]);
  const [provider, setProvider] = useState<Provider>("checking");

  useEffect(() => {
    let cancelled = false;
    setProvider("checking");
    initMapKit()
      .then(() => !cancelled && setProvider("apple"))
      .catch(() => !cancelled && setProvider("unavailable"));
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
  const openInAppleMapsUrl = `https://maps.apple.com/?ll=${coords.lat},${coords.lng}&q=${encodeURIComponent(title)}`;
  const openInGoogleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;

  return (
    <Card className="overflow-hidden">
      <div className="relative h-[220px] w-full bg-muted">
        {provider === "apple" ? (
          <SingleApplePinMap lat={coords.lat} lng={coords.lng} hex={style.hex} title={title} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <div className="text-sm font-medium text-foreground">Apple Maps preview unavailable</div>
            <div className="text-xs text-muted-foreground">
              The pin can still be opened directly in Apple Maps.
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <OpenExternalMapButton
            url={openInAppleMapsUrl}
            aria-label={`Open ${title} in Apple Maps`}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
          >
            Open in Apple Maps
          </OpenExternalMapButton>
          <OpenExternalMapButton
            url={openInGoogleMapsUrl}
            aria-label={`Open ${title} in Google Maps`}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
          >
            Google Maps
          </OpenExternalMapButton>
        </div>
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
