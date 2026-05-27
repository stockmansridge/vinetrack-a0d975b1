import { describe, it, expect } from "vitest";
import { generateRows } from "@/lib/paddockRowGeneration";
import { parseRows } from "@/lib/paddockGeometry";

// Regression for the "start row number drifts on save/reopen" bug.
//
// Rows are stored in left-to-right perpRad order (see
// docs/paddock-geometry-writer-spec.md §4 "Sort order on disk"), NOT by
// `number`. When ascending=false the first stored row holds the LARGEST
// number. The form must therefore hydrate the start-row field from the
// MIN of stored row numbers, not from `rows[0].number`, and the calculated
// last row must be derived (start + count - 1) for display only.

// Square polygon ~100m on a side around (-34.5, 138.7).
const polygon = [
  { lat: -34.5, lng: 138.7 },
  { lat: -34.5, lng: 138.7011 },
  { lat: -34.5009, lng: 138.7011 },
  { lat: -34.5009, lng: 138.7 },
];

function hydrateStart(stored: any[]): number {
  const rows = parseRows(stored);
  const nums = rows.map((r: any) => Number(r?.number)).filter((n) => Number.isFinite(n));
  return nums.length ? Math.min(...nums) : 1;
}

function calculatedLast(start: number, count: number): number {
  return start + count - 1;
}

describe("row numbering: start row hydration & last-row display", () => {
  it("ascending: start=30, count=7 round-trips as 30/36", () => {
    const rows = generateRows({
      polygonPoints: polygon,
      rowDirectionDeg: 0,
      rowWidthM: 2.5,
      rowOffsetM: 0,
      count: 7,
      rowStartNumber: 30,
      rowNumberAscending: true,
    });
    expect(rows.length).toBe(7);
    expect(hydrateStart(rows)).toBe(30);
    expect(calculatedLast(hydrateStart(rows), rows.length)).toBe(36);
  });

  it("descending: start=30, count=7 still hydrates start as 30 (not 36)", () => {
    const rows = generateRows({
      polygonPoints: polygon,
      rowDirectionDeg: 0,
      rowWidthM: 2.5,
      rowOffsetM: 0,
      count: 7,
      rowStartNumber: 30,
      rowNumberAscending: false,
    });
    expect(rows.length).toBe(7);
    // rows[0] is the leftmost row which, under descending, has number 36.
    expect((rows[0] as any).number).toBe(36);
    // But the hydrated "start row #" must still be 30 — the minimum.
    expect(hydrateStart(rows)).toBe(30);
    expect(calculatedLast(hydrateStart(rows), rows.length)).toBe(36);
  });

  it("saving without changes does not shift the row numbering", () => {
    let rows = generateRows({
      polygonPoints: polygon,
      rowDirectionDeg: 0,
      rowWidthM: 2.5,
      rowOffsetM: 0,
      count: 7,
      rowStartNumber: 30,
      rowNumberAscending: true,
    });
    // Simulate two save/reopen cycles using the form's hydrated values.
    for (let i = 0; i < 2; i++) {
      const start = hydrateStart(rows);
      const count = rows.length;
      const ascending = (rows[1] as any).number >= (rows[0] as any).number;
      expect(start).toBe(30);
      expect(count).toBe(7);
      rows = generateRows({
        polygonPoints: polygon,
        rowDirectionDeg: 0,
        rowWidthM: 2.5,
        rowOffsetM: 0,
        count,
        rowStartNumber: start,
        rowNumberAscending: ascending,
      });
    }
    expect(hydrateStart(rows)).toBe(30);
    expect(calculatedLast(hydrateStart(rows), rows.length)).toBe(36);
  });
});
