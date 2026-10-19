// VineTrack Crop Health pilot scheduler (Stockman's Ridge only).
// Inert by default: with SCHEDULER_ENABLED !== 'true' every dispatch returns
// before any network call, so scheduled receipts are HTTP 200 idle/no_op with
// ZERO provider requests. The Lovable Cloud functions additionally refuse all
// work while the ingestion kill switches are OFF.
interface Environment { SCHEDULER_ENABLED: string; FUNCTION_ORIGIN: string; MACHINE_TOKEN: string }
// Distinct UTC routes per kind; unknown triggers are rejected loudly, never guessed.
const ROUTES: Record<string, { kind: 'discovery' | 'worker'; fn: string }> = {
  '0 2 * * *': { kind: 'discovery', fn: 'satellite-ingestion-discover' },   // daily 02:00 UTC
  '*/10 * * * *': { kind: 'worker', fn: 'satellite-ingestion-worker' },     // every 10 minutes UTC
};
const VINEYARD = 'fe952afe-437f-4be7-8cbf-fdd8e630411c';
export default {
  async scheduled(event: { cron: string; scheduledTime: number }, env: Environment) {
    const route = ROUTES[event.cron];
    if (!route) throw new Error(`Unrecognised cron trigger: ${event.cron}`);
    if (env.SCHEDULER_ENABLED !== 'true') {
      console.log(JSON.stringify({ kind: route.kind, disabled: true, provider_calls: 0 }));
      return;
    }
    const origin = new URL(env.FUNCTION_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || !env.MACHINE_TOKEN) throw new Error('Invalid scheduler configuration');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${route.kind}:${event.scheduledTime}`));
    const h = [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('');
    const correlation = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const res = await fetch(env.FUNCTION_ORIGIN.replace(/\/$/, '') + '/' + route.fn, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(70000),
      headers: { Authorization: `Bearer ${env.MACHINE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ correlation_id: correlation, vineyard_id: VINEYARD }),
    });
    const body = await res.json() as { run_id?: string; provider_calls?: number; no_op?: boolean };
    if (!res.ok) throw new Error(`Scheduler callback HTTP ${res.status}`);
    console.log(JSON.stringify({ kind: route.kind, run_id: body.run_id, provider_calls: body.provider_calls, no_op: body.no_op }));
  },
};
