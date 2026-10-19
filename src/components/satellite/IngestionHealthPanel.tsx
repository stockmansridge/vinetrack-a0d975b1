import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { iosSupabase } from '@/integrations/ios-supabase/client';
import { bounded } from '@/lib/satelliteSavedLoader';
import { PILOT_VINEYARD } from '../../../supabase/functions/_shared/satellite-ingestion-core';
interface Receipt { id: string; kind: string; reason: string; heartbeat_at: string; provider_calls: number; }
interface Freshness { paddock_id: string; last_provider_check_at: string | null; newest_discovered_at: string | null; newest_usable_at: string | null; newest_verified_complete_at: string | null; }
interface Health { controls: { scope: string; scope_key: string; enabled: boolean }[]; queue: Record<string, number>; freshness: Freshness[]; receipts: Receipt[]; budgets: { provider: string; hard_spend_limit: number; spend_reserved: number; currency: string }[]; }
export default function IngestionHealthPanel({ vineyardId }: { vineyardId: string | null }) {
  const query = useQuery({ queryKey: ['satellite-ingestion-status', vineyardId], enabled: vineyardId === PILOT_VINEYARD, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => bounded(async (child) => {
      const { data: { session } } = await iosSupabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const { data, error } = await supabase.functions.invoke('satellite-ingestion-status', { body: { vineyard_id: vineyardId }, headers: { Authorization: `Bearer ${session.access_token}` }, signal: child });
      if (error) throw new Error('Ingestion diagnostics unavailable'); return data as Health;
    }, signal ?? new AbortController().signal, 10000, 'Ingestion diagnostics') });
  if (vineyardId !== PILOT_VINEYARD) return null;
  const data = query.data;
  return <section className="border-t pt-2 space-y-2 text-xs text-muted-foreground">
    <h3 className="font-semibold text-foreground">Replacement ingestion · disabled pilot</h3>
    {query.isLoading ? <p>Checking stored diagnostics…</p> : query.isError ? <p className="text-destructive">Diagnostics not checked: request failed or timed out.</p> : <>
      <p>Global: {data?.controls.some((c) => c.scope === 'global' && c.scope_key === 'all' && c.enabled) ? 'enabled' : 'off'} · Vineyard: {data?.controls.some((c) => c.scope === 'vineyard' && c.scope_key === vineyardId && c.enabled) ? 'enabled' : 'off'} · Pixel processing: {data?.controls.some((c) => c.scope === 'pixels' && c.enabled) ? 'enabled' : 'off'}</p>
      <p>Queued: {data?.queue.queued ?? 0} · Retry: {data?.queue.retry ?? 0} · Dead: {data?.queue.dead ?? 0} · Legacy backlog not imported</p>
      <p>Scheduler dispatch: not verified · Raster publication: locked pending capped pilot acceptance</p>
      {!data?.budgets.length ? <p>Monthly provider budget: not approved · provider requests blocked</p> : data.budgets.map((b, i) => <p key={i}>{b.provider}: {b.spend_reserved} / {b.hard_spend_limit} {b.currency}</p>)}
      {!data?.freshness.length ? <p>Provider check / discovered / usable / verified complete: not checked by replacement pipeline</p> : data.freshness.map((f) => <p key={f.paddock_id}>{f.paddock_id.slice(0, 8)} · check {f.last_provider_check_at ?? 'not checked'} · discovered {f.newest_discovered_at ?? 'none'} · usable {f.newest_usable_at ?? 'none'} · verified complete {f.newest_verified_complete_at ?? 'none'}</p>)}
      {!data?.receipts.length ? <p>Worker receipt: none</p> : data.receipts.map((r) => <p key={r.id}>{r.kind} · {r.reason} · {r.heartbeat_at} · {r.provider_calls} provider calls</p>)}
    </>}
  </section>;
}