import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsSystemAdmin } from '@/lib/systemAdmin';
import { useVineyard } from '@/context/VineyardContext';
import { guardMutation, readOnlyStore } from '@/lib/vineyardWriteAccess';
import { maitRpc, maitRow, maitRows } from '@/lib/maitIntelliwebQuery';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

type Props = { vineyardId: string; moduleId: string; timezone: string };

export function MaitAutomationPilot(props: Props) {
  const { isAdmin, loading } = useIsSystemAdmin();
  if (loading || !isAdmin) return null;
  return <MemberPilot key={`${props.vineyardId}:${props.moduleId}`} {...props} />;
}

function MemberPilot(props: Props) {
  const { memberships, loading } = useVineyard();
  if (loading || !memberships.some(m => m.vineyard_id === props.vineyardId)) return null;
  return <PilotStatus {...props} />;
}

function PilotStatus({ vineyardId, moduleId, timezone }: Props) {
  const query = useQuery({ queryKey: ['mait', vineyardId, 'automation'], retry: false,
    queryFn: async () => {
      const data = maitRow(await maitRpc('get_mait_irrigation_automation_status', vineyardId));
      if (typeof data.scheduler_active !== 'boolean' || data.pilot_system_admin_only !== true || typeof data.pilot_vineyard_selected !== 'boolean' || !Array.isArray(data.modules)) throw new Error('MAIT automation pilot status could not be verified. Preferences are unavailable.');
      return data;
    },
  });
  const module = maitRows(query.data?.modules).find(m => String(m.module_id) === moduleId);
  return <section aria-label="MAIT automation pilot" className="space-y-3 border-t pt-4">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Irrigation automation pilot</h3><Badge variant="outline">System Admin only</Badge></div>
    {query.isPending ? <p role="status" className="text-sm">Checking automation pilot status…</p> : query.isError ? <Alert variant="destructive"><AlertDescription>{query.error.message}</AlertDescription></Alert> : <>
      {query.data?.pilot_vineyard_selected === true ? <p role="status" className="text-sm font-medium">This vineyard is selected for the System Admin MAIT irrigation pilot.</p> : <Alert><AlertDescription>This vineyard is not selected for the MAIT automatic-sync pilot. Pilot preferences are unavailable; manual Sync now remains operational.</AlertDescription></Alert>}
      {query.data?.scheduler_active === false && <Alert><AlertDescription>Scheduler installed but paused — automatic retrieval and record creation are not running. Cadence: every 6 hours after authorised activation. Saving these pilot preferences does not activate the scheduler. Manual Sync now remains operational.</AlertDescription></Alert>}
      {query.data?.pilot_vineyard_selected === true && <>
        <p className="text-xs text-muted-foreground">Cadence: every 6 hours. Defaults: automatic retrieval off, automatic record creation off, overlap 3 days.</p>
        {module ? <PilotOptions key={`${moduleId}:${String(module.auto_sync_enabled)}:${String(module.auto_commit_enabled)}:${String(module.overlap_days)}`} vineyardId={vineyardId} moduleId={moduleId} module={module} timezone={timezone} verifying={query.isFetching} /> : <p className="text-sm">This controller is not available in the automation pilot status. Reload status before saving preferences.</p>}
      </>}
    </>}
    <Button variant="ghost" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh pilot status</Button>
  </section>;
}

function PilotOptions({ vineyardId, moduleId, module, timezone, verifying }: Props & { module: Record<string, unknown>; verifying: boolean }) {
  const qc = useQueryClient();
  const { readOnly } = useSyncExternalStore(readOnlyStore.subscribe, readOnlyStore.get);
  const [retrieve, setRetrieve] = useState(module.auto_sync_enabled === true);
  const [commit, setCommit] = useState(module.auto_sync_enabled === true && module.auto_commit_enabled === true);
  const [confirmCreation, setConfirmCreation] = useState(false);
  const [overlap, setOverlap] = useState(String(module.overlap_days ?? 3));
  const days = Number(overlap);
  const valid = overlap.trim() !== '' && Number.isInteger(days) && days >= 1 && days <= 14;
  const save = useMutation({ mutationFn: async () => {
    guardMutation(undefined);
    if (verifying || !valid) throw new Error('Overlap must be a whole number from 1 to 14 days.');
    if (confirmCreation || (commit && !retrieve)) throw new Error('Confirm record creation with automatic retrieval enabled before saving.');
    await maitRpc('set_mait_irrigation_automation_options', vineyardId, { p_module_id: moduleId, p_auto_sync_enabled: retrieve, p_auto_commit_enabled: commit, p_overlap_days: days });
  }, onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['mait', vineyardId, 'automation'] }); } });
  const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not reported';
  const disabled = readOnly || save.isPending || verifying;
  return <div className="space-y-3">
    {readOnly && <p className="text-sm text-muted-foreground">This vineyard is read-only. Pilot preferences cannot be saved.</p>}
    <div className="flex items-center justify-between gap-3"><Label htmlFor={`mait-auto-retrieve-${moduleId}`}>Automatic retrieval</Label><Switch id={`mait-auto-retrieve-${moduleId}`} checked={retrieve} disabled={disabled} onCheckedChange={v => { save.reset(); setRetrieve(v); if (!v) { setCommit(false); setConfirmCreation(false); } }} /></div>
    <div className="flex items-center justify-between gap-3"><Label htmlFor={`mait-auto-commit-${moduleId}`}>Automatic record creation</Label><Switch id={`mait-auto-commit-${moduleId}`} checked={commit} disabled={disabled || !retrieve} onCheckedChange={v => { save.reset(); if (v) setConfirmCreation(true); else setCommit(false); }} /></div>
    <div className="space-y-1"><Label htmlFor={`mait-overlap-${moduleId}`}>Overlap (days)</Label><Input id={`mait-overlap-${moduleId}`} className="max-w-32" type="number" min={1} max={14} step={1} value={overlap} disabled={disabled} onChange={e => { save.reset(); setOverlap(e.target.value); }} />{!valid && <p className="text-sm text-destructive">Enter a whole number from 1 to 14.</p>}</div>
    <p className="text-xs text-muted-foreground">Future automatic record creation requires approved, unchanged verified valve-to-block mappings and applies only to post-approval runs. No remote valve control.</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Last sync attempt</dt><dd>{timestamp(module.last_sync_attempt_at)}</dd></div><div><dt className="text-muted-foreground">Last successful sync</dt><dd>{timestamp(module.last_successful_sync_at)}</dd></div></dl>
    <p className="break-words text-sm text-muted-foreground">Last error: {[module.last_error_code, module.last_error_message].filter(v => typeof v === 'string' && v.trim()).join(' — ') || 'Not reported'}</p>
    <Button disabled={disabled || !valid || confirmCreation} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save pilot preferences'}</Button>
    {save.isError && <Alert variant="destructive"><AlertDescription>{save.error.message}</AlertDescription></Alert>}
    {save.isSuccess && <p role="status" className="text-sm">Pilot preferences saved. Scheduler activation is separate; no sync was started.</p>}
    <Dialog open={confirmCreation} onOpenChange={setConfirmCreation}><DialogContent><DialogHeader><DialogTitle>Allow future automatic record creation?</DialogTitle><DialogDescription>After an authorised future activation, this preference can create irrigation sessions automatically from MAIT-reported volumes only for post-approval runs with unchanged verified valve-to-block mappings. It does not remotely operate valves. The scheduler remains paused; confirming and saving preferences will not activate it or start a sync.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmCreation(false)}>Cancel</Button><Button disabled={disabled || !retrieve} onClick={() => { if (disabled || !retrieve) return; setCommit(true); setConfirmCreation(false); }}>Confirm record creation</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}