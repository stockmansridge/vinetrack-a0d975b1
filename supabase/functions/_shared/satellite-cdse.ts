// Shared helpers for the Satellite Mapping pipeline (Phase 2).
//
// - CDSE OAuth2 client-credentials token acquisition + in-memory cache.
// - CDSE Catalog / Process / Statistical API wrappers.
// - Admin verification via the VineTrack (iOS) Supabase project.
// - Evalscripts for TRUE_COLOUR, NDVI, NDRE, MSAVI, RECI, NDMI.
// - Geometry helpers: paddock polygon → GeoJSON, bbox.
//
// Provider docs:
//   Identity:    https://identity.dataspace.copernicus.eu
//   Sentinel Hub compatible APIs (free CDSE tier):
//                https://sh.dataspace.copernicus.eu/api/v1/{catalog,process,statistics}

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const CDSE_TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
export const CDSE_BASE = "https://sh.dataspace.copernicus.eu/api/v1";
export const CDSE_PROCESS_URL = `${CDSE_BASE}/process`;
export const CDSE_CATALOG_URL = "https://sh.dataspace.copernicus.eu/catalog/v1/search";
export const CDSE_STATISTICS_URL = `${CDSE_BASE}/statistics`;

export const SENTINEL2_COLLECTION = "sentinel-2-l2a";
export const PROCESSING_VERSION = "sentinel2-v3-eleven-layers";
export const PROVIDER = "CDSE_SENTINEL_HUB";
export const DISPLAY_ASSET_TYPE = "DISPLAY_RASTER";
export const ANALYTICAL_ASSET_TYPE = "ANALYTICAL_RASTER";
export const ANALYTICAL_NO_DATA_SENTINEL = -9999;
export const ANALYTICAL_ROW_ORIENTATION = "north_to_south";

// -------- Quality controls (server-side config) --------
export const QC = {
  maxCatalogueCloudCoverPct: 60,
  preferredCloudCoverPct: 20,
  minValidPaddockCoveragePct: 80,
  processImageMaxSize: 1024, // px per side cap
  processImageTargetResolutionM: 10, // display grid
};

// Eleven supported layers. Order matters for the Map Layer control.
export const INDEX_TYPES = [
  "TRUE_COLOUR",
  "NDVI",
  "EVI",
  "GNDVI",
  "MSAVI",
  "NDRE",
  "RECI",
  "GCI",
  "RENDVI",
  "NDMI",
  "PSRI",
] as const;
export type IndexType = (typeof INDEX_TYPES)[number];

// Native input resolution per Sentinel-2 index (10 m or 20 m).
export const INDEX_NATIVE_RES_M: Record<IndexType, number> = {
  TRUE_COLOUR: 10,
  NDVI: 10,
  EVI: 10,      // B02, B04, B08 all 10 m
  GNDVI: 10,    // B03, B08 both 10 m
  MSAVI: 10,
  NDRE: 20,     // B05 red edge
  RECI: 20,     // B05 red edge
  GCI: 10,      // B03, B08 both 10 m
  RENDVI: 20,   // B05 red edge / B8A narrow NIR (both 20 m)
  NDMI: 20,     // B11 SWIR
  PSRI: 20,     // B06 red edge
};

// Bands used per index (for asset metadata / help panel).
export const INDEX_BANDS: Record<IndexType, string[]> = {
  TRUE_COLOUR: ["B02", "B03", "B04"],
  NDVI: ["B04", "B08"],
  EVI: ["B02", "B04", "B08"],
  GNDVI: ["B03", "B08"],
  MSAVI: ["B04", "B08"],
  NDRE: ["B05", "B08"],
  RECI: ["B05", "B08"],
  GCI: ["B03", "B08"],
  RENDVI: ["B05", "B8A"],
  NDMI: ["B08", "B11"],
  PSRI: ["B02", "B04", "B06"],
};

// -------- Errors --------
export class CdseConfigError extends Error {
  code = "cdse_not_configured";
}
export class CdseAuthError extends Error {
  code = "cdse_auth_failed";
  status?: number;
  contentType?: string | null;
  bodyPreview?: string;
  constructor(msg: string, status?: number, contentType?: string | null, bodyPreview?: string) {
    super(msg);
    this.status = status;
    this.contentType = contentType;
    this.bodyPreview = bodyPreview;
  }
}
export class ProviderError extends Error {
  code: string;
  status: number;
  contentType?: string | null;
  bodyPreview?: string;
  constructor(status: number, code: string, msg: string, contentType?: string | null, bodyPreview?: string) {
    super(msg);
    this.code = code;
    this.status = status;
    this.contentType = contentType;
    this.bodyPreview = bodyPreview;
  }
}

export function sanitiseProviderPreview(input: string, max = 1000): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[redacted]"')
    .replace(/"refresh_token"\s*:\s*"[^"]+"/gi, '"refresh_token":"[redacted]"')
    .replace(/"client_secret"\s*:\s*"[^"]+"/gi, '"client_secret":"[redacted]"')
    .slice(0, max);
}

export function catalogErrorCode(status: number): string {
  if (status === 400) return "catalog_bad_request";
  if (status === 401) return "catalog_unauthorised";
  if (status === 403) return "catalog_forbidden";
  if (status === 429) return "catalog_rate_limited";
  if (status >= 500 && status <= 599) return "catalog_provider_error";
  return "catalog_provider_error";
}

// -------- Token cache (per-isolate; edge functions are short-lived) --------
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getCdseAccessTokenWithMetadata(): Promise<{
  token: string;
  status: number;
  tokenType: string | null;
  expiresInPresent: boolean;
  fromCache: boolean;
}> {
  const clientId = Deno.env.get("CDSE_CLIENT_ID");
  const clientSecret = Deno.env.get("CDSE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new CdseConfigError(
      "Copernicus Data Space credentials are not configured. Add CDSE_CLIENT_ID and CDSE_CLIENT_SECRET.",
    );
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return { token: cachedToken.token, status: 200, tokenType: "Bearer", expiresInPresent: true, fromCache: true };
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(CDSE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const contentType = res.headers.get("content-type");
    const text = await res.text();
    const bodyPreview = sanitiseProviderPreview(text, 500);
    console.error(`[cdse] token request failed [${res.status}]:`, bodyPreview);
    throw new CdseAuthError("Copernicus authentication failed.", res.status, contentType, bodyPreview);
  }
  const json = await res.json();
  const token = json.access_token as string;
  const tokenType = typeof json.token_type === "string" ? json.token_type : null;
  const expiresInPresent = json.expires_in != null;
  const expiresIn = Number(json.expires_in ?? 300);
  cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return { token, status: res.status, tokenType, expiresInPresent, fromCache: false };
}

export async function getCdseAccessToken(): Promise<string> {
  const result = await getCdseAccessTokenWithMetadata();
  return result.token;
}

// -------- Admin verification (via VineTrack iOS project) --------
export async function verifySystemAdmin(req: Request): Promise<
  { ok: true; userId: string } | { ok: false; status: number; message: string }
> {
  const url = Deno.env.get("VINETRACK_SUPABASE_URL");
  const anon = Deno.env.get("VINETRACK_ANON_KEY");
  if (!url || !anon) {
    return { ok: false, status: 503, message: "VineTrack backend is not configured." };
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { ok: false, status: 401, message: "Unauthorized" };
  const client = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user) return { ok: false, status: 401, message: "Unauthorized" };
  const { data: isAdmin, error: rpcErr } = await (client as any).rpc("is_system_admin");
  if (rpcErr) return { ok: false, status: 403, message: "Admin verification failed" };
  if (!isAdmin) return { ok: false, status: 403, message: "System admin access required" };
  return { ok: true, userId: userData.user.id };
}

// -------- This-project Supabase admin client --------
export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, srk, { auth: { persistSession: false } });
}

// -------- Paddock geometry (stored as jsonb: single ring OR multipolygon rings) --------
export type LatLng = { lat: number; lng: number };

function coercePoint(p: any): LatLng | null {
  if (!p) return null;
  if (typeof p.lat === "number" && typeof p.lng === "number") return { lat: p.lat, lng: p.lng };
  if (typeof p.latitude === "number" && typeof p.longitude === "number")
    return { lat: p.latitude, lng: p.longitude };
  if (Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number") {
    // Heuristic: swap if first looks like lng
    if (Math.abs(p[0]) > 90 && Math.abs(p[1]) <= 90) return { lat: p[1], lng: p[0] };
    return { lat: p[0], lng: p[1] };
  }
  return null;
}

/** Parse polygon_points into an array of rings (each ring closed).
 * Supports: flat point array (Polygon outer), array-of-rings (Polygon+holes),
 * array-of-polygons (MultiPolygon). Points arrays with holes: rings[0] is
 * outer, rings[1..] are holes. */
export function parseGeometryRings(raw: any): LatLng[][][] {
  if (!raw) return [];
  let val: any = raw;
  if (typeof raw === "string") {
    try {
      val = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(val) || val.length === 0) return [];

  const first = val[0];
  // Case A: flat array of points → single Polygon, single outer ring
  if (first && (typeof first.lat === "number" || typeof first.latitude === "number" || Array.isArray(first))) {
    const ring = val.map(coercePoint).filter((p): p is LatLng => !!p);
    return ring.length >= 3 ? [[closeRing(ring)]] : [];
  }
  // Case B: array of rings — first[0] is a point
  if (Array.isArray(first) && first[0] && (typeof first[0].lat === "number" || Array.isArray(first[0]))) {
    const rings = (val as any[])
      .map((r) => r.map(coercePoint).filter((p: any): p is LatLng => !!p))
      .filter((r: LatLng[]) => r.length >= 3)
      .map(closeRing);
    return rings.length ? [rings] : [];
  }
  // Case C: array of polygons (MultiPolygon) — first[0][0] is a point
  if (Array.isArray(first) && Array.isArray(first[0])) {
    const polys: LatLng[][][] = [];
    for (const poly of val as any[]) {
      const rings = (poly as any[])
        .map((r: any[]) => r.map(coercePoint).filter((p): p is LatLng => !!p))
        .filter((r: LatLng[]) => r.length >= 3)
        .map(closeRing);
      if (rings.length) polys.push(rings);
    }
    return polys;
  }
  return [];
}

function closeRing(ring: LatLng[]): LatLng[] {
  if (ring.length < 3) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a.lat === b.lat && a.lng === b.lng) return ring;
  return [...ring, a];
}

/** Convert parsed rings to GeoJSON Polygon or MultiPolygon (lng/lat order). */
export function toGeoJson(polys: LatLng[][][]): any {
  const toCoords = (poly: LatLng[][]) => poly.map((ring) => ring.map((p) => [p.lng, p.lat]));
  if (polys.length === 0) return null;
  if (polys.length === 1) return { type: "Polygon", coordinates: toCoords(polys[0]) };
  return { type: "MultiPolygon", coordinates: polys.map(toCoords) };
}

export function computeBbox(polys: LatLng[][][]): [number, number, number, number] | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const poly of polys)
    for (const ring of poly)
      for (const p of ring) {
        if (p.lng < west) west = p.lng;
        if (p.lng > east) east = p.lng;
        if (p.lat < south) south = p.lat;
        if (p.lat > north) north = p.lat;
      }
  if (!Number.isFinite(west)) return null;
  return [west, south, east, north];
}

/** Rough width/height in metres for a WGS84 bbox (equirectangular). */
export function bboxSizeMeters(bbox: [number, number, number, number]): { w: number; h: number } {
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  return { w: (e - w) * mPerDegLng, h: (n - s) * mPerDegLat };
}

/** Given bbox metres and a target native resolution, compute image WxH capped at max. */
export function computeImageSize(
  bbox: [number, number, number, number],
  targetResM: number,
  maxPx: number,
): { width: number; height: number; displayResolutionM: number } {
  const { w, h } = bboxSizeMeters(bbox);
  let widthPx = Math.max(16, Math.round(w / targetResM));
  let heightPx = Math.max(16, Math.round(h / targetResM));
  const scale = Math.min(1, maxPx / Math.max(widthPx, heightPx));
  widthPx = Math.max(16, Math.round(widthPx * scale));
  heightPx = Math.max(16, Math.round(heightPx * scale));
  const displayResM = Math.max(w / widthPx, h / heightPx);
  return { width: widthPx, height: heightPx, displayResolutionM: displayResM };
}

// -------- Evalscripts --------
// Cloud/shadow mask via SCL. Excluded classes: 3 shadow, 8/9/10 clouds, 11 snow, 0 no-data.
// All indices return a coloured RGB PNG. Palettes chosen to match the portal
// legend and remain stable across dates.

const SCL_MASK_JS = `
function scenePixelIsValid(scl) {
  // Exclude: 0 no-data, 1 saturated/defective, 3 cloud shadow, 8 cloud medium, 9 cloud high, 10 cirrus, 11 snow.
  return !(scl === 0 || scl === 1 || scl === 3 || scl === 8 || scl === 9 || scl === 10 || scl === 11);
}
function noDataColor() { return [0.4, 0.4, 0.4]; }
function cloudColor()  { return [1.0, 1.0, 1.0]; }
`;

function rampFn(stops: Array<[number, [number, number, number]]>): string {
  // Piecewise linear colour ramp for [-1..1] typical or [0..1] as-provided.
  const s = JSON.stringify(stops);
  return `
    const RAMP = ${s};
    function ramp(v) {
      if (v <= RAMP[0][0]) return RAMP[0][1];
      for (let i = 1; i < RAMP.length; i++) {
        if (v <= RAMP[i][0]) {
          const t = (v - RAMP[i-1][0]) / (RAMP[i][0] - RAMP[i-1][0]);
          const a = RAMP[i-1][1], b = RAMP[i][1];
          return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
        }
      }
      return RAMP[RAMP.length-1][1];
    }
  `;
}

// Colour ramps (0..1 hex to 0..1 rgb).
const RAMP_VEG = rampFn([
  [-0.2, [0.545, 0.227, 0.169]],
  [0.1, [0.788, 0.541, 0.247]],
  [0.35, [0.902, 0.827, 0.416]],
  [0.6, [0.494, 0.761, 0.42]],
  [0.9, [0.117, 0.420, 0.180]],
]);
const RAMP_MSAVI = RAMP_VEG;
const RAMP_NDRE = rampFn([
  [-0.2, [0.29, 0.173, 0.416]],
  [0.05, [0.498, 0.353, 0.659]],
  [0.2, [0.769, 0.659, 0.839]],
  [0.4, [0.561, 0.820, 0.561]],
  [0.6, [0.117, 0.420, 0.180]],
]);
const RAMP_RECI = rampFn([
  [0, [0.294, 0.180, 0.180]],
  [1, [0.627, 0.420, 0.247]],
  [3, [0.894, 0.761, 0.416]],
  [6, [0.498, 0.749, 0.416]],
  [10, [0.117, 0.357, 0.180]],
]);
const RAMP_NDMI = rampFn([
  [-0.4, [0.478, 0.231, 0.118]],
  [-0.1, [0.788, 0.541, 0.310]],
  [0.1, [0.902, 0.863, 0.690]],
  [0.3, [0.498, 0.718, 0.820]],
  [0.6, [0.117, 0.310, 0.478]],
]);

function evalscriptRgb(indexExpr: string, ramp: string, bands: string[]): string {
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: [${bands.map((b) => `"${b}"`).join(",")}, "SCL", "dataMask"] }],
    output: { bands: 4, sampleType: "UINT8" }
  };
}
${SCL_MASK_JS}
${ramp}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0,0,0,0];
  if (!scenePixelIsValid(s.SCL)) {
    if (s.SCL === 8 || s.SCL === 9 || s.SCL === 10) {
      const c = cloudColor(); return [c[0]*255, c[1]*255, c[2]*255, 200];
    }
    const c = noDataColor(); return [c[0]*255, c[1]*255, c[2]*255, 180];
  }
  const v = ${indexExpr};
  if (!isFinite(v)) { const c = noDataColor(); return [c[0]*255, c[1]*255, c[2]*255, 180]; }
  const rgb = ramp(v);
  return [rgb[0]*255, rgb[1]*255, rgb[2]*255, 255];
}`;
}

// New index ramps.
// GNDVI / EVI / RENDVI: -1..1 vegetation-style (share the vigour palette so
// visual comparison is intuitive, but numeric legends remain per-index).
const RAMP_GNDVI = RAMP_VEG;
const RAMP_EVI = RAMP_VEG;
const RAMP_RENDVI = RAMP_NDRE; // red-edge palette
// GCI: 0..8 typical range for canopy chlorophyll ratio (matches RECI palette).
const RAMP_GCI = rampFn([
  [0, [0.294, 0.180, 0.180]],
  [1, [0.627, 0.420, 0.247]],
  [2.5, [0.894, 0.761, 0.416]],
  [5, [0.498, 0.749, 0.416]],
  [8, [0.117, 0.357, 0.180]],
]);
// PSRI: -0.2..0.4 typical; higher = more senescence (warm autumnal palette).
const RAMP_PSRI = rampFn([
  [-0.2, [0.117, 0.420, 0.180]],
  [0, [0.494, 0.761, 0.42]],
  [0.1, [0.902, 0.827, 0.416]],
  [0.25, [0.788, 0.541, 0.247]],
  [0.4, [0.545, 0.227, 0.169]],
]);

// Safe-division expression: returns NaN when |denominator| < 1e-6 so that
// `!isFinite(v)` in the evalscript treats it as no-data.
const SAFE_DIV = (num: string, den: string) =>
  `((Math.abs(${den}) < 1e-6) ? NaN : (${num}) / (${den}))`;

// Central formula table — reused by display / stats / analytical evalscripts.
type IndexFormula = { formula: string; bands: string[] };
const INDEX_FORMULA: Record<Exclude<IndexType, "TRUE_COLOUR">, IndexFormula> = {
  NDVI:   { formula: SAFE_DIV("s.B08 - s.B04", "s.B08 + s.B04"), bands: ["B04", "B08"] },
  EVI:    { formula: `(2.5 * (s.B08 - s.B04) / ((s.B08 + 6*s.B04 - 7.5*s.B02 + 1) === 0 ? NaN : (s.B08 + 6*s.B04 - 7.5*s.B02 + 1)))`, bands: ["B02","B04","B08"] },
  GNDVI:  { formula: SAFE_DIV("s.B08 - s.B03", "s.B08 + s.B03"), bands: ["B03", "B08"] },
  MSAVI:  { formula: "((2*s.B08 + 1 - Math.sqrt((2*s.B08 + 1)*(2*s.B08 + 1) - 8*(s.B08 - s.B04))) / 2)", bands: ["B04","B08"] },
  NDRE:   { formula: SAFE_DIV("s.B08 - s.B05", "s.B08 + s.B05"), bands: ["B05", "B08"] },
  RECI:   { formula: `((Math.abs(s.B05) < 1e-6) ? NaN : ((s.B08 / s.B05) - 1))`, bands: ["B05","B08"] },
  GCI:    { formula: `((Math.abs(s.B03) < 1e-6) ? NaN : ((s.B08 / s.B03) - 1))`, bands: ["B03","B08"] },
  RENDVI: { formula: SAFE_DIV("s.B8A - s.B05", "s.B8A + s.B05"), bands: ["B05", "B8A"] },
  NDMI:   { formula: SAFE_DIV("s.B08 - s.B11", "s.B08 + s.B11"), bands: ["B08", "B11"] },
  PSRI:   { formula: `((Math.abs(s.B06) < 1e-6) ? NaN : ((s.B04 - s.B02) / s.B06))`, bands: ["B02","B04","B06"] },
};

const INDEX_RAMP: Record<Exclude<IndexType, "TRUE_COLOUR">, string> = {
  NDVI: RAMP_VEG,
  EVI: RAMP_EVI,
  GNDVI: RAMP_GNDVI,
  MSAVI: RAMP_MSAVI,
  NDRE: RAMP_NDRE,
  RECI: RAMP_RECI,
  GCI: RAMP_GCI,
  RENDVI: RAMP_RENDVI,
  NDMI: RAMP_NDMI,
  PSRI: RAMP_PSRI,
};

export function evalscriptFor(index: IndexType): string {
  if (index === "TRUE_COLOUR") {
    return `//VERSION=3
function setup(){return{input:[{bands:["B02","B03","B04","dataMask"]}],output:{bands:4,sampleType:"UINT8"}};}
function evaluatePixel(s){
  if(s.dataMask===0) return [0,0,0,0];
  const g = 2.5;
  return [Math.min(255, s.B04*255*g), Math.min(255, s.B03*255*g), Math.min(255, s.B02*255*g), 255];
}`;
  }
  const e = INDEX_FORMULA[index];
  return evalscriptRgb(e.formula, INDEX_RAMP[index], e.bands);
}

/** Evalscript for the Statistical API: emits per-index index value + validity mask.
 * The Statistical API applies aggregation across time; we always request a single
 * date range covering one scene, so results represent that scene. */
export function statsEvalscript(index: Exclude<IndexType, "TRUE_COLOUR">): string {
  const e = INDEX_FORMULA[index];
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: [${e.bands.map((b) => `"${b}"`).join(",")}, "SCL", "dataMask"] }],
    output: [
      { id: "index", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  const validScene = !(s.SCL === 0 || s.SCL === 1 || s.SCL === 3 || s.SCL === 8 || s.SCL === 9 || s.SCL === 10 || s.SCL === 11);
  const mask = (s.dataMask === 1 && validScene) ? 1 : 0;
  const v = ${e.formula};
  return { index: [isFinite(v) ? v : NaN], dataMask: [mask] };
}`;
}

/** Evalscript for browser point sampling. This emits the raw numeric index on
 * the exact same Process API grid as the display PNG. Invalid/cloud/shadow
 * pixels are written as a stable no-data sentinel rather than NaN so browser
 * reads are deterministic across GeoTIFF decoders. */
export function analyticalEvalscript(index: Exclude<IndexType, "TRUE_COLOUR">): string {
  const expr: Record<string, { formula: string; bands: string[] }> = {
    NDVI: { formula: "(s.B08 - s.B04) / (s.B08 + s.B04)", bands: ["B04", "B08"] },
    NDRE: { formula: "(s.B08 - s.B05) / (s.B08 + s.B05)", bands: ["B05", "B08"] },
    MSAVI: {
      formula:
        "(2*s.B08 + 1 - Math.sqrt((2*s.B08 + 1)*(2*s.B08 + 1) - 8*(s.B08 - s.B04))) / 2",
      bands: ["B04", "B08"],
    },
    RECI: { formula: "(s.B08 / s.B05) - 1", bands: ["B05", "B08"] },
    NDMI: { formula: "(s.B08 - s.B11) / (s.B08 + s.B11)", bands: ["B08", "B11"] },
  };
  const e = expr[index];
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: [${e.bands.map((b) => `"${b}"`).join(",")}, "SCL", "dataMask"] }],
    output: { bands: 1, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(s) {
  const validScene = !(s.SCL === 0 || s.SCL === 1 || s.SCL === 3 || s.SCL === 8 || s.SCL === 9 || s.SCL === 10 || s.SCL === 11);
  if (s.dataMask !== 1 || !validScene) return [${ANALYTICAL_NO_DATA_SENTINEL}];
  const v = ${e.formula};
  return [isFinite(v) ? v : ${ANALYTICAL_NO_DATA_SENTINEL}];
}`;
}

// -------- Provider calls --------

export async function catalogSearch(params: {
  bbox: [number, number, number, number];
  dateStart: string; // ISO
  dateEnd: string;
  maxCloudCoverPct: number;
  limit: number;
}) {
  const token = await getCdseAccessToken();
  const body = {
    collections: [SENTINEL2_COLLECTION],
    bbox: params.bbox,
    datetime: `${params.dateStart}/${params.dateEnd}`,
    limit: params.limit,
  };
  const res = await fetch(CDSE_CATALOG_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/geo+json, application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const contentType = res.headers.get("content-type");
    const t = await res.text();
    const bodyPreview = sanitiseProviderPreview(t, 1000);
    console.error(`[cdse] catalog [${res.status}]:`, bodyPreview.slice(0, 500));
    throw new ProviderError(res.status, catalogErrorCode(res.status), "Catalog search failed.", contentType, bodyPreview);
  }
  return await res.json();
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const delays = [500, 1200, 2500, 5000, 9000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && !(res.status >= 500 && res.status <= 504)) return res;
    if (attempt >= delays.length) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 15000)
      : delays[attempt];
    try { await res.body?.cancel(); } catch { /* noop */ }
    console.warn(`[cdse] ${label} ${res.status}: retrying in ${waitMs}ms (attempt ${attempt + 1})`);
    await new Promise((r) => setTimeout(r, waitMs + Math.floor(Math.random() * 250)));
  }
}

export async function processImage(params: {
  geometry: any; // GeoJSON
  bbox: [number, number, number, number];
  dateStart: string;
  dateEnd: string;
  evalscript: string;
  width: number;
  height: number;
}): Promise<Uint8Array> {
  const token = await getCdseAccessToken();
  const body = {
    input: {
      bounds: {
        bbox: params.bbox,
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
        geometry: params.geometry,
      },
      data: [
        {
          type: SENTINEL2_COLLECTION,
          dataFilter: {
            timeRange: { from: params.dateStart, to: params.dateEnd },
            mosaickingOrder: "leastCC",
          },
        },
      ],
    },
    output: {
      width: params.width,
      height: params.height,
      responses: [{ identifier: "default", format: { type: "image/png" } }],
    },
    evalscript: params.evalscript,
  };
  const res = await fetchWithRetry(CDSE_PROCESS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "image/png",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }, "process");
  if (!res.ok) {
    const t = await res.text();
    console.error(`[cdse] process [${res.status}]:`, t.slice(0, 500));
    if (res.status === 429) throw new ProviderError(429, "rate_limited", "Provider rate limit reached.");
    throw new ProviderError(res.status, "process_failed", "Sentinel-2 processing failed.");
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

export async function processAnalyticalRaster(params: {
  geometry: any; // GeoJSON
  bbox: [number, number, number, number];
  dateStart: string;
  dateEnd: string;
  evalscript: string;
  width: number;
  height: number;
}): Promise<Uint8Array> {
  const token = await getCdseAccessToken();
  const body = {
    input: {
      bounds: {
        bbox: params.bbox,
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
        geometry: params.geometry,
      },
      data: [
        {
          type: SENTINEL2_COLLECTION,
          dataFilter: {
            timeRange: { from: params.dateStart, to: params.dateEnd },
            mosaickingOrder: "leastCC",
          },
        },
      ],
    },
    output: {
      width: params.width,
      height: params.height,
      responses: [{ identifier: "default", format: { type: "image/tiff" } }],
    },
    evalscript: params.evalscript,
  };
  const res = await fetchWithRetry(CDSE_PROCESS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "image/tiff",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }, "process-analytical");
  if (!res.ok) {
    const t = await res.text();
    console.error(`[cdse] process analytical [${res.status}]:`, sanitiseProviderPreview(t, 500));
    if (res.status === 429) throw new ProviderError(429, "rate_limited", "Provider rate limit reached.");
    throw new ProviderError(res.status, "analytical_process_failed", "Sentinel-2 analytical raster processing failed.");
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function statisticsQuery(params: {
  geometry: any;
  bbox: [number, number, number, number];
  dateStart: string;
  dateEnd: string;
  evalscript: string;
  resolutionM?: number;
}) {
  const token = await getCdseAccessToken();
  const body = {
    input: {
      bounds: {
        bbox: params.bbox,
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
        geometry: params.geometry,
      },
      data: [
        {
          type: SENTINEL2_COLLECTION,
          dataFilter: {
            timeRange: { from: params.dateStart, to: params.dateEnd },
            mosaickingOrder: "leastCC",
          },
        },
      ],
    },
    aggregation: {
      timeRange: { from: params.dateStart, to: params.dateEnd },
      aggregationInterval: { of: "P1D" },
      resx: params.resolutionM ?? 10,
      resy: params.resolutionM ?? 10,
      evalscript: params.evalscript,
    },
    calculations: {
      index: {
        statistics: {
          default: {
            percentiles: { k: [10, 25, 50, 75, 90] },
          },
        },
      },
    },
  };
  const res = await fetchWithRetry(CDSE_STATISTICS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }, "statistics");
  if (!res.ok) {
    const t = await res.text();
    console.error(`[cdse] statistics [${res.status}]:`, t.slice(0, 500));
    if (res.status === 429) throw new ProviderError(429, "rate_limited", "Provider rate limit reached.");
    throw new ProviderError(res.status, "statistics_failed", "Sentinel-2 statistics query failed.");
  }
  return await res.json();
}


// -------- CORS --------
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonError(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: message, code, ...details }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
export function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
