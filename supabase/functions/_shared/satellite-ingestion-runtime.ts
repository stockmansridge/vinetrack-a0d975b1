import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { PILOT_VINEYARD } from './satellite-ingestion-core.ts';
export { corsHeaders };
export function cloudClient() {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Cloud binding unavailable');
  return createClient(url, key, { auth: { persistSession: false } });
}
export function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
export function authenticateMachine(req: Request): boolean {
  const secret = Deno.env.get('SATELLITE_MACHINE_TOKEN');
  const supplied = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!secret || supplied.length !== secret.length) return false;
  let difference = 0; for (let i = 0; i < secret.length; i++) difference |= secret.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}
// A budget is necessary but not sufficient: real raster/runtime and publication
// compatibility acceptance must land before any controls can initiate requests.
export const PROVIDER_EXECUTION_VALIDATED = false;
export async function handleMachine(req: Request, kind: 'worker' | 'discovery') {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  if (!authenticateMachine(req)) return response({ error: 'machine_auth_required' }, 401);
  let body: { correlation_id?: unknown; vineyard_id?: unknown };
  try { body = await req.json(); } catch { return response({ error: 'invalid_json' }, 400); }
  if (body.vineyard_id != null && body.vineyard_id !== PILOT_VINEYARD) return response({ error: 'pilot_scope_only' }, 403);
  const correlation = body.correlation_id ?? crypto.randomUUID();
  if (typeof correlation !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(correlation)) return response({ error: 'invalid_correlation_id' }, 400);
  try {
    const db = cloudClient();
    const { data: previous, error: previousError } = await db.from('satellite_ingest_runs').select('id,status,reason,provider_calls,no_op').eq('correlation_id', correlation).maybeSingle();
    if (previousError) throw previousError;
    if (previous) return response({ ...previous, duplicate: true });
    const { data: receipt, error: insertError } = await db.from('satellite_ingest_runs').insert({ kind, correlation_id: correlation, vineyard_id: PILOT_VINEYARD }).select('id').single();
    if (insertError?.code === '23505') return response({ duplicate: true, provider_calls: 0, no_op: true });
    if (insertError || !receipt) throw insertError ?? new Error('Receipt unavailable');
    const { data: enabled, error: controlError } = await db.rpc('satellite_pipeline_enabled', { p_vineyard: PILOT_VINEYARD, p_provider: 'EARTH_SEARCH_SENTINEL_2', p_pixels: kind === 'worker' });
    const reason = controlError ? 'controls_unavailable_fail_closed' : !enabled ? 'disabled' : !PROVIDER_EXECUTION_VALIDATED ? 'runtime_and_publication_acceptance_required' : 'idle';
    // Deliberately no discovery/claim/geometry/provider/storage calls in this
    // released foundation. Old jobs are not imported, expired or resumed.
    const { error: finishError } = await db.from('satellite_ingest_runs').update({ status: 'idle', reason, completed_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), provider_calls: 0, no_op: true }).eq('id', receipt.id);
    if (finishError) throw finishError;
    return response({ run_id: receipt.id, kind, reason, no_op: true, provider_calls: 0 });
  } catch { return response({ error: 'receipt_failed', provider_calls: 0 }, 503); }
}
export async function canonicalPilotGeometry(paddockId: string) {
  const url = Deno.env.get('VINETRACK_SUPABASE_URL'), key = Deno.env.get('VINETRACK_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Canonical vineyard binding unavailable');
  const vt = createClient(url, key, { auth: { persistSession: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) } });
  const [{ data: paddock, error }, { data: members, error: memberError }] = await Promise.all([
    vt.from('paddocks').select('id,vineyard_id,polygon_points,deleted_at').eq('id', paddockId).eq('vineyard_id', PILOT_VINEYARD).is('deleted_at', null).maybeSingle(),
    vt.from('vineyard_members').select('user_id').eq('vineyard_id', PILOT_VINEYARD).limit(1),
  ]);
  if (error || memberError || !paddock || !members?.length || !paddock.polygon_points) throw new Error('Canonical geometry/membership validation failed');
  return paddock;
}