import { describe, it, expect } from "vitest";
import { newDraft, newGroup, type ContourDraft, type DraftRow } from "@/lib/contourRows/draft";
import { deleteDraftRow, planRenumber, applyRenumber, groupStatus } from "@/lib/contourRows/rowNumbering";

const row = (id: string, number: number, offsetIndex: number | null, extra: Partial<DraftRow> = {}): DraftRow => ({
  id, number, offsetIndex, provenance: "generated", canonicalRowId: null,
  parts: [{ id: `${id}-p`, points: [{ lat: -34.5, lng: 138.7 + offsetIndex! * 0.0001 || 0 }, { lat: -34.501, lng: 138.7 }] }], ...extra,
});
function draft(rows: DraftRow[], start = 8, ascending = true, other: DraftRow[] = []): ContourDraft {
  const d = newDraft("v", "p");
  const g = { ...newGroup("A", start), id: "g1", ascending, rows, leftCount: 0, rightCount: rows.length - 1 };
  const o = { ...newGroup("B", 1), id: "g2", rows: other };
  return { ...d, groups: other.length ? [g, o] : [g] };
}

describe("deleteDraftRow", () => {
  it("removes only the targeted row by id, keeping others intact", () => {
    const d = draft([row("a", 1, 0), row("b", 2, 1), row("c", 3, 2)]);
    const out = deleteDraftRow(d, "g1", "b");
    expect(out.groups[0].rows.map((r) => [r.id, r.number])).toEqual([["a", 1], ["c", 3]]);
    expect(out.groups[0].rows[1]).toBe(d.groups[0].rows[2]);
    expect(deleteDraftRow(d, "g2", "b")).toBe(d); // wrong group: no change
  });
});

describe("planRenumber", () => {
  it("numbers present rows left→right from the start, compacting gaps, keeping ids/geometry", () => {
    const edited = row("c", 3, 2, { provenance: "edited", canonicalRowId: "x" });
    const d = draft([row("b", 2, 1), row("a", 1, -1), edited]);
    const p = planRenumber(d, "g1");
    expect(p.ok).toBe(true);
    const out = applyRenumber(d, "g1", p as any);
    expect(out.groups[0].rows.map((r) => [r.id, r.number])).toEqual([["b", 9], ["a", 8], ["c", 10]]);
    const c = out.groups[0].rows[2];
    expect(c.parts).toBe(edited.parts);
    expect([c.provenance, c.canonicalRowId]).toEqual(["edited", "x"]);
  });
  it("reverses when numbering descends", () => {
    const d = draft([row("a", 1, 0), row("b", 2, 1)], 8, false);
    const out = applyRenumber(d, "g1", planRenumber(d, "g1") as any);
    expect(out.groups[0].rows.map((r) => r.number)).toEqual([9, 8]);
  });
  it("imported rows keep their import order", () => {
    const d = draft([row("a", 5, null), row("b", 3, null)], 1);
    const out = applyRenumber(d, "g1", planRenumber(d, "g1") as any);
    expect(out.groups[0].rows.map((r) => r.number)).toEqual([1, 2]);
  });
  it("rejects collisions with other groups and out-of-range numbers", () => {
    expect(planRenumber(draft([row("a", 1, 0)], 8, true, [row("z", 8, 0)]), "g1").ok).toBe(false);
    expect(planRenumber(draft([row("a", 1, 0), row("b", 2, 1)], 100_000), "g1").ok).toBe(false);
    expect(planRenumber(draft([row("a", 1, 0)], 0), "g1").ok).toBe(false);
  });
  it("empty groups are safe", () => {
    const p = planRenumber(draft([]), "g1");
    expect(p).toMatchObject({ ok: true, changed: 0 });
  });
  it("status flags out-of-date numbers and count differences", () => {
    const d = draft([row("a", 1, 0), row("b", 2, 1)]);
    const g = { ...d.groups[0], rightCount: 5 };
    const s = groupStatus({ ...d, groups: [g] }, g);
    expect(s).toMatchObject({ drafted: 2, configured: 6, countDiffers: true, numbersOutOfDate: true });
  });
});

import { firstLastRowStarts } from "@/lib/contourRows/rowNumbering";
describe("firstLastRowStarts", () => {
  it("labels lowest and highest numbers at their start points, skipping empty parts", () => {
    const a = row("a", 9, 0), b = row("b", 8, 1), c = row("c", 10, 2);
    c.parts = [{ id: "e", points: [] }, { id: "f", points: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] }];
    expect(firstLastRowStarts([a, b, c]).map((x) => [x.number, x.point])).toEqual([[8, b.parts[0].points[0]], [10, { lat: 1, lng: 2 }]]);
    expect(firstLastRowStarts([a])).toHaveLength(1);
    expect(firstLastRowStarts([])).toEqual([]);
  });
});
