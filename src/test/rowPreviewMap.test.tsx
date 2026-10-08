import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
const h = vi.hoisted(() => ({ props: null as any, init: vi.fn() }));
vi.mock("@/lib/mapkit", () => ({ initMapKit: h.init }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v1" }) }));
vi.mock("@/lib/vineyardLocationQuery", () => ({ fetchVineyardLocation: async () => null }));
vi.mock("@/lib/queries", () => ({ fetchList: async () => [] }));
vi.mock("@/components/paddocks/ContourAppleMap", () => ({ default: (props: any) => { h.props = props; return <div>Precision rows</div>; } }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, maxZoom }: any) => <div data-testid="fallback" data-max-zoom={maxZoom}>{children}</div>,
  TileLayer: ({ maxZoom, maxNativeZoom }: any) => <div data-testid="tiles" data-max-zoom={maxZoom} data-native-zoom={maxNativeZoom} />,
  Polygon: () => null, Polyline: () => null, Marker: () => null,
  useMap: () => ({ getZoom: () => 19, getMinZoom: () => 0, fitBounds: () => {}, zoomIn: () => {}, zoomOut: () => {} }),
  useMapEvents: () => null,
}));
import BoundaryDrawMap from "@/components/paddocks/BoundaryDrawMap";
const polygon = [{ lat: -34.5, lng: 138.7 }, { lat: -34.5, lng: 138.701 }, { lat: -34.501, lng: 138.701 }];
const rows = [{ id: "row-1", number: 7, startPoint: { latitude: -34.5001, longitude: 138.7002 }, endPoint: { latitude: -34.5001, longitude: 138.7009 } }];
const provider = (children: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
beforeEach(() => { h.props = null; h.init.mockReset().mockResolvedValue({}); });

describe("normal row precision preview", () => {
  it("passes original row coordinates and numbers to shared zoom without writable handles", async () => {
    const setPolygon = vi.fn();
    render(provider(<BoundaryDrawMap polygon={polygon} rows={rows} readonly precisionPreview fitNonce={3} setPolygon={setPolygon} />));
    await screen.findByText("Precision rows");
    const line = h.props.shapes.find((s: any) => s.id === "row-row-1");
    expect(line.points).toEqual([{ lat: -34.5001, lng: 138.7002 }, { lat: -34.5001, lng: 138.7009 }]);
    expect(h.props.markers[0].html).toContain("Row 7");
    expect(h.props.markers[0].draggable).toBeUndefined();
    expect(h.props.fitNonce).toBe(3);
    h.props.onMapClick({ lat: 0, lng: 0 });
    expect(setPolygon).not.toHaveBeenCalled();
  });

  it("overzooms existing tiles on fallback, keeping the boundary editor at native zoom", async () => {
    h.init.mockRejectedValue(new Error("unavailable"));
    const { unmount } = render(provider(<BoundaryDrawMap polygon={polygon} rows={rows} readonly precisionPreview />));
    await screen.findByTestId("fallback");
    for (const tile of screen.getAllByTestId("tiles")) {
      expect(tile).toHaveAttribute("data-native-zoom", "19");
      expect(tile).toHaveAttribute("data-max-zoom", "23");
    }
    unmount();
    render(provider(<BoundaryDrawMap polygon={polygon} setPolygon={() => {}} precisionPreview />));
    await waitFor(() => expect(screen.getByTestId("fallback")).toHaveAttribute("data-max-zoom", "19"));
    expect(h.props).toBeNull();
  });

  it("precision boundary editor offers a midpoint on the initial two-point segment", async () => {
    const setPolygon = vi.fn();
    const two = polygon.slice(0, 2);
    render(provider(<BoundaryDrawMap polygon={two} setPolygon={setPolygon} precisionPreview />));
    await screen.findByText("Precision rows");
    const mids = h.props.markers.filter((m: any) => m.id.startsWith("m-"));
    expect(mids).toHaveLength(1);
    mids[0].onClick();
    const next = setPolygon.mock.calls[0][0];
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(two[0]); expect(next[2]).toBe(two[1]);
    expect(next[1].lat).toBeCloseTo(-34.5, 9); expect(next[1].lng).toBeCloseTo(138.7005, 9);
    h.props.markers.find((m: any) => m.id === "v-0").onClick();
    expect(setPolygon).toHaveBeenCalledTimes(1);
  });
});
