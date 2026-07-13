// satellite-get-asset
// Auth: system admin. Streams the bytes of a stored raster asset directly
// (display PNG or analytical GeoTIFF) with strong caching semantics so the
// browser can rely on IndexedDB + HTTP 304 instead of ephemeral signed URLs.
//
// - ETag is the immutable pair `${asset_id}:${processing_version}`. Asset
//   bytes never change; reprocessing creates a new asset row.
// - Cache-Control: private, max-age=31536000, immutable.
// - If-None-Match matching returns 304 with no body.
//
// Input: POST { asset_id }  OR  GET ?asset_id=...
import {
  corsHeaders, jsonError, verifySystemAdmin, getServiceClient,
} from "../_shared/satellite-cdse.ts";

function pickAssetId(req: Request, body: any): string | null {
  if (typeof body?.asset_id === "string" && body.asset_id) return body.asset_id;
  try {
    const u = new URL(req.url);
    const v = u.searchParams.get("asset_id");
    if (v) return v;
  } catch { /* ignore */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonError(405, "method_not_allowed", "Method not allowed");
  }

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any = null;
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* body optional for GET-style */ }
  }
  const asset_id = pickAssetId(req, body);
  if (!asset_id) return jsonError(400, "bad_request", "asset_id required");

  const supa = getServiceClient();
  const { data: asset, error: aErr } = await supa
    .from("satellite_raster_assets")
    .select("id, storage_path, mime_type, asset_type, processing_version")
    .eq("id", asset_id)
    .maybeSingle();
  if (aErr) return jsonError(500, "read_failed", aErr.message);
  if (!asset) return jsonError(404, "asset_not_found", "Asset not found");

  const etag = `"${asset.id}:${asset.processing_version ?? "unknown"}"`;
  const ifNoneMatch = req.headers.get("If-None-Match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeaders,
        ETag: etag,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  const { data: blob, error: dErr } = await supa.storage
    .from("satellite-assets")
    .download(asset.storage_path);
  if (dErr || !blob) return jsonError(500, "download_failed", dErr?.message ?? "Failed to download asset");

  const contentType = asset.mime_type
    ?? (asset.storage_path.endsWith(".png") ? "image/png"
      : asset.storage_path.endsWith(".tif") || asset.storage_path.endsWith(".tiff") ? "image/tiff"
      : "application/octet-stream");

  return new Response(blob.stream(), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
    },
  });
});
