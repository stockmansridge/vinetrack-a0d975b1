// Contour editor integration: row pick/reveal, delete row, renumber, save freeze.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/paddocks/ContourAppleMap", () => ({
  default: ({ shapes, markers }: any) => (
    <div data-testid="map">
      {shapes.filter((s: any) => s.onClick).map((s: any) => <button key={s.id} onClick={s.onClick}>shape:{s.id}</button>)}
      {markers.filter((m: any) => m.onClick).map((m: any) => <button key={m.id} onClick={m.onClick}>marker:{m.id}</button>)}
    </div>
  ),
}));
let resolveSave: (v: any) => void = () => {};
const saveDraft = vi.fn((..._a: any[]) => new Promise((r) => { resolveSave = r; }));
vi.mock("@/lib/contourRows/draftApi", async (orig) => ({ ...(await orig<any>()), saveDraft: (...a: any[]) => saveDraft(...a) }));

import { Editor } from "@/pages/setup/ContourRowMappingPage";

const V = "aaaaaaaa-0000-4000-8000-000000000001", P = "aaaaaaaa-0000-4000-8000-000000000002";
const D = "aaaaaaaa-0000-4000-8000-000000000003", G = "aaaaaaaa-0000-4000-8000-000000000004";
const rid = (i: number) => `bbbbbbbb-0000-4000-8000-00000000000${i}`;
const pid = (i: number) => `cccccccc-0000-4000-8000-00000000000${i}`;
const paddock = { id: P, vineyard_id: V, name: "B1", rows: [], polygon_points: [
  { latitude: -34.5, longitude: 138.7 }, { latitude: -34.5, longitude: 138.701 },
  { latitude: -34.501, longitude: 138.701 }, { latitude: -34.501, longitude: 138.7 }] };
const mkRow = (i: number, number: number) => ({
  id: rid(i), number, offsetIndex: i, provenance: "generated", canonicalRowId: null,
  parts: [{ id: pid(i), points: [{ lat: -34.5002, lng: 138.7002 + i * 0.0002 }, { lat: -34.5008, lng: 138.7002 + i * 0.0002 }] }],
});
function draft() {
  return { schema: "vinetrack.contour_row_mapping_draft", version: 1, draftId: D, vineyardId: V, paddockId: P, groups: [{
    id: G, name: "North", mode: "contour", referenceTrace: [{ lat: -34.5002, lng: 138.7002 }, { lat: -34.5008, lng: 138.7002 }], smoothing: 0,
    spacingM: 2.5, startNumber: 1, ascending: true, leftCount: 0, rightCount: 2, extendToArea: true, workingArea: null, exclusions: [],
    rows: [mkRow(0, 1), mkRow(1, 2), mkRow(2, 3)],
  }] };
}
function renderEditor() {
  return render(<MemoryRouter><Editor paddock={paddock} scope={{ vineyardId: V, paddockId: P }}
    load={{ status: "loaded", draft: { draftId: D, revision: 1, payload: draft() as any, updatedAt: null, lastClientSaveId: null } } as any}
    onSaved={() => {}} onReload={() => {}} onDiscarded={() => {}} /></MemoryRouter>);
}
const panel = () => screen.getByRole("complementary", { hidden: true });
const pickRow = (i: number) => fireEvent.click(screen.getByText(`shape:row-${pid(i)}`));
const savedPayload = () => (saveDraft.mock.calls.at(-1) as any[])[3];

beforeEach(() => { saveDraft.mockClear(); });

describe("contour row pick and reveal", () => {
  it("re-selecting the same row after hiding reopens Row edit; vertex clicks don't reveal", () => {
    renderEditor();
    pickRow(1);
    expect(screen.getByRole("tab", { name: "Row edit" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByText("Hide settings"));
    expect(panel().hidden).toBe(true);
    // Vertex handle click on the selected row: stays hidden.
    fireEvent.click(screen.getByText("marker:r-0-1"));
    expect(panel().hidden).toBe(true);
    pickRow(1);
    expect(panel().hidden).toBe(false);
    expect(screen.getByRole("tab", { name: "Row edit" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("delete row and renumber reach the saved payload", () => {
  it("deletes only the targeted row; others unchanged", async () => {
    renderEditor();
    pickRow(1);
    fireEvent.click(screen.getByRole("button", { name: /Delete row/ }));
    const dlg = screen.getByRole("alertdialog");
    expect(within(dlg).getByText(/Delete row 2 from North/)).toBeTruthy();
    fireEvent.click(within(dlg).getByText("Continue"));
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const rows = savedPayload().groups[0].rows;
    expect(rows.map((r: any) => r.id)).toEqual([rid(0), rid(2)]);
    expect(rows[1]).toEqual(mkRow(2, 3));
  });

  it("Update row numbers changes only numbers", async () => {
    renderEditor();
    pickRow(1);
    fireEvent.click(screen.getByRole("button", { name: /Delete row/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Continue"));
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Update row numbers" }));
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const rows = savedPayload().groups[0].rows;
    expect(rows.map((r: any) => [r.id, r.number])).toEqual([[rid(0), 1], [rid(2), 2]]);
    expect(rows[1].parts).toEqual(mkRow(2, 3).parts);
  });

  it("delete confirmed while a save is in flight does nothing", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Update row numbers" })); // no-op, numbers already 1..3
    fireEvent.change(screen.getByDisplayValue("North"), { target: { value: "North 2" } });
    pickRow(0);
    fireEvent.click(screen.getByRole("button", { name: /Delete row/ }));
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Continue"));
    const payload = savedPayload();
    await act(async () => { resolveSave({ draftId: D, revision: 2, payload, updatedAt: null, lastClientSaveId: (saveDraft.mock.calls[0] as any[])[2] }); });
    expect(payload.groups[0].rows).toHaveLength(3);
    expect(screen.getByText("Saved · revision 2")).toBeTruthy();
  });
});

describe("setup sub-tabs", () => {
  it("existing traced group opens on Rows; Add row group opens Trace with Start trace", () => {
    renderEditor();
    expect(screen.getByRole("tab", { name: "Rows" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Update row numbers" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Groups" }));
    fireEvent.click(screen.getByRole("button", { name: /Add row group/ }));
    expect(screen.getByRole("tab", { name: "Setup" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Trace" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Start trace" })).toBeTruthy();
  });
});
