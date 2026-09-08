// Spray Report route image resolution.
//
// The route image is private, generated once, and reused by all exporters.
// Portal never invents a second style: the only style is
// `spray-route-red-green-v1` defined in satelliteRouteMap.ts.
import { supabase } from "@/integrations/ios-supabase/client";
import { composeSatelliteRouteImage, type LatLng } from "./satelliteRouteMap";
import {
  SPRAY_REPORT_ASSET_BUCKET,
  SPRAY_ROUTE_STYLE_VERSION,
  type SprayReportPayloadV1,
} from "./sprayReportV1";

export interface ResolvedRouteImage {
  dataUrl: string;
  width: number;
  height: number;
  /** True when the portal had to generate + persist the asset this run. */
  generated: boolean;
}

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

export function routeObjectPath(payload: SprayReportPayloadV1, routeHash: string): string {
  return `${payload.identity.vineyardId}/${payload.identity.tripId}/${SPRAY_ROUTE_STYLE_VERSION}-${routeHash}.png`;
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

/**
 * Returns the embeddable route image for a spray report.
 * - payload.route present → fetch the private object referenced by the payload.
 * - payload.route absent → generate the deterministic fallback once, upload it,
 *   and register the metadata through the controlled backend path.
 */
export async function resolveSprayRouteImage(
  payload: SprayReportPayloadV1,
  pathPoints: LatLng[],
): Promise<ResolvedRouteImage | null> {
  if (payload.route) {
    const existing = await downloadRouteObject(payload.route.bucket, payload.route.objectPath);
    if (existing) return existing;
  }

  if (!pathPoints || pathPoints.length < 2) return null;

  const composed = await composeSatelliteRouteImage(pathPoints, 1100, 660, {
    chronology: true,
  });
  if (!composed) return null;

  const routeHash = routeHashForPoints(pathPoints);
  const objectPath = routeObjectPath(payload, routeHash);
  try {
    const bytes = dataUrlToBytes(composed.dataUrl);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const sha256 = await sha256Hex(buffer);
    const upload = await supabase.storage
      .from(SPRAY_REPORT_ASSET_BUCKET)
      .upload(objectPath, new Blob([buffer], { type: "image/png" }), {
        contentType: "image/png",
        upsert: false,
      });

    // A duplicate means another exporter already generated it — reuse, don't replace.
    if (!upload.error) {
      await (supabase as any).from("trip_report_assets").insert({
        trip_id: payload.identity.tripId,
        vineyard_id: payload.identity.vineyardId,
        bucket: SPRAY_REPORT_ASSET_BUCKET,
        object_path: objectPath,
        sha256,
        route_hash: routeHash,
        style_version: SPRAY_ROUTE_STYLE_VERSION,
      });
    }
  } catch {
    // Persistence is best-effort; the export still embeds the generated image.
  }

  return {
    dataUrl: composed.dataUrl,
    width: composed.width,
    height: composed.height,
    generated: true,
  };
}
