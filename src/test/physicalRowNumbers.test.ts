import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn() }));
const mockClient = () => ({
  supabase: {
    from: () => ({
      update: (p: any) => { updateSpy(p); return { eq: () => ({ select: () => ({ single: async () => ({ data: p, error: null }) }) }) }; },
    }),
    rpc: vi.fn(),
  },
});
vi.mock("@/integrations/supabase/client", mockClient);
vi.mock("@/integrations/ios-supabase/client", mockClient);

import { generateRows } from "@/lib/paddockRowGeneration";
import {
  parseStartRowNumber, parseRowCount, validateRowNumbering, findInvalidRowNumbers,
  assertValidRowsPayload, describePruningSummaryError, START_ROW_ERROR, ROW_COUNT_ERROR,
} from "@/lib/physicalRowNumbers";
import { updatePaddock } from "@/lib/paddockMutations";
import { mergeGeneratedGeometry } from "@/lib/paddockRowVines";

const polygon = [
  { lat: -34.5, lng: 138.7 }, { lat: -34.5, lng: 138.7011 },
  { lat: -34.5009, lng: 138.7011 }, { lat: -34.5009, lng: 138.7 },
];
const base = { polygonPoints: polygon, rowDirectionDeg: 0, rowWidthM: 2.5, rowOffsetM: 0 };

beforeEach(() => updateSpy.mockClear());

describe("input parsing", () => {
  it("rejects fractional, blank, malformed, non-finite, out-of-range start", () => {
    for (const v of ["1.5", "8.5", "", "  ", "abc", "1e3", "Infinity", "NaN", "0", "-3", "2147483648", NaN, Infinity, 1.5]) {
      expect(parseStartRowNumber(v).ok).toBe(false);
    }
    expect(parseStartRowNumber("1.5")).toEqual({ ok: false, error: START_ROW_ERROR });
  });
  it("accepts whole numbers including 1.0 and non-1 starts", () => {
    expect(parseStartRowNumber("1.0")).toEqual({ ok: true, value: 1 });
    expect(parseStartRowNumber(" 30 ")).toEqual({ ok: true, value: 30 });
  });
  it("rejects fractional/zero/blank counts", () => {
    for (const v of ["2.5", "0", "", "-1", "x"]) expect(parseRowCount(v)).toEqual({ ok: false, error: ROW_COUNT_ERROR });
    expect(parseRowCount("7")).toEqual({ ok: true, value: 7 });
  });
  it("rejects a last row beyond int4", () => {
    expect(validateRowNumbering("2147483647", "2").ok).toBe(false);
  });
});

describe("generateRows guard", () => {
  it("fractional start yields no rows (asc + desc)", () => {
    for (const asc of [true, false]) {
      expect(generateRows({ ...base, count: 7, rowStartNumber: 1.5, rowNumberAscending: asc })).toEqual([]);
    }
  });
  it("fractional count yields no rows (asc + desc)", () => {
    for (const asc of [true, false]) {
      expect(generateRows({ ...base, count: 6.5, rowStartNumber: 1, rowNumberAscending: asc })).toEqual([]);
    }
  });
  it("valid input: unchanged numbering, geometry and order", () => {
    const a = generateRows({ ...base, count: 7, rowStartNumber: 30, rowNumberAscending: true });
    const d = generateRows({ ...base, count: 7, rowStartNumber: 30, rowNumberAscending: false });
    expect(a.map((r) => r.number)).toEqual([30, 31, 32, 33, 34, 35, 36]);
    expect(d.map((r) => r.number)).toEqual([36, 35, 34, 33, 32, 31, 30]);
    expect(a.map((r) => r.startPoint.longitude)).toEqual(d.map((r) => r.startPoint.longitude));
    expect(findInvalidRowNumbers(a)).toEqual([]);
  });
});

describe("save boundary", () => {
  it("invalid rows make no database write", async () => {
    await expect(updatePaddock("p1", { rows: [{ id: "r1", number: 1.5 }] })).rejects.toThrow(/whole numbers/);
    expect(updateSpy).not.toHaveBeenCalled();
  });
  it("metadata-only edits on legacy blocks still save and don't touch rows", async () => {
    await updatePaddock("p1", { name: "3DROPS NEB" });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).not.toHaveProperty("rows");
  });
  it("import/restore payloads with fractional rows are rejected", () => {
    expect(() => assertValidRowsPayload({ rows: JSON.stringify([{ number: 2.5 }]) })).toThrow();
    expect(() => assertValidRowsPayload({ rows: [] })).not.toThrow();
    expect(() => assertValidRowsPayload({ name: "x" })).not.toThrow();
  });
  it("validation does not regenerate existing row IDs", () => {
    const stored = [{ id: "keep-1", number: 1, vineCountOverride: 5 }];
    const before = JSON.stringify(stored);
    findInvalidRowNumbers(stored);
    assertValidRowsPayload({ rows: stored });
    expect(JSON.stringify(stored)).toBe(before);
    const gen = generateRows({ ...base, count: 2, rowStartNumber: 1, rowNumberAscending: true });
    expect(mergeGeneratedGeometry(stored, gen as any)[0].id).toBe("keep-1");
  });
});

describe("scope + pruning error", () => {
  it("does not touch Trip/aisle half-path identifiers", () => {
    // Only paddocks.rows[*].number is validated; Trip paths like 24.5 are other data.
    expect(() => assertValidRowsPayload({ pathsCovered: [24.5], startRow: 24.5 } as any)).not.toThrow();
  });
  it("names the affected block only when data supports it", () => {
    const msg = 'invalid input syntax for type integer: "1.5"';
    const blocks = [
      { id: "a", name: "3DROPS NEB", rows: [{ number: 1.5 }, { number: 2 }] },
      { id: "b", name: "OK", rows: [{ number: 1 }] },
    ];
    const out = describePruningSummaryError(msg, blocks)!;
    expect(out).toContain("3DROPS NEB (1.5)");
    expect(out).not.toContain("OK (");
    expect(describePruningSummaryError(msg, [blocks[1]])).toBe(msg);
    expect(describePruningSummaryError("permission denied", blocks)).toBe("permission denied");
  });
});
