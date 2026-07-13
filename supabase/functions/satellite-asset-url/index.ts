// satellite-asset-url
// Auth: system admin. Returns a short-lived signed URL for a single raster
// asset by id, plus caching hints (etag/last-modified) the client can use
// to key IndexedDB blob storage.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
} from "../_shared/satellite-cdse.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const asset_id: string | undefined = body?.asset_id;
  if (!asset_id) return jsonError(400, "bad_request", "asset_id is required");

  const supa = getServiceClient();
  const { data: asset, error } = await supa
    .from("satellite_raster_assets")
    .select("id, storage_path, processing_version, updated_at, asset_type, index_type, content_type")
    .eq("id", asset_id)
    .maybeSingle();
  if (error) return jsonError(500, "read_failed", error.message);
  if (!asset) return jsonError(404, "asset_not_found", "Asset not found");

  const { data: signed, error: sErr } = await supa.storage
    .from("satellite-assets")
    .createSignedUrl(asset.storage_path, 600);
  if (sErr || !signed) return jsonError(500, "sign_failed", sErr?.message ?? "Failed to sign URL");

  const etag = `${asset.id}:${asset.processing_version ?? "unknown"}`;
  return jsonOk({
    asset_id: asset.id,
    signed_url: signed.signedUrl,
    expires_in: 600,
    etag,
    last_modified: asset.updated_at,
    processing_version: asset.processing_version,
    asset_type: asset.asset_type,
    index_type: asset.index_type,
    content_type: (asset as any).content_type ?? null,
  });
});
