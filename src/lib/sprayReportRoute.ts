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

async function downloadRouteObject(
  bucket: string,
  objectPath: string,
): Promise<ResolvedRouteImage | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(objectPath);
    if (error || !data) return null;
    const dataUrl = await blobToDataUrl(data);
    return { dataUrl, width: 1100, height: 660, generated: false };
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

/**
 * Returns the embeddable route image for a spray report plus an honest warning
 * when one cannot be produced.
 */
export async function resolveSprayRoute(
  payload: SprayReportPayloadV1,
  pathPoints: LatLng[],
): Promise<RouteResolution> {
  if (payload.route) {
    const existing = await downloadRouteObject(payload.route.bucket, payload.route.objectPath);
    if (existing) return { image: existing, warning: null, route: payload.route };
    return { image: null, warning: ROUTE_DOWNLOAD_FAILED_MESSAGE, route: payload.route };
  }

  if (!pathPoints || pathPoints.length < 2) {
    return { image: null, warning: ROUTE_NO_PATH_POINTS_MESSAGE, route: null };
  }

  const composed = await composeSatelliteRouteImage(pathPoints, 1100, 660, {
    chronology: true,
  });
  if (!composed) {
    return { image: null, warning: ROUTE_RENDER_FAILED_MESSAGE, route: null };
  }

  const local: ResolvedRouteImage = {
    dataUrl: composed.dataUrl,
    width: composed.width,
    height: composed.height,
    generated: true,
  };

  const routeHash = routeHashForPoints(pathPoints);
  const objectPath = routeObjectPath(payload, routeHash);

  let sha256: string;
  try {
    const bytes = dataUrlToBytes(composed.dataUrl);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    sha256 = await sha256Hex(buffer);

    const upload = await supabase.storage
      .from(SPRAY_REPORT_ASSET_BUCKET)
      .upload(objectPath, new Blob([buffer], { type: "image/png" }), {
        contentType: "image/png",
        upsert: false,
      });

    // A duplicate means the identical object already exists — never overwrite it,
    // and continue to registration so the canonical winner is resolved.
    const duplicate =
      !!upload.error &&
      /exist|duplicate|409/i.test(
        `${(upload.error as any).message ?? ""} ${(upload.error as any).statusCode ?? ""}`,
      );
    if (upload.error && !duplicate) {
      return { image: local, warning: ROUTE_UPLOAD_FAILED_MESSAGE, route: null };
    }
  } catch {
    return { image: local, warning: ROUTE_UPLOAD_FAILED_MESSAGE, route: null };
  }

  let canonical: SprayReportRoute | null = null;
  try {
    const { data, error } = await (supabase as any).rpc("register_spray_report_route_asset_v1", {
      p_trip_id: payload.identity.tripId,
      p_bucket: SPRAY_REPORT_ASSET_BUCKET,
      p_object_path: objectPath,
      p_sha256: sha256,
      p_route_hash: routeHash,
      p_style_version: SPRAY_ROUTE_STYLE_VERSION,
    });
    if (error) {
      return { image: local, warning: ROUTE_REGISTER_FAILED_MESSAGE, route: null };
    }
    canonical = normaliseRoute(data);
  } catch {
    return { image: local, warning: ROUTE_REGISTER_FAILED_MESSAGE, route: null };
  }

  if (!canonical) {
    return { image: local, warning: ROUTE_REGISTER_FAILED_MESSAGE, route: null };
  }

  // Another export may have registered first: the RPC returns that immutable
  // winner, which must be embedded instead of the local alternative.
  if (canonical.objectPath !== objectPath || canonical.bucket !== SPRAY_REPORT_ASSET_BUCKET) {
    const winner = await downloadRouteObject(canonical.bucket, canonical.objectPath);
    if (winner) return { image: winner, warning: null, route: canonical };
    return { image: local, warning: ROUTE_DOWNLOAD_FAILED_MESSAGE, route: canonical };
  }

  return { image: local, warning: null, route: canonical };
}

/** Back-compatible helper used by callers that only need the image. */
export async function resolveSprayRouteImage(
  payload: SprayReportPayloadV1,
  pathPoints: LatLng[],
): Promise<ResolvedRouteImage | null> {
  const res = await resolveSprayRoute(payload, pathPoints);
  return res.image;
}
