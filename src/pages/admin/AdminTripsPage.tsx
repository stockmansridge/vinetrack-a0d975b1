import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AdminEmpty, AdminError, AdminPageHeader, formatRelative } from "./_shared";
import {
  adminTripStatus,
  blockScopeDiff,
  canForceStop,
  detectTripIssues,
  formatDurationMs,
  lastOperationalActivity,
  needsAttention,
  parseTripTime,
  useAdminTripDetail,
  useAdminTripsList,
  useForceStopTrip,
  type AdminTripDetail,
  type AdminTripRow,
  type TripStatus,
} from "@/lib/adminTrips";

type StatusFilter = "all" | "active" | "paused" | "completed" | "attention";

const STATUS_LABEL: Record<TripStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  not_started: "Not started",
};

function fmt(iso: string | null | undefined) {
  const d = parseTripTime(iso ?? null);
  return d ? d.toLocaleString() : "—";
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function StatusBadge({ status }: { status: TripStatus }) {
  const variant = status === "active" ? "default" : status === "paused" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

export default function AdminTripsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [vineyard, setVineyard] = useState("all");
  const [fn, setFn] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const list = useAdminTripsList({
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
  });
  const rows = list.data ?? [];

  const counts = useMemo(() => {
    const dayAgo = Date.now() - 86_400_000;
    return {
      active: rows.filter((r) => adminTripStatus(r) === "active").length,
      paused: rows.filter((r) => adminTripStatus(r) === "paused").length,
      attention: rows.filter(needsAttention).length,
      recent: rows.filter((r) => r.end_time && new Date(r.end_time).getTime() >= dayAgo).length,
    };
  }, [rows]);

  const vineyards = useMemo(
    () => [...new Map(rows.map((r) => [r.vineyard_id, r.vineyard_name ?? r.vineyard_id])).entries()],
    [rows],
  );
  const functions = useMemo(
    () => [...new Set(rows.map((r) => r.trip_function).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filtered = rows.filter((r) => {
    const st = adminTripStatus(r);
    if (status === "attention" && !needsAttention(r)) return false;
    if (status !== "all" && status !== "attention" && st !== status) return false;
    if (vineyard !== "all" && r.vineyard_id !== vineyard) return false;
    if (fn !== "all" && r.trip_function !== fn) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = [r.id, r.vineyard_name, r.operator_name, r.operator_email, r.trip_title, r.trip_function]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const selectedRow = rows.find((r) => r.id === selected) ?? null;

  return (
    <div className="p-6 space-y-4">
      <AdminPageHeader title="Trips" subtitle="Support view of every Trip across all vineyards." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Active", counts.active, "active"],
          ["Paused", counts.paused, "paused"],
          ["Needs attention", counts.attention, "attention"],
          ["Completed (24h)", counts.recent, "completed"],
        ].map(([label, n, key]) => (
          <Card
            key={label as string}
            className="p-3 cursor-pointer hover:bg-muted/40"
            onClick={() => setStatus(key as StatusFilter)}
            data-testid={`count-${key}`}
          >
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold">{n as number}</div>
          </Card>
        ))}
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-end">
        <Input
          placeholder="Search Trip ID, vineyard, operator, title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="attention">Needs attention</SelectItem>
          </SelectContent>
        </Select>
        <Select value={vineyard} onValueChange={setVineyard}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Vineyard" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vineyards</SelectItem>
            {vineyards.map(([id, name]) => id && <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fn} onValueChange={setFn}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Function" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All functions</SelectItem>
            {functions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Card>

      <AdminError error={list.error} />
      {list.isLoading ? (
        <AdminEmpty>Loading Trips…</AdminEmpty>
      ) : filtered.length === 0 ? (
        <AdminEmpty>No Trips match these filters.</AdminEmpty>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {["Status", "Vineyard", "Trip", "Operator", "Started", "Last activity", "Duration", "Distance", "Mode", "Blocks", "Tanks", "Spray Record", "Issues"].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const issues = detectTripIssues(r);
                const st = adminTripStatus(r);
                const start = parseTripTime(r.start_time);
                const end = parseTripTime(r.end_time);
                const dur = start ? (end ?? new Date()).getTime() - start.getTime() : null;
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r.id)} data-testid={`trip-row-${r.id}`}>
                    <TableCell><StatusBadge status={st} /></TableCell>
                    <TableCell>{r.vineyard_name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.trip_title || r.trip_function || "Trip"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.id.slice(0, 8)}</div>
                    </TableCell>
                    <TableCell>{r.operator_name ?? r.operator_email ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(r.start_time)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatRelative(r.client_updated_at ?? r.updated_at)}</TableCell>
                    <TableCell>{formatDurationMs(dur)}</TableCell>
                    <TableCell>{r.total_distance != null ? `${(r.total_distance / 1000).toFixed(2)} km` : "—"}</TableCell>
                    <TableCell>{r.tracking_pattern ?? "—"}</TableCell>
                    <TableCell>{r.block_ids?.length ?? 0}</TableCell>
                    <TableCell>{r.total_tanks ?? "—"}{r.active_tank_number != null && ` (active ${r.active_tank_number})`}</TableCell>
                    <TableCell>{r.spray_record_id ? (r.spray_record_end_time ? "Closed" : "Open") : "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {issues.map((i) => (
                          <Badge key={i.code} variant={i.severity === "warning" ? "destructive" : "secondary"}>{i.label}</Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          {selected && <TripDetail tripId={selected} row={selectedRow} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <Card className="p-3 text-sm space-y-1">{children}</Card>
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right break-all">{v ?? "—"}</span>
    </div>
  );
}

export function TripDetail({ tripId, row }: { tripId: string; row: AdminTripRow | null }) {
  const detail = useAdminTripDetail(tripId);
  const [stopOpen, setStopOpen] = useState(false);
  const { toast } = useToast();
  const d = detail.data;
  const t = d?.trip ?? (row as any) ?? {};
  const base: AdminTripRow = {
    ...(row ?? ({} as AdminTripRow)),
    ...(t as any),
    block_ids: d ? d.blocks.map((b) => b.id) : row?.block_ids ?? [],
    tank_sessions: Array.isArray(t.tank_sessions)
      ? t.tank_sessions.map((s: any) => ({
          tankNumber: s.tankNumber ?? s.tank_number ?? s.number ?? null,
          startTime: s.startTime ?? s.start_time,
          endTime: s.endTime ?? s.end_time,
          fillStartTime: s.fillStartTime ?? s.fill_start_time,
          fillEndTime: s.fillEndTime ?? s.fill_end_time,
        }))
      : row?.tank_sessions ?? [],
    spray_record_id: d?.spray_record?.id ?? row?.spray_record_id ?? null,
    spray_record_end_time: d ? d.spray_record?.end_time ?? null : row?.spray_record_end_time ?? null,
    spray_application_block_ids: d ? d.spray_record?.application_block_ids ?? null : row?.spray_application_block_ids ?? null,
  };
  const issues = detectTripIssues(base);
  const diff = blockScopeDiff(base.block_ids, base.spray_application_block_ids);
  const st = adminTripStatus(base);
  const staleTank = issues.some((i) => i.code === "stale_active_tank");

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {t.trip_title || t.trip_function || "Trip"} <StatusBadge status={st} />
        </SheetTitle>
      </SheetHeader>
      <AdminError error={detail.error} />
      {issues.length > 0 && (
        <Card className="p-3 space-y-1" data-testid="trip-issues">
          {issues.map((i) => (
            <div key={i.code} className="text-sm">
              <Badge variant={i.severity === "warning" ? "destructive" : "secondary"}>{i.label}</Badge>{" "}
              <span className="text-muted-foreground">{i.detail}</span>
            </div>
          ))}
        </Card>
      )}
      {canForceStop(base) && (
        <Card className="p-3 flex items-center justify-between gap-3 border-destructive/40">
          <div className="text-sm">
            <div className="font-medium">Support recovery</div>
            <div className="text-muted-foreground">Closes the runtime state of a stuck Trip. Not a customer edit.</div>
          </div>
          <Button variant="destructive" onClick={() => setStopOpen(true)}>Force Stop Trip</Button>
        </Card>
      )}

      <Section title="Overview">
        <KV k="Trip ID" v={<span className="font-mono">{tripId}</span>} />
        <KV k="Vineyard" v={d?.vineyard?.name ?? row?.vineyard_name} />
        <KV k="Operator" v={t.person_name || d?.operator?.full_name || d?.operator?.email} />
        <KV k="Function / title" v={[t.trip_function, t.trip_title].filter(Boolean).join(" · ")} />
        <KV k="State" v={`active=${String(!!t.is_active)} · paused=${String(!!t.is_paused)}`} />
        <KV k="Start" v={fmt(t.start_time)} />
        <KV k="End" v={fmt(t.end_time)} />
        <KV k="Last update" v={fmt(t.client_updated_at ?? t.updated_at)} />
        <KV k="Mode" v={t.tracking_pattern} />
      </Section>

      <Section title="Route">
        <KV k="Total distance" v={t.total_distance != null ? `${(t.total_distance / 1000).toFixed(2)} km` : "—"} />
        <KV k="Path points" v={t.path_point_count ?? "—"} />
        <KV k="Completed paths" v={t.completed_path_count ?? "—"} />
        <KV k="Skipped paths" v={t.skipped_path_count ?? "—"} />
        <KV k="Current / next row" v={`${t.current_row_number ?? "—"} / ${t.next_row_number ?? "—"}`} />
      </Section>

      <Section title="Blocks">
        <KV k="Trip blocks" v={d?.blocks.length ?? base.block_ids?.length ?? 0} />
        <KV k="Spray Record application blocks" v={base.spray_application_block_ids?.length ?? "—"} />
        {diff && diff.added.length > 0 && (
          <div>
            <span className="text-muted-foreground">Added during the job: </span>
            {diff.added.map((id) => d?.blocks.find((b) => b.id === id)?.name ?? id).join(", ")}
          </div>
        )}
        {diff && diff.missing.length > 0 && (
          <div>
            <span className="text-muted-foreground">On Spray Record only: </span>
            {diff.missing.map((id) => d?.application_blocks.find((b) => b.id === id)?.name ?? id).join(", ")}
          </div>
        )}
      </Section>

      <Section title="Tanks">
        <KV k="Planned tanks" v={t.total_tanks} />
        <KV k="Active tank" v={t.active_tank_number ?? "none"} />
        <KV k="Filling" v={t.is_filling_tank ? `yes (tank ${t.filling_tank_number ?? "?"})` : "no"} />
        {staleTank && <div className="text-destructive">Active tank {t.active_tank_number} points to a Tank Session that has already ended.</div>}
        <div className="pt-2 font-medium">Tank Sessions</div>
        {(base.tank_sessions ?? []).length === 0 ? (
          <div className="text-muted-foreground">None</div>
        ) : (
          (base.tank_sessions ?? []).map((s, i) => (
            <div key={i} className="flex justify-between">
              <span>Tank {s.tankNumber ?? i + 1}</span>
              <span className="text-muted-foreground">
                {parseTripTime(s.startTime)?.toLocaleTimeString() ?? "—"} → {parseTripTime(s.endTime)?.toLocaleTimeString() ?? "open"}
              </span>
            </div>
          ))
        )}
        <div className="pt-2 font-medium">Tank actuals</div>
        <div className="text-muted-foreground">{d ? `${d.tank_actuals.length} recorded` : "—"}</div>
      </Section>

      <Section title="Equipment / operator">
        <KV k="Tractor" v={d?.tractor?.name} />
        <KV k="Operator account" v={d?.operator?.email} />
        <KV k="Engine hours" v={`${t.start_engine_hours ?? "—"} → ${t.end_engine_hours ?? "—"}`} />
      </Section>

      <Section title="Spray Record">
        {d?.spray_record ? (
          <>
            <KV k="ID" v={<span className="font-mono">{d.spray_record.id}</span>} />
            <KV k="Start / end" v={`${d.spray_record.start_time ?? "—"} → ${d.spray_record.end_time ?? "open"}`} />
            <KV k="Tanks on record" v={d.spray_record.tank_count} />
          </>
        ) : (
          <div className="text-muted-foreground">No linked Spray Record</div>
        )}
      </Section>

      <Section title="Diagnostics">
        <KV k="Sync version" v={t.sync_version} />
        <KV k="Updated" v={fmt(t.updated_at)} />
        <KV k="Client updated" v={fmt(t.client_updated_at)} />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard?.writeText(JSON.stringify(d ?? row, null, 2));
            toast({ title: "Diagnostic JSON copied" });
          }}
        >
          Copy diagnostic JSON
        </Button>
      </Section>

      <Section title="Audit">
        {(d?.audit ?? []).length === 0 ? (
          <div className="text-muted-foreground">No recovery actions recorded.</div>
        ) : (
          d!.audit.map((a) => (
            <div key={a.id} className="border-b last:border-0 py-1">
              <div className="font-medium">{a.action} · {fmt(a.created_at)}</div>
              <div className="text-muted-foreground">{a.details?.reason}</div>
            </div>
          ))
        )}
      </Section>

      <ForceStopDialog open={stopOpen} onOpenChange={setStopOpen} trip={base} detail={d ?? null} />
    </div>
  );
}

export function ForceStopDialog({
  open,
  onOpenChange,
  trip,
  detail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  trip: AdminTripRow;
  detail: AdminTripDetail | null;
}) {
  const { toast } = useToast();
  const stop = useForceStopTrip();
  const last = lastOperationalActivity(detail, trip);
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState(() => toLocalInput(last ?? new Date()));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError("A support reason is required.");
      return;
    }
    try {
      const r = await stop.mutateAsync({ tripId: trip.id, reason, endTime: new Date(when).toISOString() });
      setResult(
        r.status === "already_completed"
          ? `Trip was already completed at ${fmt(r.end_time)}. Nothing changed.`
          : `Trip completed at ${fmt(r.end_time)}.${r.spray_record_closed ? " Linked Spray Record closed at the same time." : ""}`,
      );
      toast({ title: "Trip force-stopped" });
    } catch (e: any) {
      setError(e?.message ?? "Force Stop failed. Nothing was changed.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          setError(null);
          setResult(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Force Stop Trip</DialogTitle>
          <DialogDescription>Support recovery action for a stuck Trip.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="text-sm" data-testid="force-stop-result">{result}</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <div><span className="text-muted-foreground">Trip:</span> {trip.trip_title || trip.trip_function || "Trip"} <span className="font-mono text-xs">{trip.id}</span></div>
              <div><span className="text-muted-foreground">Vineyard:</span> {detail?.vineyard?.name ?? trip.vineyard_name ?? "—"}</div>
              <div><span className="text-muted-foreground">Current state:</span> active={String(!!trip.is_active)}, paused={String(!!trip.is_paused)}, active tank={trip.active_tank_number ?? "none"}, filling={trip.is_filling_tank ? `yes (tank ${trip.filling_tank_number ?? "?"})` : "no"}</div>
              <div><span className="text-muted-foreground">Spray Record:</span> {trip.spray_record_id ? (trip.spray_record_end_time ? "closed" : "open — will be closed at the same time") : "none linked"}</div>
              <div><span className="text-muted-foreground">Last known activity:</span> {last ? last.toLocaleString() : "unknown"}</div>
            </div>
            <div>
              <Label htmlFor="fs-time">Completion time</Label>
              <Input id="fs-time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Suggested from the last operational activity, not the current time, so duration and costing aren't distorted.</p>
            </div>
            <div>
              <Label htmlFor="fs-reason">Support reason (required)</Label>
              <Textarea id="fs-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="rounded border p-2 text-xs space-y-1">
              <div>Will set: end time, active = off, paused = off, active tank cleared, filling = off, filling tank cleared, sync version +1.</div>
              <div>Preserved unchanged: route and path points, distance, Tank Sessions, tank actuals, chemicals, pins, weather, completed/skipped paths, planned tanks and block history. No missing tank actuals are created.</div>
            </div>
            {error && <div className="text-destructive" role="alert">{error}</div>}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="destructive" onClick={submit} disabled={stop.isPending}>
                {stop.isPending ? "Stopping…" : "Force Stop"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
