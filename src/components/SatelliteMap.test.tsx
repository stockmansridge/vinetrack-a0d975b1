import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SatelliteMap from "./SatelliteMap";
const mock = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@/lib/mapkit", () => ({ initMapKit: mock.init }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps overlay identity across opacity changes; mounts only decoded, positioned pixels; ignores late removed image events", async () => {
  let width = 0;
  class Coordinate { constructor(public latitude: number, public longitude: number) {} }
  class Map {
    static MapTypes = { Hybrid: "hybrid" };
    destroy() {} resize() {}
    convertCoordinateToPointOnPage(coordinate: Coordinate) {
      return { x: coordinate.longitude * width, y: (1 - coordinate.latitude) * 100 };
    }
  }
  const mapkit = { Map, Coordinate, FeatureVisibility: { Hidden: "hidden", Adaptive: "adaptive" } };
  vi.stubGlobal("mapkit", mapkit); mock.init.mockResolvedValue(mapkit);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  const mounted = vi.fn(), loaded = vi.fn(), removed = vi.fn();
  const first = { paddockId: "p1", sceneId: "s1", indexType: "NDVI", assetId: "a1", key: "p1|2026-08-01|NDVI|a1",
    url: "blob:a1", bounds: { north: 1, south: 0, east: 1, west: 0 }, opacity: 0.7 };
  const props = { paddocks: [], overlays: [first], onOverlayMounted: mounted, onOverlayLoad: loaded, onOverlayUnmounted: removed };
  const screen = render(<SatelliteMap {...props} />);
  await waitFor(() => expect(screen.container.querySelector('img[src="blob:a1"]')).not.toBeNull());
  const image = screen.container.querySelector('img[src="blob:a1"]') as HTMLImageElement;
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1 } });
  image.dispatchEvent(new Event("load"));
  expect(loaded).toHaveBeenCalledTimes(1); expect(mounted).not.toHaveBeenCalled();
  width = 100;
  await waitFor(() => expect(mounted).toHaveBeenCalledTimes(1));
  screen.rerender(<SatelliteMap {...props} overlays={[{ ...first, opacity: 0.4 }]} />);
  expect(screen.container.querySelector('img[src="blob:a1"]')).toBe(image);
  expect(mounted.mock.calls[0][0]).toMatchObject({ sceneId: "s1", assetId: "a1", overlayKey: first.key });
  screen.rerender(<SatelliteMap {...props} overlays={[]} />);
  expect(removed).toHaveBeenCalledTimes(1);
  image.dispatchEvent(new Event("load")); expect(loaded).toHaveBeenCalledTimes(1);
});