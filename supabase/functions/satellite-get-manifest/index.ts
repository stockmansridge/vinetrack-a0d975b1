// satellite-get-manifest
// Auth: system admin. Returns the per-paddock imagery manifest for a vineyard.
// This is the fast client read that replaces recomputing completeness from
// raw scenes/assets/summaries on every page visit.
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
  const vineyard_id: string | undefined = body?.vineyard_id;
  if (!vineyard_id) return jsonError(400, "bad_request", "vineyard_id is required");

  const supa = getServiceClient();
  const { data, error } = await supa
    .from("satellite_paddock_manifest")
    .select("*")
    .eq("vineyard_id", vineyard_id);
  if (error) return jsonError(500, "read_failed", error.message);

  const rows = data ?? [];
  const updated_at = rows.reduce<string | null>((acc, r: any) => {
    const u = r.updated_at as string | null;
    if (!u) return acc;
    return !acc || u > acc ? u : acc;
  }, null);

  return jsonOk({
    manifest_version: "v1",
    vineyard_id,
    updated_at,
    paddocks: rows,
  });
});
