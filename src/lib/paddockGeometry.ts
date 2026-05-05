// Read-only geometry helpers for paddock map rendering.
// No mutations, no Supabase writes.

export type LatLng = { lat: number; lng: number };

const isFiniteNum = (n: any): n is number => typeof n === "number" && Number.isFinite(n);

/** Coerce arbitrary jsonb shapes into an array of {lat, lng} points. */
export function parsePolygonPoints(raw: any): LatLng[] {
  if (!raw) return [];
  let arr: any = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: LatLng[] = [];
  for (const p of arr) {
    if (!p) continue;
    // {lat, lng}
    if (isFiniteNum(p.lat) && isFiniteNum(p.lng)) {
      out.push({ lat: p.lat, lng: p.lng });
      continue;
    }
    // {latitude, longitude}
    if (isFiniteNum(p.latitude) && isFiniteNum(p.longitude)) {
      out.push({ lat: p.latitude, lng: p.longitude });
      continue;
    }
    // [lat, lng] or [lng, lat] (GeoJSON-style)
    if (Array.isArray(p) && p.length >= 2 && isFiniteNum(p[0]) && isFiniteNum(p[1])) {
      // Heuristic: lat in [-90,90], lng in [-180,180]. If first looks like lng, swap.
      const a = p[0], b = p[1];
      if (Math.abs(a) > 90 && Math.abs(b) <= 90) out.push({ lat: b, lng: a });
      else out.push({ lat: a, lng: b });
    }
  }
  return out;
}

/** A single row from the `rows` jsonb. Canonical iOS shape uses
 * `startPoint` / `endPoint` with `{ id, latitude, longitude }`. We also
 * accept legacy/alternate shapes for resilience. */
export type PaddockRow = {
  id?: string;
  number?: number;
  start?: LatLng;
  end?: LatLng;
  points?: LatLng[];
  length_m?: number;
};

export function parseRows(raw: any): PaddockRow[] {
  if (!raw) return [];
  let arr: any = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out: PaddockRow[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const row: PaddockRow = {};
    if (typeof r.id === "string") row.id = r.id;
    if (isFiniteNum(r.number)) row.number = r.number;
    // Canonical iOS first, then legacy fallbacks.
    const start = r.startPoint ?? r.start ?? r.from ?? r.a;
    const end = r.endPoint ?? r.end ?? r.to ?? r.b;
    if (start) {
      const [s] = parsePolygonPoints([start]);
      if (s) row.start = s;
    }
    if (end) {
      const [e] = parsePolygonPoints([end]);
      if (e) row.end = e;
    }
    if (Array.isArray(r.points)) row.points = parsePolygonPoints(r.points);
    if (isFiniteNum(r.length_m)) row.length_m = r.length_m;
    else if (isFiniteNum(r.length)) row.length_m = r.length;
    if (row.start || row.end || (row.points && row.points.length) || row.length_m) {
      out.push(row);
    }
  }
  return out;
}

/** Variety allocation parsing — best-effort. */
export type VarietyAllocation = {
  variety?: string;
  percent?: number;
  rows?: number;
  row_ids?: any[];
  polygon?: LatLng[];
};

export function parseVarietyAllocations(raw: any): VarietyAllocation[] {
  if (!raw) return [];
  let arr: any = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((v: any) => ({
    variety: v?.variety ?? v?.name ?? v?.cultivar,
    percent: isFiniteNum(v?.percent) ? v.percent : undefined,
    rows: isFiniteNum(v?.rows) ? v.rows : undefined,
    row_ids: Array.isArray(v?.row_ids) ? v.row_ids : undefined,
    polygon: v?.polygon ? parsePolygonPoints(v.polygon) : undefined,
  }));
}

// ---- Geodesy helpers ----

const EARTH_R = 6378137; // metres

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/**
 * Polygon area in hectares using an equirectangular projection around the
 * polygon centroid. Accurate for vineyard-scale polygons (<10 km).
 */
export function polygonAreaHectares(points: LatLng[]): number {
  if (!points || points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  const proj = points.map((p) => ({
    x: (p.lng * Math.PI) / 180 * EARTH_R * cosLat0,
    y: (p.lat * Math.PI) / 180 * EARTH_R,
  }));
  let area = 0;
  for (let i = 0; i < proj.length; i++) {
    const a = proj[i];
    const b = proj[(i + 1) % proj.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2 / 10000; // m² -> ha
}

/** Length of a single row (start→end or sum of points). */
export function rowLengthMeters(row: PaddockRow): number {
  if (isFiniteNum(row.length_m)) return row.length_m;
  if (row.start && row.end) return haversineMeters(row.start, row.end);
  if (row.points && row.points.length >= 2) {
    let s = 0;
    for (let i = 1; i < row.points.length; i++) s += haversineMeters(row.points[i - 1], row.points[i]);
    return s;
  }
  return 0;
}

export interface DerivedMetrics {
  areaHa: number;
  rowCount: number;
  totalRowLengthM: number;
  vineCount: number | null;
  intermediatePostCount: number | null;
  emitterCount: number | null;
  vineCountSource: "override" | "derived" | "unknown";
}

export function deriveMetrics(paddock: any): DerivedMetrics {
  const polygon = parsePolygonPoints(paddock?.polygon_points);
  const rows = parseRows(paddock?.rows);
  const areaHa = polygonAreaHectares(polygon);
  const rowCount = rows.length;
  const totalRowLengthM = rows.reduce((s, r) => s + rowLengthMeters(r), 0);

  const vineSpacing = Number(paddock?.vine_spacing);
  const intermediateSpacing = Number(paddock?.intermediate_post_spacing);
  const emitterSpacing = Number(paddock?.emitter_spacing);

  let vineCount: number | null = null;
  let vineCountSource: DerivedMetrics["vineCountSource"] = "unknown";
  if (isFiniteNum(paddock?.vine_count_override) && paddock.vine_count_override > 0) {
    vineCount = Math.round(paddock.vine_count_override);
    vineCountSource = "override";
  } else if (isFiniteNum(vineSpacing) && vineSpacing > 0 && totalRowLengthM > 0) {
    vineCount = Math.round(totalRowLengthM / vineSpacing);
    vineCountSource = "derived";
  }

  // iOS: rawPosts = floor(total / intermediateSpacing); endPosts = 2 * rows.count;
  //      intermediatePostCount = max(0, rawPosts - endPosts)
  const intermediatePostCount =
    isFiniteNum(intermediateSpacing) && intermediateSpacing > 0 && totalRowLengthM > 0
      ? Math.max(0, Math.floor(totalRowLengthM / intermediateSpacing) - 2 * rowCount)
      : null;

  const emitterCount =
    isFiniteNum(emitterSpacing) && emitterSpacing > 0 && totalRowLengthM > 0
      ? Math.floor(totalRowLengthM / emitterSpacing)
      : null;

  return {
    areaHa,
    rowCount,
    totalRowLengthM,
    vineCount,
    intermediatePostCount,
    emitterCount,
    vineCountSource,
  };
}

export function polygonCentroid(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}
