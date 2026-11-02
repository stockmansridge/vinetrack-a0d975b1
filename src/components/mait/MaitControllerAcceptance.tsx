import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSetupStatus, useValveBlocks } from '@/lib/irrigationQuery';
import { MAIT_PARTIAL_WARNING, maitRows, type MaitResult } from '@/lib/maitIntelliwebQuery';

export function MaitControllerAcceptance({ vineyardId, linked, mappingsChecked, mappingsValid, mappingCount, mappedValveIds, preview }: {
  vineyardId: string; linked: boolean; mappingsChecked: boolean; mappingsValid: boolean; mappingCount: number; mappedValveIds: string[]; preview: MaitResult | null;
}) {
  return <section className="space-y-2 border-t pt-3" aria-label="Controller acceptance checklist">
    <h3 className="text-sm font-semibold">Controller acceptance checklist</h3>
    <dl className="space-y-2 text-sm">
      <Check label="MAIT network connected (saved configuration; not a connection test)" state="Ready" />
      <Check label="Confirmed controller linked to an active VineTrack irrigation system" state={linked ? 'Ready' : 'Not configured'} />
      <Check label={`Saved output mappings: ${mappedValveIds.length} active target valves from ${mappingCount} outputs`} state={!mappingsChecked ? 'Not checked' : mappingsValid ? 'Ready' : 'Not configured'} />
      <Check label="Read-only usage preview" state={!preview ? 'Not checked' : preview.partial || preview.empty ? 'Checked — incomplete or empty' : 'Checked — compare with MAIT'} />
    </dl>
    <p className="text-xs text-muted-foreground">Ready describes this check only. One mapped output does not verify every controller output or enable automation. Compare the preview with MAIT records and review every relevant output.</p>
    {mappedValveIds.length ? mappedValveIds.map(id => <ValveAllocation key={id} vineyardId={vineyardId} valveId={id} />) : <p className="text-sm text-muted-foreground">Valve-to-block / row / area allocations: Not configured.</p>}
    <p className="text-xs text-muted-foreground">Scheduler installed but paused. Scheduled retrieval is not running.</p>
  </section>;
}
function Check({ label, state }: { label: string; state: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><dt>{label}</dt><dd><Badge variant="outline">{state}</Badge></dd></div>;
}
function ValveAllocation({ vineyardId, valveId }: { vineyardId: string; valveId: string }) {
  const blocks = useValveBlocks(vineyardId, valveId);
  const status = useSetupStatus(vineyardId);
  const saved = blocks.data?.filter(b => b.valve_id === valveId && b.is_active === true) ?? [];
  const authoritative = status.data?.valves.find(v => v.valve_id === valveId);
  const state = blocks.isPending || status.isPending ? 'Not checked' : blocks.error || status.error || authoritative?.allocation_ok == null ? 'Confirm in setup' : saved.length && authoritative.allocation_ok === true ? 'Ready' : 'Not configured';
  return <div className="space-y-1 text-sm"><Check label={`${authoritative?.valve_name || 'Mapped valve'} block / row / area allocations`} state={state} />
    {saved.map(b => <p key={b.id} className="text-xs text-muted-foreground">{b.block_name || 'Saved block'} · {b.allocation_method.replace(/_/g, ' ')}{b.row_count != null ? ` · ${b.row_count} rows` : ''}</p>)}
  </div>;
}

export function MaitUsagePreview({ result, timezone }: { result: MaitResult; timezone: string }) {
  const data = result.data;
  const events = maitRows(data.events ?? data.usage ?? data.data?.events ?? data.data?.usage);
  const number = (value: unknown) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not reported';
  return <section className="space-y-2" aria-label="Read-only MAIT usage preview">
    <h3 className="text-sm font-semibold">Read-only MAIT usage preview</h3>
    <p className="text-xs text-muted-foreground">No irrigation records created. Reported run data, not live flow. Review these runs against your saved mappings.</p>
    {result.partial && <Alert variant="destructive"><AlertDescription>{MAIT_PARTIAL_WARNING}</AlertDescription></Alert>}
    {result.empty ? <p>No MAIT usage data returned (204). This does not verify the controller.</p> : <>
      <p className="text-sm">Returned events: {events.length}. Showing {Math.min(10, events.length)}.{result.partial ? ' Incomplete range (206 / partial).' : ''}</p>
      {!events.length ? <p className="text-sm text-muted-foreground">No event details returned. Confirm controller and getdata access with MAIT.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Output</th><th className="p-2">Start time</th><th className="p-2">Duration (min)</th><th className="p-2">Reported volume (kL)</th></tr></thead><tbody>{events.slice(0, 10).map((event, index) => {
        const litres = number(event.reported_volume_litres);
        return <tr key={index} className="border-b"><td className="p-2">{event.output_number ?? event.external_valve_number ?? event.channel_number ?? event.channel ?? 'Not reported'}</td><td className="p-2">{timestamp(event.started_at ?? event.start_time)}</td><td className="p-2">{number(event.duration_minutes) ?? 'Not reported'}</td><td className="p-2">{litres == null ? 'Not reported' : litres / 1000}</td></tr>;
      })}</tbody></table></div>}
    </>}
  </section>;
}