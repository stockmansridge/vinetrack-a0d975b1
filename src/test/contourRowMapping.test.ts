import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: (...a: any[]) => from(...a) } }));

import { makeProjection, offsetPolyline, clipPolyline, polylineLengthXY, multipartLengthM, chordLengthM, type XY } from "@/lib/contourRows/geometry";
import { newDraft, newGroup, generateGroupRows, validateDraft, validateDraftShape, exportDraft, importDraftFile, readBackupFile, numberForOffset, totalRowsFor } from "@/lib/contourRows/draft";
import { checkDraftGeometry } from "@/lib/contourRows/checks";
import { generateUuid } from "@/lib/uuid";
import { moveVertex, splitAfterVertex } from "@/lib/contourRows/rowEdits";
import { parseGeoJsonLines, parseKmlLines, parseLineFile, duplicateNumbers, linesFarOutside } from "@/lib/contourRows/importLines";
import { saveDraft, loadDraft, discardDraft } from "@/lib/contourRows/draftApi";

const V = "aaaaaaaa-0000-4000-8000-000000000001", P = "aaaaaaaa-0000-4000-8000-000000000002";
const V2 = "aaaaaaaa-0000-4000-8000-000000000003", P2 = "aaaaaaaa-0000-4000-8000-000000000004";
const CANON = "aaaaaaaa-0000-4000-8000-0000000000cc";
const scope = { vineyardId: V, paddockId: P };

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

const g0 = () => ({ ...newGroup("A", 1), mode: "straight" as const, spacingM: 2.5, leftCount: 2, rightCount: 3,
  referenceTrace: toLL([{ x: -50, y: 0 }, { x: 50, y: 0 }]) });

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
    const d = newDraft(V, P);
    const a = { ...g0(), rows: generateGroupRows(g0(), square).rows };
    const b = { ...g0(), id: generateUuid(), rows: generateGroupRows(g0(), square).rows };
    d.groups = [a, b];
    expect(validateDraft(d).some((m) => /used twice/.test(m))).toBe(true);
  });

  it("backup restore keeps ids only for same draft; copy regenerates children and keeps container id", () => {
    const d = newDraft(V, P);
    d.groups = [{ ...g0(), rows: generateGroupRows(g0(), square).rows }];
    const text = JSON.stringify(exportDraft(d));
    expect(importDraftFile(text, scope, d.draftId, "restore")).toEqual(d);
    expect(() => importDraftFile(text, scope, generateUuid(), "restore")).toThrow(/copy/);
    const cur = generateUuid();
    const copy = importDraftFile(text, { vineyardId: V2, paddockId: P2 }, cur, "copy");
    expect(copy.draftId).toBe(cur);
    const oldIds = new Set(d.groups.flatMap((g) => [g.id, ...g.rows.flatMap((r) => [r.id, ...r.parts.map((p) => p.id)])]));
    const newIds = copy.groups.flatMap((g) => [g.id, ...g.rows.flatMap((r) => [r.id, ...r.parts.map((p) => p.id)])]);
    expect(newIds.some((x) => oldIds.has(x))).toBe(false);
    expect(copy.paddockId).toBe(P2);
  });

  it("backup import rejects malformed structures without TypeErrors", () => {
    const bad = [ "{", "null", JSON.stringify({ format: "vinetrack.contour_row_mapping_export", exportVersion: 1, draft: null }),
      JSON.stringify({ format: "vinetrack.contour_row_mapping_export", exportVersion: 1, draft: { schema: "vinetrack.contour_row_mapping_draft", version: 1, groups: [null] } }),
      "x".repeat(5_000_001) ];
    for (const t of bad) expect(() => readBackupFile(t, scope, generateUuid())).toThrow(Error);
  });
});

describe("strict shape validation", () => {
  const valid = () => { const d = newDraft(V, P); d.groups = [{ ...g0(), rows: generateGroupRows(g0(), square).rows }]; return d; };
  it("accepts a valid draft, an empty draft and an in-progress trace", () => {
    expect(validateDraftShape(valid(), scope)).toEqual([]);
    expect(validateDraftShape(newDraft(V, P), scope)).toEqual([]);
    const d = newDraft(V, P); d.groups = [{ ...newGroup("A"), referenceTrace: square.slice(0, 1) }];
    expect(validateDraftShape(d, scope)).toEqual([]);
  });
  it.each([
    ["missing schema", (d: any) => { delete d.schema; }],
    ["missing scope", (d: any) => { delete d.paddockId; }],
    ["wrong scope", (d: any) => { d.vineyardId = V2; }],
    ["missing groups", (d: any) => { delete d.groups; }],
    ["null group", (d: any) => { d.groups.push(null); }],
    ["missing parts", (d: any) => { delete d.groups[0].rows[0].parts; }],
    ["empty parts", (d: any) => { d.groups[0].rows[0].parts = []; }],
    ["row number 0", (d: any) => { d.groups[0].rows[0].number = 0; }],
    ["fractional row number", (d: any) => { d.groups[0].rows[0].number = 1.5; }],
    ["missing row id", (d: any) => { d.groups[0].rows[0].id = null; }],
    ["non-uuid id", (d: any) => { d.groups[0].id = "g1"; }],
    ["duplicate id", (d: any) => { d.groups[0].rows[1].id = d.groups[0].rows[0].id; }],
    ["null coordinate", (d: any) => { d.groups[0].rows[0].parts[0].points[0].lat = null; }],
    ["string coordinate", (d: any) => { d.groups[0].rows[0].parts[0].points[0].lng = "138.7"; }],
    ["out of range", (d: any) => { d.groups[0].rows[0].parts[0].points[0].lng = 181; }],
    ["zero-length part", (d: any) => { const p = d.groups[0].rows[0].parts[0]; p.points = [p.points[0], { ...p.points[0] }]; }],
    ["unsupported mode", (d: any) => { d.groups[0].mode = "spline"; }],
    ["unsupported provenance", (d: any) => { d.groups[0].rows[0].provenance = "magic"; }],
    ["spacing range", (d: any) => { d.groups[0].spacingM = 0; }],
    ["smoothing range", (d: any) => { d.groups[0].smoothing = 3; }],
    ["count range", (d: any) => { d.groups[0].rightCount = 301; }],
    ["incomplete working area", (d: any) => { d.groups[0].workingArea = [square[0]]; }],
    ["malformed mask", (d: any) => { d.groups[0].exclusions = [{ id: generateUuid(), points: [square[0], null, square[2]] }]; }],
    ["oversize trace", (d: any) => { d.groups[0].referenceTrace = Array.from({ length: 501 }, () => square[0]); }],
    ["unknown canonical row", (d: any) => { d.groups[0].rows[0].canonicalRowId = generateUuid(); }],
  ])("rejects %s", (_n, mutate) => {
    const d: any = structuredClone(valid()); mutate(d);
    expect(validateDraftShape(d, { ...scope, canonicalRowIds: new Set([CANON]) }).length).toBeGreaterThan(0);
  });
  it("accepts a canonical row that belongs to the block", () => {
    const d = valid(); d.groups[0].rows[0].canonicalRowId = CANON;
    expect(validateDraftShape(d, { ...scope, canonicalRowIds: new Set([CANON]) })).toEqual([]);
  });
});

describe("final geometry checks", () => {
  const draftWith = (rows: XY[][][], mode: "imported" | "contour" = "imported") => {
    const d = newDraft(V, P);
    d.groups = [{ ...newGroup("I"), mode, rows: rows.map((parts, i) => ({ id: generateUuid(), number: i + 1, offsetIndex: null, provenance: "imported" as const, canonicalRowId: null,
      parts: parts.map((p) => ({ id: generateUuid(), points: toLL(p) })) })) }];
    return d;
  };
  const errs = (d: any) => checkDraftGeometry(d, square).filter((i) => i.level === "error").map((i) => i.message).join(" | ");
  it("clean parallel rows pass", () => {
    expect(errs(draftWith([[[{ x: -50, y: 0 }, { x: 50, y: 0 }]], [[{ x: -50, y: 3 }, { x: 50, y: 3 }]]]))).toBe("");
  });
  it("detects self-intersection", () => {
    expect(errs(draftWith([[[{ x: -50, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 10 }, { x: 0, y: -10 }]]]))).toMatch(/crosses or doubles back/);
  });
  it("detects a collinear doubling back on adjacent segments", () => {
    expect(errs(draftWith([[[{ x: -50, y: 0 }, { x: 50, y: 0 }, { x: 10, y: 0 }]]]))).toMatch(/doubles back/);
  });
  it("detects crossing rows and collinear overlap between rows", () => {
    expect(errs(draftWith([[[{ x: -50, y: 0 }, { x: 50, y: 0 }]], [[{ x: 0, y: -20 }, { x: 0, y: 20 }]]]))).toMatch(/Rows 1 and 2 cross/);
    expect(errs(draftWith([[[{ x: -50, y: 0 }, { x: 10, y: 0 }]], [[{ x: 0, y: 0 }, { x: 50, y: 0 }]]]))).toMatch(/Rows 1 and 2 overlap/);
  });
  it("multipart rows are not flattened: a gap between parts is not a segment", () => {
    // Part gap would cross row 2 if flattened.
    const d = draftWith([[[{ x: -50, y: 0 }, { x: -10, y: 0 }], [{ x: -10, y: 20 }, { x: 50, y: 20 }]], [[{ x: -9, y: -30 }, { x: -9, y: -5 }]]]);
    expect(errs(d)).toBe("");
  });
  it("flags rows outside the block and repeated points", () => {
    expect(errs(draftWith([[[{ x: -50, y: 0 }, { x: 150, y: 0 }]]]))).toMatch(/outside the block/);
    expect(errs(draftWith([[[{ x: -50, y: 0 }, { x: -50, y: 0 }, { x: 50, y: 0 }]]]))).toMatch(/repeated points/);
  });
  it("flags rows through a cut-out and invalid masks", () => {
    const d = draftWith([[[{ x: -50, y: 0 }, { x: 50, y: 0 }]]], "contour");
    d.groups[0].exclusions = [{ id: generateUuid(), points: toLL([{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }]) }];
    expect(errs(d)).toMatch(/through a cut-out/);
    d.groups[0].exclusions = [{ id: generateUuid(), points: toLL([{ x: -5, y: -5 }, { x: 5, y: 5 }, { x: 5, y: -2 }, { x: -5, y: 5 }]) }];
    expect(errs(d)).toMatch(/crosses itself/);
  });
  it("generator rejects invalid masks instead of ignoring them", () => {
    const res = generateGroupRows({ ...g0(), workingArea: square.slice(0, 2) }, square);
    expect(res.rows).toHaveLength(0);
    expect(res.issues.some((i) => /working area/.test(i.message))).toBe(true);
  });
  it("large drafts finish quickly (grid, no all-pairs freeze)", () => {
    const rows = Array.from({ length: 70 }, (_, i) => [[...Array.from({ length: 200 }, (_, k) => ({ x: -95 + k * 0.95, y: -90 + i * 2.5 }))]]);
    const t = Date.now();
    expect(errs(draftWith(rows))).toBe("");
    expect(Date.now() - t).toBeLessThan(4000);
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

describe("row import strictness", () => {
  const fc = (coords: unknown) => JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] });
  it("rejects null/blank/string coordinates instead of coercing", () => {
    expect(() => parseGeoJsonLines(fc([[null, -34.5], [138.7, -34.5]]))).toThrow(/numbers/);
    expect(() => parseGeoJsonLines(fc([["138.7", -34.5], [138.7, -34.6]]))).toThrow(/numbers/);
    expect(() => parseKmlLines(`<kml><Placemark><LineString><coordinates>138.7, 138.701,-34.5</coordinates></LineString></Placemark></kml>`)).toThrow();
    expect(() => parseKmlLines(`<kml><Placemark><LineString><coordinates>,-34.5 138.701,-34.5</coordinates></LineString></Placemark></kml>`)).toThrow(/numbers/);
  });
  it("rejects empty MultiLineString, invalid FeatureCollection and nested CRS", () => {
    expect(() => parseGeoJsonLines(JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [] } }))).toThrow(/no lines/);
    expect(() => parseGeoJsonLines(JSON.stringify({ type: "FeatureCollection", features: {} }))).toThrow(/features/);
    expect(() => parseGeoJsonLines(JSON.stringify({ type: "FeatureCollection", features: [null] }))).toThrow(/Feature/);
    expect(() => parseGeoJsonLines(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", crs: { properties: { name: "EPSG:28354" } }, coordinates: [[1, 1], [2, 2]] } }] }))).toThrow(/coordinate system/);
  });
  it("flags lines far outside the block", () => {
    const near = parseGeoJsonLines(fc(toLL([{ x: -50, y: 0 }, { x: 50, y: 0 }]).map((p) => [p.lng, p.lat])));
    expect(linesFarOutside(near.lines, square)).toHaveLength(0);
    const far = parseGeoJsonLines(fc(toLL([{ x: 500, y: 0 }, { x: 600, y: 0 }]).map((p) => [p.lng, p.lat])));
    expect(linesFarOutside(far.lines, square)).toHaveLength(1);
  });
});

describe("draft API", () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset(); });
  const d = () => newDraft(V, P);
  const SID = "bbbbbbbb-0000-4000-8000-000000000001";

  it("missing backend is reported as setup required, not empty; discarded slot keeps its revision", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect((await loadDraft(scope)).status).toBe("setup_required");
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadDraft(scope)).toEqual({ status: "empty", revision: 0 });
    rpc.mockResolvedValue({ data: { draft_id: null, payload: null, revision: 5 }, error: null });
    expect(await loadDraft(scope)).toEqual({ status: "empty", revision: 5 });
  });

  it("invalid server payload is rejected before rendering", async () => {
    const bad = { ...d(), groups: [{ id: "x" }] };
    rpc.mockResolvedValue({ data: { draft_id: bad.draftId, revision: 1, payload: bad }, error: null });
    await expect(loadDraft(scope)).rejects.toMatchObject({ kind: "invalid" });
    const other = newDraft(V2, P);
    rpc.mockResolvedValue({ data: { draft_id: other.draftId, revision: 1, payload: other }, error: null });
    await expect(loadDraft(scope)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("denied backend access surfaces as an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_authorised" } });
    await expect(loadDraft(scope)).rejects.toMatchObject({ kind: "denied" });
  });

  it("stale save is a conflict; never touches the paddocks table", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "stale_revision" } });
    await expect(saveDraft(scope, { draftId: null, revision: 3 }, SID, d())).rejects.toMatchObject({ kind: "stale" });
    expect(from).not.toHaveBeenCalled();
  });

  it("confirms only an exact acknowledgement (revision, save id, content)", async () => {
    const draft = d();
    rpc.mockImplementation(async (fn: string, args: any) => {
      if (fn === "save_contour_row_mapping_draft") {
        expect(args).toMatchObject({ p_paddock_id: P, p_expected_draft_id: null, p_expected_revision: 0, p_client_save_id: SID });
        return { data: { draft_id: draft.draftId, revision: 1, client_save_id: SID }, error: null };
      }
      // key order differs: still equal
      return { data: { draft_id: draft.draftId, revision: 1, last_client_save_id: SID, payload: JSON.parse(JSON.stringify({ groups: draft.groups, ...draft })) }, error: null };
    });
    const s = await saveDraft(scope, { draftId: null, revision: 0 }, SID, draft);
    expect(s.revision).toBe(1);
    expect(from).not.toHaveBeenCalled();
  });

  it("read-back with different content at the same revision is not confirmed", async () => {
    const draft = d();
    const changed = { ...draft, groups: [newGroup("other")] };
    rpc.mockImplementation(async (fn: string) => fn === "save_contour_row_mapping_draft"
      ? { data: { draft_id: draft.draftId, revision: 1, client_save_id: SID }, error: null }
      : { data: { draft_id: draft.draftId, revision: 1, last_client_save_id: SID, payload: changed }, error: null });
    await expect(saveDraft(scope, { draftId: null, revision: 0 }, SID, draft)).rejects.toMatchObject({ kind: "unknown" });
  });

  it("a newer writer after our ack is a conflict and their payload is never returned", async () => {
    const draft = d();
    const theirs = { ...draft, groups: [newGroup("theirs")] };
    rpc.mockImplementation(async (fn: string) => fn === "save_contour_row_mapping_draft"
      ? { data: { draft_id: draft.draftId, revision: 2, client_save_id: SID }, error: null }
      : { data: { draft_id: draft.draftId, revision: 3, last_client_save_id: "bbbbbbbb-0000-4000-8000-000000000009", payload: theirs }, error: null });
    await expect(saveDraft(scope, { draftId: draft.draftId, revision: 1 }, SID, draft)).rejects.toMatchObject({ kind: "conflict" });
  });

  it("ack with a different save id is rejected", async () => {
    const draft = d();
    rpc.mockResolvedValue({ data: { draft_id: draft.draftId, revision: 1, client_save_id: "bbbbbbbb-0000-4000-8000-000000000002" }, error: null });
    await expect(saveDraft(scope, { draftId: null, revision: 0 }, SID, draft)).rejects.toThrow(/acknowledged/);
  });

  it("network retry reuses the original save id", async () => {
    const draft = d();
    const ids: string[] = [];
    let n = 0;
    rpc.mockImplementation(async (fn: string, args: any) => {
      if (fn === "save_contour_row_mapping_draft") {
        ids.push(args.p_client_save_id);
        if (n++ === 0) throw new TypeError("Failed to fetch");
        return { data: { draft_id: draft.draftId, revision: 1, client_save_id: SID }, error: null };
      }
      return { data: { draft_id: draft.draftId, revision: 1, last_client_save_id: SID, payload: draft }, error: null };
    });
    await saveDraft(scope, { draftId: null, revision: 0 }, SID, draft);
    expect(ids).toEqual([SID, SID]);
  });

  it("rejects invalid save inputs before calling the server", async () => {
    await expect(saveDraft(scope, { draftId: null, revision: -1 }, SID, d())).rejects.toMatchObject({ kind: "invalid" });
    await expect(saveDraft(scope, { draftId: null, revision: 0 }, "nope", d())).rejects.toMatchObject({ kind: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("discard sends draft identity and reports idempotent repeats", async () => {
    rpc.mockResolvedValue({ data: { revision: 4, already_discarded: true }, error: null });
    const draftId = generateUuid();
    expect(await discardDraft(P, draftId, 3)).toEqual({ revision: 4, alreadyDiscarded: true });
    expect(rpc).toHaveBeenCalledWith("discard_contour_row_mapping_draft", { p_paddock_id: P, p_draft_id: draftId, p_expected_revision: 3 });
  });
});
