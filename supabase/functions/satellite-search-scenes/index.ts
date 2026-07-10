// satellite-search-scenes
// Auth: system admin (verified against VineTrack iOS project).
// Behaviour: search CDSE Catalog for Sentinel-2 L2A scenes intersecting the
// paddock bbox in the requested date window, filter by scene cloud cover, and
// return newest-first candidates. Does NOT create scene DB records.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin,
  getServiceClient, parseGeometryRings, computeBbox,
  catalogSearch, QC, SENTINEL2_COLLECTION, PROVIDER, CdseConfigError, CdseAuthError, ProviderError,
} from "../_shared/satellite-cdse.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

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

  const polys = parseGeometryRings(paddock.polygon_points);
  if (polys.length === 0) return jsonError(422, "geometry_invalid", "Paddock geometry is missing or invalid.");
  const bbox = computeBbox(polys);
  if (!bbox) return jsonError(422, "geometry_invalid", "Paddock geometry has no valid extent.");

  const start = date_start ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  const end = date_end ?? new Date().toISOString();
  const maxCC = Math.min(Number(max_cloud_cover ?? QC.maxCatalogueCloudCoverPct), QC.maxCatalogueCloudCoverPct);
  const lim = Math.min(Math.max(Number(limit ?? 20), 1), 50);

  try {
    const search = await catalogSearch({
      bbox, dateStart: start, dateEnd: end, maxCloudCoverPct: maxCC, limit: lim,
    });
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

    return jsonOk({ paddock_id, vineyard_id, bbox, candidates });
  } catch (e) {
    if (e instanceof CdseConfigError) return jsonError(503, e.code, e.message);
    if (e instanceof CdseAuthError) return jsonError(502, e.code, e.message);
    if (e instanceof ProviderError) return jsonError(e.status === 429 ? 429 : 502, e.code, e.message);
    console.error("[satellite-search-scenes] unexpected", e);
    return jsonError(500, "internal_error", "Unexpected error searching scenes.");
  }
});
