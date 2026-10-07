import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
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
const discardDraft = vi.fn(async () => ({ revision: 2, alreadyDiscarded: false }));
vi.mock("@/lib/contourRows/draftApi", async (orig) => ({ ...(await orig<any>()),
  saveDraft: (...a: any[]) => (saveDraft as any)(...a), discardDraft: (...a: any[]) => (discardDraft as any)(...a) }));

import { Editor } from "@/pages/setup/ContourRowMappingPage";
import { workingCopyKey, getWorkingCopy, clearWorkingCopiesExcept, _workingCopyCount } from "@/lib/contourRows/workingCopy";

const U1 = "u1", U2 = "u2";
const V = "aaaaaaaa-0000-4000-8000-000000000001", V2 = "aaaaaaaa-0000-4000-8000-000000000003", P = "aaaaaaaa-0000-4000-8000-000000000002";
const paddock = { id: P, vineyard_id: V, name: "B1", polygon_points: [{ latitude: -34.5, longitude: 138.7 }, { latitude: -34.5, longitude: 138.701 }, { latitude: -34.501, longitude: 138.701 }], rows: [] };

const mount = (user: string, vineyard: string, load: any = { status: "empty", revision: 0 }) =>
  render(<MemoryRouter><Editor paddock={{ ...paddock, vineyard_id: vineyard }} copyKey={workingCopyKey(user, vineyard, P)} scope={{ vineyardId: vineyard, paddockId: P }}
    load={load} onSaved={() => {}} onReload={() => {}} onDiscarded={() => {}} /></MemoryRouter>);

beforeEach(() => { cleanup(); clearWorkingCopiesExcept(null); saveDraft.mockClear(); discardDraft.mockClear(); });

describe("Contour working copy (navigation recovery)", () => {
  it("navigating away and back (remount) restores the unsaved draft with a notice", () => {
    const a = mount(U1, V);
    fireEvent.click(screen.getByText("Add row group"));
    a.unmount();
    mount(U1, V);
    expect(screen.getByText("Unsaved draft restored")).toBeTruthy();
    expect(screen.getAllByText("Row group 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("vineyard switch keeps each vineyard's copy separate and returns intact", () => {
    const a = mount(U1, V);
    fireEvent.click(screen.getByText("Add row group"));
    a.unmount();
    const b = mount(U1, V2);
    expect(screen.queryByText("Unsaved draft restored")).toBeNull();
    expect(screen.queryByText("Row group 1")).toBeNull();
    b.unmount();
    mount(U1, V);
    expect(screen.getByText("Unsaved draft restored")).toBeTruthy();
  });

  it("isolates users and clears other users' copies on account change", () => {
    const a = mount(U1, V);
    fireEvent.click(screen.getByText("Add row group"));
    a.unmount();
    const b = mount(U2, V);
    expect(screen.queryByText("Unsaved draft restored")).toBeNull();
    b.unmount();
    clearWorkingCopiesExcept(U2);
    expect(getWorkingCopy(workingCopyKey(U1, V, P))).toBeNull();
  });

  it("save completing after unmount reconciles the copy (no stale restore)", async () => {
    const a = mount(U1, V);
    fireEvent.click(screen.getByText("Add row group"));
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const [, , saveId, payload] = saveDraft.mock.calls[0] as any[];
    a.unmount();
    expect(getWorkingCopy(workingCopyKey(U1, V, P))).not.toBeNull();
    await act(async () => { resolveSave({ draftId: payload.draftId, revision: 1, payload, updatedAt: null, lastClientSaveId: saveId }); });
    expect(_workingCopyCount()).toBe(0);
    mount(U1, V, { status: "loaded", draft: { draftId: payload.draftId, revision: 1, payload, updatedAt: null, lastClientSaveId: saveId } });
    expect(screen.queryByText("Unsaved draft restored")).toBeNull();
    expect(screen.getByText("Saved · revision 1")).toBeTruthy();
  });

  it("discard clears the copy so a remount starts clean", async () => {
    const a = mount(U1, V);
    fireEvent.click(screen.getByText("Add row group"));
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const [, , saveId, payload] = saveDraft.mock.calls[0] as any[];
    await act(async () => { resolveSave({ draftId: payload.draftId, revision: 1, payload, updatedAt: null, lastClientSaveId: saveId }); });
    fireEvent.click(screen.getByText("Add row group")); // dirty again
    expect(_workingCopyCount()).toBe(1);
    fireEvent.click(screen.getByText("Discard draft"));
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(discardDraft).toHaveBeenCalled());
    await waitFor(() => expect(_workingCopyCount()).toBe(0));
    a.unmount();
    mount(U1, V, { status: "empty", revision: 2 });
    expect(screen.queryByText("Unsaved draft restored")).toBeNull();
  });
});
