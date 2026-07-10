// satellite-list-scenes
// Auth: system admin. Returns processed scenes (with raster assets + summaries)
// for a paddock or all paddocks in a vineyard. Portal reads live here — ordinary
// authenticated users cannot query the satellite tables directly.
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
  const { vineyard_id, paddock_id } = body ?? {};
  if (!vineyard_id) return jsonError(400, "bad_request", "vineyard_id is required");

  const supa = getServiceClient();

  let q = supa.from("satellite_scenes")
    .select("id, vineyard_id, paddock_id, provider, collection, provider_scene_id, acquired_at, scene_cloud_cover_pct, paddock_valid_coverage_pct, paddock_cloud_cover_pct, spatial_resolution_m, quality_status, processing_status")
    .eq("vineyard_id", vineyard_id)
    .order("acquired_at", { ascending: false })
    .limit(200);
  if (paddock_id && paddock_id !== "all") q = q.eq("paddock_id", paddock_id);
  const { data: scenes, error } = await q;
  if (error) return jsonError(500, "read_failed", error.message);

  const sceneIds = (scenes ?? []).map((s) => s.id);
  const [assetsRes, summariesRes] = await Promise.all([
    sceneIds.length ? supa.from("satellite_raster_assets").select("*").in("satellite_scene_id", sceneIds) : { data: [], error: null },
    sceneIds.length ? supa.from("satellite_index_summaries").select("*").in("satellite_scene_id", sceneIds) : { data: [], error: null },
  ]);

  return jsonOk({
    scenes: scenes ?? [],
    assets: assetsRes.data ?? [],
    summaries: summariesRes.data ?? [],
  });
});
