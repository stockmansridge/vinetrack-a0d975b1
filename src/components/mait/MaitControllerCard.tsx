import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useIrrigationSystems, useIrrigationValves } from '@/lib/irrigationQuery';
import { maitRpc, maitProxy, maitModules, maitOutputs, maitRows, maitDateWindow, maitSyncCounts, maitControllerSyncState, MAIT_PROVIDER, MAIT_PARTIAL_WARNING, type MaitResult } from '@/lib/maitIntelliwebQuery';
import { MaitChoice, useMait } from './MaitWeatherCard';

type Row = Record<string, any>;
export function MaitSyncResult({ result }: { result: MaitResult }) {
  return <div className="space-y-3" role="status">{result.partial && <Alert variant="destructive"><AlertDescription>{MAIT_PARTIAL_WARNING}</AlertDescription></Alert>}{result.empty ? <p>MAIT returned no usage data for this range.</p> : <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{maitSyncCounts(result.data).map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold">{count ?? 'Not reported'}</dd></div>)}</dl>}</div>;
}
export function MaitSyncStatus({ data, moduleId, timezone }: { data: Row; moduleId: string; timezone: string }) {
  const state = maitControllerSyncState(data, moduleId);
  if (!state) return <p role="status" className="text-sm text-muted-foreground">No sync status recorded for this controller.</p>;
  const timestamp = (value: unknown) => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Not reported';
    return new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  };
  const values = [
    ['Last attempt', timestamp(state.last_attempt_at)], ['Last success', timestamp(state.last_success_at)],
    ['Received', state.records_received], ['Created / staged', state.records_created],
    ['Already existing', state.records_existing], ['Needs mapping', state.records_needing_mapping],
    ['Needs review', state.records_needing_review],
  ];
  return <div role="status" className="space-y-3">{state.incomplete_range === true && <Alert variant="destructive"><AlertDescription>{MAIT_PARTIAL_WARNING}</AlertDescription></Alert>}<dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{values.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold">{value ?? 'Not reported'}</dd></div>)}</dl></div>;
}
export function MaitControllerCard({ vineyardId }: { vineyardId: string }) {
  const { access, configuration, config, connected, timezone } = useMait(vineyardId);
  const systems = useIrrigationSystems(vineyardId);
  const valves = useIrrigationValves(vineyardId);
  const qc = useQueryClient();
  const [modules, setModules] = useState<Row[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [systemId, setSystemId] = useState('');
  const [outputs, setOutputs] = useState<Row[] | null>(null);
  const [notice, setNotice] = useState('');
  const [partialDiscovery, setPartialDiscovery] = useState(false);
  const [result, setResult] = useState<MaitResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<Row | null>(null);
  const controllers = config.controllerModules;
  const connection = config.connection;
  const controller = controllers.find(c => String(c.module_id) === moduleId);
  const selectedSystem = systemId || controller?.irrigation_system_id || '';
  const mappings = useQuery({ queryKey: ['mait', vineyardId, 'controller-mappings', moduleId], enabled: access.data?.manage === true && !!controller, queryFn: async () => maitRows(await maitRpc('get_mait_intelliweb_controller_mappings', vineyardId, { p_module_id: moduleId })) });
  const run = useMutation({ mutationFn: async (fn: () => Promise<unknown>) => { if (!access.data?.manage) throw new Error('You do not have permission to manage MAIT controllers.'); return fn(); }, onError: (e: Error) => setNotice(e.message) });
  const act = (fn: () => Promise<unknown>) => { setNotice(''); run.mutate(fn); };
  const moduleChoices = [...new Map([...controllers.map(c => ({ id: String(c.module_id), name: c.module_name ?? '' })), ...modules].map(m => [m.id, m])).values()];
  const mapRows = mappings.data ?? [];
  const ready = !!controller && !!connection.network_id && mapRows.some(m => m.irrigation_valve_id && m.ignore !== true && m.is_ignored !== true && (valves.data ?? []).some(v => v.id === m.irrigation_valve_id && v.irrigation_system_id === controller.irrigation_system_id));
  if (access.isPending) return <Card className="p-4">Checking MAIT access…</Card>;
  return <Card className="p-4 space-y-4"><h2 className="font-semibold">MAIT iNTELLiWeb controller</h2>
    {[access.error, configuration.error, mappings.error].filter(Boolean).map((e, i) => <Alert variant="destructive" key={i}><AlertDescription>{(e as Error).message}</AlertDescription></Alert>)}
    {!access.data?.manage ? <p className="text-sm text-muted-foreground">Your vineyard owner or manager manages controller setup and imports.</p> : !connected ? <>
      <p className="text-sm text-muted-foreground">Weather stations and irrigation controllers use the same MAIT network connection.</p><Button asChild variant="outline"><Link to="/setup/weather#mait">Connect MAIT in Weather setup</Link></Button>
    </> : <>
      <p className="text-sm text-muted-foreground">{connection.network_name || 'Connected MAIT network'}</p>
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      <Button variant="outline" disabled={run.isPending} onClick={() => act(async () => { const r = await maitProxy(vineyardId, 'modules'); setModules(maitModules(r.data)); if (r.empty) setNotice('MAIT returned no modules.'); })}>Load controller modules</Button>
      <div className="grid gap-3 sm:grid-cols-2"><MaitChoice label="Choose controller module" value={moduleId} onChange={v => { setModuleId(v); setSystemId(''); setOutputs(null); setResult(null); setSyncStatus(null); setPartialDiscovery(false); }} items={moduleChoices.map(m => ({ value: m.id, label: `${m.id} · ${m.name}` }))} /><MaitChoice label="VineTrack Irrigation System" value={selectedSystem} onChange={setSystemId} items={(systems.data ?? []).map(s => ({ value: s.id, label: s.name }))} /></div>
      {systems.error && <p className="text-sm text-destructive">Could not load irrigation systems.</p>}
      <Button disabled={run.isPending || !moduleId || !(systemId || selectedSystem)} onClick={() => act(async () => {
        await maitRpc('set_mait_intelliweb_controller_module', vineyardId, { p_module_id: moduleId, p_irrigation_system_id: systemId || selectedSystem, p_module_name: moduleChoices.find(m => m.id === moduleId)?.name || null }); await qc.invalidateQueries({ queryKey: ['mait', vineyardId] }); setOutputs(null); setNotice('Controller module saved. Review its output mappings.');
      })}>Save controller module</Button>
      {controller && <div className="space-y-3 border-t pt-4">
        <p className="text-sm font-medium">{controller.module_name || moduleId} · {(systems.data ?? []).find(s => s.id === selectedSystem)?.name ?? 'Irrigation system'}</p>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Controller identity</summary>{connection.network_id}:{moduleId}</details>
        <Button variant="outline" disabled={run.isPending} onClick={() => act(async () => { const r = await maitProxy(vineyardId, 'usage', { moduleId, ...maitDateWindow(timezone) }); setOutputs(maitOutputs(r.data)); setPartialDiscovery(r.partial); if (r.empty) setNotice('No MAIT outputs ran in the recent three-day window. Existing mappings remain available.'); })}>Discover recent outputs</Button>
        {partialDiscovery && <Alert variant="destructive"><AlertDescription>{MAIT_PARTIAL_WARNING}</AlertDescription></Alert>}
        {outputs && !outputs.length && <p className="text-sm text-muted-foreground">No usage outputs returned for the recent three-day window.</p>}
        {(outputs || mapRows.length > 0) && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">MAIT output</th><th className="p-2">MAIT name</th><th className="p-2">VineTrack valve</th><th className="p-2">Status</th></tr></thead><tbody>{[...new Map([...mapRows.map(m => ({ number: Number(m.external_valve_number ?? m.channel_number), name: m.external_valve_name ?? m.channel_name ?? '' })), ...(outputs ?? [])].map(o => [o.number, o])).values()].filter(o => Number.isFinite(o.number)).map(o => <OutputRow key={`${moduleId}:${selectedSystem}:${o.number}`} output={o} saved={mapRows.find(m => Number(m.external_valve_number ?? m.channel_number) === o.number)} vineyardId={vineyardId} controllerKey={`${connection.network_id}:${moduleId}`} controllerName={controller.module_name ?? moduleId} valves={(valves.data ?? []).filter(v => v.irrigation_system_id === selectedSystem)} onSaved={async () => { await mappings.refetch(); }} />)}</tbody></table></div>}
        {valves.error && <p className="text-sm text-destructive">Could not load valves.</p>}
        <Button disabled={run.isPending || !ready || selectedSystem !== controller.irrigation_system_id} onClick={() => act(async () => { const r = await maitProxy(vineyardId, 'sync_usage', { moduleId, ...maitDateWindow(timezone) }); setResult(r); await qc.invalidateQueries({ queryKey: ['irrigation'] }); await qc.invalidateQueries({ queryKey: ['irrigation-report'] }); await qc.invalidateQueries({ queryKey: ['mait', vineyardId] }); })}>Sync now</Button>
        {result && <MaitSyncResult result={result} />}
        <Button variant="ghost" disabled={run.isPending} onClick={() => act(async () => { const r = await maitProxy(vineyardId, 'sync_status'); setSyncStatus(r.data); })}>Check sync status</Button>
        {syncStatus && <MaitSyncStatus data={syncStatus} moduleId={moduleId} timezone={timezone} />}
      </div>}
    </>}
  </Card>;
}
function OutputRow({ output, saved, vineyardId, controllerKey, controllerName, valves, onSaved }: { output: Row; saved?: Row; vineyardId: string; controllerKey: string; controllerName: string; valves: { id: string; name: string }[]; onSaved: () => Promise<void> }) {
  const [target, setTarget] = useState(saved?.ignore || saved?.is_ignored ? 'ignore' : saved?.irrigation_valve_id ?? '');
  const [conflict, setConflict] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (confirmChange: boolean) => maitRpc('set_irrigation_controller_valve_mapping', vineyardId, { p_provider: MAIT_PROVIDER, p_external_controller_key: controllerKey, p_external_valve_number: output.number, p_external_valve_name: output.name, p_external_controller_name: controllerName, p_external_station_code: null, p_irrigation_valve_id: target === 'ignore' ? null : target, p_ignore: target === 'ignore', p_confirm_change: confirmChange }), onSuccess: async () => { setConflict(null); await onSaved(); }, onError: (e: Error) => { setConflict(e.message); } });
  const needsConfirm = conflict?.includes('mapping_conflict');
  return <tr className="border-b align-top"><td className="p-2">{output.number}</td><td className="p-2">{output.name || '—'}</td><td className="p-2 min-w-56"><MaitChoice label={`Valve for MAIT output ${output.number}`} value={target} onChange={v => { setTarget(v); setConflict(null); }} items={[{ value: 'ignore', label: 'Ignore this output' }, ...valves.map(v => ({ value: v.id, label: v.name }))]} /></td><td className="p-2 space-y-2"><Badge variant="outline">{saved?.ignore || saved?.is_ignored ? 'Ignored' : saved?.irrigation_valve_id ? 'Mapped' : 'Needs mapping'}</Badge><div><Button size="sm" variant="outline" disabled={save.isPending || !target} onClick={() => save.mutate(false)}>Save mapping</Button></div>{conflict && !needsConfirm && <p className="text-destructive">{conflict}</p>}
    <Dialog open={!!needsConfirm} onOpenChange={v => { if (!v) setConflict(null); }}><DialogContent><DialogHeader><DialogTitle>Change MAIT output mapping?</DialogTitle><DialogDescription>This output already has a different mapping. Confirm before changing it.</DialogDescription></DialogHeader><p className="text-sm break-words">{conflict}</p><p className="text-sm">Previous: {saved?.irrigation_valve_name ?? valves.find(v => v.id === saved?.irrigation_valve_id)?.name ?? (saved?.ignore ? 'Ignored' : 'See conflict above')}</p><p className="text-sm">New: {target === 'ignore' ? 'Ignore this output' : valves.find(v => v.id === target)?.name}</p><DialogFooter><Button variant="outline" onClick={() => setConflict(null)}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate(true)}>Confirm change</Button></DialogFooter></DialogContent></Dialog>
  </td></tr>;
}
