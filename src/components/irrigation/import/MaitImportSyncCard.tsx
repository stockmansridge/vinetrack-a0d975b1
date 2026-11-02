import { useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useVineyard } from '@/context/VineyardContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { MaitChoice, useMait } from '@/components/mait/MaitWeatherCard';
import { MaitSyncResult } from '@/components/mait/MaitControllerCard';
import { useIrrigationSystems, useIrrigationValves } from '@/lib/irrigationQuery';
import { maitDateWindow, maitProxy, maitRows, maitRpc, type MaitResult } from '@/lib/maitIntelliwebQuery';
import { guardMutation, readOnlyStore } from '@/lib/vineyardWriteAccess';
import maitLogo from '@/assets/mait-industries-logo.png.asset.json';

const setup = '/irrigation/setup#mait-controller';
const explanation = 'Import recent irrigation run history and controller-reported water volumes directly from a connected MAIT system. No file upload needed. Sync is manual; scheduled syncing is not currently enabled.';

export default function MaitImportSyncCard({ className = '' }: { className?: string }) {
  const { selectedVineyardId, currentRole, loading } = useVineyard();
  return <Card className={`flex h-full flex-col border-task-water/40 bg-task-water/5 ${className}`}>
    <CardHeader><div className="flex items-center gap-3"><img src={maitLogo.url} alt="MAIT Industries" className="h-8 w-auto shrink-0" /><CardTitle className="text-base">MAIT iNTELLiWeb — API sync</CardTitle></div></CardHeader>
    <CardContent className="flex flex-1 flex-col space-y-3">
      <p className="text-sm text-muted-foreground">{explanation}</p>
      {selectedVineyardId ? <VineyardSync key={selectedVineyardId} vineyardId={selectedVineyardId} allowedRole={!loading && ['owner', 'manager'].includes(currentRole ?? '')} /> : <p className="text-sm">Select a vineyard to configure or sync MAIT irrigation.</p>}
    </CardContent>
  </Card>;
}

function VineyardSync({ vineyardId, allowedRole }: { vineyardId: string; allowedRole: boolean }) {
  const mait = useMait(vineyardId);
  const [moduleId, setModuleId] = useState('');
  const { readOnly } = useSyncExternalStore(readOnlyStore.subscribe, readOnlyStore.get);
  if (mait.access.error || mait.configuration.error || mait.status.error) return <Alert variant="destructive"><AlertDescription>Could not verify MAIT access or configuration. Reopen this page to retry.</AlertDescription></Alert>;
  if (mait.access.isPending || (mait.access.data?.manage && mait.configuration.isPending)) return <p role="status" className="text-sm">Checking MAIT access and configuration…</p>;
  if (!allowedRole || mait.access.data?.manage !== true) return <div className="space-y-2"><p className="text-sm">Your vineyard owner or manager manages MAIT irrigation syncing.</p><SetupLink /></div>;
  if (readOnly) return <div className="space-y-2"><p className="text-sm">This vineyard is read-only. MAIT sync can create records and is unavailable.</p><SetupLink /></div>;
  if (!mait.connected || !mait.config.connection.network_id) return <Button asChild variant="outline"><Link to="/setup/weather#mait">Connect MAIT in Weather setup</Link></Button>;
  const controllers = mait.config.controllerModules.filter(c => c.is_active === true && c.module_id != null && String(c.module_id) !== '' && (c.vineyard_id == null || c.vineyard_id === vineyardId));
  if (!controllers.length) return <SetupLink label="Set up MAIT irrigation controller" />;
  const controller = controllers.find(c => String(c.module_id) === moduleId);
  return <div className="space-y-3">
    <MaitChoice label="MAIT irrigation controller" value={moduleId} onChange={setModuleId} items={controllers.map(c => ({ value: String(c.module_id), label: `${c.module_name || 'Controller'} · ${c.module_id}` }))} />
    {controller ? <ControllerSync key={moduleId} vineyardId={vineyardId} moduleId={moduleId} systemId={controller.irrigation_system_id} timezone={mait.timezone} verifying={mait.access.isFetching || mait.configuration.isFetching} /> : <p className="text-sm text-muted-foreground">Choose the controller to sync.</p>}
  </div>;
}

function SetupLink({ label = 'Configure MAIT valve mappings' }: { label?: string }) {
  return <Button asChild variant="outline"><Link to={setup}>{label}</Link></Button>;
}

function ControllerSync({ vineyardId, moduleId, systemId, timezone, verifying }: { vineyardId: string; moduleId: string; systemId: string | null; timezone: string; verifying: boolean }) {
  const systems = useIrrigationSystems(vineyardId);
  const valves = useIrrigationValves(vineyardId);
  const mappings = useQuery({ queryKey: ['mait', vineyardId, 'controller-mappings', moduleId], staleTime: 0, refetchOnMount: 'always', queryFn: async () => maitRows(await maitRpc('get_mait_intelliweb_controller_mappings', vineyardId, { p_module_id: moduleId })) });
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<MaitResult | null>(null);
  const busy = useRef(false);
  const reads = [systems, valves, mappings];
  const failed = reads.some(q => q.isError);
  const loading = verifying || reads.some(q => q.isPending || q.isFetching);
  const activeSystem = systems.data?.some(s => s.id === systemId && s.vineyard_id === vineyardId && s.is_active === true);
  const ready = !failed && !loading && activeSystem && mappings.data?.some(m => m.ignore !== true && m.is_ignored !== true && m.is_active !== false && (m.vineyard_id == null || m.vineyard_id === vineyardId) && (m.module_id == null || String(m.module_id) === moduleId) && valves.data?.some(v => v.id === m.irrigation_valve_id && v.vineyard_id === vineyardId && v.irrigation_system_id === systemId && v.is_active === true));
  const sync = useMutation({
    mutationFn: async () => {
      guardMutation(undefined);
      if (!ready || !navigator.onLine) throw new Error('MAIT sync is unavailable. Check your connection and saved valve mappings.');
      return maitProxy(vineyardId, 'sync_usage', { moduleId, ...maitDateWindow(timezone) });
    },
    onSuccess: r => setResult(r),
    onSettled: async () => {
      // A failed response may still follow committed server work; refresh without retrying a write.
      await Promise.all([qc.invalidateQueries({ queryKey: ['irrigation'] }), qc.invalidateQueries({ queryKey: ['irrigation-report'] }), qc.invalidateQueries({ queryKey: ['mait', vineyardId] })]);
    },
  });
  const run = async () => {
    if (busy.current || sync.isPending || !ready) return;
    busy.current = true;
    setConfirm(false);
    setResult(null);
    try { await sync.mutateAsync(); } catch { /* Render the mutation error separately from results. */ }
    finally { busy.current = false; }
  };
  return <div className="space-y-3">
    {failed ? <Alert variant="destructive"><AlertDescription>Could not verify saved irrigation systems, valves or MAIT mappings. Sync is unavailable.</AlertDescription></Alert> : loading ? <p role="status" className="text-sm">Checking saved controller mappings…</p> : !ready ? <><p className="text-sm">This controller needs an active irrigation system and at least one mapped active valve in that system. Review the saved valve-to-block connections before syncing.</p><SetupLink /></> : <Button disabled={sync.isPending} onClick={() => { sync.reset(); setConfirm(true); }}><RefreshCw className="mr-2 h-4 w-4" />{sync.isPending ? 'Syncing MAIT irrigation…' : 'Sync MAIT irrigation now'}</Button>}
    {sync.isError && <Alert variant="destructive"><AlertDescription>{sync.error.message} Some records may already have been created; check Irrigation Records before retrying.</AlertDescription></Alert>}
    {result && <div className="space-y-2"><p className="text-sm font-medium">Latest MAIT sync result</p><MaitSyncResult result={result} /><Button asChild variant="link" className="h-auto p-0"><Link to="/irrigation">View Irrigation Records</Link></Button></div>}
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Confirm MAIT irrigation sync</DialogTitle><DialogDescription>This action may immediately create irrigation records for the last three local days; imported water is attributed using today's saved valve-to-block configuration. Confirm the configuration accurately reflects these runs.</DialogDescription></DialogHeader><Button asChild variant="link" className="justify-start px-0"><Link to={setup}>Review irrigation configuration</Link></Button><DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={!ready || sync.isPending} onClick={() => void run()}>Confirm &amp; sync</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}