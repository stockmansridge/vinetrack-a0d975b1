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
  fitPoints,
  fitKey,
  showBoundaries,
  onSelect,
}: HeatMapViewProps) {
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
              pathOptions={{ color: "#ffffff", weight: 2, fillOpacity: b.mode === "none" ? 0.05 : 0 }}
            >
              <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none !text-white">
                {b.paddockName}
                {b.mode === "none" ? " · No observations" : ""}
              </Tooltip>
            </Polygon>
          ) : null,
        )}
      {overlays.map((o) => (
        <ImageOverlay key={`heat-${o.id}`} url={o.url} bounds={o.bounds} opacity={1} />
      ))}
      {observations.map((o) => (
        <CircleMarker
          key={o.id}
          center={[o.lat, o.lng]}
          radius={6}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: elColourCss(o.el),
            fillOpacity: o.assigned && o.paddockId ? 1 : 0,
          }}
          eventHandlers={{ click: () => onSelect(o) }}
        />
      ))}
    </MapContainer>
  );
}
