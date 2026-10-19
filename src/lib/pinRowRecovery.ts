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
  reason?: string;
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
  const issues: string[] = [];
  if (insidePolygon === false) issues.push("GPS outside the current block polygon");
  if (insidePolygon == null) issues.push("block polygon missing");
  if (!within) issues.push("GPS beyond a bounding row's extent or within headland/row-end margin");
  if (!parallel) issues.push("bounding rows diverge (straight-row model does not hold; contour/curved rows unsupported)");
  if (!consecutive) issues.push(`bounding rows ${a} and ${b} not consecutive`);
  return {
    insidePolygon, withinRowExtents: within, rowsParallel: parallel, geometryIssues: issues,
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

  const out = (status: RecoveryStatus, reason: string, suggestedVineRow: number | null = null): RecoveryRow =>
    ({ ...base, geometry, travel, obsTravel, trackTravel, headingVsTravelDeg,
      directionConflict: directionConflict ?? headingNote, suggestedVineRow, status, reason });

  if (existingMeta) return out("preserve_existing", "Existing row metadata — preserved, never auto-filled");
  // Fail closed: cannot rule out saved segments.
  if (segmentsState === "unavailable")
    return out("requires_review", "Saved row segments unreadable (permission unknown) — cannot rule out existing metadata");
  if (lat == null || lng == null) return out("not_resolvable", "No GPS");
  if (!block) return out("not_resolvable", suggestedBlockNote ?? "No block");
  if (!geometry?.boundingRows || geometry.aisle == null)
    return out("not_resolvable", geometry?.reason ?? "No aisle");

  if (geometry.insidePolygon === false || geometry.withinRowExtents === false)
    return out("not_resolvable", geometry.geometryIssues.join("; "));
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
  return out(
    corroborated ? "supported_candidate" : "requires_review",
    corroborated
      ? `Travel from ${travel.source} + side, accuracy inside aisle clearance, unique track anchor; current geometry only — still needs human review`
      : issues.join("; "),
    // Only show a candidate row when travel direction is corroborated.
    travel.courseDeg != null ? pair.row : null,
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
}

export function validateKnownPins(pins: any[], paddocks: any[]): ValidationResult {
  const padById = new Map(paddocks.map((p) => [p.id, p]));
  const r: ValidationResult = { total: 0, adjacencyValid: 0, aisleMatch: 0, aisleEvaluated: 0,
    vineRowEvaluated: 0, vineRowMatch: 0, nearestDiffersFromSaved: 0, falsePositives: 0, withSavedBlock: 0 };
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
    const g = aisleGeometry({ lat, lng }, block.rows, block.polygon_points);
    if (g.aisle != null) { r.aisleEvaluated++; if (g.aisle === aisle) r.aisleMatch++; }
    if (g.nearestPhysicalRow != null && g.nearestPhysicalRow !== saved) r.nearestDiffersFromSaved++;
    // DIAGNOSTIC ONLY: pairs the stored device heading (phone orientation),
    // which is NOT travel direction. Shows how often compass pairing is wrong.
    const pr = pairVineRow(g, num(p.heading), normSide(p.pin_side ?? p.side));
    if (pr.row != null) {
      r.vineRowEvaluated++;
      if (pr.row === saved) r.vineRowMatch++; else r.falsePositives++;
    }
  }
  return r;
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
