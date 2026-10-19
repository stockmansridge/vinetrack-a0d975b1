import { verifySystemAdmin } from '../_shared/satellite-cdse.ts';
import { cloudClient, response, corsHeaders, PROVIDER_EXECUTION_VALIDATED } from '../_shared/satellite-ingestion-runtime.ts';
import { PILOT_VINEYARD } from '../_shared/satellite-ingestion-core.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  const admin = await verifySystemAdmin(req); if (!admin.ok) return response({ error: admin.message }, admin.status);
  let body: { vineyard_id?: unknown }; try { body = await req.json(); } catch { return response({ error: 'invalid_json' }, 400); }
  if (body.vineyard_id !== PILOT_VINEYARD) return response({ error: 'pilot_scope_only' }, 403);
  try {
    const db = cloudClient();
    const results = await Promise.all([
      db.from('satellite_ingestion_control').select('scope,scope_key,enabled,reason,changed_at'),
      db.from('satellite_work_items').select('id,paddock_id,status,lane,due_at,heartbeat_at,lease_expires_at,last_error').eq('vineyard_id', PILOT_VINEYARD).limit(1000),
      db.from('satellite_freshness').select('*').eq('vineyard_id', PILOT_VINEYARD),
      db.from('satellite_provider_budget').select('*').order('period_start', { ascending: false }).limit(12),
      db.from('satellite_ingest_runs').select('id,kind,status,reason,started_at,completed_at,heartbeat_at,provider_calls,no_op').eq('vineyard_id', PILOT_VINEYARD).order('started_at', { ascending: false }).limit(10),
    ]);
    if (results.some((r) => r.error)) return response({ error: 'diagnostics_unavailable' }, 503);
    const work = results[1].data ?? [], queue: Record<string, number> = {};
    for (const row of work) queue[row.status] = (queue[row.status] ?? 0) + 1;
    return response({ controls: results[0].data, queue, work, freshness: results[2].data, budgets: results[3].data, receipts: results[4].data,
      scheduler_verified: false, provider_execution_validated: PROVIDER_EXECUTION_VALIDATED, historical_queue_seeded: false });
  } catch { return response({ error: 'diagnostics_unavailable' }, 503); }
});