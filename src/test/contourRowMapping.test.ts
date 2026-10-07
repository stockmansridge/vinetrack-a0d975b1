import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: (...a: any[]) => from(...a) } }));

import { makeProjection, offsetPolyline, clipPolyline, polylineLengthXY, multipartLengthM, chordLengthM, type XY } from "@/lib/contourRows/geometry";
import { newDraft, newGroup, generateGroupRows, validateDraft, exportDraft, importDraftFile, numberForOffset, totalRowsFor } from "@/lib/contourRows/draft";
import { moveVertex, splitAfterVertex } from "@/lib/contourRows/rowEdits";
import { parseGeoJsonLines, parseKmlLines, parseLineFile, duplicateNumbers } from "@/lib/contourRows/importLines";
import { saveDraft, loadDraft } from "@/lib/contourRows/draftApi";

const proj = makeProjection({ lat: -34.5, lng: 138.7 });
const toLL = (pts: XY[]) => pts.map(proj.toLL);
const square = toLL([{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }]);

function minDistToPolyline(p: XY, line: XY[]) {
  let m = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    m = Math.min(m, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return m;
}

describe("geometry", () => {
  it("curved path is longer than its chord", () => {
    const arc = toLL(Array.from({ length: 21 }, (_, i) => ({ x: -50 + i * 5, y: 20 * Math.sin((i / 20) * Math.PI) })));
    expect(multipartLengthM([arc], proj)).toBeGreaterThan(chordLengthM([arc], proj) + 5);
    expect(chordLengthM([arc], proj)).toBeCloseTo(100, 0);
  });

  it("straight offsets are exactly the spacing in metres", () => {
    const off = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 2.5);
    expect(off[0].y).toBeCloseTo(2.5, 6); // positive = left of start→end
  });

  it("S-curve offset keeps ~spacing distance from the reference", () => {
    const s = Array.from({ length: 41 }, (_, i) => ({ x: i * 2.5, y: 10 * Math.sin((i / 40) * 2 * Math.PI) }));
    const off = offsetPolyline(s, 3);
    for (const p of off.slice(2, -2)) expect(minDistToPolyline(p, s)).toBeCloseTo(3, 0);
  });

  it("concave clipping yields disjoint parts without bridging the gap", () => {
    // U-shape: line at y=50 crosses both arms, gap in between.
    const U = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
    const parts = clipPolyline([{ x: -10, y: 50 }, { x: 110, y: 50 }], { boundary: U });
    expect(parts).toHaveLength(2);
    expect(parts.reduce((s, p) => s + polylineLengthXY(p), 0)).toBeCloseTo(60, 6);
  });

  it("exclusion masks cut rows and working areas limit them", () => {
    const box = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const track = [{ x: 45, y: -1 }, { x: 55, y: -1 }, { x: 55, y: 101 }, { x: 45, y: 101 }];
    expect(clipPolyline([{ x: -5, y: 50 }, { x: 105, y: 50 }], { boundary: box, exclusions: [track] })).toHaveLength(2);
    const area = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
    const p = clipPolyline([{ x: -5, y: 50 }, { x: 105, y: 50 }], { boundary: box, workingArea: area });
    expect(polylineLengthXY(p[0])).toBeCloseTo(40, 6);
  });
});

describe("generator and draft rules", () => {
  const g0 = () => ({ ...newGroup("A", 1), mode: "straight" as const, spacingM: 2.5, leftCount: 2, rightCount: 3,
    referenceTrace: toLL([{ x: -50, y: 0 }, { x: 50, y: 0 }]) });

  it("counts include the reference once and number ascending from the left", () => {
    const g = g0();
    expect(totalRowsFor(g)).toBe(6);
    const res = generateGroupRows(g, square);
    expect(res.rows).toHaveLength(6);
    expect(numberForOffset(g, -2)).toBe(1);
    expect(numberForOffset({ ...g, ascending: false }, -2)).toBe(6);
    const leftmost = res.rows.find((r) => r.offsetIndex === -2)!;
    expect(proj.toXY(leftmost.parts[0].points[0]).y).toBeCloseTo(5, 3); // 2 × 2.5 m left (north)
  });

  it("regeneration keeps row identities; edited rows are marked", () => {
    const g = g0();
    const first = generateGroupRows(g, square).rows;
    const again = generateGroupRows({ ...g, rows: first }, square).rows;
    expect(again.map((r) => r.id)).toEqual(first.map((r) => r.id));
    const e = moveVertex(first[0], 0, 0, first[0].parts[0].points[1]);
    expect(e.provenance).toBe("edited");
    expect(e.id).toBe(first[0].id);
  });

  it("split keeps one logical row with two parts", () => {
    const r = generateGroupRows({ ...g0(), mode: "contour", referenceTrace: toLL([{ x: -50, y: 0 }, { x: -20, y: 0 }, { x: 0, y: 1 }, { x: 20, y: 0 }, { x: 50, y: 0 }]), extendToArea: false, leftCount: 0, rightCount: 0 }, square).rows[0];
    const s = splitAfterVertex(r, 0, 1);
    expect(s.id).toBe(r.id);
    expect(s.parts).toHaveLength(2);
  });

  it("rejects a tight curve that folds rows over", () => {
    const tight = toLL(Array.from({ length: 13 }, (_, i) => ({ x: 3 * Math.cos((i / 12) * Math.PI), y: 3 * Math.sin((i / 12) * Math.PI) })));
    const res = generateGroupRows({ ...g0(), mode: "contour", referenceTrace: tight, leftCount: 3, rightCount: 0, extendToArea: false, spacingM: 2.5 }, square);
    expect(res.rows).toHaveLength(0);
    expect(res.issues.some((i) => i.level === "error")).toBe(true);
  });

  it("flags duplicate row numbers across groups", () => {
    const d = newDraft("v1", "p1");
    const a = { ...g0(), rows: generateGroupRows(g0(), square).rows };
    const b = { ...g0(), id: "g2", rows: generateGroupRows(g0(), square).rows };
    d.groups = [a, b];
    expect(validateDraft(d).some((m) => /used twice/.test(m))).toBe(true);
  });

  it("export/import round trip keeps ids for same draft, regenerates for another block", () => {
    const d = newDraft("v1", "p1");
    d.groups = [{ ...g0(), rows: generateGroupRows(g0(), square).rows, canonicalRowId: undefined } as any];
    d.groups[0].rows[0].canonicalRowId = "11111111-1111-1111-1111-111111111111";
    const text = JSON.stringify(exportDraft(d));
    const same = importDraftFile(text, "v1", "p1", d.draftId);
    expect(same.sameDraft).toBe(true);
    expect(same.draft).toEqual(d);
    const other = importDraftFile(text, "v2", "p9", null);
    expect(other.sameDraft).toBe(false);
    const oldIds = new Set([d.draftId, ...d.groups.flatMap((g) => [g.id, ...g.rows.flatMap((r) => [r.id, ...r.parts.map((p) => p.id)])])]);
    const newIds = [other.draft.draftId, ...other.draft.groups.flatMap((g) => [g.id, ...g.rows.flatMap((r) => [r.id, ...r.parts.map((p) => p.id)])])];
    expect(newIds.some((i) => oldIds.has(i))).toBe(false);
    expect(other.draft.groups[0].rows.every((r) => r.canonicalRowId === null)).toBe(true);
    expect(other.draft.paddockId).toBe("p9");
  });
});

describe("row import", () => {
  it("MultiLineString is one row with multiple parts; numbers from properties", () => {
    const r = parseGeoJsonLines(JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", properties: { row: 7 }, geometry: { type: "MultiLineString", coordinates: [[[138.7, -34.5], [138.701, -34.5]], [[138.702, -34.5], [138.703, -34.5]]] } },
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } },
    ] }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].parts).toHaveLength(2);
    expect(r.lines[0].suggestedNumber).toBe(7);
    expect(r.warnings).toHaveLength(1);
  });
  it("rejects unsupported CRS, bad ranges, entities and unsupported formats", () => {
    expect(() => parseGeoJsonLines(JSON.stringify({ type: "FeatureCollection", crs: { properties: { name: "EPSG:28354" } }, features: [] }))).toThrow(/coordinate system/);
    expect(() => parseGeoJsonLines(JSON.stringify({ type: "LineString", coordinates: [[500, 1], [1, 1]] }))).toThrow(/range/);
    expect(() => parseKmlLines(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><kml/>`)).toThrow(/entity/);
    expect(() => parseLineFile("rows.gpx", "")).toThrow(/supported/);
  });
  it("KML MultiGeometry becomes one row", () => {
    const r = parseKmlLines(`<kml><Placemark><name>Row 4</name><MultiGeometry><LineString><coordinates>138.7,-34.5 138.701,-34.5</coordinates></LineString><LineString><coordinates>138.702,-34.5,0 138.703,-34.5,0</coordinates></LineString></MultiGeometry></Placemark></kml>`);
    expect(r.lines[0].parts).toHaveLength(2);
    expect(r.lines[0].suggestedNumber).toBe(4);
  });
  it("duplicate numbers detected", () => {
    expect(duplicateNumbers([1, 2, 2, 5], new Set([5]))).toEqual([2, 5]);
  });
});

describe("draft API", () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset(); });
  const d = () => ({ ...newDraft("v1", "p1") });

  it("missing backend is reported as setup required, not empty", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect((await loadDraft("p1")).status).toBe("setup_required");
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await loadDraft("p1")).status).toBe("empty");
  });

  it("denied backend access surfaces as an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_authorised" } });
    await expect(loadDraft("p1")).rejects.toMatchObject({ kind: "denied" });
  });

  it("stale save is a conflict; never touches the paddocks table", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "stale_revision" } });
    await expect(saveDraft("p1", 3, "s1", d())).rejects.toMatchObject({ kind: "stale" });
    expect(from).not.toHaveBeenCalled();
  });

  it("confirms save only after read-back with matching identity/revision", async () => {
    const draft = d();
    rpc.mockImplementation(async (fn: string, args: any) => {
      if (fn === "save_contour_row_mapping_draft") {
        expect(args).toMatchObject({ p_paddock_id: "p1", p_expected_revision: 0, p_client_save_id: "s1" });
        return { data: { revision: 1, payload: draft }, error: null };
      }
      return { data: { revision: 1, payload: draft }, error: null };
    });
    const s = await saveDraft("p1", 0, "s1", draft);
    expect(s.revision).toBe(1);
    expect(rpc).toHaveBeenCalledWith("get_contour_row_mapping_draft", { p_paddock_id: "p1" });
    expect(from).not.toHaveBeenCalled();

    rpc.mockImplementation(async (fn: string) => fn === "save_contour_row_mapping_draft"
      ? { data: { revision: 2, payload: draft }, error: null }
      : { data: { revision: 2, payload: { ...draft, draftId: "other" } }, error: null });
    await expect(saveDraft("p1", 1, "s2", draft)).rejects.toThrow(/confirmed/);
  });

  it("network failure is recoverable", async () => {
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(saveDraft("p1", 0, "s1", d())).rejects.toBeTruthy();
  });
});
