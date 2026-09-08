// Spray Report route image resolution.
//
// The route image is private, generated once, and reused by all exporters.
// Portal never invents a second style: the only style is
// `spray-route-red-green-v1` defined in satelliteRouteMap.ts.
//
// Metadata is ONLY written through the controlled RPC
// `register_spray_report_route_asset_v1` (SQL 226). Direct writes to
// `trip_report_assets` are forbidden, and the RPC response is the canonical
// route object: when another export registered first, that immutable winner is
// returned and must be used instead of the locally generated alternative.
import { supabase } from "@/integrations/ios-supabase/client";
import { composeSatelliteRouteImage, type LatLng } from "./satelliteRouteMap";
import {
  SPRAY_REPORT_ASSET_BUCKET,
  SPRAY_ROUTE_STYLE_VERSION,
  type SprayReportPayloadV1,
  type SprayReportRoute,
} from "./sprayReportV1";

export interface ResolvedRouteImage {
  dataUrl: string;
  width: number;
  height: number;
  /** True when the portal had to generate + persist the asset this run. */
  generated: boolean;
}

export interface RouteResolution {
  image: ResolvedRouteImage | null;
  /** Honest, user-visible explanation when no route image can be embedded. */
  warning: string | null;
  /** Canonical route metadata as returned by the backend, when available. */
  route: SprayReportRoute | null;
}

export const ROUTE_NO_PATH_POINTS_MESSAGE =
  "Route unavailable — no recorded path points for this trip.";
export const ROUTE_DOWNLOAD_FAILED_MESSAGE =
  "Route unavailable — the saved route image could not be downloaded.";
export const ROUTE_UPLOAD_FAILED_MESSAGE =
  "Route image could not be saved to storage; this export shows a locally generated route.";
export const ROUTE_REGISTER_FAILED_MESSAGE =
  "Route image could not be registered; this export shows a locally generated route.";
export const ROUTE_RENDER_FAILED_MESSAGE =
  "Route unavailable — the route image could not be generated.";

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic, order-sensitive hash of the route geometry. */
export function routeHashForPoints(points: LatLng[]): string {
  const src = points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(";");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < src.length; i++) {
    h1 = (h1 ^ src.charCodeAt(i)) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + src.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Trip-scoped private object path required by the handoff: begins `{tripId}/`. */
export function routeObjectPath(payload: SprayReportPayloadV1, routeHash: string): string {
  return `${payload.identity.tripId}/${SPRAY_ROUTE_STYLE_VERSION}-${routeHash}.png`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Real pixel size from PNG IHDR bytes; null when the bytes are not a PNG. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return null;
  const read = (o: number) =>
    ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const width = read(16);
  const height = read(20);
  if (!width || !height) return null;
  return { width, height };
}

interface DownloadedRoute {
  image: ResolvedRouteImage;
  /** SHA-256 of the canonical object's actual bytes. */
  sha256: string;
}

/**
 * Download a private route object and describe it from its ACTUAL bytes:
 * real pixel dimensions (so the PDF keeps the true aspect ratio) and the real
 * content hash (never a locally assumed one).
 */
async function downloadRouteObject(
  bucket: string,
  objectPath: string,
): Promise<DownloadedRoute | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(objectPath);
    if (error || !data) return null;
    const dataUrl = await blobToDataUrl(data);
    const bytes = dataUrlToBytes(dataUrl);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    let sha256 = "";
    try {
      sha256 = await sha256Hex(buffer);
    } catch {
      sha256 = "";
    }
    const size = pngDimensions(bytes) ?? { width: 1100, height: 660 };
    return {
      image: { dataUrl, width: size.width, height: size.height, generated: false },
      sha256,
    };
  } catch {
    return null;
  }
}


function normaliseRoute(raw: unknown): SprayReportRoute | null {
  if (!raw || typeof raw !== "object") return null;
  const r = Array.isArray(raw) ? (raw[0] as any) : (raw as any);
  if (!r || typeof r !== "object") return null;
  const bucket = r.bucket ?? r.p_bucket;
  const objectPath = r.objectPath ?? r.object_path;
  if (typeof bucket !== "string" || typeof objectPath !== "string" || !objectPath) return null;
  return {
    bucket,
    objectPath,
    sha256: String(r.sha256 ?? ""),
    routeHash: String(r.routeHash ?? r.route_hash ?? ""),
    styleVersion: String(r.styleVersion ?? r.style_version ?? SPRAY_ROUTE_STYLE_VERSION),
  } as SprayReportRoute;
}

export const ROUTE_WIDTH = 1030;
export const ROUTE_HEIGHT = 700;
export const ROUTE_LOCAL_ONLY_MESSAGE =
  "Route shown from a locally generated image — it is not the saved route for this trip.";
export const ROUTE_HASH_MISMATCH_MESSAGE =
  "Route unavailable — the saved route image did not match its recorded checksum.";

/**
 * Canonical shared route-input hash: SHA-256 over
 * `spray-route-red-green-v1|1030x700|lat,lon|...` in oldest-to-newest order,
 * each coordinate at exactly six decimal places.
 */
export async function canonicalRouteHash(points: LatLng[]): Promise<string> {
  const parts = [
    SPRAY_ROUTE_STYLE_VERSION,
    `${ROUTE_WIDTH}x${ROUTE_HEIGHT}`,
    ...points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`),
  ];
  const bytes = new TextEncoder().encode(parts.join("|"));
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return await sha256Hex(buffer);
}

/**
 * Returns the embeddable route image for a spray report plus an honest warning
 * when one cannot be produced. Upload/registration happens only through the
 * authenticated `spray-report-route-upload` function; the portal never writes
 * the bucket or the metadata itself.
 */
export async function resolveSprayRoute(
  payload: SprayReportPayloadV1,
  pathPoints: LatLng[],
): Promise<RouteResolution> {
  if (payload.route) {
    const existing = await downloadRouteObject(payload.route.bucket, payload.route.objectPath);
    if (!existing) return { image: null, warning: ROUTE_DOWNLOAD_FAILED_MESSAGE, route: payload.route };
    if (payload.route.sha256 && existing.sha256 && existing.sha256 !== payload.route.sha256) {
      return { image: null, warning: ROUTE_HASH_MISMATCH_MESSAGE, route: payload.route };
    }
    return { image: existing.image, warning: null, route: payload.route };
  }

  if (!pathPoints || pathPoints.length < 2) {
    return { image: null, warning: ROUTE_NO_PATH_POINTS_MESSAGE, route: null };
  }

  const routeHash = await canonicalRouteHash(pathPoints);

  // A locally composed image is only ever a fallback for display; the canonical
  // bytes are whatever the trusted function stores and returns.
  const composed = await composeSatelliteRouteImage(pathPoints, ROUTE_WIDTH, ROUTE_HEIGHT, {
    chronology: true,
  });
  const local: ResolvedRouteImage | null = composed
    ? {
        dataUrl: composed.dataUrl,
        width: composed.width,
        height: composed.height,
        generated: true,
      }
    : null;

  let canonical: SprayReportRoute | null = null;
  try {
    const pngBase64 = composed ? composed.dataUrl.slice(composed.dataUrl.indexOf(",") + 1) : undefined;
    const { data, error } = await supabase.functions.invoke("spray-report-route-upload", {
      body: {
        tripId: payload.identity.tripId,
        routeHash,
        ...(pngBase64 ? { pngBase64 } : {}),
        coordinates: pathPoints.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        width: ROUTE_WIDTH,
        height: ROUTE_HEIGHT,
      },
    });
    if (error) {
      return {
        image: local,
        warning: local ? ROUTE_LOCAL_ONLY_MESSAGE : ROUTE_UPLOAD_FAILED_MESSAGE,
        route: null,
      };
    }
    canonical = normaliseRoute((data as any)?.route ?? data);
  } catch {
    return {
      image: local,
      warning: local ? ROUTE_LOCAL_ONLY_MESSAGE : ROUTE_UPLOAD_FAILED_MESSAGE,
      route: null,
    };
  }

  if (!canonical) {
    return {
      image: local,
      warning: local ? ROUTE_LOCAL_ONLY_MESSAGE : ROUTE_REGISTER_FAILED_MESSAGE,
      route: null,
    };
  }

  // Always embed the registered bytes — they may belong to a concurrent
  // immutable winner — and verify them against the recorded checksum.
  const stored = await downloadRouteObject(canonical.bucket, canonical.objectPath);
  if (!stored) {
    return {
      image: local,
      warning: local ? ROUTE_LOCAL_ONLY_MESSAGE : ROUTE_DOWNLOAD_FAILED_MESSAGE,
      route: canonical,
    };
  }
  if (canonical.sha256 && stored.sha256 && stored.sha256 !== canonical.sha256) {
    return { image: local, warning: ROUTE_HASH_MISMATCH_MESSAGE, route: canonical };
  }
  return { image: stored.image, warning: null, route: canonical };
}



/** Back-compatible helper used by callers that only need the image. */
export async function resolveSprayRouteImage(
  payload: SprayReportPayloadV1,
  pathPoints: LatLng[],
): Promise<ResolvedRouteImage | null> {
  const res = await resolveSprayRoute(payload, pathPoints);
  return res.image;
}
