import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { ProviderConnectionCard } from '@/components/weather/ProviderConnectionCard';
import { PROVIDER_PROVIDES } from '@/lib/weatherSourceSummary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Gauge } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchVineyard } from '@/lib/vineyardSettingsQuery';
import { maitAccess, maitRpc, maitProxy, maitRow, maitConfiguration, maitWeatherReady, maitModules, maitChannels, maitConversion, maitDailyRainConfirmed, saveMaitConnection, MAIT_METRICS, MAIT_PROVIDER, type MaitResult } from '@/lib/maitIntelliwebQuery';

type Row = Record<string, any>;
export function useMait(vineyardId: string) {
  const access = useQuery({ queryKey: ['mait', vineyardId, 'access'], queryFn: () => maitAccess(vineyardId) });
  const configuration = useQuery({ queryKey: ['mait', vineyardId, 'configuration'], enabled: access.data?.manage === true, queryFn: async () => maitConfiguration(await maitRpc('get_mait_intelliweb_configuration', vineyardId)) });
  const status = useQuery({ queryKey: ['mait', vineyardId, 'status'], enabled: access.data?.view === true, queryFn: async () => maitRow(await maitRpc('get_vineyard_weather_integration', vineyardId, { p_provider: MAIT_PROVIDER })) });
  const vineyard = useQuery({ queryKey: ['vineyard-settings', vineyardId], queryFn: () => fetchVineyard(vineyardId) });
  const config = configuration.data ?? maitConfiguration(null);
  const connection = config.connection;
  const connected = access.data?.manage ? connection.configured === true : !!status.data?.id && status.data?.is_active !== false;
  return { access, configuration, status, config, connected, timezone: connection.timezone ?? vineyard.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
}
function Choice({ value, onChange, items, label }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[]; label: string }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="min-w-40"><SelectValue placeholder={label} /></SelectTrigger><SelectContent>{items.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent></Select>;
}
export { Choice as MaitChoice };
export function MaitWeatherCard({ vineyardId, usedFor }: { vineyardId: string; usedFor?: string[] }) {
  const { access, configuration, status, config, connected, timezone } = useMait(vineyardId);
  const connection = config.connection;
  const weatherModuleId = config.weatherModule?.module_id;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [networkId, setNetworkId] = useState('');
  const [zone, setZone] = useState('');
  const [tested, setTested] = useState<MaitResult | null>(null);
  const [modules, setModules] = useState<Row[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [channels, setChannels] = useState<Row[] | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { setUsername(connection.username ?? ''); setNetworkId(connection.network_id ?? ''); setZone(timezone); setPassword(''); setTested(null); setModuleId(String(weatherModuleId ?? '')); setChannels(null); }, [connection.username, connection.network_id, weatherModuleId, timezone]);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['mait', vineyardId] }); await qc.invalidateQueries({ queryKey: ['weather_status', vineyardId] }); await qc.invalidateQueries({ queryKey: ['local-observation-provider', vineyardId] }); await qc.invalidateQueries({ queryKey: ['live_weather', vineyardId] }); };
  const action = useMutation({ mutationFn: async (run: () => Promise<unknown>) => { if (!access.data?.manage) throw new Error('You do not have permission to manage this MAIT connection.'); return run(); }, onError: (e: Error) => setNotice(e.message) });
  const run = (fn: () => Promise<unknown>) => { setNotice(''); action.mutate(fn); };
  const updateCredential = (fn: () => void) => { fn(); setTested(null); };
  const mappings = config.weatherMappings.filter(m => String(m.module_id) === String(weatherModuleId));
  const ready = maitWeatherReady(config);
  const moduleChoices = [...new Map([...(config.weatherModule ? [{ id: String(weatherModuleId), name: config.weatherModule.module_name ?? '' }] : []), ...modules].map(m => [m.id, m])).values()];
  const networkName = tested?.data.network_name ?? tested?.data.network?.name ?? connection.network_name;
  if (access.isPending) return <Card className="p-4">Checking MAIT access…</Card>;
  const content = <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-task-water/10 text-task-water border-task-water/30"><Gauge className="h-5 w-5" /></div>
      <h2 className="text-base font-semibold">MAIT iNTELLiWeb</h2>
      {connected
        ? ((connection.last_test_status ?? status.data?.last_test_status) === 'failed'
          ? <Badge className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Needs attention</Badge>
          : <Badge className="bg-success/15 text-success border-success/30">Connected</Badge>)
        : <Badge variant="outline" className="text-muted-foreground">Not connected</Badge>}
    </div>
    <p className="text-sm text-muted-foreground">Connect your MAIT Industries iNTELLiWeb weather station or sensor network.</p>
    {[access.error, configuration.error, status.error].filter(Boolean).map((e, i) => <Alert key={i} variant="destructive"><AlertDescription>{(e as Error).message}</AlertDescription></Alert>)}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    {connected && <p className="text-sm">{access.data?.manage ? <>{connection.network_name ?? 'MAIT network'} · Network ID {connection.network_id ?? '—'}</> : status.data?.station_name || 'MAIT weather source'}</p>}
    {!access.data?.manage ? <p className="text-sm text-muted-foreground">{access.data?.view ? 'Your vineyard owner or manager manages this MAIT connection.' : 'MAIT access is not available for this vineyard.'}</p> : <>
      {!editing && <div className="flex flex-wrap gap-2">{!connected ? <Button onClick={() => setEditing(true)}>Connect MAIT</Button> : <>
        <Button variant="outline" disabled={action.isPending} onClick={() => run(async () => { const r = await maitProxy(vineyardId, 'test_saved'); setModules(maitModules(r.data)); setNotice(r.empty ? 'MAIT returned no data.' : 'Saved MAIT connection tested successfully.'); await refresh(); })}>Test saved connection</Button>
        <Button variant="outline" onClick={() => { setPassword(''); setTested(null); setEditing(true); }}>Change credentials</Button>
        <Button variant="outline" onClick={() => setDisconnect(true)}>Disconnect</Button>
      </>}</div>}
      {editing && <div className="space-y-3 border-t pt-4">
        <p className="text-sm text-muted-foreground">Use an iNTELLiWeb user with getdata access. If you do not have one, contact your MAIT/iNTELLiWeb administrator or MAIT Industries.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="mait-user">Username</Label><Input id="mait-user" autoComplete="off" value={username} onChange={e => updateCredential(() => setUsername(e.target.value))} /></div>
          <div><Label htmlFor="mait-password">Password</Label><Input id="mait-password" type="password" autoComplete="new-password" value={password} onChange={e => updateCredential(() => setPassword(e.target.value))} />{connected && <p className="text-xs text-muted-foreground">Password saved securely</p>}</div>
          <div><Label htmlFor="mait-network">Network ID</Label><Input id="mait-network" value={networkId} onChange={e => updateCredential(() => setNetworkId(e.target.value))} /></div>
          <div><Label htmlFor="mait-timezone">Time zone</Label><Input id="mait-timezone" value={zone} onChange={e => updateCredential(() => setZone(e.target.value))} /></div>
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={action.isPending || !username.trim() || !networkId.trim() || (!connected && !password)} onClick={() => run(async () => {
          // A blank saved password cannot be revealed for a typed test. Unchanged credentials use test_saved.
          if (!password && (username !== connection.username || networkId !== connection.network_id)) throw new Error('Enter a password to test changed credentials.');
          const r = await maitProxy(vineyardId, password ? 'test' : 'test_saved', password ? { username, password, networkId } : {});
          if (r.empty || r.partial) throw new Error('MAIT did not return a complete connection test. Retry before saving.');
          setTested(r); setModules(maitModules(r.data)); setNotice('MAIT connection tested successfully.');
        })}>Test connection</Button>
        <Button disabled={action.isPending || !tested} onClick={() => run(async () => { await saveMaitConnection(vineyardId, { username, password, networkId, networkName, timezone: zone }); setPassword(''); setEditing(false); setTested(null); await refresh(); toast.success('MAIT connection saved'); })}>Save &amp; continue</Button>
        <Button variant="ghost" onClick={() => { setEditing(false); setPassword(''); setTested(null); }}>Cancel</Button></div>
        {tested && <div className="text-sm"><p>{networkName || 'Connection verified'}</p><ul>{modules.map(m => <li key={m.id}>{m.id} · {m.name}</li>)}</ul></div>}
      </div>}
      {connected && !editing && <div className="space-y-3 border-t pt-4">
        <h3 className="font-medium">Weather module</h3>
        <Button variant="outline" disabled={action.isPending} onClick={() => run(async () => { const r = await maitProxy(vineyardId, 'modules'); setModules(maitModules(r.data)); setNotice(r.empty ? 'MAIT returned no modules.' : ''); })}>Load modules</Button>
        <div className="flex flex-wrap gap-2"><Choice label="Weather module" value={moduleId} onChange={v => { setModuleId(v); setChannels(null); }} items={moduleChoices.map(m => ({ value: m.id, label: `${m.id} · ${m.name}` }))} />
        <Button disabled={action.isPending || !moduleId || !moduleChoices.some(m => m.id === moduleId)} onClick={() => run(async () => { await maitRpc('set_mait_intelliweb_weather_module', vineyardId, { p_module_id: moduleId, p_module_name: moduleChoices.find(m => m.id === moduleId)?.name || null }); await refresh(); setNotice('Weather module saved. Review and confirm the channel mappings.'); })}>Save weather module</Button></div>
        {weatherModuleId && moduleId !== String(weatherModuleId) && <p className="text-sm text-destructive">Changing the weather module requires reviewing its channel mappings.</p>}
        {!!weatherModuleId && <Button variant="outline" disabled={action.isPending} onClick={() => run(async () => { const r = await maitProxy(vineyardId, 'inspect_module', { moduleId: weatherModuleId, scope: 'existing' }); setChannels(maitChannels(r.data)); if (r.empty) setNotice('MAIT returned no channels or readings.'); })}>Inspect weather channels</Button>}
        {channels && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Channel</th><th className="p-2">MAIT label</th><th className="p-2">Unit</th><th className="p-2">Latest value</th><th className="p-2">Use in VineTrack as</th></tr></thead><tbody>{channels.map(c => <ChannelRow key={`${weatherModuleId}:${c.key}`} channel={c} saved={mappings.find(m => String(m.channel_key) === c.key && String(m.module_id) === String(weatherModuleId))} vineyardId={vineyardId} moduleId={String(weatherModuleId)} onSaved={refresh} />)}</tbody></table>{!channels.length && <p className="p-2 text-muted-foreground">No channels returned.</p>}</div>}
        <div className="flex items-center gap-3"><Switch aria-label="Use MAIT rainfall in VineTrack rainfall records" checked={connection.rainfall_publish_enabled === true} disabled={action.isPending || !maitDailyRainConfirmed(mappings)} onCheckedChange={enabled => run(async () => { await maitRpc('set_mait_intelliweb_rainfall_publish_enabled', vineyardId, { p_enabled: enabled }); await refresh(); })} /><span className="text-sm">Use MAIT rainfall in VineTrack rainfall records</span></div>
        {!maitDailyRainConfirmed(mappings) && <p className="text-xs text-muted-foreground">Confirm a daily cumulative rainfall channel before enabling rainfall records.</p>}
        <Button disabled={action.isPending || !ready} onClick={() => run(async () => { await maitRpc('set_vineyard_current_observation_provider', vineyardId, { p_provider: MAIT_PROVIDER }); await refresh(); setNotice('MAIT selected for live observations.'); })}>Use MAIT for live observations</Button>
      </div>}
    </>}
    <Dialog open={disconnect} onOpenChange={setDisconnect}><DialogContent><DialogHeader><DialogTitle>Disconnect MAIT?</DialogTitle><DialogDescription>The weather station and controllers share this connection. Historical irrigation records will remain unchanged.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDisconnect(false)}>Cancel</Button><Button variant="destructive" disabled={action.isPending} onClick={() => run(async () => { await maitRpc('remove_mait_intelliweb_connection', vineyardId); setDisconnect(false); setModules([]); setChannels(null); await refresh(); })}>Disconnect</Button></DialogFooter></DialogContent></Dialog>
  </div>;
  if (!usedFor) return <Card id="mait" className="p-4 space-y-4 scroll-mt-6">{content}</Card>;
  return <ProviderConnectionCard id="mait" name="MAIT iNTELLiWeb" mark="MAIT" icon={<Gauge className="h-7 w-7" />} tone="bg-task-water/10 text-task-water" description="iNTELLiWeb weather stations and sensor networks." configured={connected} provides={PROVIDER_PROVIDES.mait} usedFor={usedFor}>{content}</ProviderConnectionCard>;
}
function ChannelRow({ channel, saved, vineyardId, moduleId, onSaved }: { channel: Row; saved?: Row; vineyardId: string; moduleId: string; onSaved: () => Promise<void> }) {
  const [metric, setMetric] = useState(saved?.is_active ? saved.canonical_metric : 'none');
  const [semantics, setSemantics] = useState(saved?.semantics ?? '');
  const [multiplier, setMultiplier] = useState(String(saved?.conversion_multiplier ?? 1));
  const [offset, setOffset] = useState(String(saved?.conversion_offset ?? 0));
  const [reviewed, setReviewed] = useState(false);
  const conversion = maitConversion(channel.unit, metric);
  const save = useMutation({ mutationFn: async () => {
    if (!MAIT_METRICS.some(([id]) => id === metric)) throw new Error('Choose a supported MAIT metric.');
    if (metric === 'rainfall' && !semantics) throw new Error('Choose the meaning of this rainfall channel.');
    if (!conversion && !reviewed && metric !== 'none') throw new Error('Review unit conversion before confirming.');
    if (!Number.isFinite(Number(multiplier)) || !Number.isFinite(Number(offset)) || !multiplier.trim() || !offset.trim()) throw new Error('Enter a valid conversion multiplier and offset.');
    await maitRpc('save_mait_intelliweb_channel_mapping', vineyardId, { p_module_id: moduleId, p_channel_key: channel.key, p_canonical_metric: metric, p_channel_number: channel.number, p_source_label: channel.label || null, p_source_unit: channel.unit || null, p_semantics: metric === 'rainfall' ? semantics : null, p_conversion_multiplier: Number(multiplier), p_conversion_offset: Number(offset), p_is_active: metric !== 'none' });
  }, onSuccess: async () => { await onSaved(); toast.success('Channel mapping confirmed'); }, onError: (e: Error) => toast.error(e.message) });
  return <tr className="border-b align-top"><td className="p-2">{channel.number ?? channel.key}</td><td className="p-2">{channel.label || '—'}</td><td className="p-2">{channel.unit || '—'}</td><td className="p-2">{channel.value ?? '—'}</td><td className="p-2 space-y-2 min-w-64">
    <Choice label={`Use channel ${channel.key} as`} value={metric} items={MAIT_METRICS.map(([value, label]) => ({ value, label }))} onChange={v => { setMetric(v); setReviewed(false); setSemantics(''); const c = maitConversion(channel.unit, v); setMultiplier(String(c?.multiplier ?? 1)); setOffset(String(c?.offset ?? 0)); }} />
    {metric === 'rainfall' && <Choice label="Rainfall meaning" value={semantics} onChange={setSemantics} items={[{ value: 'daily_cumulative', label: 'Daily cumulative rainfall' }, { value: 'interval', label: 'Interval rainfall (not daily totals)' }, { value: 'unknown', label: 'Other / unknown (not daily totals)' }]} />}
    {metric !== 'none' && <details><summary className="cursor-pointer text-xs text-muted-foreground">{conversion ? 'Advanced conversion' : 'Review unit conversion'}</summary><div className="grid grid-cols-2 gap-2 py-2"><div><Label>Multiplier</Label><Input aria-label={`Channel ${channel.key} multiplier`} type="number" step="any" value={multiplier} onChange={e => { setMultiplier(e.target.value); setReviewed(true); }} /></div><div><Label>Offset</Label><Input aria-label={`Channel ${channel.key} offset`} type="number" step="any" value={offset} onChange={e => { setOffset(e.target.value); setReviewed(true); }} /></div></div>{!conversion && <Button size="sm" variant="outline" onClick={() => setReviewed(true)}>Confirm conversion</Button>}</details>}
    <Button size="sm" variant="outline" disabled={save.isPending || (metric === 'rainfall' && !semantics) || (!conversion && !reviewed && metric !== 'none')} onClick={() => save.mutate()}>Confirm mapping</Button>
  </td></tr>;
}
