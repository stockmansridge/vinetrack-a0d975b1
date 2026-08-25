// Single authoritative hemisphere resolver for the Portal.
//
// Contract (matches the VineTrack cross-platform rule):
//   1. Vineyard GPS latitude is authoritative whenever it is valid.
//   2. If the vineyard has no stored latitude, derive it from block/paddock
//      polygon geometry (real recorded GPS for the site).
//   3. Country is a fallback ONLY when no valid latitude exists anywhere.
//   4. Regional/unit settings (metric vs US) must NEVER affect hemisphere.
//
// latitude < 0 → southern, latitude > 0 → northern. Exactly 0 (equator) is
// treated as northern per the "latitude > 0 → Northern" boundary being the
// documented rule and southern requiring a strictly negative value.

export type Hemisphere = "southern" | "northern";

/** Countries used ONLY as a last-resort fallback when no GPS exists. */
const SOUTHERN_COUNTRIES = new Set(["AU", "NZ", "ZA", "AR", "CL", "UY", "BR", "PE", "BO"]);

export function isValidLatitude(lat: unknown): lat is number {
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

/** Pure latitude → hemisphere. */
export function hemisphereFromLatitude(lat: number): Hemisphere {
  return lat < 0 ? "southern" : "northern";
}

export function hemisphereFromCountry(code: string | null | undefined): Hemisphere {
  if (!code) return "southern";
  return SOUTHERN_COUNTRIES.has(code.toUpperCase()) ? "southern" : "northern";
}

export interface HemisphereInput {
  /** `vineyards.latitude` (authoritative when valid). */
  latitude?: number | null;
  /** Fallback latitude derived from block/paddock geometry. */
  geometryLatitude?: number | null;
  /** Region country code — fallback only. */
  countryCode?: string | null;
}

export interface HemisphereResult {
  hemisphere: Hemisphere;
  /** Which input decided the result. */
  source: "vineyard_latitude" | "geometry_latitude" | "country" | "default";
  /** The latitude actually used, when a latitude was available. */
  latitude: number | null;
}

export function resolveHemisphere(input: HemisphereInput): HemisphereResult {
  if (isValidLatitude(input.latitude)) {
    return {
      hemisphere: hemisphereFromLatitude(input.latitude),
      source: "vineyard_latitude",
      latitude: input.latitude,
    };
  }
  if (isValidLatitude(input.geometryLatitude)) {
    return {
      hemisphere: hemisphereFromLatitude(input.geometryLatitude),
      source: "geometry_latitude",
      latitude: input.geometryLatitude,
    };
  }
  if (input.countryCode) {
    return {
      hemisphere: hemisphereFromCountry(input.countryCode),
      source: "country",
      latitude: null,
    };
  }
  return { hemisphere: "southern", source: "default", latitude: null };
}

export function hemisphereLabel(h: Hemisphere): string {
  return h === "southern" ? "Southern Hemisphere" : "Northern Hemisphere";
}

/**
 * Mean latitude of any block/paddock polygon geometry for a vineyard.
 * Accepts the loose shapes stored in `paddocks.polygon_points`
 * (`{latitude,longitude}`, `{lat,lng}` or `[lat,lng]`).
 */
export function meanLatitudeFromPolygons(
  rows: Array<{ polygon_points?: unknown } | null | undefined>,
): number | null {
  let sum = 0;
  let count = 0;
  for (const row of rows ?? []) {
    const pts = (row as any)?.polygon_points;
    if (!Array.isArray(pts)) continue;
    for (const p of pts) {
      let lat: unknown = null;
      if (Array.isArray(p)) lat = p[0];
      else if (p && typeof p === "object") lat = (p as any).latitude ?? (p as any).lat;
      const n = typeof lat === "string" ? Number(lat) : lat;
      if (isValidLatitude(n) && n !== 0) {
        sum += n;
        count += 1;
      }
    }
  }
  return count > 0 ? sum / count : null;
}
