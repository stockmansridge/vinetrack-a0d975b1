import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  actionForIssue,
  adminTripStatus,
  blockScopeDiff,
  describeCloseSpray,
  describeReconcile,
  tripActions,
  TRIP_ACTION_LABEL,
  useCloseSprayRecordFromTrip,
  useReconcileTripRuntime,
  type TripActionId,
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
  const [pendingAction, setPendingAction] = useState<TripActionId | null>(null);
  const { toast } = useToast();
  const openTrip = (id: string, action: TripActionId | null = null) => {
    setSelected(id);
    setPendingAction(action);
  };

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
                {["Status", "Vineyard", "Trip", "Operator", "Started", "Last activity", "Duration", "Distance", "Mode", "Blocks", "Tanks", "Spray Record", "Issues", "Actions"].map((h) => (
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
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openTrip(r.id)} data-testid={`trip-row-${r.id}`}>
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        row={r}
                        onOpen={(a) => openTrip(r.id, a)}
                        onCopy={() => {
                          navigator.clipboard?.writeText(JSON.stringify(r, null, 2));
                          toast({ title: "Diagnostic JSON copied" });
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setPendingAction(null); } }}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          {selected && <TripDetail key={`${selected}-${pendingAction ?? ""}`} tripId={selected} row={selectedRow} initialAction={pendingAction} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function RowActions({
  row,
  onOpen,
  onCopy,
}: {
  row: AdminTripRow;
  onOpen: (a: TripActionId | null) => void;
  onCopy: () => void;
}) {
  const actions = tripActions(row);
  const contextual = actions.filter((a) => a !== "force_stop");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Trip actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen(null)}>View Details</DropdownMenuItem>
        {contextual.map((a) => (
          <DropdownMenuItem key={a} onSelect={() => onOpen(a)}>{TRIP_ACTION_LABEL[a]}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {actions.includes("force_stop") && (
          <DropdownMenuItem onSelect={() => onOpen("force_stop")} className="text-destructive">Force Stop Trip</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onCopy}>Copy Diagnostic JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Section({ title, children, sectionRef }: { title: string; children: React.ReactNode; sectionRef?: React.Ref<HTMLElement> }) {
  return (
    <section className="space-y-2" ref={sectionRef}>
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

export function TripDetail({
  tripId,
  row,
  initialAction = null,
}: {
  tripId: string;
  row: AdminTripRow | null;
  initialAction?: TripActionId | null;
}) {
  const detail = useAdminTripDetail(tripId);
  const [stopOpen, setStopOpen] = useState(initialAction === "force_stop");
  const [repair, setRepair] = useState<TripActionId | null>(
    initialAction && ["repair_tank", "repair_fill", "repair_completion", "close_spray"].includes(initialAction) ? initialAction : null,
  );
  const [blocksOpen, setBlocksOpen] = useState(initialAction === "compare_blocks");
  const blocksRef = useRef<HTMLElement>(null);
  const sprayRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialAction === "compare_blocks") blocksRef.current?.scrollIntoView?.({ block: "start" });
    if (initialAction === "review_spray") sprayRef.current?.scrollIntoView?.({ block: "start" });
  }, [initialAction]);
  const runAction = (a: TripActionId) => {
    if (a === "force_stop") setStopOpen(true);
    else if (a === "compare_blocks") {
      setBlocksOpen(true);
      blocksRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    } else if (a === "review_spray") sprayRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    else setRepair(a);
  };
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
          {issues.map((i) => {
            const a = actionForIssue(base, i);
            return (
              <div key={i.code} className="text-sm flex items-start justify-between gap-3" data-testid={`issue-${i.code}`}>
                <div>
                  <Badge variant={i.severity === "warning" ? "destructive" : "secondary"}>{i.label}</Badge>{" "}
                  <span className="text-muted-foreground">{i.detail}</span>
                </div>
                {a && (
                  <Button size="sm" variant={a === "compare_blocks" || a === "review_spray" ? "outline" : "default"} onClick={() => runAction(a)}>
                    {TRIP_ACTION_LABEL[a]}
                  </Button>
                )}
              </div>
            );
          })}
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

      <Section title="Blocks" sectionRef={blocksRef}>
        <KV k="Blocks currently recorded on the Trip" v={d?.blocks.length ?? base.block_ids?.length ?? 0} />
        <KV k="Original Spray Record blocks" v={base.spray_application_block_ids?.length ?? "—"} />
        {diff && diff.added.length > 0 && (
          <div>
            <span className="text-muted-foreground">Added during Trip: </span>
            {diff.added.map((id) => d?.blocks.find((b) => b.id === id)?.name ?? id).join(", ")}
          </div>
        )}
        {diff && diff.missing.length > 0 && (
          <div>
            <span className="text-muted-foreground">On original Spray Record but not Trip: </span>
            {diff.missing.map((id) => d?.application_blocks.find((b) => b.id === id)?.name ?? id).join(", ")}
          </div>
        )}
        {diff && (
          <Button size="sm" variant="ghost" onClick={() => setBlocksOpen((o) => !o)}>
            {blocksOpen ? "Hide block lists" : "Compare Blocks"}
          </Button>
        )}
        {blocksOpen && (
          <div className="grid grid-cols-2 gap-3 pt-1" data-testid="block-compare">
            <div>
              <div className="font-medium">Original Spray Record blocks</div>
              {(d?.application_blocks ?? (base.spray_application_block_ids ?? []).map((id) => ({ id, name: null }))).map((b) => (
                <div key={b.id}>{b.name ?? b.id}</div>
              ))}
            </div>
            <div>
              <div className="font-medium">Blocks on the Trip</div>
              {(d?.blocks ?? (base.block_ids ?? []).map((id) => ({ id, name: null }))).map((b) => (
                <div key={b.id}>{b.name ?? b.id}{diff?.added.includes(b.id) ? " (added)" : ""}</div>
              ))}
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">Differences are kept as planned-versus-actual evidence and are not changed from here.</p>
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

      <Section title="Spray Record" sectionRef={sprayRef}>
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
      {repair && (
        <RepairDialog action={repair} trip={base} onOpenChange={(o) => !o && setRepair(null)} />
      )}
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

export function repairCopy(action: TripActionId, trip: AdminTripRow): string {
  const n = trip.active_tank_number;
  switch (action) {
    case "repair_tank":
      return `Tank ${n}'s session is already recorded as ended, but the Trip still marks Tank ${n} active. This will clear the stale active-tank flag only. Tank records and actual quantities will not change.`;
    case "repair_fill":
      return `The Trip says Tank ${trip.filling_tank_number ?? "?"} is filling, but no open fill session exists. This will clear the stale filling flag and filling tank only. Fill sessions, tanks and quantities will not change.`;
    case "repair_completion":
      return `The Trip finished at ${fmt(trip.end_time)}, but runtime fields still claim it is running. This will turn off active, paused and filling and clear the active and filling tank. The existing end time is kept; no new completion time is created.`;
    case "close_spray":
      return `The Trip finished at ${fmt(trip.end_time)}, but its linked Spray Record remains open. This will close the Spray Record at the same completion time. Spray quantities, tanks, blocks and weather will not change.`;
    default:
      return "";
  }
}

export function RepairDialog({
  action,
  trip,
  onOpenChange,
}: {
  action: TripActionId;
  trip: AdminTripRow;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const reconcile = useReconcileTripRuntime();
  const closeSpray = useCloseSprayRecordFromTrip();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const pending = reconcile.isPending || closeSpray.isPending;

  const submit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError("A support reason is required.");
      return;
    }
    try {
      const msg =
        action === "close_spray"
          ? describeCloseSpray(await closeSpray.mutateAsync({ tripId: trip.id, reason }))
          : describeReconcile(await reconcile.mutateAsync({ tripId: trip.id, reason }));
      setResult(msg);
      toast({ title: TRIP_ACTION_LABEL[action], description: msg });
    } catch (e: any) {
      setError(e?.message ?? "Repair failed. Nothing was changed.");
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{TRIP_ACTION_LABEL[action]}</DialogTitle>
          <DialogDescription>
            {trip.trip_title || trip.trip_function || "Trip"} · {trip.vineyard_name ?? "—"}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="text-sm" data-testid="repair-result">{result}</div>
        ) : (
          <div className="space-y-3 text-sm">
            <p data-testid="repair-copy">{repairCopy(action, trip)}</p>
            <div>
              <Label htmlFor="repair-reason">Support reason (required)</Label>
              <Textarea id="repair-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
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
              <Button onClick={submit} disabled={pending}>{pending ? "Working…" : TRIP_ACTION_LABEL[action]}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
