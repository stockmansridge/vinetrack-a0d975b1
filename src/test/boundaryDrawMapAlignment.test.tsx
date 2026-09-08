// Regression: boundary draw/edit markers must be centred exactly on the
// coordinate so the drop point matches the cursor location on the Edit Block
// Boundary screen. MapKit custom annotations are already horizontally centred
// and bottom-anchored, and a POSITIVE anchorOffset.y moves the element UP, so
// existing-boundary markers use a NEGATIVE half-height Y offset.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { LatLng } from "@/lib/paddockGeometry";

const createdAnnotations: any[] = [];

function makeFakeAnnotation(coord: any, factory: () => HTMLElement, options?: any) {
  const ann = {
    coordinate: coord,
    _factory: factory,
    _options: options,
    get draggable() { return false; },
    set draggable(v: boolean) { (this as any)._draggable = v; },
    addEventListener: vi.fn(),
  };
  createdAnnotations.push(ann);
  return ann;
}

// Use a hoisted container so the mock factory can assign the fake mapkit and
// the tests can read it back after import.
const mockState = vi.hoisted(() => ({
  fakeMapKit: null as any,
  initMapKit: vi.fn(),
}));

vi.mock("@/lib/mapkit", () => {
  const mapMock = vi.fn().mockImplementation(() => ({
    addOverlays: vi.fn(),
    removeOverlays: vi.fn(),
    addOverlay: vi.fn(),
    removeOverlay: vi.fn(),
    addAnnotations: vi.fn(),
    removeAnnotations: vi.fn(),
    addAnnotation: vi.fn(),
    removeAnnotation: vi.fn(),
    addEventListener: vi.fn(),
  }));
  // MapKit accesses static members on the Map constructor itself.
  (mapMock as any).MapTypes = { Hybrid: "hybrid" };
  (mapMock as any).FeatureVisibility = { Adaptive: "adaptive" };
  (mapMock as any).prototype = Object.prototype;
  mockState.fakeMapKit = {
    _isMock: true,
    Map: mapMock,
    Coordinate: vi.fn().mockImplementation((lat: number, lng: number) => ({ latitude: lat, longitude: lng })),
    CoordinateRegion: vi.fn().mockImplementation((center: any, span: any) => ({ center, span })),
    CoordinateSpan: vi.fn().mockImplementation((latDelta: number, lngDelta: number) => ({ latDelta, lngDelta })),
    PolygonOverlay: vi.fn().mockImplementation((coords: any[], opts?: any) => ({ coords, opts })),
    PolylineOverlay: vi.fn().mockImplementation((coords: any[], opts?: any) => ({ coords, opts })),
    Annotation: vi.fn().mockImplementation(makeFakeAnnotation),
    FeatureVisibility: { Adaptive: "adaptive" },
    MapTypes: { Hybrid: "hybrid" },
    Style: vi.fn().mockImplementation((opts: any) => ({ ...opts })),
    Point: vi.fn().mockImplementation((x: number, y: number) => ({ x, y })),
  };
  mockState.initMapKit.mockImplementation(() => Promise.resolve(mockState.fakeMapKit));
  return {
    initMapKit: mockState.initMapKit,
  };
});

vi.mock("@/lib/vineyardLocationQuery", () => ({
  fetchVineyardLocation: vi.fn().mockResolvedValue({ latitude: -34.5, longitude: 138.7 }),
}));

vi.mock("@/lib/queries", () => ({
  fetchList: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/context/VineyardContext", () => ({
  useVineyard: vi.fn().mockReturnValue({ selectedVineyardId: "v1" }),
}));

import BoundaryDrawMap from "@/components/paddocks/BoundaryDrawMap";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("BoundaryDrawMap marker alignment", () => {
  beforeEach(() => {
    createdAnnotations.length = 0;
    vi.clearAllMocks();
    // BoundaryDrawMap reads the MapKit global from window after init.
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.mapkit = mockState.fakeMapKit;
    (globalThis as any).mapkit = mockState.fakeMapKit;
  });

  afterEach(() => {
    // Avoid leaking the fake MapKit global into other test files.
    delete (globalThis as any).window.mapkit;
    delete (globalThis as any).mapkit;
  });

  it("centres edit-boundary vertex and midpoint annotations exactly on their coordinates", async () => {
    const polygon: LatLng[] = [
      { lat: -34.5, lng: 138.7 },
      { lat: -34.501, lng: 138.701 },
      { lat: -34.502, lng: 138.699 },
    ];

    render(
      <BoundaryDrawMap
        polygon={polygon}
        setPolygon={() => {}}
        readonly={false}
        editingExistingBoundary
      />,
      { wrapper: wrapper() }
    );

    // MapKit init resolves and the map is constructed.
    const { initMapKit } = await import("@/lib/mapkit");
    await act(async () => { await initMapKit(); });
    await waitFor(() => expect(mockState.fakeMapKit.Map).toHaveBeenCalled(), { timeout: 10000 });
    // Wait for the effect that adds annotations to run.
    await waitFor(() => expect(createdAnnotations.length).toBeGreaterThan(0), { timeout: 10000 });

    const vertexAnnotations = createdAnnotations.slice(0, polygon.length);
    const midpointAnnotations = createdAnnotations.slice(polygon.length);
    expect(vertexAnnotations).toHaveLength(3);
    expect(midpointAnnotations).toHaveLength(3);

    for (const ann of vertexAnnotations) {
      // MapKit anchors at bottom-centre and positive Y moves UP; centring the
      // 20px numbered handle on its vertex needs a NEGATIVE half-height offset.
      expect(ann.anchorOffset.x).toBe(0);
      expect(ann.anchorOffset.y).toBe(-10);
      const el = ann._factory();
      expect(el.style.transform).toBe("");
    }
    for (const ann of midpointAnnotations) {
      // 14px midpoint dot centred on its edge → -7.
      expect(ann.anchorOffset.x).toBe(0);
      expect(ann.anchorOffset.y).toBe(-7);
      const el = ann._factory();
      expect(el.style.transform).toBe("");
    }
  });

  it("dragging an edit-boundary vertex stores the exact dropped coordinate", async () => {
    const polygon: LatLng[] = [
      { lat: -34.5, lng: 138.7 },
      { lat: -34.501, lng: 138.701 },
      { lat: -34.502, lng: 138.699 },
    ];
    const setPolygon = vi.fn();

    render(
      <BoundaryDrawMap
        polygon={polygon}
        setPolygon={setPolygon}
        readonly={false}
        editingExistingBoundary
      />,
      { wrapper: wrapper() }
    );

    const { initMapKit } = await import("@/lib/mapkit");
    await act(async () => { await initMapKit(); });
    await waitFor(() => expect(createdAnnotations.length).toBeGreaterThan(0), { timeout: 10000 });

    const ann = createdAnnotations[0];
    const dragEnd = ann.addEventListener.mock.calls.find((c: any[]) => c[0] === "drag-end")?.[1];
    expect(dragEnd).toBeDefined();

    const dropped = { latitude: -34.5005, longitude: 138.7005 };
    ann.coordinate = dropped;
    act(() => { dragEnd(); });

    expect(setPolygon).toHaveBeenCalledTimes(1);
    const next = setPolygon.mock.calls[0][0] as LatLng[];
    // Exact coordinate preserved — no geographic compensation applied.
    expect(next[0]).toEqual({ lat: dropped.latitude, lng: dropped.longitude });
    expect(next[1]).toEqual(polygon[1]);
    expect(next[2]).toEqual(polygon[2]);
  });

  it("keeps create-block behaviour unchanged (CSS centring, zero offset)", async () => {
    const polygon: LatLng[] = [
      { lat: -34.5, lng: 138.7 },
      { lat: -34.501, lng: 138.701 },
      { lat: -34.502, lng: 138.699 },
    ];

    render(
      <BoundaryDrawMap
        polygon={polygon}
        setPolygon={() => {}}
        readonly={false}
      />,
      { wrapper: wrapper() }
    );

    const { initMapKit } = await import("@/lib/mapkit");
    await act(async () => { await initMapKit(); });
    await waitFor(() => expect(createdAnnotations.length).toBeGreaterThan(0), { timeout: 10000 });

    for (const ann of createdAnnotations) {
      expect(ann.anchorOffset.x).toBe(0);
      expect(ann.anchorOffset.y).toBe(0);
      const el = ann._factory();
      expect(el.style.transform).toContain("translate(-50%,-50%)");
    }
  });

  it("centres row-label annotations exactly on their coordinates", async () => {
    const rows = [
      {
        id: "r1",
        number: 1,
        startPoint: { latitude: -34.5, longitude: 138.7 },
        endPoint: { latitude: -34.501, longitude: 138.701 },
      },
    ];

    render(
      <BoundaryDrawMap polygon={[]} setPolygon={() => {}} readonly={true} rows={rows} />,
      { wrapper: wrapper() }
    );

    const { initMapKit } = await import("@/lib/mapkit");
    await act(async () => { await initMapKit(); });
    await waitFor(() => expect(mockState.fakeMapKit.Map).toHaveBeenCalled(), { timeout: 10000 });
    await waitFor(() => expect(createdAnnotations.length).toBeGreaterThan(0), { timeout: 10000 });

    for (const ann of createdAnnotations) {
      expect(ann.anchorOffset.x).toBe(0);
      expect(ann.anchorOffset.y).toBe(0);
      const el = ann._factory();
      expect(el.style.transform).toContain("translate(-50%,-50%)");
    }
  });
});
