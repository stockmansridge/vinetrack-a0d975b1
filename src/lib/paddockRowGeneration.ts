// Paddock row generation — direct port of iOS RowGeometry.calculateRowLines
// Reference: docs/paddock-geometry-writer-spec.md §4
//
// The web writer MUST produce identical lines to the iOS app for sync parity.
// Do NOT change any math here without coordinating with the iOS team.

export type LatLng = { lat: number; lng: number };
export type CoordinatePoint = { id: string; latitude: number; longitude: number };
export type GeneratedRow = {
  id: string;
  number: number;
  startPoint: CoordinatePoint;
  endPoint: CoordinatePoint;
};

const M_PER_DEG_LAT = 111320.0;
const uuid = () => crypto.randomUUID();

function mPerDegLon(centroidLat: number) {
  return M_PER_DEG_LAT * Math.cos((centroidLat * Math.PI) / 180);
}

/** Equirectangular-projected metres around a centroid → planar (x,y) in metres. */
function projectMeters(p: LatLng, centroidLat: number) {
  const mLon = mPerDegLon(centroidLat);
  return { x: p.lng * mLon, y: p.lat * M_PER_DEG_LAT };
}

/** Pairwise max distance (metres). */
function maxPairwiseDistance(points: LatLng[], centroidLat: number): number {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = projectMeters(points[i], centroidLat);
      const b = projectMeters(points[j], centroidLat);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > max) max = d;
    }
  }
  return max;
}

/** Intersect two segments p1-p2 and p3-p4. Returns the intersection point and
 * the parameter `t` along p1-p2 (0..1) — or null if no proper intersection.
 * Matches the standard segment-segment intersection used by the iOS clipper. */
function segmentIntersect(
  p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng,
): { point: LatLng; t: number } | null {
  const x1 = p1.lng, y1 = p1.lat, x2 = p2.lng, y2 = p2.lat;
  const x3 = p3.lng, y3 = p3.lat, x4 = p4.lng, y4 = p4.lat;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return {
    point: { lat: y1 + t * (y2 - y1), lng: x1 + t * (x2 - x1) },
    t,
  };
}

export interface RowGenInput {
  polygonPoints: LatLng[]; // open polygon, ≥3
  rowDirectionDeg: number; // 0..360, compass bearing
  rowWidthM: number;       // > 0
  rowOffsetM: number;      // any
  count: number;           // > 0
  rowStartNumber: number;  // typically 1
  rowNumberAscending: boolean;
}

/**
 * Direct port of iOS `RowGeometry.calculateRowLines`.
 * Returns rows in left-to-right (perpRad) order, with `number` filled per
 * §4 step 9. Rows that fail to clip the polygon are OMITTED (web behaviour
 * per spec — iOS leaves placeholders, but spec says omit).
 */
export function generateRows(input: RowGenInput): GeneratedRow[] {
  const { polygonPoints, rowDirectionDeg, rowWidthM, rowOffsetM, count,
          rowStartNumber, rowNumberAscending } = input;

  // 1. Guard
  if (polygonPoints.length < 3) return [];
  if (count <= 0) return [];
  if (rowWidthM <= 0) return [];

  // 2. Centroid (planar arithmetic mean)
  const centroidLat = polygonPoints.reduce((s, p) => s + p.lat, 0) / polygonPoints.length;
  const centroidLon = polygonPoints.reduce((s, p) => s + p.lng, 0) / polygonPoints.length;

  // 3. Local metric scaling
  const mLat = M_PER_DEG_LAT;
  const mLon = mPerDegLon(centroidLat);

  // 4. Bearing
  const bearingRad = (rowDirectionDeg * Math.PI) / 180;
  const perpRad = bearingRad + Math.PI / 2;

  // 5. Half length
  const maxDist = maxPairwiseDistance(polygonPoints, centroidLat);
  const halfLen = maxDist * 1.5;

  // 6. Row offsets
  const totalW = (count - 1) * rowWidthM;
  const startOff = -totalW / 2;

  const out: GeneratedRow[] = [];

  for (let i = 0; i < count; i++) {
    const off = startOff + i * rowWidthM + rowOffsetM;

    // 7. Candidate line
    const cLat = centroidLat + (off * Math.cos(perpRad)) / mLat;
    const cLon = centroidLon + (off * Math.sin(perpRad)) / mLon;
    const dLat = (halfLen * Math.cos(bearingRad)) / mLat;
    const dLon = (halfLen * Math.sin(bearingRad)) / mLon;
    const candStart: LatLng = { lat: cLat - dLat, lng: cLon - dLon };
    const candEnd: LatLng = { lat: cLat + dLat, lng: cLon + dLon };

    // 8. Clip
    const hits: { point: LatLng; t: number }[] = [];
    for (let j = 0; j < polygonPoints.length; j++) {
      const a = polygonPoints[j];
      const b = polygonPoints[(j + 1) % polygonPoints.length];
      const ix = segmentIntersect(candStart, candEnd, a, b);
      if (ix) hits.push(ix);
    }
    if (hits.length < 2) continue; // drop entirely

    hits.sort((x, y) => x.t - y.t);
    const start = hits[0].point;
    const end = hits[hits.length - 1].point;

    // 9. Numbering
    const number = rowNumberAscending
      ? rowStartNumber + i
      : rowStartNumber + (count - 1 - i);

    out.push({
      id: uuid(),
      number,
      startPoint: { id: uuid(), latitude: start.lat, longitude: start.lng },
      endPoint: { id: uuid(), latitude: end.lat, longitude: end.lng },
    });
  }

  return out;
}

/** Convert UI polygon (LatLng[]) to canonical iOS shape used in storage. */
export function toCanonicalPolygon(points: LatLng[]): CoordinatePoint[] {
  return points.map((p) => ({
    id: uuid(),
    latitude: p.lat,
    longitude: p.lng,
  }));
}
