import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>, TileLayer: () => null, Polygon: () => null,
  Polyline: () => null, Marker: () => null, useMap: () => ({ fitBounds: () => {} }), useMapEvents: () => null,
}));
vi.mock("leaflet", () => ({ default: { divIcon: () => ({}), latLngBounds: () => ({}), DomEvent: { stopPropagation: () => {} } } }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

let resolveSave: (v: any) => void = () => {};
const saveDraft = vi.fn(() => new Promise((r) => { resolveSave = r; }));
vi.mock("@/lib/contourRows/draftApi", async (orig) => ({ ...(await orig<any>()), saveDraft: (...a: any[]) => (saveDraft as any)(...a) }));

import { Editor } from "@/pages/setup/ContourRowMappingPage";

const V = "aaaaaaaa-0000-4000-8000-000000000001", P = "aaaaaaaa-0000-4000-8000-000000000002";
const paddock = { id: P, vineyard_id: V, name: "B1", polygon_points: [{ latitude: -34.5, longitude: 138.7 }, { latitude: -34.5, longitude: 138.701 }, { latitude: -34.501, longitude: 138.701 }], rows: [] };

describe("Contour editor save freeze", () => {
  it("ignores edits while saving and keeps the editor (no remount) after confirmation", async () => {
    const onSaved = vi.fn();
    render(<MemoryRouter><Editor paddock={paddock} scope={{ vineyardId: V, paddockId: P }} load={{ status: "empty", revision: 0 }}
      onSaved={onSaved} onReload={() => {}} onDiscarded={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Add row group"));
    expect(screen.getAllByText("Row group 1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    // Mutations are frozen while the save is in flight.
    fireEvent.click(screen.getByText("Add row group"));
    expect(screen.queryByText("Row group 2")).toBeNull();
    const [, , saveId, payload] = (saveDraft.mock.calls[0] as any[]);
    await act(async () => { resolveSave({ draftId: payload.draftId, revision: 1, payload, updatedAt: null, lastClientSaveId: saveId }); });
    expect(onSaved).toHaveBeenCalled();
    expect(screen.getByText("Saved · revision 1")).toBeTruthy();
    // Editing resumes on the same editor.
    fireEvent.click(screen.getByText("Add row group"));
    expect(screen.getAllByText("Row group 2").length).toBeGreaterThan(0);
  });
});

describe("Contour editor tabs", () => {
  it("adding a group opens Setup with Start trace; typed fields survive tab switches", () => {
    render(<MemoryRouter><Editor paddock={paddock} scope={{ vineyardId: V, paddockId: P }} load={{ status: "empty", revision: 0 }}
      onSaved={() => {}} onReload={() => {}} onDiscarded={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Add row group"));
    expect(screen.getByRole("tab", { name: "Setup" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Start trace" })).toBeTruthy();
    const name = screen.getByDisplayValue("Row group 1");
    fireEvent.change(name, { target: { value: "North" } });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    expect(screen.getByDisplayValue("North")).toBeTruthy();
  });
});
