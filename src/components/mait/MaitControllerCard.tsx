import { useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info } from 'lucide-react';
import { useIrrigationSystems, useIrrigationValves } from '@/lib/irrigationQuery';
import { maitRpc, maitProxy, maitModules, maitOutputs, maitRows, maitDateWindow, maitSyncCounts, maitControllerSyncState, MAIT_PROVIDER, MAIT_PARTIAL_WARNING, type MaitResult } from '@/lib/maitIntelliwebQuery';
import { MaitChoice, useMait } from './MaitWeatherCard';
import { MaitAutomationPilot } from './MaitAutomationPilot';
import { MaitControllerAcceptance, MaitUsagePreview } from './MaitControllerAcceptance';
import { useVineyard } from '@/context/VineyardContext';
import { ALLOW_READ_ONLY, guardMutation, readOnlyStore } from '@/lib/vineyardWriteAccess';

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
  const values: [string, any][] = [
    ['Last sync attempt', timestamp(state.last_sync_attempt_at)], ['Last successful sync', timestamp(state.last_successful_sync_at)],
    ...(state.last_source_event_at == null ? [] : [['Last source event', timestamp(state.last_source_event_at)] as [string, unknown]]),
    ['Received', state.records_received], ['Created / staged', state.records_created],
    ['Already existing', state.records_existing], ['Needs mapping', state.records_needing_mapping],
    ['Needs review', state.records_needing_review],
  ];
  const errorText = [state.last_error_code, state.last_error_message].filter((part) => typeof part === 'string' && part.trim() !== '').join(' — ');
  return <div role="status" className="space-y-3">{state.incomplete_range === true && <Alert variant="destructive"><AlertDescription>{MAIT_PARTIAL_WARNING}</AlertDescription></Alert>}<dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{values.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold">{value ?? 'Not reported'}</dd></div>)}</dl>{errorText && <p className="text-sm text-muted-foreground">Last error: {errorText}</p>}</div>;
}
export function MaitControllerCard({ vineyardId }: { vineyardId: string }) {
  return <ControllerCard key={vineyardId} vineyardId={vineyardId} />;
}
function ControllerCard({ vineyardId }: { vineyardId: string }) {
  const { currentRole, selectedVineyardId, loading } = useVineyard();
  const { readOnly } = useSyncExternalStore(readOnlyStore.subscribe, readOnlyStore.get);
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
  const [preview, setPreview] = useState<MaitResult | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const scope = useRef(0);
  const busy = useRef(false);
  const allowed = !loading && selectedVineyardId === vineyardId && ['owner', 'manager'].includes(currentRole ?? '') && access.data?.manage === true;
  const controllers = config.controllerModules;
  const connection = config.connection;
  const controller = controllers.find(c => String(c.module_id) === moduleId);
  const selectedSystem = systemId || controller?.irrigation_system_id || '';
  const mappings = useQuery({ queryKey: ['mait', vineyardId, 'controller-mappings', moduleId], enabled: access.data?.manage === true && !!controller, queryFn: async () => maitRows(await maitRpc('get_mait_intelliweb_controller_mappings', vineyardId, { p_module_id: moduleId })) });
  const run = useMutation({ meta: ALLOW_READ_ONLY, mutationFn: async (fn: () => Promise<unknown>) => { if (!allowed) throw new Error('You do not have permission to manage MAIT controllers.'); return fn(); } });
  const act = (fn: () => Promise<unknown>, writes = true) => {
    if (busy.current || !allowed) return;
    busy.current = true;
    const token = scope.current;
    setNotice('');
    run.mutate(async () => { if (writes) guardMutation(undefined); return fn(); }, { onError: (e: Error) => { if (token === scope.current) setNotice(e.message); }, onSettled: () => { busy.current = false; } });
  };
  const resetAcceptance = () => { scope.current += 1; setOutputs(null); setPreview(null); setResult(null); setSyncStatus(null); setPartialDiscovery(false); setConfirmSync(false); setNotice(''); };
  const moduleChoices = [...new Map([...controllers.map(c => ({ id: String(c.module_id), name: c.module_name ?? '' })), ...modules].map(m => [m.id, m])).values()];
  const mapRows = mappings.data ?? [];
  const linked = !!controller && (systems.data ?? []).some(s => s.id === controller.irrigation_system_id && s.vineyard_id === vineyardId && s.is_active === true);
  const relevantMappings = mapRows.filter(m => m.ignore !== true && m.is_ignored !== true && m.is_active !== false && (m.vineyard_id == null || m.vineyard_id === vineyardId) && (m.module_id == null || String(m.module_id) === moduleId));
  const mappedValveIds = [...new Set(relevantMappings.flatMap(m => (valves.data ?? []).filter(v => v.id === m.irrigation_valve_id && v.vineyard_id === vineyardId && v.is_active === true && v.irrigation_system_id === controller?.irrigation_system_id).map(v => v.id)))];
  const ready = allowed && !readOnly && connected && !!connection.network_id && linked && mappedValveIds.length > 0 && ![access, configuration, systems, valves, mappings].some(q => q.isPending || q.isFetching || q.error);
  if (access.isPending) return <Card id="mait-controller" className="p-4 scroll-mt-6">Checking MAIT access…</Card>;
  return <Card id="mait-controller" className="p-4 space-y-4 scroll-mt-6">
    <div className="flex items-center gap-1.5">
      <h2 className="font-semibold">MAIT iNTELLiWeb controller</h2>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="About MAIT irrigation integration" className="h-6 w-6 shrink-0 rounded-full border border-border text-muted-foreground">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2">
          <p className="text-sm font-semibold">What MAIT adds to irrigation</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>MAIT can report each controller output's irrigation run history: output/valve number, dates and times, run durations and the reported total water volume.</li>
            <li>VineTrack maps MAIT controller outputs to your saved valves, then uses the valve-to-block, row or area allocation to attribute that water to blocks.</li>
            <li>You can manually sync recent usage and view the imported records in Irrigation Records and Reports.</li>
            <li>The MAIT connection is shared with the Weather setup area.</li>
            <li>Only available when the MAIT network has compatible controller modules and MAIT getdata access.</li>
          </ul>
          <p className="text-xs text-muted-foreground">Manual sync is operational. Automatic retrieval and record creation are a System Admin-only pilot, not yet running while the scheduler is inactive. MAIT reports recorded water volume, not live flow monitoring, and provides no remote start/stop valve control.</p>
        </PopoverContent>
      </Popover>
    </div>
    <p className="text-sm text-muted-foreground">Import MAIT controller run history and reported water volumes into VineTrack irrigation records.</p>
    {[access.error, configuration.error, mappings.error].filter(Boolean).map((e, i) => <Alert variant="destructive" key={i}><AlertDescription>{(e as Error).message}</AlertDescription></Alert>)}
    {!allowed ? <p className="text-sm text-muted-foreground">Your vineyard owner or manager manages controller setup and imports.</p> : !connected ? <>
      <p className="text-sm text-muted-foreground">Weather stations and irrigation controllers use the same MAIT network connection — connect once in Weather setup.</p><Button asChild variant="outline"><Link to="/setup/weather#mait">Connect MAIT in Weather setup</Link></Button>
    </> : <>
      <p className="text-sm text-muted-foreground">{connection.network_name || 'Connected MAIT network'}</p>
      <MaitControllerAcceptance vineyardId={vineyardId} linked={linked} mappingsChecked={!!mappings.data && !mappings.error && !mappings.isFetching} mappingCount={relevantMappings.length} mappedValveIds={mappedValveIds} preview={preview} />
      {readOnly && <p className="text-sm text-muted-foreground">This vineyard is read-only. Module discovery and usage preview do not import records; saving and syncing are unavailable.</p>}
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      <p className="text-xs text-muted-foreground">Load controller modules reads available modules only. It does not save, import or operate equipment. Weather and soil sensor modules are not irrigation controllers; confirm the controller identity with MAIT before saving.</p>
      <Button variant="outline" disabled={run.isPending} onClick={() => act(async () => { const token = scope.current; const r = await maitProxy(vineyardId, 'modules'); if (token !== scope.current) return; const available = maitModules(r.data); setModules(available); if (!available.length) setNotice('No modules returned. Ask MAIT to confirm compatible irrigation controller modules and getdata controller access.'); }, false)}>Load controller modules</Button>
      {!controllers.length && <p className="text-sm text-muted-foreground">No irrigation controller configured. Identify a confirmed MAIT irrigation controller; if none is available, ask MAIT about compatible controller modules and getdata access.</p>}
      <div className="grid gap-3 sm:grid-cols-2"><MaitChoice label="Choose controller module" value={moduleId} onChange={v => { resetAcceptance(); setModuleId(v); setSystemId(''); }} items={moduleChoices.map(m => ({ value: m.id, label: `${m.id} · ${m.name}` }))} /><MaitChoice label="VineTrack Irrigation System" value={selectedSystem} onChange={v => { resetAcceptance(); setSystemId(v); }} items={(systems.data ?? []).map(s => ({ value: s.id, label: s.name }))} /></div>
      {systems.error && <p className="text-sm text-destructive">Could not load irrigation systems.</p>}
      <Button disabled={readOnly || run.isPending || !moduleId || !(systemId || selectedSystem)} onClick={() => act(async () => {
        await maitRpc('set_mait_intelliweb_controller_module', vineyardId, { p_module_id: moduleId, p_irrigation_system_id: systemId || selectedSystem, p_module_name: moduleChoices.find(m => m.id === moduleId)?.name || null }); await qc.invalidateQueries({ queryKey: ['mait', vineyardId] }); setOutputs(null); setNotice('Controller module saved. Review its output mappings.');
      })}>Save controller module</Button>
      {controller && <div className="space-y-3 border-t pt-4">
        <p className="text-sm font-medium">{controller.module_name || moduleId} · {(systems.data ?? []).find(s => s.id === selectedSystem)?.name ?? 'Irrigation system'}</p>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Controller identity</summary>{connection.network_id}:{moduleId}</details>
        <Button variant="outline" disabled={run.isPending} onClick={() => act(async () => { const token = scope.current; setPreview(null); const r = await maitProxy(vineyardId, 'usage', { moduleId, ...maitDateWindow(timezone) }); if (token !== scope.current) return; setPreview(r); setOutputs(maitOutputs(r.data)); setPartialDiscovery(r.partial); }, false)}>Preview MAIT usage (read-only)</Button>
        {preview && <MaitUsagePreview result={preview} timezone={timezone} />}
        {partialDiscovery && !preview && <Alert variant="destructive"><AlertDescription>{MAIT_PARTIAL_WARNING}</AlertDescription></Alert>}
        {outputs && !outputs.length && <p className="text-sm text-muted-foreground">No usage outputs returned for the recent three-day window.</p>}
        {(outputs || mapRows.length > 0) && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">MAIT output</th><th className="p-2">MAIT name</th><th className="p-2">VineTrack valve</th><th className="p-2">Status</th></tr></thead><tbody>{[...new Map([...mapRows.map(m => ({ number: Number(m.external_valve_number ?? m.channel_number), name: m.external_valve_name ?? m.channel_name ?? '' })), ...(outputs ?? [])].map(o => [o.number, o])).values()].filter(o => Number.isFinite(o.number)).map(o => <OutputRow key={`${moduleId}:${selectedSystem}:${o.number}`} output={o} saved={mapRows.find(m => Number(m.external_valve_number ?? m.channel_number) === o.number)} vineyardId={vineyardId} controllerKey={`${connection.network_id}:${moduleId}`} controllerName={controller.module_name ?? moduleId} valves={(valves.data ?? []).filter(v => v.irrigation_system_id === selectedSystem)} onSaved={async () => { await mappings.refetch(); }} />)}</tbody></table></div>}
        {valves.error && <p className="text-sm text-destructive">Could not load valves.</p>}
        <Button disabled={run.isPending || !ready || selectedSystem !== controller.irrigation_system_id} onClick={() => setConfirmSync(true)}>Sync now</Button>
        <Dialog open={confirmSync} onOpenChange={setConfirmSync}><DialogContent><DialogHeader><DialogTitle>Confirm MAIT irrigation sync</DialogTitle><DialogDescription>This action may immediately create irrigation records for the last three local days; imported water is attributed using today's saved valve-to-block configuration. Confirm the configuration accurately reflects these runs.</DialogDescription></DialogHeader><p className="text-sm">Review saved controller output mappings and valve-to-block / row / area allocations. A read-only usage preview is recommended; it does not import or verify every run.</p><DialogFooter><Button variant="outline" onClick={() => setConfirmSync(false)}>Cancel</Button><Button disabled={run.isPending || !ready || selectedSystem !== controller.irrigation_system_id} onClick={() => { setConfirmSync(false); if (!ready || selectedSystem !== controller.irrigation_system_id) return; setResult(null); act(async () => { const token = scope.current; try { const r = await maitProxy(vineyardId, 'sync_usage', { moduleId, ...maitDateWindow(timezone) }); if (token === scope.current) setResult(r); } finally { await Promise.all([qc.invalidateQueries({ queryKey: ['irrigation'] }), qc.invalidateQueries({ queryKey: ['irrigation-report'] }), qc.invalidateQueries({ queryKey: ['mait', vineyardId] })]); } }); }}>Confirm &amp; sync</Button></DialogFooter></DialogContent></Dialog>
        {result && <MaitSyncResult result={result} />}
        <Button variant="ghost" disabled={run.isPending} onClick={() => act(async () => { const token = scope.current; const r = await maitProxy(vineyardId, 'sync_status'); if (token === scope.current) setSyncStatus(r.data); }, false)}>Check sync status</Button>
        {syncStatus && <MaitSyncStatus data={syncStatus} moduleId={moduleId} timezone={timezone} />}
        {connected && connection.network_id && controller.is_active === true && <MaitAutomationPilot key={`${vineyardId}:${moduleId}`} vineyardId={vineyardId} moduleId={moduleId} timezone={timezone} />}
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
