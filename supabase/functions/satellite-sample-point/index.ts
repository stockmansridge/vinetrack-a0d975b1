// satellite-sample-point
// Auth: system admin. Returns the ACTUAL Sentinel-2 index value at a single
// coordinate, sampled via CDSE Statistical API over a small buffer around the
// point. No synthetic, estimated or interpolated values.
//
// Sampling strategy:
//   1. Sample a ~30 m half-side buffer (60 x 60 m ≈ 36 pixels at 10 m). A
//      single-pixel polygon is unreliable on CDSE — small buffers frequently
//      return sampleCount=0 due to pixel-grid alignment.
//   2. If the small buffer returns zero valid pixels (edge/mask alignment),
//      retry once with a ~60 m half-side buffer (120 x 120 m ≈ 144 pixels).
//   3. Report diagnostics — sampled pixel count, no-data count, buffer used —
//      so the admin hover panel can distinguish "genuine no-data" from
//      "provider quirk".

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

  // One-day window straddling the scene acquisition date.
  const acq = new Date(acquired_at);
  const dayStart = new Date(acq); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(acq); dayEnd.setUTCHours(23, 59, 59, 999);

  const evalscript = statsEvalscript(index_type as Exclude<IndexType, "TRUE_COLOUR">);

  // Build a square buffer polygon around the point.
  const buildGeom = (halfSideM: number) => {
    const dLat = halfSideM / 111320;
    const dLng = halfSideM / (111320 * Math.cos((lat * Math.PI) / 180));
    const west = lng - dLng, east = lng + dLng;
    const south = lat - dLat, north = lat + dLat;
    const bbox: [number, number, number, number] = [west, south, east, north];
    const geometry = {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    };
    return { bbox, geometry };
  };

  // Attempt one CDSE statistics call, retrying on 429 with backoff.
  const sample = async (halfSideM: number) => {
    const { bbox, geometry } = buildGeom(halfSideM);
    const delays = [400, 1200, 2500];
    for (let i = 0; ; i++) {
      try {
        return await statisticsQuery({
          geometry, bbox,
          dateStart: dayStart.toISOString(),
          dateEnd: dayEnd.toISOString(),
          evalscript,
          resolutionM: 10,
        });
      } catch (err) {
        if (err instanceof ProviderError && err.status === 429 && i < delays.length) {
          await new Promise((r) => setTimeout(r, delays[i]));
          continue;
        }
        throw err;
      }
    }
  };

  const readStats = (stats: any) => {
    const interval = stats?.data?.[0];
    const s = interval?.outputs?.index?.bands?.B0?.stats;
    const sampleCount = Number(s?.sampleCount ?? 0);
    const noDataCount = Number(s?.noDataCount ?? 0);
    const validCount = Math.max(0, sampleCount - noDataCount);
    const mean = Number(s?.mean);
    return { s, sampleCount, noDataCount, validCount, mean };
  };

  try {
    // 1) Primary sample — ~30 m half-side (60 x 60 m, ≈36 pixels at 10 m).
    let halfSide = 30;
    let stats = await sample(halfSide);
    let r = readStats(stats);

    // 2) Fallback — widen once to 60 m half-side (120 x 120 m, ≈144 pixels).
    //    Handles pixel-grid alignment / narrow-edge misses.
    let widened = false;
    if (!Number.isFinite(r.mean) || r.validCount === 0) {
      widened = true;
      halfSide = 60;
      stats = await sample(halfSide);
      r = readStats(stats);
    }

    if (!Number.isFinite(r.mean) || r.validCount === 0) {
      return jsonOk({
        value: null,
        reason: "no_valid_pixels",
        diagnostics: {
          buffer_half_side_m: halfSide,
          sample_count: r.sampleCount,
          no_data_count: r.noDataCount,
          valid_pixel_count: r.validCount,
          widened,
        },
      });
    }

    return jsonOk({
      value: r.mean,
      min: Number.isFinite(Number(r.s?.min)) ? Number(r.s.min) : null,
      max: Number.isFinite(Number(r.s?.max)) ? Number(r.s.max) : null,
      valid_pixels: r.validCount,
      total_pixels: r.sampleCount,
      diagnostics: {
        buffer_half_side_m: halfSide,
        sample_count: r.sampleCount,
        no_data_count: r.noDataCount,
        valid_pixel_count: r.validCount,
        widened,
      },
    });
  } catch (e) {
    if (e instanceof CdseConfigError) return jsonError(503, e.code, e.message);
    if (e instanceof CdseAuthError) return jsonError(502, e.code, e.message);
    if (e instanceof ProviderError) {
      if (e.status === 429) {
        return jsonError(429, "rate_limited", "Provider is busy — hover again in a moment.");
      }
      return jsonError(502, e.code, e.message);
    }
    return jsonError(500, "internal_error", (e as Error)?.message ?? "Sample failed");
  }
});
