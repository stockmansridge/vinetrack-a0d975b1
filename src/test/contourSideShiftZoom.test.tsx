import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { makeProjection } from "@/lib/contourRows/geometry";
import { newGroup, newDraft, exportDraft, importDraftFile, type RowGroup } from "@/lib/contourRows/draft";
import { shiftGroup, shiftDirection, canUndoShift } from "@/lib/contourRows/sideShift";
import NumberStepper, { parseStepperText, stepValue } from "@/components/paddocks/NumberStepper";
import { screenToMapUnits, mapUnitsToScreen, metresPerScreenPx, type ViewFrame } from "@/components/paddocks/ContourAppleMap";

const V = "aaaaaaaa-0000-4000-8000-000000000001", P = "aaaaaaaa-0000-4000-8000-000000000002";
const origin = { lat: -34.5, lng: 138.7 }; // non-equatorial
const proj = makeProjection(origin);
const ll = (x: number, y: number) => proj.toLL({ x, y });

function group(): RowGroup {
  const g = newGroup("G", 1);
  g.referenceTrace = [ll(0, 0), ll(50, 0), ll(100, 0)]; // heading east
  g.rows = [
    { id: "11111111-1111-4111-8111-111111111111", number: 1, offsetIndex: 0, provenance: "edited", canonicalRowId: null,
      parts: [{ id: "21111111-1111-4111-8111-111111111111", points: [ll(0, 0), ll(40, 0.3)] }, { id: "31111111-1111-4111-8111-111111111111", points: [ll(45, 0), ll(100, 0)] }] },
    { id: "41111111-1111-4111-8111-111111111111", number: 2, offsetIndex: 1, provenance: "generated", canonicalRowId: null,
      parts: [{ id: "51111111-1111-4111-8111-111111111111", points: [ll(0, -2.5), ll(100, -2.5)] }] },
  ];
  g.exclusions = [{ id: "61111111-1111-4111-8111-111111111111", points: [ll(10, 10), ll(20, 10), ll(20, 20)] }];
  g.workingArea = [ll(-5, -5), ll(105, -5), ll(105, 5)];
  return g;
}

describe("side shift", () => {
  it("moves every vertex exactly 0.1 m left (north when heading east) at -34.5°", () => {
    const g = group(); const s = shiftGroup(g, proj, 0.1, "left");
    const all = (x: RowGroup) => [...x.referenceTrace, ...x.rows.flatMap((r) => r.parts.flatMap((p) => p.points))].map(proj.toXY);
    const a = all(g), b = all(s);
    a.forEach((p, i) => { expect(b[i].x - p.x).toBeCloseTo(0, 6); expect(b[i].y - p.y).toBeCloseTo(0.1, 6); });
    const r = shiftGroup(g, proj, 0.25, "right");
    expect(proj.toXY(r.referenceTrace[0]).y).toBeCloseTo(-0.25, 6);
  });
  it("preserves ids, numbers, parts, provenance and leaves masks untouched", () => {
    const g = group(); const s = shiftGroup(g, proj, 0.1, "left");
    expect(s.rows.map((r) => [r.id, r.number, r.provenance, r.parts.map((p) => p.id)])).toEqual(g.rows.map((r) => [r.id, r.number, r.provenance, r.parts.map((p) => p.id)]));
    expect(s.exclusions).toEqual(g.exclusions); expect(s.workingArea).toEqual(g.workingArea);
  });
  it("traceless group uses first row direction; none -> null", () => {
    const g = group(); g.referenceTrace = [];
    expect(shiftDirection(g, proj)?.source).toBe("row");
    g.rows = []; expect(shiftDirection(g, proj)).toBeNull();
    expect(() => shiftGroup(g, proj, 0.1, "left")).toThrow();
  });
  it("undo is valid only while the group is unchanged since the shift", () => {
    const g = group(); const s = shiftGroup(g, proj, 0.1, "left");
    const stack = [{ groupId: g.id, before: g, afterJson: JSON.stringify(s) }];
    expect(canUndoShift(stack, s)).toBe(true);
    expect(canUndoShift(stack, { ...s, spacingM: 3 })).toBe(false);
  });
  it("survives export/import roundtrip with identical coordinates", () => {
    const d = newDraft(V, P); const s = shiftGroup(group(), proj, 0.1, "left"); d.groups = [s];
    const back = importDraftFile(JSON.stringify(exportDraft(d)), { vineyardId: V, paddockId: P }, d.draftId, "restore");
    expect(back.groups[0].rows[0].parts[0].points).toEqual(s.rows[0].parts[0].points);
    expect(back.groups[0].referenceTrace).toEqual(s.referenceTrace);
  });
});

describe("number stepper", () => {
  it("parses within bounds only", () => {
    const b = { min: 0.5, max: 20 };
    expect(parseStepperText("", b)).toBeNull(); expect(parseStepperText("0.4", b)).toBeNull();
    expect(parseStepperText("20.1", b)).toBeNull(); expect(parseStepperText("2.", b)).toBe(2);
    expect(parseStepperText("1.5", { min: 1, max: 9, integer: true })).toBeNull();
    expect(stepValue(19.95, 1, { ...b, step: 0.1 })).toBe(20);
    expect(stepValue(0, -1, { min: 0, max: 300, step: 1 })).toBe(0);
  });
  it("commits typing, steps from typed value, never commits invalid, keeps typed text", () => {
    const seen: number[] = [];
    function H() { const [v, setV] = useState(2.5); return <NumberStepper label="Row spacing (m)" value={v} min={0.5} max={20} step={0.1} onChange={(n) => { seen.push(n); setV(n); }} />; }
    render(<H />);
    const input = screen.getByLabelText("Row spacing (m)") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "3." } });
    expect(input.value).toBe("3."); expect(seen.at(-1)).toBe(3);
    fireEvent.change(input, { target: { value: "3.27" } }); expect(seen.at(-1)).toBe(3.27);
    fireEvent.click(screen.getByLabelText("Increase Row spacing (m)")); expect(seen.at(-1)).toBe(3.37);
    fireEvent.keyDown(input, { key: "ArrowDown" }); expect(seen.at(-1)).toBe(3.27);
    const n = seen.length;
    fireEvent.change(input, { target: { value: "" } }); fireEvent.change(input, { target: { value: "99" } });
    expect(seen.length).toBe(n);
    fireEvent.blur(input); expect(input.value).toBe("3.27");
  });
  it("disabled blocks steps", () => {
    const f = vi.fn();
    render(<NumberStepper label="Rows on the left" integer value={1} min={0} max={300} step={1} disabled onChange={f} />);
    fireEvent.click(screen.getByLabelText("Increase Rows on the left")); expect(f).not.toHaveBeenCalled();
  });
});

describe("precision magnification maths", () => {
  const f1: ViewFrame = { ox: 0.8, oy: 0.6, w: 1e-6, h: 5e-7, elW: 800, elH: 400, k: 1 };
  it("screen↔map units roundtrip at 4× and same geo point lands k× further from origin", () => {
    const f4 = { ...f1, elW: 200, elH: 100, k: 4, w: f1.w / 4, h: f1.h / 4 };
    const u = screenToMapUnits(f4, 333, 77); const s = mapUnitsToScreen(f4, u.x, u.y);
    expect(s.sx).toBeCloseTo(333, 4); expect(s.sy).toBeCloseTo(77, 4);
    // Same screen size, 4× magnification → 4× fewer metres per screen pixel.
    expect(metresPerScreenPx(f1, -34.5) / metresPerScreenPx(f4, -34.5)).toBeCloseTo(4, 9);
  });
});
