// satellite-search-scenes
// Auth: system admin (verified against VineTrack iOS project).
// Behaviour: search CDSE Catalog for Sentinel-2 L2A scenes intersecting the
// paddock bbox in the requested date window, filter by scene cloud cover, and
// return newest-first candidates. Does NOT create scene DB records.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin,
  getServiceClient, parseGeometryRings, computeBbox,
  QC, SENTINEL2_COLLECTION, PROVIDER, CdseConfigError, CdseAuthError, ProviderError,
  CDSE_CATALOG_URL, getCdseAccessTokenWithMetadata, sanitiseProviderPreview, catalogErrorCode,
} from "../_shared/satellite-cdse.ts";

function logStage(stage: string, metadata: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ function: "satellite-search-scenes", stage, ...metadata }));
}

function isValidBbox(bbox: [number, number, number, number] | null): bbox is [number, number, number, number] {
  if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const [west, south, east, north] = bbox;
  return west >= -180 && west <= 180 && east >= -180 && east <= 180 &&
    south >= -90 && south <= 90 && north >= -90 && north <= 90 &&
    west < east && south < north;
}

function startOfUtcDay(date: Date) {
  return date.toISOString().slice(0, 10) + "T00:00:00Z";
}

function endOfUtcDay(date: Date) {
  return date.toISOString().slice(0, 10) + "T23:59:59Z";
}

Deno.serve(async (req) => {
  logStage("request_received", { method: req.method });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);
  logStage("user_authenticated", { user_id: admin.userId });
  logStage("admin_verified", { user_id: admin.userId });

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const { vineyard_id, paddock_id, date_start, date_end, max_cloud_cover, limit } = body ?? {};
  if (!vineyard_id || !paddock_id) return jsonError(400, "bad_request", "vineyard_id and paddock_id are required");

  const supa = getServiceClient();

  // Load paddock from VineTrack (iOS) project since that's the source of truth.
  const vtUrl = Deno.env.get("VINETRACK_SUPABASE_URL")!;
  const vtSrk = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY")!;
  const vtRes = await fetch(`${vtUrl}/rest/v1/paddocks?id=eq.${paddock_id}&select=id,vineyard_id,polygon_points,name`, {
    headers: { apikey: vtSrk, Authorization: `Bearer ${vtSrk}` },
  });
  if (!vtRes.ok) return jsonError(500, "paddock_lookup_failed", "Could not load paddock.");
  const [paddock] = await vtRes.json();
  if (!paddock) return jsonError(404, "paddock_not_found", "Paddock not found.");
  logStage("paddock_loaded", {
    paddock_id,
    paddock_name: paddock.name ?? null,
    vineyard_id: paddock.vineyard_id ?? null,
  });

  const polys = parseGeometryRings(paddock.polygon_points);
  logStage("geometry_parsed", {
    paddock_id,
    paddock_name: paddock.name ?? null,
    polygon_count: polys.length,
    ring_count: polys.reduce((sum, poly) => sum + poly.length, 0),
  });
  if (polys.length === 0) return jsonError(422, "geometry_invalid", "Paddock geometry is missing or invalid.");
  const bbox = computeBbox(polys);
  logStage("bbox_validated", {
    paddock_id,
    paddock_name: paddock.name ?? null,
    bbox,
    coordinate_order: "longitude_latitude",
    valid: isValidBbox(bbox),
  });
  if (!isValidBbox(bbox)) {
    return jsonError(422, "invalid_bbox", "The paddock boundary produced an invalid satellite search area.");
  }

  const start = date_start ?? startOfUtcDay(new Date(Date.now() - 90 * 86400_000));
  const end = date_end ?? endOfUtcDay(new Date());
  const lim = Math.min(Math.max(Number(limit ?? 20), 1), 50);
  const datetime = `${start}/${end}`;

  try {
    logStage("cdse_token_request_started", { endpoint: "identity.dataspace.copernicus.eu", grant_type: "client_credentials" });
    const tokenResult = await getCdseAccessTokenWithMetadata();
    logStage("cdse_token_request_completed", {
      status: tokenResult.status,
      token_received: Boolean(tokenResult.token),
      token_type: tokenResult.tokenType ?? "Bearer",
      expires_in_present: tokenResult.expiresInPresent,
      from_cache: tokenResult.fromCache,
    });

    const catalogBody = {
      bbox,
      datetime,
      collections: [SENTINEL2_COLLECTION],
      limit: lim,
    };
    logStage("catalog_request_started", {
      endpoint: CDSE_CATALOG_URL,
      collection: SENTINEL2_COLLECTION,
      bbox,
      datetime,
      limit: lim,
    });

    const catalogRes = await fetch(CDSE_CATALOG_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        "Content-Type": "application/json",
        Accept: "application/geo+json, application/json",
      },
      body: JSON.stringify(catalogBody),
    });
    const contentType = catalogRes.headers.get("content-type");
    const rawText = await catalogRes.text();
    const providerBodyPreview = sanitiseProviderPreview(rawText, 1000);
    logStage("catalog_request_completed", {
      endpoint: CDSE_CATALOG_URL,
      status: catalogRes.status,
      content_type: contentType,
      collection: SENTINEL2_COLLECTION,
      bbox,
      datetime,
      ...(catalogRes.ok ? {} : { provider_body_preview: providerBodyPreview }),
    });

    if (!catalogRes.ok) {
      throw new ProviderError(
        catalogRes.status,
        catalogErrorCode(catalogRes.status),
        "Catalog search failed.",
        contentType,
        providerBodyPreview,
      );
    }

    let search: any;
    try {
      search = JSON.parse(rawText);
    } catch {
      logStage("catalog_response_parsed", { valid_json: false, features_present: false });
      return jsonError(502, "catalog_invalid_response", "Copernicus returned an invalid catalog response.", {
        provider_status: catalogRes.status,
      });
    }

    const features = Array.isArray(search.features) ? (search.features as any[]) : null;
    logStage("catalog_response_parsed", {
      valid_json: true,
      features_present: Array.isArray(features),
      feature_count: features?.length ?? null,
    });
    if (!features) {
      return jsonError(502, "catalog_invalid_response", "Copernicus returned an invalid catalog response.", {
        provider_status: catalogRes.status,
      });
    }

    if (features.length === 0) {
      logStage("scenes_returned", { paddock_id, vineyard_id, feature_count: 0, status: "no_scenes_found" });
      return jsonOk({ paddock_id, vineyard_id, bbox, scenes: [], candidates: [], status: "no_scenes_found" });
    }

    const features = (search.features ?? []) as any[];
    const candidates = features.map((f) => ({
      provider: PROVIDER,
      collection: SENTINEL2_COLLECTION,
      provider_scene_id: f.id,
      acquired_at: f.properties?.datetime,
      scene_cloud_cover_pct: f.properties?.["eo:cloud_cover"] ?? null,
      metadata: {
        platform: f.properties?.platform,
        instruments: f.properties?.instruments,
        mgrs: f.properties?.["mgrs:utm_zone"] ? `${f.properties["mgrs:utm_zone"]}${f.properties["mgrs:latitude_band"]}${f.properties["mgrs:grid_square"]}` : null,
      },
    })).sort((a, b) => (b.acquired_at ?? "").localeCompare(a.acquired_at ?? ""));

    logStage("scenes_returned", {
      paddock_id,
      vineyard_id,
      feature_count: candidates.length,
      latest_three_acquired_at: candidates.slice(0, 3).map((c) => c.acquired_at),
      latest_three_cloud_cover_pct: candidates.slice(0, 3).map((c) => c.scene_cloud_cover_pct),
    });
    return jsonOk({ paddock_id, vineyard_id, bbox, candidates, scenes: candidates });
  } catch (e) {
    if (e instanceof CdseConfigError) return jsonError(503, e.code, e.message);
    if (e instanceof CdseAuthError) {
      logStage("cdse_token_request_completed", {
        status: e.status ?? null,
        content_type: e.contentType ?? null,
        provider_body_preview: e.bodyPreview ?? null,
      });
      return jsonError(502, e.code, e.message, { provider_status: e.status });
    }
    if (e instanceof ProviderError) {
      const status = e.status === 429 ? 429 : 502;
      return jsonError(status, e.code, e.message, { provider_status: e.status });
    }
    console.error("[satellite-search-scenes] unexpected", e);
    return jsonError(500, "internal_error", "Unexpected error searching scenes.");
  }
});
