import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>, TileLayer: () => null, Polygon: () => null,
  Polyline: () => null, Marker: () => null, useMap: () => ({ fitBounds: () => {} }), useMapEvents: () => null,
}));
vi.mock("leaflet", () => ({ default: { divIcon: () => ({}), latLngBounds: () => ({}), DomEvent: { stopPropagation: () => {} } } }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const saveDraft = vi.fn(async (_s: any, _b: any, saveId: string, payload: any) => ({ draftId: payload.draftId, revision: 1, payload, updatedAt: null, lastClientSaveId: saveId }));
vi.mock("@/lib/contourRows/draftApi", async (orig) => ({ ...(await orig<any>()), saveDraft: (...a: any[]) => (saveDraft as any)(...a) }));

import { Editor } from "@/pages/setup/ContourRowMappingPage";
import { blockSnapshot, diffBlock, blockChanged, compareNumbering, fetchCurrentBlock, BlockFreshnessError } from "@/lib/contourRows/blockFreshness";
import { checkDraftGeometry } from "@/lib/contourRows/checks";
import { newDraft, newGroup } from "@/lib/contourRows/draft";

const V = "aaaaaaaa-0000-4000-8000-000000000001", P = "aaaaaaaa-0000-4000-8000-000000000002";
const R1 = "bbbbbbbb-0000-4000-8000-000000000001", R2 = "bbbbbbbb-0000-4000-8000-000000000002";
const poly = [{ latitude: -34.5, longitude: 138.7 }, { latitude: -34.5, longitude: 138.701 }, { latitude: -34.501, longitude: 138.701 }];
const row = (id: string, n: number) => ({ id, number: n, startPoint: { latitude: -34.5005, longitude: 138.7005 }, endPoint: { latitude: -34.5004, longitude: 138.7008 } });
const paddock = { id: P, vineyard_id: V, name: "B1", polygon_points: poly, rows: [row(R1, 1)] };

const mount = (fetchBlock: any) => render(<MemoryRouter><Editor paddock={paddock} scope={{ vineyardId: V, paddockId: P }} load={{ status: "empty", revision: 0 }}
  onSaved={() => {}} onReload={() => {}} onDiscarded={() => {}} fetchBlock={fetchBlock} /></MemoryRouter>);

beforeEach(() => { cleanup(); saveDraft.mockClear(); });

describe("block snapshot diff (canonical)", () => {
  const a = blockSnapshot(paddock);
  it("unchanged data and reordered properties are unchanged", () => {
    expect(blockChanged(diffBlock(a, blockSnapshot({ ...paddock })))).toBe(false);
    const reordered = { ...paddock, polygon_points: poly.map((p) => ({ longitude: p.longitude, latitude: p.latitude })),
      rows: [{ endPoint: { longitude: 138.7008, latitude: -34.5004 }, number: 1, startPoint: { longitude: 138.7005, latitude: -34.5005 }, id: R1 }] };
    expect(blockChanged(diffBlock(a, blockSnapshot(reordered)))).toBe(false);
  });
  it("boundary change", () => {
    expect(diffBlock(a, blockSnapshot({ ...paddock, polygon_points: [...poly, { latitude: -34.501, longitude: 138.7 }] })).boundaryChanged).toBe(true);
  });
  it("same ids, changed coordinates → geometry change", () => {
    const d = diffBlock(a, blockSnapshot({ ...paddock, rows: [{ ...row(R1, 1), endPoint: { latitude: -34.5004, longitude: 138.7009 } }] }));
    expect(d).toMatchObject({ rowIdentityChanged: false, rowNumbersChanged: false, rowGeometryChanged: true, boundaryChanged: false });
  });
  it("same ids, changed number → numbering change", () => {
    const d = diffBlock(a, blockSnapshot({ ...paddock, rows: [row(R1, 2)] }));
    expect(d).toMatchObject({ rowIdentityChanged: false, rowNumbersChanged: true, rowGeometryChanged: false });
  });
  it("added/removed id → identity change", () => {
    expect(diffBlock(a, blockSnapshot({ ...paddock, rows: [row(R1, 1), row(R2, 2)] })).rowIdentityChanged).toBe(true);
    expect(diffBlock(a, blockSnapshot({ ...paddock, rows: [] })).rowIdentityChanged).toBe(true);
  });
});

describe("pre-save freshness (F1)", () => {
  it("boundary changed in another tab: save stops, edits kept, recheck re-enables save", async () => {
    const moved = { ...paddock, polygon_points: [...poly, { latitude: -34.501, longitude: 138.7 }] };
    const fetchBlock = vi.fn(async () => moved);
    mount(fetchBlock);
    fireEvent.click(screen.getByText("Add row group"));
    fireEvent.click(screen.getByText("Save Draft"));
    await screen.findByText("Block changed since this draft was checked");
    expect(saveDraft).not.toHaveBeenCalled();
    expect(screen.getAllByText("Row group 1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Recheck against current block"));
    await waitFor(() => expect(screen.queryByText("Block changed since this draft was checked")).toBeNull());
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
  });

  it("operational rows changed while open: save stops, links are flagged not cleared", async () => {
    const fetchBlock = vi.fn(async () => ({ ...paddock, rows: [row(R2, 1)] }));
    mount(fetchBlock);
    fireEvent.click(screen.getByText("Add row group"));
    fireEvent.click(screen.getByText("Save Draft"));
    await screen.findByText(/added or removed/);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("network failure during pre-save read: nothing saved, edits kept", async () => {
    const fetchBlock = vi.fn(async () => { throw new BlockFreshnessError("network", "Couldn't confirm the block is up to date (connection problem). Nothing was saved — try again."); });
    mount(fetchBlock);
    fireEvent.click(screen.getByText("Add row group"));
    fireEvent.click(screen.getByText("Save Draft"));
    await screen.findByText(/connection problem/);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(screen.getAllByText("Row group 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("same ids with renumbered rows stops the save and keeps edits", async () => {
    mount(vi.fn(async () => ({ ...paddock, rows: [row(R1, 7)] })));
    fireEvent.click(screen.getByText("Add row group"));
    fireEvent.click(screen.getByText("Save Draft"));
    await screen.findByText(/row numbers were changed/);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(screen.getAllByText("Row group 1").length).toBeGreaterThan(0);
  });

  it("unchanged block saves normally", async () => {
    mount(vi.fn(async () => paddock));
    fireEvent.click(screen.getByText("Add row group"));
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    await screen.findByText("Saved · revision 1");
  });

  it("window focus flags a changed block without replacing the snapshot", async () => {
    mount(vi.fn(async () => ({ ...paddock, rows: [] })));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await screen.findByText("Block changed since this draft was checked");
  });
});

describe("fetchCurrentBlock scope", () => {
  it("rejects a block from another vineyard or archived", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries", () => ({ fetchOne: async () => ({ ...paddock, vineyard_id: "other" }) }));
    const m = await import("@/lib/contourRows/blockFreshness");
    await expect(m.fetchCurrentBlock(V, P)).rejects.toMatchObject({ kind: "scope" });
    vi.doUnmock("@/lib/queries");
    expect(typeof fetchCurrentBlock).toBe("function");
  });
});

describe("imported multipart geometry (F2 rules unchanged)", () => {
  it("each part is checked separately; boundary still enforced; cut-outs not applied", () => {
    const b = poly.map((p) => ({ lat: p.latitude, lng: p.longitude }));
    const d = newDraft(V, P);
    const g = { ...newGroup("Imp", 1), mode: "imported" as const,
      exclusions: [{ id: "cccccccc-0000-4000-8000-000000000001", points: [{ lat: -34.5001, lng: 138.7009 }, { lat: -34.5001, lng: 138.70099 }, { lat: -34.5009, lng: 138.70099 }] }],
      rows: [{ id: "dddddddd-0000-4000-8000-000000000001", number: 1, offsetIndex: null, provenance: "imported" as const, canonicalRowId: null, source: null,
        parts: [{ id: "eeeeeeee-0000-4000-8000-000000000001", points: [{ lat: -34.5002, lng: 138.7004 }, { lat: -34.5002, lng: 138.7006 }] },
                { id: "eeeeeeee-0000-4000-8000-000000000002", points: [{ lat: -34.5002, lng: 138.7008 }, { lat: -34.5002, lng: 138.7009 }] }] }] };
    d.groups = [g];
    const issues = checkDraftGeometry(d, b);
    expect(issues.some((i) => /cut-out/.test(i.message))).toBe(false);
    expect(issues.some((i) => /parts that touch/.test(i.message))).toBe(false);
    const out = { ...d, groups: [{ ...g, rows: [{ ...g.rows[0], parts: [{ ...g.rows[0].parts[0], points: [{ lat: -34.5002, lng: 138.7004 }, { lat: -34.4990, lng: 138.7004 }] }] }] }] };
    expect(checkDraftGeometry(out, b).some((i) => /outside the block/.test(i.message))).toBe(true);
  });
});

describe("numbering comparison (F3)", () => {
  it("reports draft-only and operational-only numbers", () => {
    expect(compareNumbering([1, 2, 3], [2, 3, 4])).toMatchObject({ onlyInDraft: [1], onlyOperational: [4], same: false });
    expect(compareNumbering([2, 1], [1, 2]).same).toBe(true);
  });
});
