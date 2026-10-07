// Contour Row Mapping (Beta) — block-local metric geometry.
//
// Persisted coordinates are WGS84 { lat, lng } (decimal degrees).
// All offsetting, clipping and length maths happen in a block-local
// equirectangular projection centred on the block boundary centroid:
//   x = (lng - lng0) * 111320 * cos(lat0)   (metres east)
//   y = (lat - lat0) * 111320               (metres north)
// At vineyard-block scale (< a few km) the distortion is far below row
// spacing tolerance. Degrees are never offset directly and screen pixels
// are never treated as metres.
//
// This module is independent of src/lib/paddockRowGeneration.ts (the
// mobile-parity straight generator), which is intentionally untouched.

export type LatLng = { lat: number; lng: number };
export type XY = { x: number; y: number };

const M_PER_DEG = 111320;

export interface Projection {
  lat0: number;
  lng0: number;
  toXY: (p: LatLng) => XY;
  toLL: (p: XY) => LatLng;
}

export function makeProjection(origin: LatLng): Projection {
  const mLon = M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180);
  return {
    lat0: origin.lat,
    lng0: origin.lng,
    toXY: (p) => ({ x: (p.lng - origin.lng) * mLon, y: (p.lat - origin.lat) * M_PER_DEG }),
    toLL: (p) => ({ lat: origin.lat + p.y / M_PER_DEG, lng: origin.lng + p.x / mLon }),
  };
}

export function projectionForPolygon(poly: LatLng[]): Projection {
  const n = poly.length || 1;
  return makeProjection({
    lat: poly.reduce((s, p) => s + p.lat, 0) / n,
    lng: poly.reduce((s, p) => s + p.lng, 0) / n,
  });
}

export const isFiniteLL = (p: LatLng) =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

export function polylineLengthXY(pts: XY[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Length in metres of a WGS84 polyline (block-local projection). */
export function polylineLengthM(pts: LatLng[], proj?: Projection): number {
  if (pts.length < 2) return 0;
  const pr = proj ?? makeProjection(pts[0]);
  return polylineLengthXY(pts.map(pr.toXY));
}

/** Sum of part lengths. Gaps between parts are never counted. */
export function multipartLengthM(parts: LatLng[][], proj?: Projection): number {
  return parts.reduce((s, p) => s + polylineLengthM(p, proj), 0);
}

/** Straight-line distance between the first and last point of a row. */
export function chordLengthM(parts: LatLng[][], proj?: Projection): number {
  const nonEmpty = parts.filter((p) => p.length > 0);
  if (!nonEmpty.length) return 0;
  const a = nonEmpty[0][0];
  const lastPart = nonEmpty[nonEmpty.length - 1];
  const b = lastPart[lastPart.length - 1];
  const pr = proj ?? makeProjection(a);
  return dist(pr.toXY(a), pr.toXY(b));
}

// ---------------------------------------------------------------- basics

function segIntersectParams(a: XY, b: XY, c: XY, d: XY): { t: number; u: number } | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

export function pointInPolygonXY(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when any two non-adjacent segments of the polyline cross. */
export function polylineSelfIntersects(pts: XY[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      const p = segIntersectParams(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (p && !(p.t > 1 - 1e-9 && p.u < 1e-9)) return true;
    }
  }
  return false;
}

export function polylinesCross(a: XY[], b: XY[]): boolean {
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < b.length - 1; j++)
      if (segIntersectParams(a[i], a[i + 1], b[j], b[j + 1])) return true;
  return false;
}

function pointSegDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function minDistanceBetween(a: XY[], b: XY[]): number {
  let m = Infinity;
  for (const p of a) for (let j = 0; j < b.length - 1; j++) m = Math.min(m, pointSegDist(p, b[j], b[j + 1]));
  for (const p of b) for (let j = 0; j < a.length - 1; j++) m = Math.min(m, pointSegDist(p, a[j], a[j + 1]));
  return m;
}

/** Remove consecutive duplicates (< 1 cm). */
export function dedupeXY(pts: XY[]): XY[] {
  const out: XY[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > 0.01) out.push(p);
  return out;
}

/** Optional bounded Chaikin smoothing (0–2 iterations). Endpoints kept. */
export function chaikin(pts: XY[], iterations: number): XY[] {
  let cur = pts;
  const it = Math.max(0, Math.min(2, Math.floor(iterations)));
  for (let k = 0; k < it; k++) {
    if (cur.length < 3) break;
    const next: XY[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Extend both ends along their end-segment direction by `m` metres. */
export function extendEnds(pts: XY[], m: number): XY[] {
  if (pts.length < 2 || m <= 0) return pts;
  const a = pts[0], b = pts[1];
  const y = pts[pts.length - 1], z = pts[pts.length - 2];
  const la = dist(a, b) || 1, lz = dist(y, z) || 1;
  const start = { x: a.x + ((a.x - b.x) / la) * m, y: a.y + ((a.y - b.y) / la) * m };
  const end = { x: y.x + ((y.x - z.x) / lz) * m, y: y.y + ((y.y - z.y) / lz) * m };
  return [start, ...pts, end];
}

/**
 * Parallel offset of a polyline by `d` metres. Positive d = LEFT of the
 * start→end direction. Interior joins use the miter point (bounded to
 * 4×|d|, else a bevel). Callers must check the result for self-intersection,
 * which signals a curve too tight for that offset.
 */
export function offsetPolyline(pts: XY[], d: number): XY[] {
  return offsetPolylineChecked(pts, d).points;
}

/** Offset plus a fold check: true when any offset segment runs backwards
 *  relative to the reference (the offset exceeds the local curve radius). */
export function offsetPolylineChecked(pts: XY[], d: number): { points: XY[]; folded: boolean } {
  if (pts.length < 2 || d === 0) return { points: pts.slice(), folded: false };
  const src: number[] = [0];
  const normals: XY[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
    const l = Math.hypot(dx, dy) || 1;
    normals.push({ x: -dy / l, y: dx / l });
  }
  const out: XY[] = [{ x: pts[0].x + normals[0].x * d, y: pts[0].y + normals[0].y * d }];
  for (let i = 1; i < pts.length - 1; i++) {
    const n1 = normals[i - 1], n2 = normals[i];
    const mx = n1.x + n2.x, my = n1.y + n2.y;
    const ml = Math.hypot(mx, my);
    const cos = ml / 2; // cos of half-angle between normals
    if (ml < 1e-9 || 1 / cos > 4) {
      out.push({ x: pts[i].x + n1.x * d, y: pts[i].y + n1.y * d });
      out.push({ x: pts[i].x + n2.x * d, y: pts[i].y + n2.y * d });
      src.push(i, i);
    } else {
      const k = d / (cos * ml);
      out.push({ x: pts[i].x + mx * k, y: pts[i].y + my * k });
      src.push(i);
    }
  }
  const nl = normals[normals.length - 1];
  const last = pts[pts.length - 1];
  out.push({ x: last.x + nl.x * d, y: last.y + nl.y * d });
  src.push(pts.length - 1);
  let folded = false;
  for (let j = 1; j < out.length && !folded; j++) {
    const a = src[j - 1], b = src[j];
    if (a === b) continue;
    const tx = pts[b].x - pts[a].x, ty = pts[b].y - pts[a].y;
    if ((out[j].x - out[j - 1].x) * tx + (out[j].y - out[j - 1].y) * ty < 0) folded = true;
  }
  return { points: out, folded };
}

// --------------------------------------------------------------- clipping

export interface ClipRegion {
  boundary: XY[];          // real block polygon (never modified)
  workingArea?: XY[] | null; // optional group area inside the block
  exclusions?: XY[][];     // tracks/obstacles to cut out
}

function insideRegion(p: XY, r: ClipRegion): boolean {
  if (!pointInPolygonXY(p, r.boundary)) return false;
  if (r.workingArea && r.workingArea.length >= 3 && !pointInPolygonXY(p, r.workingArea)) return false;
  for (const ex of r.exclusions ?? []) if (ex.length >= 3 && pointInPolygonXY(p, ex)) return false;
  return true;
}

/**
 * Clip a polyline to the effective region. Returns disjoint parts in
 * order along the line. Parts are never bridged across gaps; pieces
 * shorter than `minPartM` are dropped.
 */
export function clipPolyline(pts: XY[], region: ClipRegion, minPartM = 0.5): XY[][] {
  const polys = [region.boundary, ...(region.workingArea && region.workingArea.length >= 3 ? [region.workingArea] : []),
    ...(region.exclusions ?? []).filter((e) => e.length >= 3)];
  const parts: XY[][] = [];
  let cur: XY[] | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ts = [0, 1];
    for (const poly of polys) {
      for (let j = 0; j < poly.length; j++) {
        const hit = segIntersectParams(a, b, poly[j], poly[(j + 1) % poly.length]);
        if (hit) ts.push(hit.t);
      }
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      const mid = { x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm };
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      if (insideRegion(mid, region)) {
        if (!cur) { cur = [p0]; parts.push(cur); }
        cur.push(p1);
      } else {
        cur = null;
      }
    }
  }
  return parts.map(dedupeXY).filter((p) => p.length >= 2 && polylineLengthXY(p) >= minPartM);
}

// ------------------------------------------------- robust segment relations

const ORIENT_EPS = 1e-6; // m² (cross-product tolerance in metres)

function orient(a: XY, b: XY, c: XY): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < ORIENT_EPS ? 0 : v;
}

export type SegRelation = "none" | "touch" | "cross" | "overlap";

/**
 * Relationship between segments ab and cd, including collinear overlap
 * and degenerate (zero-length) cases. "touch" = share exactly one point
 * without crossing through; "overlap" = collinear with a shared length.
 */
export function segRelation(a: XY, b: XY, c: XY, d: XY, eps = 1e-3): SegRelation {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
    // Collinear (or degenerate). Project onto the dominant axis of both.
    const ux = (b.x - a.x) + (d.x - c.x), uy = (b.y - a.y) + (d.y - c.y);
    const useX = Math.abs(ux) >= Math.abs(uy);
    const p = (q: XY) => (useX ? q.x : q.y);
    const lo1 = Math.min(p(a), p(b)), hi1 = Math.max(p(a), p(b));
    const lo2 = Math.min(p(c), p(d)), hi2 = Math.max(p(c), p(d));
    const ov = Math.min(hi1, hi2) - Math.max(lo1, lo2);
    // Collinear check via orient alone fails when a segment is a point; also verify distance.
    if (ov > eps) return "overlap";
    if (ov >= -eps && Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b)) <= eps) return "touch";
    return "none";
  }
  if (o1 * o2 < 0 && o3 * o4 < 0) return "cross";
  // Endpoint on the other segment.
  if (pointSegDist(c, a, b) <= eps || pointSegDist(d, a, b) <= eps || pointSegDist(a, c, d) <= eps || pointSegDist(b, c, d) <= eps) return "touch";
  return "none";
}

export function polygonAreaXY(ring: XY[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x * ring[i].y - ring[i].x * ring[j].y);
  return Math.abs(s) / 2;
}

export function distToRingXY(p: XY, ring: XY[]): number {
  let m = Infinity;
  for (let i = 0; i < ring.length; i++) m = Math.min(m, pointSegDist(p, ring[i], ring[(i + 1) % ring.length]));
  return m;
}

/** True when any two non-adjacent edges of a closed ring touch/cross/overlap,
 *  or adjacent edges fold back on each other. */
export function ringSelfIntersects(ring: XY[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = ring[j], d = ring[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const rel = segRelation(a, b, c, d);
      if (adjacent ? rel === "overlap" : rel !== "none") return true;
    }
  }
  return false;
}

export const MASK_LIMITS = { maxPoints: 500, minAreaM2: 1 };

/** Friendly problem text for an invalid working area / cut-out, else null. */
export function maskProblem(points: LatLng[], proj: Projection): string | null {
  if (points.length < 3) return "needs at least three points";
  if (points.length > MASK_LIMITS.maxPoints) return `has more than ${MASK_LIMITS.maxPoints} points`;
  if (!points.every(isFiniteLL)) return "has invalid coordinates";
  const xy = points.map(proj.toXY);
  for (let i = 0; i < xy.length; i++) if (dist(xy[i], xy[(i + 1) % xy.length]) < 0.01) return "has repeated points";
  if (polygonAreaXY(xy) < MASK_LIMITS.minAreaM2) return "has no area";
  if (ringSelfIntersects(xy)) return "crosses itself";
  return null;
}

/** Minimum distance between two multipart rows, testing each part
 *  separately so gaps between parts never create fake segments. */
export function minDistanceBetweenParts(a: XY[][], b: XY[][]): number {
  let m = Infinity;
  for (const pa of a) for (const pb of b) m = Math.min(m, minDistanceBetween(pa, pb));
  return m;
}
