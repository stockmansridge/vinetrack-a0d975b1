// Stage 1 — Existing Pin Row Recovery (REVIEW ONLY, NON-MUTATING).
//
// Pure client-side projections over data already readable by the signed-in
// System Admin. Nothing here writes, confirms or queues anything. Every
// output is a NON-AUTHORITATIVE candidate. Never call a result "confirmed".
//
// Key rule: the nearest physical vine row is NOT the observed/selected row.
// A suggested vine row is only produced when the pin's heading is clearly
// along the rows AND a left/right side is recorded, so the side can be paired
// with one of the two rows bounding the driving aisle.
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

/** Max horizontal accuracy (m) for a supported candidate. */
export const MAX_SUPPORTED_ACCURACY_M = 5;
/** Heading must be within this angle of the row axis (degrees). */
export const MAX_HEADING_OFF_AXIS_DEG = 30;
/** Pins closer than this to a vine row line are ambiguous between aisles. */
export const MIN_ROW_CLEARANCE_FRACTION = 0.15;

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pick = (o: any, keys: string[]): any => {
  for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k];
  return null;
};

export function pinHeading(p: any): number | null {
  return num(pick(p, ["heading", "heading_degrees", "heading_deg", "course", "bearing", "true_heading"]));
}
export function pinAccuracy(p: any): number | null {
  return num(pick(p, ["horizontal_accuracy", "horizontal_accuracy_m", "gps_accuracy", "accuracy_m", "accuracy"]));
}
export function pinSideRaw(p: any): "left" | "right" | null {
  const s = String(pick(p, ["pin_side", "side"]) ?? "").toLowerCase();
  if (s.startsWith("l")) return "left";
  if (s.startsWith("r")) return "right";
  return null;
}
export function pinTripId(p: any): string | null {
  const v = pick(p, ["trip_id", "source_trip_id", "linked_trip_id"]);
  return v ? String(v) : null;
}
export function pinSegmentsRaw(p: any): any[] {
  const raw = pick(p, ["pin_row_segments", "row_segments"]);
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  return Array.isArray(v) ? v : [];
}

/** Missing queue: live GPS pin with neither legacy nor canonical row number. */
export function isMissingRowPin(p: any): boolean {
  if (p?.deleted_at) return false;
  if (num(p?.latitude) == null || num(p?.longitude) == null) return false;
  return num(p?.row_number) == null && num(p?.pin_row_number) == null;
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
  /** Bounding rows, ordered [lower number, higher number]. */
  boundingRows: [number, number] | null;
  aisle: number | null;
  nearestPhysicalRow: number | null;
  /** Fraction of spacing from nearest row (0 = on the row line, 0.5 = aisle centre). */
  clearance: number | null;
  /** Row axis bearing in degrees (0 = north), from lower to higher row end. */
  rowAxisDeg: number | null;
  /** Row number to the LEFT when travelling along +axis. */
  leftWhenAlongAxis: number | null;
  outsideRows: boolean;
  reason?: string;
}

export function aisleGeometry(pt: LatLng, rawRows: any): AisleGeometry {
  const rows = parseRows(rawRows).filter((r) => r.start && r.end && r.number != null);
  const empty: AisleGeometry = {
    boundingRows: null, aisle: null, nearestPhysicalRow: null, clearance: null,
    rowAxisDeg: null, leftWhenAlongAxis: null, outsideRows: false,
  };
  if (rows.length < 2) return { ...empty, reason: "Block has fewer than two mapped rows" };
  const proj = projector(rows[0].start!);
  const s0 = proj(rows[0].start!), e0 = proj(rows[0].end!);
  let ux = e0.x - s0.x, uy = e0.y - s0.y;
  const L = Math.hypot(ux, uy) || 1;
  ux /= L; uy /= L;
  // Normal (left of +axis).
  const nx = -uy, ny = ux;
  const P = proj(pt);
  const offs = rows.map((r) => {
    const a = proj(r.start!), b = proj(r.end!);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return { n: r.number!, o: mx * nx + my * ny };
  }).sort((a, b) => a.o - b.o);
  const po = P.x * nx + P.y * ny;
  const axisDeg = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360;
  let nearest = offs[0];
  for (const r of offs) if (Math.abs(r.o - po) < Math.abs(nearest.o - po)) nearest = r;
  if (po < offs[0].o || po > offs[offs.length - 1].o) {
    return { ...empty, nearestPhysicalRow: nearest.n, rowAxisDeg: axisDeg, outsideRows: true,
      reason: "GPS point lies outside the outermost mapped rows" };
  }
  let i = 0;
  while (i < offs.length - 2 && offs[i + 1].o < po) i++;
  const lo = offs[i], hi = offs[i + 1];
  const spacing = hi.o - lo.o || 1;
  const clearance = Math.min(po - lo.o, hi.o - po) / spacing;
  const a = Math.min(lo.n, hi.n), b = Math.max(lo.n, hi.n);
  const consecutive = b - a === 1;
  return {
    boundingRows: [a, b],
    aisle: consecutive ? (a + b) / 2 : null,
    nearestPhysicalRow: nearest.n,
    clearance,
    rowAxisDeg: axisDeg,
    // Higher offset = left of +axis.
    leftWhenAlongAxis: hi.n,
    outsideRows: false,
    reason: consecutive ? undefined : `Bounding rows ${a} and ${b} are not consecutive`,
  };
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/** Pair heading + side with one bounding row. Null when unsupported. */
export function pairVineRow(
  g: AisleGeometry, heading: number | null, side: "left" | "right" | null,
): { row: number | null; reason: string } {
  if (!g.boundingRows || g.rowAxisDeg == null || g.leftWhenAlongAxis == null)
    return { row: null, reason: "No bounding aisle" };
  if (heading == null) return { row: null, reason: "No original heading recorded" };
  if (!side) return { row: null, reason: "No left/right side recorded" };
  const dAlong = angleDiff(heading, g.rowAxisDeg);
  const dAgainst = angleDiff(heading, (g.rowAxisDeg + 180) % 360);
  const off = Math.min(dAlong, dAgainst);
  if (off > MAX_HEADING_OFF_AXIS_DEG)
    return { row: null, reason: `Heading is ${Math.round(off)}° off the row direction` };
  const leftRow = dAlong <= dAgainst
    ? g.leftWhenAlongAxis
    : (g.boundingRows[0] === g.leftWhenAlongAxis ? g.boundingRows[1] : g.boundingRows[0]);
  const rightRow = leftRow === g.boundingRows[0] ? g.boundingRows[1] : g.boundingRows[0];
  return { row: side === "left" ? leftRow : rightRow, reason: "Heading along rows and side pair with one bounding row" };
}

// ---------- per-pin assessment ----------
export interface RecoveryEvidence {
  paddocks: any[];
  captureCounts: Map<string, number> | null; // null = unavailable
  trips: Map<string, LatLng[]> | null; // null = not loaded / unavailable
}

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
  heading: number | null;
  side: "left" | "right" | null;
  accuracy: number | null;
  captureCount: number | null;
  tripId: string | null;
  trackAnchor: "exact" | "none" | "unavailable" | "no_trip";
  existingMeta: string | null;
  geometry: AisleGeometry | null;
  suggestedVineRow: number | null;
  reason: string;
  status: RecoveryStatus;
}

const EXACT_EPS = 1e-7;

export function assessPin(pin: any, ev: RecoveryEvidence): RecoveryRow {
  const lat = num(pin.latitude), lng = num(pin.longitude);
  const padById = new Map(ev.paddocks.map((p) => [p.id, p]));
  const saved = pin.paddock_id ? padById.get(pin.paddock_id) : null;
  let block = saved ?? null;
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
      suggestedBlockNote = "Suggestion: GPS inside current block polygon";
    } else {
      suggestedBlockNote = hits.length ? `Ambiguous: inside ${hits.length} blocks` : "No current block polygon contains the GPS point";
    }
  }
  const heading = pinHeading(pin), side = pinSideRaw(pin), accuracy = pinAccuracy(pin);
  const tripId = pinTripId(pin);
  let trackAnchor: RecoveryRow["trackAnchor"] = "no_trip";
  if (tripId) {
    if (!ev.trips) trackAnchor = "unavailable";
    else {
      const pts = ev.trips.get(tripId);
      if (!pts) trackAnchor = "unavailable";
      else trackAnchor = lat != null && lng != null &&
        pts.some((q) => Math.abs(q.lat - lat) < EXACT_EPS && Math.abs(q.lng - lng) < EXACT_EPS) ? "exact" : "none";
    }
  }
  const segs = pinSegmentsRaw(pin);
  const driving = num(pin.driving_row_number);
  const metaParts: string[] = [];
  if (segs.length) metaParts.push(`Row segments: ${segs.map((s: any) => s?.row_number ?? s?.row ?? "?").join(", ")}`);
  if (driving != null) metaParts.push(`Driving row: ${driving}`);
  const existingMeta = metaParts.length ? metaParts.join(" · ") : null;

  const base = {
    pin, id: String(pin.id), title: pin.title ?? pin.button_name ?? "(untitled)", mode: pin.mode ?? "—",
    createdAt: pin.created_at ?? null, lat, lng,
    savedBlockName: saved ? saved.name ?? "Unnamed block" : null,
    suggestedBlockName, suggestedBlockNote,
    geometrySource: block
      ? "Current block geometry (historical capture-time geometry not available to Portal)"
      : "None",
    heading, side, accuracy,
    captureCount: ev.captureCounts ? ev.captureCounts.get(String(pin.id)) ?? 0 : null,
    tripId, trackAnchor, existingMeta,
  };

  const geometry = block && lat != null && lng != null ? aisleGeometry({ lat, lng }, block.rows) : null;

  if (existingMeta) {
    return { ...base, geometry, suggestedVineRow: null, status: "preserve_existing",
      reason: "Existing row metadata recorded — preserved, no auto-fill" };
  }
  if (lat == null || lng == null) return { ...base, geometry, suggestedVineRow: null, status: "not_resolvable", reason: "No GPS" };
  if (!block) return { ...base, geometry, suggestedVineRow: null, status: "not_resolvable", reason: suggestedBlockNote ?? "No block" };
  if (!geometry?.boundingRows || geometry.aisle == null)
    return { ...base, geometry, suggestedVineRow: null, status: "not_resolvable", reason: geometry?.reason ?? "No aisle" };

  const pair = pairVineRow(geometry, heading, side);
  const conflicts: string[] = [];
  if (!saved) conflicts.push("block is a suggestion only");
  if (accuracy == null) conflicts.push("horizontal accuracy unknown");
  else if (accuracy > MAX_SUPPORTED_ACCURACY_M) conflicts.push(`accuracy ${accuracy.toFixed(1)} m > ${MAX_SUPPORTED_ACCURACY_M} m`);
  if ((geometry.clearance ?? 0) < MIN_ROW_CLEARANCE_FRACTION) conflicts.push("GPS is close to a vine row line (aisle ambiguous)");
  if (pair.row == null) conflicts.push(pair.reason);
  if (trackAnchor === "none") conflicts.push("pin does not match an ordered track point");

  const status: RecoveryStatus = conflicts.length ? "requires_review" : "supported_candidate";
  return {
    ...base, geometry, suggestedVineRow: pair.row, status,
    reason: conflicts.length ? conflicts.join("; ") : `${pair.reason}; current geometry only`,
  };
}

// ---------- validation against known pins ----------
export interface ValidationResult {
  total: number;
  adjacencyValid: number; // |saved vine row − saved aisle| = 0.5
  aisleMatch: number; // geometric aisle == saved driving row
  aisleEvaluated: number;
  vineRowEvaluated: number; // pairing produced a row
  vineRowMatch: number;
  nearestDiffersFromSaved: number;
  falsePositives: number; // supported-quality pairing that disagrees
  samples: { id: string; title: string; saved: number; aisle: number | null; geoAisle: number | null; nearest: number | null; paired: number | null }[];
}

export function validateKnownPins(pins: any[], paddocks: any[]): ValidationResult {
  const padById = new Map(paddocks.map((p) => [p.id, p]));
  const r: ValidationResult = { total: 0, adjacencyValid: 0, aisleMatch: 0, aisleEvaluated: 0,
    vineRowEvaluated: 0, vineRowMatch: 0, nearestDiffersFromSaved: 0, falsePositives: 0, samples: [] };
  for (const p of pins) {
    const saved = num(p.pin_row_number) ?? num(p.row_number);
    const aisle = num(p.driving_row_number);
    const lat = num(p.latitude), lng = num(p.longitude);
    if (p.deleted_at || saved == null || aisle == null || lat == null || lng == null) continue;
    if (Math.abs(aisle % 1) !== 0.5) continue;
    r.total++;
    if (Math.abs(saved - aisle) === 0.5) r.adjacencyValid++;
    const block = p.paddock_id ? padById.get(p.paddock_id) : null;
    let geoAisle: number | null = null, nearest: number | null = null, paired: number | null = null;
    if (block) {
      const g = aisleGeometry({ lat, lng }, block.rows);
      geoAisle = g.aisle; nearest = g.nearestPhysicalRow;
      if (g.aisle != null) { r.aisleEvaluated++; if (g.aisle === aisle) r.aisleMatch++; }
      if (nearest != null && nearest !== saved) r.nearestDiffersFromSaved++;
      const pr = pairVineRow(g, pinHeading(p), pinSideRaw(p));
      paired = pr.row;
      if (pr.row != null) {
        r.vineRowEvaluated++;
        if (pr.row === saved) r.vineRowMatch++;
        else if ((g.clearance ?? 0) >= MIN_ROW_CLEARANCE_FRACTION) r.falsePositives++;
      }
    }
    r.samples.push({ id: String(p.id), title: p.title ?? "", saved, aisle, geoAisle, nearest, paired });
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
    "saved_block", "suggested_block", "geometry_source", "heading", "side", "accuracy_m", "capture_observations",
    "trip_id", "track_anchor", "existing_metadata", "nearest_physical_row", "bounding_rows",
    "suggested_driving_aisle", "suggested_vine_row", "status", "reason", "review_note"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      "yes", r.id, r.title, r.mode, r.createdAt, r.lat, r.lng, r.savedBlockName, r.suggestedBlockName,
      r.geometrySource, r.heading, r.side, r.accuracy, r.captureCount, r.tripId, r.trackAnchor, r.existingMeta,
      r.geometry?.nearestPhysicalRow, r.geometry?.boundingRows?.join("|"), r.geometry?.aisle,
      r.suggestedVineRow, STATUS_LABEL[r.status], r.reason, notes[r.id] ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
