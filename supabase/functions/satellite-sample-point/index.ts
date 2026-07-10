// satellite-sample-point
// Auth: system admin. Returns the ACTUAL Sentinel-2 index value at a single
// coordinate, sampled via CDSE Statistical API over a small (~15 m) buffer
// around the point. No synthetic, estimated or interpolated values.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin,
  statisticsQuery, statsEvalscript, INDEX_TYPES,
  CdseConfigError, CdseAuthError, ProviderError,
  type IndexType,
} from "../_shared/satellite-cdse.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const { lat, lng, acquired_at, index_type } = body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number")
    return jsonError(400, "bad_request", "lat and lng are required numbers");
  if (!acquired_at) return jsonError(400, "bad_request", "acquired_at is required");
  if (!index_type || !(INDEX_TYPES as readonly string[]).includes(index_type))
    return jsonError(400, "bad_request", "index_type is invalid");
  if (index_type === "TRUE_COLOUR")
    return jsonError(400, "unsupported_index", "TRUE_COLOUR has no scalar value to sample");

  // Build a ~15 m half-side square buffer around the point.
  // 1 degree latitude ~ 111,320 m; longitude scales by cos(lat).
  const halfSideM = 15;
  const dLat = halfSideM / 111320;
  const dLng = halfSideM / (111320 * Math.cos((lat * Math.PI) / 180));
  const west = lng - dLng, east = lng + dLng;
  const south = lat - dLat, north = lat + dLat;
  const bbox: [number, number, number, number] = [west, south, east, north];
  const geometry = {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };

  // One-day window straddling the scene acquisition date.
  const acq = new Date(acquired_at);
  const dayStart = new Date(acq); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(acq); dayEnd.setUTCHours(23, 59, 59, 999);

  try {
    const stats = await statisticsQuery({
      geometry, bbox,
      dateStart: dayStart.toISOString(),
      dateEnd: dayEnd.toISOString(),
      evalscript: statsEvalscript(index_type as Exclude<IndexType, "TRUE_COLOUR">),
      resolutionM: 10,
    });
    const interval = stats?.data?.[0];
    const s = interval?.outputs?.index?.bands?.B0?.stats;
    const sampleCount = Number(s?.sampleCount ?? 0);
    const noDataCount = Number(s?.noDataCount ?? 0);
    const validCount = Math.max(0, sampleCount - noDataCount);
    const mean = Number(s?.mean);
    if (!Number.isFinite(mean) || validCount === 0) {
      return jsonOk({ value: null, valid_pixels: validCount, reason: "no_valid_pixels" });
    }
    return jsonOk({
      value: mean,
      min: Number.isFinite(Number(s?.min)) ? Number(s.min) : null,
      max: Number.isFinite(Number(s?.max)) ? Number(s.max) : null,
      valid_pixels: validCount,
      total_pixels: sampleCount,
    });
  } catch (e) {
    if (e instanceof CdseConfigError) return jsonError(503, e.code, e.message);
    if (e instanceof CdseAuthError) return jsonError(502, e.code, e.message);
    if (e instanceof ProviderError) return jsonError(e.status === 429 ? 429 : 502, e.code, e.message);
    return jsonError(500, "internal_error", (e as Error)?.message ?? "Sample failed");
  }
});
