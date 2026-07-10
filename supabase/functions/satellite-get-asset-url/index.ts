// satellite-get-asset-url
// Auth: system admin. Returns a short-lived signed URL for a private raster.
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
  const storage_path: string | undefined = body?.storage_path;
  const asset_id: string | undefined = body?.asset_id;
  if (!storage_path && !asset_id) return jsonError(400, "bad_request", "storage_path or asset_id required");

  const supa = getServiceClient();
  let path = storage_path;
  if (!path && asset_id) {
    const { data, error } = await supa.from("satellite_raster_assets").select("storage_path").eq("id", asset_id).maybeSingle();
    if (error || !data) return jsonError(404, "asset_not_found", "Asset not found");
    path = data.storage_path;
  }
  const { data: signed, error: sErr } = await supa.storage.from("satellite-assets").createSignedUrl(path!, 600);
  if (sErr || !signed) return jsonError(500, "sign_failed", sErr?.message ?? "Failed to sign URL");
  return jsonOk({ signed_url: signed.signedUrl, expires_in: 600 });
});
