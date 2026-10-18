import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const P = "aaaaaaaa-0000-4000-8000-0000000000p1".replace("p1", "01"), V = "aaaaaaaa-0000-4000-8000-000000000009";
const poly = [{ id: "x1", latitude: -34.5, longitude: 138.7 }, { id: "x2", latitude: -34.5, longitude: 138.702 }, { id: "x3", latitude: -34.502, longitude: 138.702 }, { id: "x4", latitude: -34.502, longitude: 138.7 }];
const paddock = { id: P, vineyard_id: V, name: "B1", polygon_points: poly, row_direction: 0, row_width: 2.5, row_offset: 0, vine_spacing: 1.5,
  rows: [{ id: "r-1", number: 1, startPoint: { id: "s", latitude: -34.5, longitude: 138.701 }, endPoint: { id: "e", latitude: -34.502, longitude: 138.701 }, extraKey: "keep" }] };

let admin = true;
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: admin, loading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/queries", async (o) => ({ ...(await o<any>()), fetchOne: async () => paddock }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: V, currentRole: "owner" }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
const updatePaddock = vi.fn(async () => {});
vi.mock("@/lib/paddockMutations", async (o) => ({ ...(await o<any>()), updatePaddock: (...a: any[]) => (updatePaddock as any)(...a) }));
const contour = { loadDraft: vi.fn(async () => ({ status: "loaded", draft: { draftId: "d", revision: 1, payload: {} } })), saveDraft: vi.fn(), discardDraft: vi.fn() };
vi.mock("@/lib/contourRows/draftApi", async (o) => ({ ...(await o<any>()), loadDraft: (...a: any[]) => (contour.loadDraft as any)(...a),
  saveDraft: (...a: any[]) => (contour.saveDraft as any)(...a), discardDraft: (...a: any[]) => (contour.discardDraft as any)(...a) }));
vi.mock("@/components/paddocks/BoundaryDrawMap", () => ({ default: () => null }));
vi.mock("@/components/soil/SoilProfileSection", () => ({ default: () => null }));
vi.mock("react-leaflet", () => ({ MapContainer: ({ children }: any) => <div>{children}</div>, TileLayer: () => null, Polygon: () => null,
  Polyline: () => null, Marker: () => null, CircleMarker: () => null, Tooltip: () => null, useMap: () => ({ fitBounds: () => {} }), useMapEvents: () => null }));
vi.mock("leaflet", () => ({ default: { divIcon: () => ({}), latLngBounds: () => ({}), DomEvent: { stopPropagation: () => {} } } }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

import PaddockDetailPage from "@/pages/setup/PaddockDetailPage";

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <MemoryRouter initialEntries={[`/setup/paddocks/${P}`]}><Routes><Route path="/setup/paddocks/:id" element={<PaddockDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
const openTab = async (name: RegExp) => { const t = await screen.findByRole("tab", { name }); fireEvent.mouseDown(t); fireEvent.click(t); };

beforeEach(() => { cleanup(); updatePaddock.mockClear(); contour.saveDraft.mockClear(); contour.discardDraft.mockClear(); });

describe("Block Setup straight saves stay unchanged", () => {
  for (const isAdmin of [true, false]) {
    it(`Save boundary sends polygon + regenerated rows keeping ids/extra keys (admin=${isAdmin})`, async () => {
      admin = isAdmin; mount();
      await openTab(/Boundary/);
      fireEvent.click(await screen.findByRole("button", { name: /Save boundary/i }));
      await waitFor(() => expect(updatePaddock).toHaveBeenCalledTimes(1));
      const [id, patch] = updatePaddock.mock.calls[0] as any[];
      expect(id).toBe(P);
      expect(Object.keys(patch).sort()).toEqual(["polygon_points", "rows", "updated_by"]);
      const r1 = patch.rows.find((r: any) => r.number === 1);
      expect(r1.id).toBe("r-1"); expect(r1.extraKey).toBe("keep");
      expect(contour.saveDraft).not.toHaveBeenCalled(); expect(contour.discardDraft).not.toHaveBeenCalled();
    });
    it(`Save rows sends the usual fields only (admin=${isAdmin})`, async () => {
      admin = isAdmin; mount();
      await openTab(/^Rows/);
      fireEvent.click(await screen.findByRole("button", { name: /Save rows/i }));
      await waitFor(() => expect(updatePaddock).toHaveBeenCalledTimes(1));
      const patch = (updatePaddock.mock.calls[0] as any[])[1];
      expect(Object.keys(patch).sort()).toEqual(["row_direction", "row_length_override", "row_offset", "row_width", "rows", "updated_by", "vine_count_override", "vine_spacing"]);
      expect(contour.saveDraft).not.toHaveBeenCalled();
    });
  }
});
