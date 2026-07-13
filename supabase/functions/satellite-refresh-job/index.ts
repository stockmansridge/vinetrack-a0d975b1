// satellite-refresh-job
// Auth: system admin.
// Single entry point for the vineyard-level refresh lock. Wraps the
// claim_refresh_job / heartbeat_refresh_job / finish_refresh_job SQL helpers
// so the browser never talks to those functions directly.
//
// action = "claim"     -> body: { vineyard_id, job_type, total_paddocks }
//                         returns { job }  or  409 { active_job } when a
//                         live job for the same (vineyard, job_type) exists.
// action = "heartbeat" -> body: { job_id, current_paddock_id?,
//                                 completed_paddocks?, failed_paddocks? }
// action = "finish"    -> body: { job_id, status, error? }
//                         status ∈ {complete, partial, failed, cancelled}
import {
  corsHeaders, jsonError, jsonOk, verifySystemAdmin, getServiceClient,
} from "../_shared/satellite-cdse.ts";

const JOB_TYPES = new Set(["provider_refresh", "asset_repair", "historical_backfill"]);
const FINAL_STATUSES = new Set(["complete", "partial", "failed", "cancelled"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");

  const admin = await verifySystemAdmin(req);
  if (!admin.ok) return jsonError(admin.status, "unauthorized", admin.message);

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request", "Invalid JSON"); }
  const action: string | undefined = body?.action;
  if (!action) return jsonError(400, "bad_request", "action is required");

  const supa = getServiceClient();

  if (action === "claim") {
    const { vineyard_id, job_type, total_paddocks } = body ?? {};
    if (!vineyard_id || !job_type) return jsonError(400, "bad_request", "vineyard_id and job_type are required");
    if (!JOB_TYPES.has(job_type)) return jsonError(400, "bad_request", "invalid job_type");
    const { data, error } = await (supa as any).rpc("claim_refresh_job", {
      p_vineyard_id: vineyard_id,
      p_job_type: job_type,
      p_requested_by: admin.userId,
      p_total_paddocks: Number(total_paddocks) || 0,
    });
    if (error) return jsonError(500, "claim_failed", error.message);
    if (!data) {
      // Someone else already holds the lock — return the active job.
      const { data: active } = await supa.from("satellite_refresh_jobs").select("*")
        .eq("vineyard_id", vineyard_id).eq("job_type", job_type)
        .in("status", ["queued", "running"])
        .order("started_at", { ascending: false }).limit(1).maybeSingle();
      return new Response(JSON.stringify({ error: "refresh_in_progress", active_job: active ?? null }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return jsonOk({ job: data });
  }

  if (action === "heartbeat") {
    const { job_id, current_paddock_id, completed_paddocks, failed_paddocks } = body ?? {};
    if (!job_id) return jsonError(400, "bad_request", "job_id is required");
    const { error } = await (supa as any).rpc("heartbeat_refresh_job", {
      p_job_id: job_id,
      p_current_paddock_id: current_paddock_id ?? null,
      p_completed_paddocks: typeof completed_paddocks === "number" ? completed_paddocks : null,
      p_failed_paddocks: typeof failed_paddocks === "number" ? failed_paddocks : null,
    });
    if (error) return jsonError(500, "heartbeat_failed", error.message);
    return jsonOk({ ok: true });
  }

  if (action === "finish") {
    const { job_id, status, error: errMsg } = body ?? {};
    if (!job_id || !status) return jsonError(400, "bad_request", "job_id and status are required");
    if (!FINAL_STATUSES.has(status)) return jsonError(400, "bad_request", "invalid status");
    const { error } = await (supa as any).rpc("finish_refresh_job", {
      p_job_id: job_id,
      p_status: status,
      p_error: errMsg ?? null,
    });
    if (error) return jsonError(500, "finish_failed", error.message);
    return jsonOk({ ok: true });
  }

  return jsonError(400, "bad_request", "unknown action");
});
