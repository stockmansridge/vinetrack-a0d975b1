import { useMemo, useState } from "react";
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
  formatDuration,
  formatLitres,
  formatNumber,
  useIrrigationValves,
  useReverseSession,
  useSessions,
  useUpdateSession,
  type IrrigationSession,
} from "@/lib/irrigationQuery";
import {
  formatRowRanges,
  snapshotRowBlocks,
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
        {snap.blocks.map((b) => (
          <div key={b.block_id || b.block_name} className="text-sm">
            <div className="font-medium">{b.block_name}</div>
            <div className="text-xs text-muted-foreground">
              {b.row_count} row{b.row_count === 1 ? "" : "s"}:{" "}
              {formatRowRanges(b.row_numbers)}
            </div>
            <div className="text-xs text-muted-foreground">
              Allocation:{" "}
              {b.allocation_percentage == null
                ? "—"
                : `${Number(b.allocation_percentage).toFixed(2)}%`}{" "}
              · Basis: {weightingBasisLabel(b.weighting_basis ?? snap.weighting_basis)}
            </div>
          </div>
        ))}
      </div>
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
  const [date, setDate] = useState(session.session_date);
  const [duration, setDuration] = useState(String(session.duration_minutes));
  const [notes, setNotes] = useState(session.notes ?? "");
  const [useCurrent, setUseCurrent] = useState(false);

  const save = async () => {
    try {
      await update.mutateAsync({
        id: session.id,
        session_date: date,
        duration_minutes: num(duration),
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-date">Date</Label>
              <Input id="ed-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ed-dur">Duration (minutes)</Label>
              <Input
                id="ed-dur"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          </div>
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
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function IrrigationHistoryPage() {
  const { selectedVineyardId } = useVineyard();
  const { vintage } = useVintage();
  const valves = useIrrigationValves(selectedVineyardId, true);
  const reverse = useReverseSession(selectedVineyardId);

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
                    {s.system_name} · {formatDuration(s.duration_minutes)} ·{" "}
                    {CALCULATION_METHOD_LABEL[s.calculation_method] ?? s.calculation_method}
                    {s.source_type === "manual_portal" ? " · Portal" : ` · ${s.source_type}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="tabular-nums">{formatLitres(s.total_volume_litres)}</Badge>
                  {s.status !== "reversed" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReversing(s)}>
                        Reverse
                      </Button>
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
