// Stage 1 — Existing Pin Row Recovery (REVIEW ONLY, NON-MUTATING).
//
// Pure client-side projections over data the signed-in System Admin can
// already read from the VineTrack backend. Nothing here writes, confirms or
// queues anything. Every output is a NON-AUTHORITATIVE candidate.
//
// Real schema (VineTrack backend):
//   pins: heading, side, pin_side, trip_id, row_number, pin_row_number,
//         driving_row_number, location_scope, snapped_to_row, latitude,
//         longitude, created_at  (NO accuracy columns)
//   pin_capture_evidence: pin_id, captured_at, horizontal_accuracy_m,
//         heading_degrees, heading_observed_at, pressed_side,
//         observations jsonb[], geometry_hash
//   pin_row_segments: pin_id, row_number, segment_number (member-readable)
//   trips: id, path_points (ordered, no per-point timestamps)
//   pin_location_geometry_history: NOT readable by the Portal → current
//         block geometry only, always labelled as such.
//
// Rules: nearest physical row is never the selected row; geometry alone is
// never enough for a supported candidate; unknown ≠ none.
import { parsePolygonPoints, parseRows, type LatLng } from "@/lib/paddockGeometry";

export const RECOVERY_VINEYARD_ID = "fe952afe-437f-4be7-8cbf-fdd8e630411c";

export type RecoveryStatus =
  | "supported_candidate"
  | "requires_review"
  | "not_resolvable"
  | "preserve_existing";

export const STATUS_LABEL: Record<RecoveryStatus, string> = {
  supported_candidate: "Supported candidate",
  requires_review: "Requires review",
  not_resolvable: "Not resolvable",
  preserve_existing: "Preserve existing",
};

export const GEOMETRY_SOURCE_LABEL =
  "Current block geometry only — capture-time history not readable by Portal";

/** Heading must be within this angle of the row axis (degrees). */
export const MAX_HEADING_OFF_AXIS_DEG = 30;
/** Heading observation must be within this many seconds of capture. */
export const MAX_HEADING_AGE_S = 10;
/** Pins closer than this fraction of spacing to a row line are aisle-ambiguous. */
export const MIN_ROW_CLEARANCE_FRACTION = 0.15;

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normSide(v: any): "left" | "right" | null {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("l")) return "left";
  if (s.startsWith("r")) return "right";
  return null;
}

/** Missing queue: live GPS pin with neither legacy nor canonical row number. */
export function isMissingRowPin(p: any): boolean {
  if (p?.deleted_at) return false;
  if (num(p?.latitude) == null || num(p?.longitude) == null) return false;
  return num(p?.row_number) == null && num(p?.pin_row_number) == null;
}

// ---------- capture evidence ----------
export interface CaptureEvidence {
  pin_id: string;
  captured_at?: string | null;
  horizontal_accuracy_m?: number | null;
  heading_degrees?: number | null;
  heading_observed_at?: string | null;
  pressed_side?: string | null;
  observations?: any;
  geometry_hash?: string | null;
}

/** Count JSONB observation entries that carry a finite coordinate. */
export function countValidObservations(raw: any): number {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return 0; } }
  if (!Array.isArray(v)) return 0;
  return v.filter((o) => {
    if (!o || typeof o !== "object") return false;
    const lat = num(o.latitude ?? o.lat), lng = num(o.longitude ?? o.lng ?? o.lon);
    return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  }).length;
}

/** Latest evidence row per pin. */
export function latestEvidenceByPin(rows: CaptureEvidence[]): Map<string, CaptureEvidence> {
  const m = new Map<string, CaptureEvidence>();
  for (const r of rows) {
    const k = String(r.pin_id);
    const prev = m.get(k);
    if (!prev || String(r.captured_at ?? "") > String(prev.captured_at ?? "")) m.set(k, r);
  }
  return m;
}

// ---------- geometry ----------
type XY = { x: number; y: number };
function projector(origin: LatLng) {
  const kx = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110574;
  return (p: LatLng): XY => ({ x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * ky });
}

export function pointInPolygon(pt: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > pt.lat) !== (b.lat > pt.lat) &&
        pt.lng < ((b.lng - a.lng) * (pt.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

export interface AisleGeometry {
  boundingRows: [number, number] | null;
  aisle: number | null;
  nearestPhysicalRow: number | null;
  clearance: number | null;
  clearanceM: number | null;
  spacingM: number | null;
  rowAxisDeg: number | null;
  leftWhenAlongAxis: number | null;
  outsideRows: boolean;
  /** null = no polygon to check. */
  insidePolygon: boolean | null;
  /** Point projects inside both bounding row segments, clear of row ends. */
  withinRowExtents: boolean | null;
  /** Bounding rows parallel to the block axis (straight-row model holds). */
  rowsParallel: boolean | null;
  /** Geometry problems that rule out a supported candidate. */
  geometryIssues: string[];
  /** Aisle from local point-to-segment offsets of rows whose extent covers the point. */
  localAisle: number | null;
  localBoundingRows: [number, number] | null;
  /** Midpoint/global-normal aisle disagrees with local segment aisle. */
  methodDisagree: boolean | null;
  /** Bounding row lengths differ by >20% (midpoints not comparable). */
  variableLength: boolean | null;
  reason?: string;
}

/** Local aisle: signed perpendicular distance from each row's OWN line, only rows covering the point. */
function localAisleOf(P: { x: number; y: number }, offs: { n: number; a: any; b: any }[], ux: number, uy: number) {
  let left: { n: number; d: number } | null = null, right: { n: number; d: number } | null = null;
  for (const r of offs) {
    let dx = r.b.x - r.a.x, dy = r.b.y - r.a.y;
    const len = Math.hypot(dx, dy); if (!len) continue;
    dx /= len; dy /= len;
    if (dx * ux + dy * uy < 0) { dx = -dx; dy = -dy; }
    const ax = dx === (r.b.x - r.a.x) / len ? r.a : r.b; // start consistent with orientation
    const t = (P.x - ax.x) * dx + (P.y - ax.y) * dy;
    if (t < 0 || t > len) continue;
    const d = dx * (P.y - ax.y) - dy * (P.x - ax.x); // >0: point left of row
    if (d > 0) { if (!right || d < right.d) right = { n: r.n, d }; } // row is to the right
    else if (!left || -d < left.d) left = { n: r.n, d: -d };
  }
  if (!left || !right) return { aisle: null, rows: null };
  const a = Math.min(left.n, right.n), b = Math.max(left.n, right.n);
  return { aisle: b - a === 1 ? (a + b) / 2 : null, rows: [a, b] as [number, number] };
}

/** Distance from a row end treated as headland / endpoint (m). */
export const ROW_END_MARGIN_M = 3;
/** Max angle between a bounding row and the block axis (deg). */
export const MAX_ROW_DIVERGENCE_DEG = 5;

export function aisleGeometry(pt: LatLng, rawRows: any, polygonRaw?: any): AisleGeometry {
  const polygon = polygonRaw == null ? [] : parsePolygonPoints(polygonRaw);
  const insidePolygon = polygon.length >= 3 ? pointInPolygon(pt, polygon) : null;
  const rows = parseRows(rawRows).filter((r) => r.start && r.end && r.number != null);
  const empty: AisleGeometry = {
    boundingRows: null, aisle: null, nearestPhysicalRow: null, clearance: null, clearanceM: null,
    spacingM: null, rowAxisDeg: null, leftWhenAlongAxis: null, outsideRows: false,
    insidePolygon, withinRowExtents: null, rowsParallel: null, geometryIssues: [],
    localAisle: null, localBoundingRows: null, methodDisagree: null, variableLength: null,
  };
  if (rows.length < 2) return { ...empty, reason: "Block has fewer than two mapped rows" };
  const proj = projector(rows[0].start!);
  const s0 = proj(rows[0].start!), e0 = proj(rows[0].end!);
  let ux = e0.x - s0.x, uy = e0.y - s0.y;
  const L = Math.hypot(ux, uy) || 1;
  ux /= L; uy /= L;
  const nx = -uy, ny = ux;
  const P = proj(pt);
  const offs = rows.map((r) => {
    const a = proj(r.start!), b = proj(r.end!);
    return { n: r.number!, a, b, o: ((a.x + b.x) / 2) * nx + ((a.y + b.y) / 2) * ny };
  }).sort((a, b) => a.o - b.o);
  const po = P.x * nx + P.y * ny;
  const axisDeg = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360;
  let nearest = offs[0];
  for (const r of offs) if (Math.abs(r.o - po) < Math.abs(nearest.o - po)) nearest = r;
  if (po < offs[0].o || po > offs[offs.length - 1].o) {
    return { ...empty, nearestPhysicalRow: nearest.n, rowAxisDeg: axisDeg, outsideRows: true,
      geometryIssues: ["GPS outside the outermost mapped rows"],
      reason: "GPS point lies outside the outermost mapped rows" };
  }
  let i = 0;
  while (i < offs.length - 2 && offs[i + 1].o < po) i++;
  const lo = offs[i], hi = offs[i + 1];
  const spacing = hi.o - lo.o || 1;
  const clearanceM = Math.min(po - lo.o, hi.o - po);
  const a = Math.min(lo.n, hi.n), b = Math.max(lo.n, hi.n);
  const consecutive = b - a === 1;
  // Segment-projection checks on the two bounding rows.
  let within = true, parallel = true;
  for (const r of [lo, hi]) {
    let dx = r.b.x - r.a.x, dy = r.b.y - r.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 2 * ROW_END_MARGIN_M + 1) { within = false; continue; }
    dx /= len; dy /= len;
    const along = (P.x - r.a.x) * dx + (P.y - r.a.y) * dy;
    if (along < ROW_END_MARGIN_M || along > len - ROW_END_MARGIN_M) within = false;
    const ang = (Math.acos(Math.min(1, Math.abs(dx * ux + dy * uy))) * 180) / Math.PI;
    if (ang > MAX_ROW_DIVERGENCE_DEG) parallel = false;
  }
  const local = localAisleOf(P, offs, ux, uy);
  const lenOf = (r: any) => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
  const l1 = lenOf(lo), l2 = lenOf(hi);
  const variableLength = Math.max(l1, l2) / Math.max(1e-6, Math.min(l1, l2)) > 1.2;
  const midAisle = consecutive ? (a + b) / 2 : null;
  const methodDisagree = local.aisle != null && midAisle != null ? local.aisle !== midAisle : local.aisle == null ? null : true;
  const issues: string[] = [];
  if (methodDisagree) issues.push(`midpoint aisle ${midAisle ?? "—"} ≠ local segment aisle ${local.aisle ?? "—"} (global projection invalid here)`);
  if (variableLength) issues.push("bounding rows differ >20% in length");
  if (insidePolygon === false) issues.push("GPS outside the current block polygon");
  if (insidePolygon == null) issues.push("block polygon missing");
  if (!within) issues.push("GPS beyond a bounding row's extent or within headland/row-end margin");
  if (!parallel) issues.push("bounding rows diverge (straight-row model does not hold; contour/curved rows unsupported)");
  if (!consecutive) issues.push(`bounding rows ${a} and ${b} not consecutive`);
  return {
    insidePolygon, withinRowExtents: within, rowsParallel: parallel, geometryIssues: issues,
    localAisle: local.aisle, localBoundingRows: local.rows, methodDisagree, variableLength,
    boundingRows: [a, b],
    aisle: consecutive ? (a + b) / 2 : null,
    nearestPhysicalRow: nearest.n,
    clearance: clearanceM / spacing,
    clearanceM,
    spacingM: spacing,
    rowAxisDeg: axisDeg,
    leftWhenAlongAxis: hi.n,
    outsideRows: false,
    reason: consecutive ? undefined : `Bounding rows ${a} and ${b} are not consecutive`,
  };
}

function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** Pair heading + side with one bounding row. Null when unsupported. */
export function pairVineRow(
  g: AisleGeometry, heading: number | null, side: "left" | "right" | null,
): { row: number | null; reason: string } {
  if (!g.boundingRows || g.rowAxisDeg == null || g.leftWhenAlongAxis == null)
    return { row: null, reason: "No bounding aisle" };
  if (heading == null) return { row: null, reason: "No heading recorded" };
  if (!side) return { row: null, reason: "No left/right side recorded" };
  const dAlong = angleDiff(heading, g.rowAxisDeg);
  const dAgainst = angleDiff(heading, (g.rowAxisDeg + 180) % 360);
  const off = Math.min(dAlong, dAgainst);
  if (off > MAX_HEADING_OFF_AXIS_DEG)
    return { row: null, reason: `Heading is ${Math.round(off)}° off the row direction` };
  const other = (r: number) => (g.boundingRows![0] === r ? g.boundingRows![1] : g.boundingRows![0]);
  const leftRow = dAlong <= dAgainst ? g.leftWhenAlongAxis : other(g.leftWhenAlongAxis);
  return { row: side === "left" ? leftRow : other(leftRow), reason: "Heading along rows paired with side" };
}

// ---------- travel direction (NOT device heading) ----------
// Device compass heading is phone orientation and is never used as travel
// direction. Travel must come from qualified GPS movement.
export const MIN_COURSE_SPEED_MPS = 0.8;
export const MAX_COURSE_ACCURACY_M = 5;
export const MAX_OBS_GAP_S = 15;
export const MAX_COURSE_SPREAD_DEG = 20;
export const MIN_DISPLACEMENT_M = 2;
export const MIN_TRACK_SPAN_M = 5;
export const MIN_TRACK_STRAIGHTNESS = 0.9;
/** Travel sources / device heading that differ by more than this conflict. */
export const DIRECTION_CONFLICT_DEG = 30;

export interface TravelEstimate {
  courseDeg: number | null;
  source: "gps_observations" | "trip_track" | null;
  reason: string;
}

const toRad = (d: number) => (d * Math.PI) / 180;
function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function metres(a: LatLng, b: LatLng): number {
  const kx = 111320 * Math.cos(toRad(a.lat));
  return Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * 110574);
}
function circularMean(degs: number[]): { mean: number; spread: number } {
  const sx = degs.reduce((s, d) => s + Math.sin(toRad(d)), 0);
  const cx = degs.reduce((s, d) => s + Math.cos(toRad(d)), 0);
  const mean = ((Math.atan2(sx, cx) * 180) / Math.PI + 360) % 360;
  return { mean, spread: Math.max(...degs.map((d) => angleDiff(d, mean))) };
}

export interface ParsedObservation {
  lat: number; lng: number; t: number | null; course: number | null; speed: number | null; acc: number | null;
}
export function parseObservations(raw: any): ParsedObservation[] {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  const out: ParsedObservation[] = [];
  for (const o of v) {
    if (!o || typeof o !== "object") continue;
    const lat = num(o.latitude), lng = num(o.longitude);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const t = o.observedAt ? Date.parse(o.observedAt) : NaN;
    out.push({ lat, lng, t: Number.isFinite(t) ? t : null, course: num(o.courseDegrees),
      speed: num(o.speedMps), acc: num(o.horizontalAccuracyM) });
  }
  return out;
}

/** Travel course from ≥2 qualified, temporally close, mutually consistent observations. */
export function travelFromObservations(raw: any): TravelEstimate {
  const obs = parseObservations(raw);
  const q = obs.filter((o) => o.t != null && o.course != null && o.course >= 0 &&
    o.speed != null && o.speed >= MIN_COURSE_SPEED_MPS && o.acc != null && o.acc <= MAX_COURSE_ACCURACY_M)
    .sort((a, b) => a.t! - b.t!);
  if (q.length < 2) return { courseDeg: null, source: null,
    reason: `${q.length} qualified GPS course observation(s) (need ≥2 at ≥${MIN_COURSE_SPEED_MPS} m/s, ≤${MAX_COURSE_ACCURACY_M} m)` };
  if ((q[q.length - 1].t! - q[0].t!) / 1000 > MAX_OBS_GAP_S)
    return { courseDeg: null, source: null, reason: "GPS course observations too far apart in time" };
  const { mean, spread } = circularMean(q.map((o) => o.course!));
  if (spread > MAX_COURSE_SPREAD_DEG) return { courseDeg: null, source: null, reason: `GPS courses inconsistent (spread ${Math.round(spread)}°)` };
  const first = q[0], last = q[q.length - 1];
  const disp = metres(first, last);
  if (disp < MIN_DISPLACEMENT_M) return { courseDeg: null, source: null, reason: `GPS displacement ${disp.toFixed(1)} m too small` };
  const db = bearing(first, last);
  if (angleDiff(db, mean) > DIRECTION_CONFLICT_DEG)
    return { courseDeg: null, source: null, reason: "GPS displacement disagrees with reported course" };
  return { courseDeg: mean, source: "gps_observations", reason: `${q.length} qualified GPS observations, ${disp.toFixed(1)} m` };
}

/** Travel bearing from the ordered track around a UNIQUE matching point. */
export function travelFromTrack(pt: LatLng, track: LatLng[]): TravelEstimate {
  const idx: number[] = [];
  track.forEach((q, i) => { if (Math.abs(q.lat - pt.lat) < ANCHOR_EPS_DEG && Math.abs(q.lng - pt.lng) < ANCHOR_EPS_DEG) idx.push(i); });
  if (idx.length !== 1) return { courseDeg: null, source: null, reason: idx.length ? "track point repeated" : "no exact track point" };
  const i = idx[0];
  const walk = (dir: 1 | -1) => {
    let j = i, path = 0;
    while (j + dir >= 0 && j + dir < track.length) {
      path += metres(track[j], track[j + dir]); j += dir;
      if (metres(track[i], track[j]) >= MIN_TRACK_SPAN_M) break;
    }
    return { j, path };
  };
  const back = walk(-1), fwd = walk(1);
  const a = track[back.j], b = track[fwd.j];
  const chord = metres(a, b), path = back.path + fwd.path;
  if (metres(track[i], a) < MIN_TRACK_SPAN_M || metres(track[i], b) < MIN_TRACK_SPAN_M)
    return { courseDeg: null, source: null, reason: `track span < ${MIN_TRACK_SPAN_M} m each side of anchor` };
  if (path <= 0 || chord / path < MIN_TRACK_STRAIGHTNESS)
    return { courseDeg: null, source: null, reason: "track around anchor is not straight (turn?)" };
  return { courseDeg: bearing(a, b), source: "trip_track", reason: `ordered track ${chord.toFixed(0)} m, straight` };
}

// ---------- track anchors ----------
export type TrackAnchor = "unique" | "multiple" | "none" | "unavailable" | "not_loaded" | "no_trip";
export const ANCHOR_EPS_DEG = 1e-7;

export function trackAnchor(pt: LatLng, track: LatLng[]): "unique" | "multiple" | "none" {
  let n = 0;
  for (const q of track) {
    if (Math.abs(q.lat - pt.lat) < ANCHOR_EPS_DEG && Math.abs(q.lng - pt.lng) < ANCHOR_EPS_DEG) n++;
    if (n > 1) return "multiple";
  }
  return n === 1 ? "unique" : "none";
}

export type FailureCategory =
  | "preserved" | "segments_unavailable" | "no_gps" | "missing_block" | "outside_polygon"
  | "outside_rows" | "headland_or_row_end" | "no_aisle" | "geometry_method_conflict"
  | "row_spacing_uncertain" | "direction_conflict" | "no_travel" | "other_review" | "supported";
export const CATEGORY_LABEL: Record<FailureCategory, string> = {
  preserved: "Existing metadata preserved", segments_unavailable: "Segments unreadable",
  no_gps: "No GPS", missing_block: "No saved/unique block", outside_polygon: "Outside current block polygon",
  outside_rows: "Beyond outermost rows", headland_or_row_end: "Headland / row end",
  no_aisle: "No consecutive aisle", geometry_method_conflict: "Midpoint vs local geometry disagree",
  row_spacing_uncertain: "GPS uncertainty vs row spacing", direction_conflict: "Direction conflict",
  no_travel: "No qualified travel direction", other_review: "Other review", supported: "Supported candidate",
};

// ---------- per-pin assessment ----------
/** null map = query unavailable (permission or error). */
export interface RecoveryEvidence {
  paddocks: any[];
  evidence: Map<string, CaptureEvidence> | null;
  segments: Map<string, { row_number: number; segment_number: number | null }[]> | null;
  trips: Map<string, LatLng[]> | null | "not_loaded";
  /** Trip ids the trips query attempted but could not read. */
}

export type EvidenceState = "present" | "none" | "unavailable";

export interface RecoveryRow {
  pin: any;
  id: string;
  title: string;
  mode: string;
  createdAt: string | null;
  lat: number | null;
  lng: number | null;
  savedBlockName: string | null;
  suggestedBlockName: string | null;
  suggestedBlockNote: string | null;
  geometrySource: string;
  storedHeading: number | null;
  evidenceHeading: number | null;
  headingFresh: boolean | null;
  side: "left" | "right" | null;
  pressedSide: "left" | "right" | null;
  accuracy: number | null;
  evidenceState: EvidenceState;
  observationCount: number | null;
  tripId: string | null;
  trackAnchor: TrackAnchor;
  segmentsState: EvidenceState;
  segmentsLabel: string | null;
  existingMeta: string | null;
  geometry: AisleGeometry | null;
  travel: TravelEstimate;
  obsTravel: TravelEstimate | null;
  trackTravel: TravelEstimate | null;
  /** Device heading vs travel difference (deg), when both exist. */
  headingVsTravelDeg: number | null;
  directionConflict: string | null;
  /** Why not resolvable / review, with CURRENT evidence (not inherently impossible). */
  category: FailureCategory;
  suggestedVineRow: number | null;
  reason: string;
  status: RecoveryStatus;
}

export function assessPin(pin: any, ev: RecoveryEvidence): RecoveryRow {
  const id = String(pin.id);
  const lat = num(pin.latitude), lng = num(pin.longitude);
  const padById = new Map(ev.paddocks.map((p) => [p.id, p]));
  const saved = pin.paddock_id ? padById.get(pin.paddock_id) ?? null : null;
  let block = saved;
  let suggestedBlockName: string | null = null;
  let suggestedBlockNote: string | null = null;
  if (!saved && lat != null && lng != null) {
    const hits = ev.paddocks.filter((p) => {
      const poly = parsePolygonPoints(p.polygon_points);
      return poly.length >= 3 && pointInPolygon({ lat, lng }, poly);
    });
    if (hits.length === 1) {
      block = hits[0];
      suggestedBlockName = hits[0].name ?? "Unnamed block";
      suggestedBlockNote = "Suggestion only: GPS inside one current block polygon";
    } else {
      suggestedBlockNote = hits.length ? `Ambiguous: inside ${hits.length} blocks` : "No current block polygon contains the GPS point";
    }
  }

  // Evidence
  const evRow = ev.evidence ? ev.evidence.get(id) ?? null : null;
  const evidenceState: EvidenceState = ev.evidence == null ? "unavailable" : evRow ? "present" : "none";
  const accuracy = evRow ? num(evRow.horizontal_accuracy_m) : null;
  const evidenceHeading = evRow ? num(evRow.heading_degrees) : null;
  let headingFresh: boolean | null = null;
  if (evRow?.heading_observed_at && evRow?.captured_at) {
    const dt = Math.abs(Date.parse(evRow.captured_at) - Date.parse(evRow.heading_observed_at)) / 1000;
    headingFresh = Number.isFinite(dt) ? dt <= MAX_HEADING_AGE_S : null;
  }
  const observationCount = evRow ? countValidObservations(evRow.observations) : evidenceState === "none" ? 0 : null;
  const pressedSide = evRow ? normSide(evRow.pressed_side) : null;
  const storedHeading = num(pin.heading);
  const side = normSide(pin.pin_side ?? pin.side);

  // Trip
  const tripId = pin.trip_id ? String(pin.trip_id) : null;
  let anchor: TrackAnchor = "no_trip";
  if (tripId) {
    if (ev.trips === "not_loaded") anchor = "not_loaded";
    else if (ev.trips == null) anchor = "unavailable";
    else {
      const pts = ev.trips.get(tripId);
      anchor = !pts ? "unavailable" : lat != null && lng != null ? trackAnchor({ lat, lng }, pts) : "none";
    }
  }

  // Existing metadata
  const segs = ev.segments ? ev.segments.get(id) ?? [] : null;
  const segmentsState: EvidenceState = segs == null ? "unavailable" : segs.length ? "present" : "none";
  const segmentsLabel = segs?.length
    ? segs.map((s) => `Row ${s.row_number}${s.segment_number != null ? ` seg ${s.segment_number}` : ""}`).join(", ")
    : null;
  const driving = num(pin.driving_row_number);
  const meta: string[] = [];
  if (segmentsLabel) meta.push(`Saved segments: ${segmentsLabel}`);
  if (driving != null) meta.push(`Driving row: ${driving}`);
  if (pin.location_scope === "row") meta.push("location_scope = row");
  const existingMeta = meta.length ? meta.join(" · ") : null;

  const base = {
    pin, id, title: pin.title ?? pin.button_name ?? "(untitled)", mode: pin.mode ?? "—",
    createdAt: pin.created_at ?? null, lat, lng,
    savedBlockName: saved ? saved.name ?? "Unnamed block" : null,
    suggestedBlockName, suggestedBlockNote,
    geometrySource: block ? GEOMETRY_SOURCE_LABEL : "None",
    storedHeading, evidenceHeading, headingFresh, side, pressedSide, accuracy, evidenceState,
    observationCount, tripId, trackAnchor: anchor, segmentsState, segmentsLabel, existingMeta,
  };
  const geometry = block && lat != null && lng != null ? aisleGeometry({ lat, lng }, block.rows, block.polygon_points) : null;

  // Travel direction: GPS movement only, never device compass.
  const obsTravel = evRow ? travelFromObservations(evRow.observations) : null;
  let trackTravel: TravelEstimate | null = null;
  if (tripId && ev.trips && ev.trips !== "not_loaded" && lat != null && lng != null) {
    const pts = ev.trips.get(tripId);
    if (pts) trackTravel = travelFromTrack({ lat, lng }, pts);
  }
  let travel: TravelEstimate = { courseDeg: null, source: null, reason: "no qualified GPS travel direction" };
  let directionConflict: string | null = null;
  const o = obsTravel?.courseDeg ?? null, t = trackTravel?.courseDeg ?? null;
  if (o != null && t != null && angleDiff(o, t) > DIRECTION_CONFLICT_DEG) {
    directionConflict = `GPS observations (${Math.round(o)}°) and trip track (${Math.round(t)}°) disagree`;
  } else if (o != null) travel = obsTravel!;
  else if (t != null) travel = trackTravel!;
  const devHeading = evidenceHeading ?? storedHeading;
  const headingVsTravelDeg = devHeading != null && travel.courseDeg != null ? angleDiff(devHeading, travel.courseDeg) : null;
  const headingNote = headingVsTravelDeg != null && headingVsTravelDeg > DIRECTION_CONFLICT_DEG
    ? `device heading differs from travel by ${Math.round(headingVsTravelDeg)}° (phone orientation ≠ travel)` : null;

  const out = (status: RecoveryStatus, reason: string, suggestedVineRow: number | null = null, category: FailureCategory = "other_review"): RecoveryRow =>
    ({ ...base, geometry, travel, obsTravel, trackTravel, headingVsTravelDeg,
      directionConflict: directionConflict ?? headingNote, suggestedVineRow, status, reason, category });

  if (existingMeta) return out("preserve_existing", "Existing row metadata — preserved, never auto-filled", null, "preserved");
  // Fail closed: cannot rule out saved segments.
  if (segmentsState === "unavailable")
    return out("requires_review", "Saved row segments unreadable (permission unknown) — cannot rule out existing metadata", null, "segments_unavailable");
  if (lat == null || lng == null) return out("not_resolvable", "No GPS", null, "no_gps");
  if (!block) return out("not_resolvable", suggestedBlockNote ?? "No block", null, "missing_block");
  if (!geometry?.boundingRows || geometry.aisle == null)
    return out("not_resolvable", geometry?.reason ?? "No aisle", null, geometry?.outsideRows ? "outside_rows" : "no_aisle");

  if (geometry.insidePolygon === false || geometry.withinRowExtents === false)
    return out("not_resolvable", geometry.geometryIssues.join("; "), null,
      geometry.insidePolygon === false ? "outside_polygon" : "headland_or_row_end");
  const pair = pairVineRow(geometry, travel.courseDeg, side);
  const issues: string[] = ["current geometry only", ...geometry.geometryIssues];
  if (!saved) issues.push("block is a suggestion");
  if (evidenceState === "unavailable") issues.push("capture evidence unavailable");
  else if (evidenceState === "none") issues.push("no capture evidence");
  if (accuracy == null) issues.push("horizontal accuracy unknown");
  else if (geometry.clearanceM != null && accuracy >= geometry.clearanceM)
    issues.push(`accuracy ±${accuracy.toFixed(1)} m ≥ ${geometry.clearanceM.toFixed(1)} m to nearest row line`);
  if ((geometry.clearance ?? 0) < MIN_ROW_CLEARANCE_FRACTION) issues.push("GPS near a vine row line (aisle ambiguous)");
  if (travel.courseDeg == null) issues.push(directionConflict ?? `no reliable travel direction (${obsTravel?.reason ?? "no observations"}${trackTravel ? `; ${trackTravel.reason}` : ""})`);
  if (headingNote) issues.push(headingNote);
  if (pressedSide && side && pressedSide !== side) issues.push("pressed side conflicts with pin side");
  if (pair.row == null && travel.courseDeg != null) issues.push(pair.reason);
  if (anchor !== "unique") issues.push(`track anchor: ${anchor.replace("_", " ")}`);

  // "current geometry only" is always present → supported only if it's the sole caveat.
  const corroborated = issues.length === 1;
  const category: FailureCategory = corroborated ? "supported"
    : geometry.methodDisagree || geometry.rowsParallel === false || geometry.variableLength ? "geometry_method_conflict"
    : directionConflict || headingNote ? "direction_conflict"
    : travel.courseDeg == null ? "no_travel"
    : issues.some((x) => /accuracy|near a vine row/.test(x)) ? "row_spacing_uncertain" : "other_review";
  return out(
    corroborated ? "supported_candidate" : "requires_review",
    corroborated
      ? `Travel from ${travel.source} + side, accuracy inside aisle clearance, unique track anchor; current geometry only — still needs human review`
      : issues.join("; "),
    // Only show a candidate row when travel direction is corroborated.
    travel.courseDeg != null ? pair.row : null,
    category,
  );
}

// ---------- audit summary (for fixtures / snapshot) ----------
export interface AuditSummary {
  activeGps: number; missing: number; withPaddock: number; withoutPaddock: number;
  noBlockInsideOne: number; noBlockOutside: number; tripLinks: number; withEvidence: number;
  existingMeta: number; withHeading: number; withSide: number; uniqueAnchors: number; anchorTrips: number;
}
export function auditSummary(pins: any[], ev: RecoveryEvidence): AuditSummary {
  const active = pins.filter((p) => !p.deleted_at && num(p.latitude) != null && num(p.longitude) != null);
  const missing = active.filter(isMissingRowPin);
  const rows = missing.map((p) => assessPin(p, ev));
  const anchorTrips = new Set(rows.filter((r) => r.trackAnchor === "unique").map((r) => r.tripId));
  return {
    activeGps: active.length,
    missing: missing.length,
    withPaddock: missing.filter((p) => p.paddock_id).length,
    withoutPaddock: missing.filter((p) => !p.paddock_id).length,
    noBlockInsideOne: rows.filter((r) => !r.savedBlockName && r.suggestedBlockName).length,
    noBlockOutside: rows.filter((r) => !r.savedBlockName && !r.suggestedBlockName).length,
    tripLinks: rows.filter((r) => r.tripId).length,
    withEvidence: rows.filter((r) => r.evidenceState === "present").length,
    existingMeta: rows.filter((r) => r.existingMeta).length,
    withHeading: rows.filter((r) => r.storedHeading != null).length,
    withSide: rows.filter((r) => r.side != null).length,
    uniqueAnchors: rows.filter((r) => r.trackAnchor === "unique").length,
    anchorTrips: anchorTrips.size,
  };
}

// ---------- validation against known pins ----------
export interface ValidationResult {
  total: number; adjacencyValid: number; aisleMatch: number; aisleEvaluated: number;
  vineRowEvaluated: number; vineRowMatch: number; nearestDiffersFromSaved: number; falsePositives: number;
  withSavedBlock: number;
  /** Local segment aisle evaluated / matched saved. */
  localEvaluated: number; localMatch: number; methodDisagree: number;
  /** Raw vs previously-snapped coordinates (never overwritten). */
  withSnapped: number; snappedEvaluated: number; snappedMatch: number; meanRawSnapM: number | null;
  perBlock: BlockValidation[];
}

export interface BlockValidation {
  paddockId: string; name: string; total: number; adjacent: number; evaluated: number; matched: number;
  /** current-map aisle − saved aisle → count (keys "-2","-1","0","+1","+2", "other"). */
  diffs: Record<string, number>;
  /** capture month (YYYY-MM) → evaluated/matched. */
  eras: Record<string, { evaluated: number; matched: number }>;
  localEvaluated: number; localMatched: number; methodDisagree: number; snappedMatched: number; snappedEvaluated: number;
}

export function diffKey(d: number): string {
  if (!Number.isFinite(d) || Math.abs(d % 1) > 1e-9 || Math.abs(d) > 2) return "other";
  return d === 0 ? "0" : d > 0 ? `+${d}` : String(d);
}

export function validateKnownPins(pins: any[], paddocks: any[]): ValidationResult {
  const padById = new Map(paddocks.map((p) => [p.id, p]));
  const r: ValidationResult = { total: 0, adjacencyValid: 0, aisleMatch: 0, aisleEvaluated: 0,
    vineRowEvaluated: 0, vineRowMatch: 0, nearestDiffersFromSaved: 0, falsePositives: 0, withSavedBlock: 0,
    localEvaluated: 0, localMatch: 0, methodDisagree: 0, withSnapped: 0, snappedEvaluated: 0, snappedMatch: 0,
    meanRawSnapM: null, perBlock: [] };
  const blocks = new Map<string, BlockValidation>();
  let snapSum = 0;
  for (const p of pins) {
    const saved = num(p.pin_row_number) ?? num(p.row_number);
    const aisle = num(p.driving_row_number);
    const lat = num(p.latitude), lng = num(p.longitude);
    if (p.deleted_at || saved == null || aisle == null || lat == null || lng == null) continue;
    if (Math.abs(aisle % 1) !== 0.5) continue;
    r.total++;
    if (Math.abs(saved - aisle) === 0.5) r.adjacencyValid++;
    const block = p.paddock_id ? padById.get(p.paddock_id) : null;
    if (!block) continue;
    r.withSavedBlock++;
    const bv = blocks.get(block.id) ?? { paddockId: block.id, name: block.name ?? "Unnamed", total: 0, adjacent: 0,
      evaluated: 0, matched: 0, diffs: {}, eras: {}, localEvaluated: 0, localMatched: 0, methodDisagree: 0,
      snappedMatched: 0, snappedEvaluated: 0 };
    blocks.set(block.id, bv);
    bv.total++;
    if (Math.abs(saved - aisle) === 0.5) bv.adjacent++;
    const g = aisleGeometry({ lat, lng }, block.rows, block.polygon_points);
    const era = String(p.created_at ?? "").slice(0, 7) || "unknown";
    if (g.aisle != null) {
      r.aisleEvaluated++; bv.evaluated++;
      const ok = g.aisle === aisle;
      if (ok) { r.aisleMatch++; bv.matched++; }
      const k = diffKey(g.aisle - aisle); bv.diffs[k] = (bv.diffs[k] ?? 0) + 1;
      const e = (bv.eras[era] ??= { evaluated: 0, matched: 0 }); e.evaluated++; if (ok) e.matched++;
    }
    if (g.localAisle != null) { r.localEvaluated++; bv.localEvaluated++; if (g.localAisle === aisle) { r.localMatch++; bv.localMatched++; } }
    if (g.methodDisagree) { r.methodDisagree++; bv.methodDisagree++; }
    const sl = num(p.snapped_latitude), sg = num(p.snapped_longitude);
    if (sl != null && sg != null) {
      r.withSnapped++;
      snapSum += metres({ lat, lng }, { lat: sl, lng: sg });
      const gs = aisleGeometry({ lat: sl, lng: sg }, block.rows, block.polygon_points);
      if (gs.aisle != null) { r.snappedEvaluated++; bv.snappedEvaluated++; if (gs.aisle === aisle) { r.snappedMatch++; bv.snappedMatched++; } }
    }
    if (g.nearestPhysicalRow != null && g.nearestPhysicalRow !== saved) r.nearestDiffersFromSaved++;
    // DIAGNOSTIC ONLY: pairs the stored device heading (phone orientation),
    // which is NOT travel direction. Shows how often compass pairing is wrong.
    const pr = pairVineRow(g, num(p.heading), normSide(p.pin_side ?? p.side));
    if (pr.row != null) {
      r.vineRowEvaluated++;
      if (pr.row === saved) r.vineRowMatch++; else r.falsePositives++;
    }
  }
  r.meanRawSnapM = r.withSnapped ? snapSum / r.withSnapped : null;
  r.perBlock = [...blocks.values()].sort((a, b) => a.name.localeCompare(b.name));
  return r;
}

// ---------- trip-evidence summary ----------
export interface TrackSummary {
  linked: number; unique: number; multiple: number; none: number; failed: number; notLoaded: number;
  travelFromTrack: number; travelFromObs: number; headingConflicts: number; sourceConflicts: number;
  transitions: Record<string, number>;
  categories: Record<string, number>;
}
export function trackSummary(before: RecoveryRow[], after: RecoveryRow[]): TrackSummary {
  const s: TrackSummary = { linked: 0, unique: 0, multiple: 0, none: 0, failed: 0, notLoaded: 0,
    travelFromTrack: 0, travelFromObs: 0, headingConflicts: 0, sourceConflicts: 0, transitions: {}, categories: {} };
  const prev = new Map(before.map((r) => [r.id, r.status]));
  for (const r of after) {
    s.categories[r.category] = (s.categories[r.category] ?? 0) + 1;
    if (r.travel.source === "gps_observations") s.travelFromObs++;
    if (r.travel.source === "trip_track") s.travelFromTrack++;
    if (r.directionConflict?.includes("device heading")) s.headingConflicts++;
    if (r.directionConflict?.includes("disagree")) s.sourceConflicts++;
    if (!r.tripId) continue;
    s.linked++;
    if (r.trackAnchor === "unique") s.unique++;
    else if (r.trackAnchor === "multiple") s.multiple++;
    else if (r.trackAnchor === "none") s.none++;
    else if (r.trackAnchor === "not_loaded") s.notLoaded++;
    else s.failed++;
    const p = prev.get(r.id);
    if (p && p !== r.status) { const k = `${p}→${r.status}`; s.transitions[k] = (s.transitions[k] ?? 0) + 1; }
  }
  return s;
}

// ---------- CSV (client-local, non-authoritative) ----------
export function recoveryCsv(rows: RecoveryRow[], notes: Record<string, string>): string {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["NON_AUTHORITATIVE_CANDIDATE", "pin_id", "title", "mode", "created_at", "latitude", "longitude",
    "saved_block", "suggested_block", "geometry_source", "stored_heading", "evidence_heading", "heading_fresh",
    "side", "pressed_side", "accuracy_m", "evidence", "valid_observations", "trip_id", "track_anchor",
    "saved_segments", "existing_metadata", "nearest_physical_row", "bounding_rows", "suggested_driving_aisle",
    "travel_course", "travel_source", "heading_vs_travel_deg", "direction_conflict", "suggested_vine_row", "status", "reason", "review_note"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      "yes", r.id, r.title, r.mode, r.createdAt, r.lat, r.lng, r.savedBlockName, r.suggestedBlockName,
      r.geometrySource, r.storedHeading, r.evidenceHeading, r.headingFresh, r.side, r.pressedSide, r.accuracy,
      r.evidenceState, r.observationCount, r.tripId, r.trackAnchor,
      r.segmentsState === "unavailable" ? "unavailable" : r.segmentsLabel, r.existingMeta,
      r.geometry?.nearestPhysicalRow, r.geometry?.boundingRows?.join("|"), r.geometry?.aisle,
      r.travel.courseDeg?.toFixed(1), r.travel.source, r.headingVsTravelDeg?.toFixed(1), r.directionConflict,
      r.suggestedVineRow, STATUS_LABEL[r.status], r.reason, notes[r.id] ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
