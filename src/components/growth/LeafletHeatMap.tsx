import { useEffect } from "react";
import { MapContainer, TileLayer, Polygon, ImageOverlay, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { elColourCss } from "@/lib/growthHeatmap";
import type { HeatMapViewProps } from "@/components/growth/heatMapTypes";

function FitTo({ points, fitKey }: { points: { lat: number; lng: number }[]; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    try {
      map.fitBounds(
        L.latLngBounds(points.map((p) => [p.lat, p.lng]) as L.LatLngBoundsLiteral).pad(0.15),
        { padding: [16, 16] },
      );
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, points.length]);
  return null;
}

export default function LeafletHeatMap({
  blocks,
  overlays,
  observations,
  staleIds,
  fitPoints,
  fitKey,
  showBoundaries,
  onSelect,
}: HeatMapViewProps) {
  const blockLabel = (mode: string) =>
    mode === "none" ? " · No observations" : mode === "stale" ? " · No current observations" : "";
  return (
    <MapContainer center={[-34.3, 138.6]} zoom={14} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri"
      />
      <FitTo points={fitPoints} fitKey={fitKey} />
      {showBoundaries &&
        blocks.map((b) =>
          b.polygon.length >= 3 ? (
            <Polygon
              key={`poly-${b.paddockId}`}
              positions={b.polygon.map((p) => [p.lat, p.lng]) as any}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillOpacity: b.mode === "none" || b.mode === "stale" ? 0.05 : 0,
              }}
            >
              <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none !text-white">
                {b.paddockName}
                {blockLabel(b.mode)}
              </Tooltip>
            </Polygon>
          ) : null,
        )}
      {overlays.map((o) => (
        <ImageOverlay key={`heat-${o.id}`} url={o.url} bounds={o.bounds} opacity={1} />
      ))}
      {observations.map((o) => {
        const stale = staleIds.has(o.id);
        const filled = o.assigned && !!o.paddockId;
        return (
          <CircleMarker
            key={o.id}
            center={[o.lat, o.lng]}
            radius={stale ? 5 : 6}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              opacity: stale ? 0.55 : 1,
              dashArray: stale ? "3 3" : undefined,
              fillColor: elColourCss(o.el),
              fillOpacity: filled ? (stale ? 0.35 : 1) : 0,
            }}
            eventHandlers={{ click: () => onSelect(o) }}
          />
        );
      })}
    </MapContainer>
  );
}

