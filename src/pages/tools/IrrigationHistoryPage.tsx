import { useEffect, useMemo, useState } from "react";
import { SessionTimeFields } from "@/components/irrigation/SessionTimeFields";
import {
  MAX_DURATION_MINUTES,
  TIME_ERRORS,
  clockValueFromISO,
  dateValueFromISO,
  formatClockWithDate,
  formatTimeRange,
  resolveSessionTimes,
} from "@/lib/irrigationTimes";

import { Link } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { PageHead } from "@/components/PageHead";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Plus } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";
import {
  CALCULATION_METHOD_LABEL,
  flowSourceLabel,
  formatDuration,
  formatFlow,
  formatLitres,
  formatNumber,
  snapshotFlow,
  useIrrigationValves,
  useReverseSession,
  useIrrigationCapabilities,
  useSessions,
  useUpdateSession,
  type IrrigationSession,
} from "@/lib/irrigationQuery";

import {
  emitterBasisLabel,
  formatEstimate,
  formatRowRanges,
  snapshotRowBlocks,
  vineBasisLabel,
  weightingBasisLabel,
} from "@/lib/irrigationRows";

const ALL = "all";
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Human-readable frozen row detail from the session's configuration snapshot. */
function RowsIrrigated({ session }: { session: IrrigationSession }) {
  const snap = snapshotRowBlocks(session.configuration_snapshot);
  if (!snap || snap.blocks.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Rows irrigated
      </div>
      <div className="mt-2 space-y-2">
        {snap.blocks.map((b) => {
          // Snapshot values only — historical sessions are never recalculated
          // from the current vineyard setup.
          const vines = formatEstimate(b.selected_vine_count, b.vine_count_is_estimated ?? true);
          const emitters = formatEstimate(
            b.selected_emitter_count,
            b.emitter_count_is_estimated ?? true,
          );
          return (
          <div key={b.block_id || b.block_name} className="text-sm">
            <div className="font-medium">{b.block_name}</div>
            <div className="text-xs text-muted-foreground">
              {b.row_count} row{b.row_count === 1 ? "" : "s"}:{" "}
              {formatRowRanges(b.row_numbers)}
              {b.selected_row_length_metres != null &&
                ` · ${Number(b.selected_row_length_metres).toLocaleString()} m`}
            </div>
            <div className="text-xs text-muted-foreground">
              Estimated vines: {vines ?? "Not available"}
              {b.vine_count_basis && ` (${vineBasisLabel(b.vine_count_basis)})`} · Estimated
              emitters: {emitters ?? "Not available"}
              {b.emitter_count_basis && ` (${emitterBasisLabel(b.emitter_count_basis)})`}
            </div>
            <div className="text-xs text-muted-foreground">
              Share of valve water:{" "}
              {b.allocation_percentage == null
                ? "—"
                : `${Number(b.allocation_percentage).toFixed(2)}%`}{" "}
              · Allocation basis:{" "}
              {weightingBasisLabel(b.weighting_basis ?? snap.weighting_basis)}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}


/** SQL 130 Times block — only rendered when the session has saved timestamps. */
function SessionTimes({ session }: { session: IrrigationSession }) {
  if (!session.started_at) return null;
  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Times
      </div>
      <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground sm:grid-cols-3">
        <div>Start: {formatClockWithDate(session.started_at)}</div>
        <div>
          Finish:{" "}
          {session.finished_at ? formatClockWithDate(session.finished_at) : "Not recorded"}
        </div>
        <div>Duration: {formatDuration(session.duration_minutes)}</div>
      </div>
    </div>
  );
}

/**
 * SQL 131 frozen flow detail. Shows the flow rate the session was actually
 * saved with — never the valve's current resolution.
 */
function SessionFlow({ session }: { session: IrrigationSession }) {
  const flow = snapshotFlow(session.configuration_snapshot);
  if (!flow) return null;
  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Water calculation (as recorded)
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Flow used: {formatFlow(flow.flow_lph_used)}
        {flow.flow_is_estimated != null &&
          ` (${flow.flow_is_estimated ? "estimated" : "measured"})`}{" "}
        · Source: {flowSourceLabel(flow.flow_source)}
        {flow.emitter_count != null &&
          ` · ${formatNumber(flow.emitter_count, 0)} emitters at the time`}
      </div>
      {flow.blocks.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {flow.blocks.map((b) => (
            <li key={b.block_id}>
              {b.block_name}: {formatFlow(b.block_flow_lph)}
              {b.emitter_count != null && ` · ${formatNumber(b.emitter_count, 0)} emitters`}
              {b.flow_per_emitter_lph != null &&
                ` × ${formatNumber(b.flow_per_emitter_lph, 2)} L/h each`}
            </li>
          ))}
        </ul>
      )}
      {flow.warning && <p className="mt-1 text-xs text-muted-foreground">{flow.warning}</p>}
    </div>
  );
}


function EditDialog({
  vineyardId,
  session,
  onClose,
}: {
  vineyardId: string | null;
  session: IrrigationSession;
  onClose: () => void;
}) {
  const update = useUpdateSession(vineyardId);
  const [date, setDate] = useState(
    dateValueFromISO(session.started_at) || session.session_date,
  );
  const [duration, setDuration] = useState(String(session.duration_minutes));
  const [startTime, setStartTime] = useState(clockValueFromISO(session.started_at));
  const [endTime, setEndTime] = useState(clockValueFromISO(session.finished_at));
  const [notes, setNotes] = useState(session.notes ?? "");
  const [useCurrent, setUseCurrent] = useState(false);

  const hadTimes = !!session.started_at || !!session.finished_at;

  const times = useMemo(
    () =>
      resolveSessionTimes({
        sessionDate: date,
        startTime,
        endTime,
        durationMinutes: num(duration),
      }),
    [date, startTime, endTime, duration],
  );

  const bothTimes = startTime.trim() !== "" && endTime.trim() !== "";

  useEffect(() => {
    if (bothTimes && times.durationMinutes != null) {
      const v = String(times.durationMinutes);
      if (v !== duration) setDuration(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothTimes, times.durationMinutes]);

  const effectiveMinutes =
    bothTimes && times.durationMinutes != null ? times.durationMinutes : num(duration);

  const error = useMemo(() => {
    if (times.error) return times.error;
    if (effectiveMinutes == null || !Number.isFinite(effectiveMinutes)) return TIME_ERRORS.zero;
    if (effectiveMinutes <= 0) return TIME_ERRORS.zero;
    if (effectiveMinutes > MAX_DURATION_MINUTES) return TIME_ERRORS.tooLong;
    return null;
  }, [times.error, effectiveMinutes]);

  const save = async () => {
    if (error) return;
    // Times were saved but the user removed them → explicit clear.
    const clearing = hadTimes && !startTime && !endTime;
    try {
      await update.mutateAsync({
        id: session.id,
        session_date: date,
        duration_minutes: effectiveMinutes,
        started_at: times.startedAt,
        finished_at: bothTimes ? times.finishedAt : null,
        clear_times: clearing,
        notes: notes || null,
        use_current_configuration: useCurrent,
      });
      toast({ title: "Session updated" });
      onClose();
    } catch (e) {
      toast({
        title: "Couldn't update session",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit irrigation session</DialogTitle>
          <DialogDescription>
            The backend recalculates volumes and block allocations from the session&rsquo;s
            saved configuration unless you choose the current setup.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="ed-date">Date</Label>
            <Input id="ed-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <SessionTimeFields
            idPrefix="ed"
            startTime={startTime}
            endTime={endTime}
            duration={duration}
            times={times}
            onStartTime={setStartTime}
            onEndTime={setEndTime}
            onDuration={setDuration}
            onClearTimes={() => {
              setStartTime("");
              setEndTime("");
            }}
          />
          {error && !times.error && <p className="text-xs text-destructive">{error}</p>}
          <div>
            <Label htmlFor="ed-notes">Notes</Label>
            <Textarea id="ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useCurrent}
              onChange={(e) => setUseCurrent(e.target.checked)}
            />
            Re-apply the current valve configuration
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending || !!error}>
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/** Imported sessions stay read-only through the normal session-edit controls. */
const isImported = (s: IrrigationSession) =>
  !!s.source_type && s.source_type !== "manual_portal" && s.source_type !== "manual_ios";

export default function IrrigationHistoryPage() {
  const { selectedVineyardId } = useVineyard();
  const { vintage } = useVintage();
  const valves = useIrrigationValves(selectedVineyardId, true);
  const reverse = useReverseSession(selectedVineyardId);
  const { capabilities, loading: capsLoading } = useIrrigationCapabilities(selectedVineyardId);

  const [valveId, setValveId] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeReversed, setIncludeReversed] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<IrrigationSession | null>(null);
  const [reversing, setReversing] = useState<IrrigationSession | null>(null);

  const pageSize = 25;
  const filters = useMemo(
    () => ({
      vintage_year: vintage,
      valve_id: valveId === ALL ? null : valveId,
      from_date: fromDate || null,
      to_date: toDate || null,
      include_reversed: includeReversed,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [vintage, valveId, fromDate, toDate, includeReversed, page],
  );
  const sessions = useSessions(selectedVineyardId, filters);
  const total = sessions.data?.total_count ?? 0;

  return (
    <div className="space-y-6">
      <PageHead
        title="Irrigation History | VineTrack"
        description="Every recorded irrigation session with water applied, runtime and per-block allocations."
        path="/irrigation/history"
        noindex
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/irrigation">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Irrigation Records
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Irrigation history</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vintage {vintage} · {total} session{total === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild>
          <Link to="/irrigation/record">
            <Plus className="mr-1.5 h-4 w-4" /> Record irrigation
          </Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Narrow the list by valve or date range.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Valve</Label>
            <Select
              value={valveId}
              onValueChange={(v) => {
                setValveId(v);
                setPage(0);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All valves</SelectItem>
                {valves.data?.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.system_name} · {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeReversed}
                onChange={(e) => {
                  setIncludeReversed(e.target.checked);
                  setPage(0);
                }}
              />
              Show reversed sessions
            </label>
          </div>
        </CardContent>
      </Card>

      {sessions.error && (
        <PortalNotice
          variant="error"
          title="Couldn't load sessions"
          description={(sessions.error as Error).message}
        />
      )}

      <div className="space-y-3">
        {sessions.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {sessions.data?.sessions.length === 0 && (
          <PortalNotice
            variant="info"
            title="No irrigation sessions"
            description="Nothing matches these filters yet."
          />
        )}
        {sessions.data?.sessions.map((s) => (
          <Card key={s.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {formatDate(s.session_date)} · {s.valve_name}
                    </span>
                    {s.status === "reversed" && <Badge variant="outline">Reversed</Badge>}
                    {s.status === "corrected" && <Badge variant="secondary">Corrected</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {s.started_at && (
                      <>{formatTimeRange(s.started_at, s.finished_at)} · </>
                    )}
                    {s.system_name} · {formatDuration(s.duration_minutes)} ·{" "}
                    {CALCULATION_METHOD_LABEL[s.calculation_method] ?? s.calculation_method}
                    {s.source_type === "manual_portal" ? " · Portal" : ` · ${s.source_type}`}
                  </div>

                </div>
                <div className="flex items-center gap-2">
                  <Badge className="tabular-nums">{formatLitres(s.total_volume_litres)}</Badge>
                  {s.status !== "reversed" && !capsLoading && (
                    <>
                      {capabilities.can_edit_irrigation && !isImported(s) && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                      )}
                      {capabilities.can_reverse_irrigation && (
                        <Button size="sm" variant="ghost" onClick={() => setReversing(s)}>
                          Reverse
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {s.blocks.map((b) => (
                  <div key={b.id ?? b.block_id} className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{b.block_name}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {formatLitres(b.allocated_volume_litres)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatNumber(b.allocation_percentage, 2)}%
                      {b.irrigation_depth_mm != null &&
                        ` · ${formatNumber(b.irrigation_depth_mm, 2)} mm`}
                    </div>
                  </div>
                ))}
              </div>

              <SessionTimes session={s} />

              <SessionFlow session={s} />


              <RowsIrrigated session={s} />


              {s.notes && <p className="mt-2 text-sm text-muted-foreground">{s.notes}</p>}

            </CardContent>
          </Card>
        ))}
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {Math.ceil(total / pageSize)}
          </span>
          <Button
            variant="outline"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {editing && (
        <EditDialog
          vineyardId={selectedVineyardId}
          session={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog open={!!reversing} onOpenChange={(v) => !v && setReversing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this irrigation session?</AlertDialogTitle>
            <AlertDialogDescription>
              The session stays in the record for audit but is removed from all water totals
              and reports.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!reversing) return;
                try {
                  await reverse.mutateAsync(reversing.id);
                  toast({ title: "Session reversed" });
                } catch (e) {
                  toast({
                    title: "Couldn't reverse session",
                    description: (e as Error).message,
                    variant: "destructive",
                  });
                }
                setReversing(null);
              }}
            >
              Reverse session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
