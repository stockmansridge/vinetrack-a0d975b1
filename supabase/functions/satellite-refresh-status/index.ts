// satellite-refresh-status
// Auth: system admin. Returns the current active refresh job (if any) plus
// the most recent completed job for a vineyard + job_type. Runs
// expire_stale_refresh_jobs() first so callers always see recovered state.
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
} from "../_shared/satellite-cdse.ts";

const VALID_TYPES = new Set(["provider_refresh", "asset_repair", "historical_backfill"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const vineyard_id: string | undefined = body?.vineyard_id;
  const job_type: string | undefined = body?.job_type;
  if (!vineyard_id) return jsonError(400, "bad_request", "vineyard_id is required");
  if (job_type && !VALID_TYPES.has(job_type)) return jsonError(400, "bad_request", "invalid job_type");

  const supa = getServiceClient();
  // Best-effort: expire any stale locks before reading state.
  await (supa as any).rpc("expire_stale_refresh_jobs");

  let activeQ = supa.from("satellite_refresh_jobs").select("*")
    .eq("vineyard_id", vineyard_id)
    .in("status", ["queued", "running"])
    .order("started_at", { ascending: false })
    .limit(1);
  if (job_type) activeQ = activeQ.eq("job_type", job_type);
  const { data: activeRows, error: activeErr } = await activeQ;
  if (activeErr) return jsonError(500, "read_failed", activeErr.message);

  let lastQ = supa.from("satellite_refresh_jobs").select("*")
    .eq("vineyard_id", vineyard_id)
    .in("status", ["complete", "partial", "failed", "cancelled", "expired"])
    .order("completed_at", { ascending: false })
    .limit(1);
  if (job_type) lastQ = lastQ.eq("job_type", job_type);
  const { data: lastRows, error: lastErr } = await lastQ;
  if (lastErr) return jsonError(500, "read_failed", lastErr.message);

  return jsonOk({
    active_job: activeRows?.[0] ?? null,
    last_job: lastRows?.[0] ?? null,
  });
});
