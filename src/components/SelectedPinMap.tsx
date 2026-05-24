import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import OpenExternalMapButton, { copyTextToClipboard, type ExternalMapOpenResult } from "@/components/OpenExternalMapButton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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
  const [externalMapResult, setExternalMapResult] = useState<ExternalMapOpenResult | null>(null);

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
  const openInAppleMapsUrl = `https://maps.apple.com/?ll=${coords.lat},${coords.lng}&q=${encodeURIComponent(title)}&z=20&t=h`;
  const openInGoogleMapsUrl = `https://www.google.com/maps/@${coords.lat},${coords.lng},21z/data=!3m1!1e3`;
  const coordinatesLabel = `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;

  const rowNumber = (pin as any).pin_row_number ?? (pin as any).row_number ?? (pin as any).driving_row_number;
  const side = (pin as any).pin_side ?? (pin as any).side;
  const category = (pin as any).category;
  const note = (pin as any).notes;
  const whatsappLines = [
    "VineTrack pin:",
    title,
    "",
    category ? `Category: ${category}` : null,
    rowNumber != null ? `Row: ${rowNumber}` : null,
    side ? `Side: ${side}` : null,
    note ? `Note: ${note}` : null,
    `Coordinates: ${coordinatesLabel}`,
    "",
    `Google Maps:`,
    openInGoogleMapsUrl,
    "",
    `Apple Maps:`,
    openInAppleMapsUrl,
  ].filter(Boolean);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappLines.join("\n"))}`;

  const handleExternalMapResult = useCallback((result: ExternalMapOpenResult) => {
    setExternalMapResult(result);
  }, []);

  const handleCopy = useCallback(async (value: string, label: string) => {
    await copyTextToClipboard(value);
    toast(`${label} copied`);
  }, []);

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
          {coordinatesLabel}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <OpenExternalMapButton
            url={openInAppleMapsUrl}
            aria-label={`Open ${title} in Apple Maps`}
            onResult={handleExternalMapResult}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
          >
            Open in Apple Maps
          </OpenExternalMapButton>
          <OpenExternalMapButton
            url={openInGoogleMapsUrl}
            aria-label={`Open ${title} in Google Maps`}
            onResult={handleExternalMapResult}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
          >
            Google Maps
          </OpenExternalMapButton>
          <OpenExternalMapButton
            url={whatsappUrl}
            aria-label="Share pin via WhatsApp"
            onResult={handleExternalMapResult}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
          >
            Share via WhatsApp
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void handleCopy(coordinatesLabel, "Coordinates")}
          >
            Copy coordinates
          </Button>
        </div>
      </div>
      <div className="border-t bg-muted/20 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void handleCopy(openInAppleMapsUrl, "Apple Maps link")}
          >
            Copy Apple Maps link
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void handleCopy(openInGoogleMapsUrl, "Google Maps link")}
          >
            Copy Google Maps link
          </Button>
        </div>
        {externalMapResult?.status === "copied" ? (
          <div className="mt-3 rounded-md border bg-background px-3 py-2 text-xs text-foreground">
            <div className="font-medium">External map opening was blocked.</div>
            <div className="mt-1 text-muted-foreground">{externalMapResult.message}</div>
            <div className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{externalMapResult.url}</div>
          </div>
        ) : null}
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
