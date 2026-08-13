// Work Task controls for the parent pruning activity (SQL 166).
//
// The Work Task belongs to the ACTIVITY, never to a single block allocation.
// Creating or picking a task from here must never mutate or reset the pruning
// draft — this component only ever reports a task id (and the canonical task
// labour totals) back to its parent.
//
// Labour lives on the Work Task. The create dialog reuses the SHARED
// WorkTaskLabourFields block (labour type, rate, people, hours per person and
// the derived person-hours / cost) — there is no pruning-specific labour form.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Link2, Link2Off, Loader2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useAuth } from "@/context/AuthContext";
import {
  createLabourLine, createWorkTask, fetchLabourLinesForTask, fetchWorkTaskById,
  fetchPieceRateRowsForTask, syncWorkTaskPieceRateRows,
  fetchWorkTaskPaddocksForVineyard, fetchWorkTasksForVineyard, syncWorkTaskPaddocks,
  type WorkTask, type WorkTaskLabourLine,
} from "@/lib/workTasksQuery";
import { usePruningActivities } from "@/lib/pruningActivityApi";
import {
  COSTING_METHOD_HOURLY, COSTING_METHOD_PIECE_RATE, costPerHectare,
  pieceRateTotalCost, resolveCostingMethod, type CostingMethod,
} from "@/lib/pieceRateCosting";
import {
  activityTotals, allocationQuarterCount, allocationRowSummary, draftPieceRateRows,
  type BlockAllocationDraft, type PruningActivityDraft,
} from "@/lib/pruningActivityContract";
import { formatDate } from "@/lib/dateFormat";
import { supabase } from "@/integrations/ios-supabase/client";
import { parsePolygonPoints, polygonAreaHectares } from "@/lib/paddockGeometry";
import WorkTaskLabourFields, {
  elapsedHoursBetween, emptyLabourValue, labourTotals, labourTypeName, useLabourTypes,
  type LabourFieldsValue,
} from "@/components/work-tasks/WorkTaskLabourFields";

const OPEN_STATUSES = ["planned", "in_progress", "in progress", "open", "scheduled", "pending"];

const statusLabel = (s?: string | null) =>
  !s ? "—" : s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const money = (n: number) => `$${n.toFixed(2)}`;

/** "Pinot Noir W1 (rows 1–4), Shiraz E2 (rows 9–10)" */
export function blockSummaryText(allocations: Record<string, BlockAllocationDraft>): string {
  const parts = Object.values(allocations)
    .filter((a) => allocationQuarterCount(a) > 0)
    .map((a) => `${a.paddockName} (${allocationRowSummary(a)})`);
  return parts.join(", ");
}

/** Canonical labour totals for a task, summed across its labour lines. */
export function summariseTaskLabour(lines: WorkTaskLabourLine[]) {
  const active = lines.filter((l) => !l.deleted_at);
  const totalHours = active.reduce(
    (s, l) => s + Number(l.total_hours ?? (Number(l.worker_count ?? 0) * Number(l.hours_per_worker ?? 0))),
    0,
  );
  const totalCost = active.reduce((s, l) => s + Number(l.total_cost ?? 0), 0);
  const rate = totalHours > 0 && totalCost > 0 ? Math.round((totalCost / totalHours) * 100) / 100 : null;
  return {
    lines: active,
    totalHours: totalHours || null,
    totalCost: totalCost || null,
    rate: rate ?? (active[0]?.hourly_rate != null ? Number(active[0].hourly_rate) : null),
  };
}

export interface ResolvedTaskLabour {
  hours: number | null;
  rate: number | null;
}

interface Props {
  vineyardId: string;
  draft: PruningActivityDraft;
  /** Current activity id (edit mode) — used to ignore self when detecting conflicts. */
  activityId?: string | null;
  value: string | null;
  onChange: (workTaskId: string | null) => void;
  /** Canonical labour read back from the linked task, mirrored to the activity. */
  onLabourResolved?: (labour: ResolvedTaskLabour) => void;
  /** "HH:MM" activity start/finish, used to prefill hours per person. */
  startTime?: string;
  finishTime?: string;
  /** Legacy activity labour (no Work Task yet) used to seed the create form. */
  legacyLabourHours?: number | null;
  legacyHourlyRate?: number | null;
  disabled?: boolean;
}

export default function ActivityWorkTaskField({
  vineyardId, draft, activityId = null, value, onChange, onLabourResolved,
  startTime = "", finishTime = "", legacyLabourHours = null, legacyHourlyRate = null, disabled,
}: Props) {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const linkedQ = useQuery({
    queryKey: ["pruning-activity", "work-task", value],
    enabled: !!value,
    queryFn: () => fetchWorkTaskById(value!),
  });
  const labourQ = useQuery({
    queryKey: ["pruning-activity", "work-task-labour", value],
    enabled: !!value,
    queryFn: () => fetchLabourLinesForTask(value!),
  });
  const linked = linkedQ.data ?? null;
  const labour = useMemo(() => summariseTaskLabour(labourQ.data ?? []), [labourQ.data]);

  // Mirror the canonical task labour onto the parent activity (read-only there).
  useEffect(() => {
    if (!value || !labourQ.data) return;
    onLabourResolved?.({ hours: labour.totalHours, rate: labour.rate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, labourQ.data]);

  const hasLegacyLabour = !value && (legacyLabourHours ?? 0) > 0;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">Work Task</Label>
        {value && <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" /> Linked</Badge>}
      </div>

      {!value && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground mr-1">Not linked</span>
            <Button type="button" size="sm" variant="outline" disabled={disabled}
              onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              {hasLegacyLabour ? "Create Work Task from existing labour" : "Create Work Task"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled}
              onClick={() => setPickerOpen(true)}>
              <Search className="h-4 w-4 mr-1" /> Link existing Work Task
            </Button>
          </div>
          {hasLegacyLabour && (
            <p className="text-xs text-muted-foreground">
              Legacy labour on this activity (read-only):{" "}
              <b className="text-foreground">{Number(legacyLabourHours).toFixed(2)} hours</b>
              {legacyHourlyRate != null ? ` @ ${money(Number(legacyHourlyRate))}/h` : ""}. It stays
              exactly as recorded until a Work Task is created successfully.
            </p>
          )}
        </div>
      )}

      {value && (
        <div className="space-y-2">
          <div className="text-sm">
            {linkedQ.isLoading ? (
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading task…
              </span>
            ) : (
              <>
                <span className="font-medium">
                  {linked?.description?.trim() || linked?.task_type || "Work Task"}
                </span>
                <span className="text-muted-foreground">
                  {" · "}{statusLabel(linked?.status)}
                  {linked?.end_date || linked?.date
                    ? ` · due ${formatDate((linked.end_date ?? linked.date)!.slice(0, 10))}`
                    : ""}
                </span>
              </>
            )}
          </div>

          {/* SQL 188: a piece-rate task is costed from its saved snapshot —
              labour lines are operational history only and are NEVER added. */}
          {resolveCostingMethod(linked) === "piece_rate" ? (
            <div className="rounded border bg-background/60 px-3 py-2 text-xs space-y-0.5 tabular-nums">
              <div>
                <span className="text-muted-foreground">Costing method: </span>
                <b className="text-foreground">Piece Rate</b>
              </div>
              <div>
                <span className="text-muted-foreground">Rate: </span>
                <b className="text-foreground">
                  {linked?.piece_rate_per_vine != null ? `${money(Number(linked.piece_rate_per_vine))} / vine` : "—"}
                </b>
                <span className="text-muted-foreground"> · Vines (snapshot): </span>
                <b className="text-foreground">
                  {linked?.piece_vine_count != null ? Number(linked.piece_vine_count).toLocaleString() : "—"}
                </b>
              </div>
              <div>
                <span className="text-muted-foreground">Labour cost: </span>
                <b className="text-foreground">
                  {linked?.piece_rate_total_cost != null ? money(Number(linked.piece_rate_total_cost)) : "—"}
                </b>
              </div>
              {labour.totalHours != null && (
                <div className="text-muted-foreground">
                  Hours worked: {labour.totalHours.toFixed(2)} — operational history only, not costed.
                </div>
              )}
            </div>
          ) : (
          <div className="rounded border bg-background/60 px-3 py-2 text-xs space-y-0.5 tabular-nums">
            {labourQ.isLoading ? (
              <span className="text-muted-foreground">Loading labour…</span>
            ) : labour.lines.length === 0 ? (
              <span className="text-muted-foreground">
                No labour recorded on this task yet — add it on the Work Task.
              </span>
            ) : (
              <>
                {labour.lines.map((l) => (
                  <div key={l.id}>
                    <span className="text-muted-foreground">Labour type: </span>
                    <b className="text-foreground">{l.worker_type ?? "Worker"}</b>
                    <span className="text-muted-foreground"> · Crew: </span>
                    <b className="text-foreground">{Number(l.worker_count ?? 0)} people</b>
                    <span className="text-muted-foreground"> · Hours each: </span>
                    <b className="text-foreground">{Number(l.hours_per_worker ?? 0)}</b>
                    <span className="text-muted-foreground"> · Rate: </span>
                    <b className="text-foreground">
                      {l.hourly_rate != null ? `${money(Number(l.hourly_rate))}/hour` : "—"}
                    </b>
                  </div>
                ))}
                <div>
                  <span className="text-muted-foreground">Total labour: </span>
                  <b className="text-foreground">
                    {labour.totalHours != null ? `${labour.totalHours.toFixed(2)} hours` : "—"}
                  </b>
                  <span className="text-muted-foreground"> · Labour cost: </span>
                  <b className="text-foreground">
                    {labour.totalCost != null ? money(labour.totalCost) : "—"}
                  </b>
                </div>
              </>
            )}
          </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" asChild>
              <Link to={`/work-tasks?highlight=${value}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" /> Open task
              </Link>
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled}
              onClick={() => setPickerOpen(true)}>
              Change
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled}
              onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Create replacement
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive"
              disabled={disabled}
              onClick={() => {
                onChange(null);
                toast.info("Work Task will be unlinked when you save.");
              }}>
              <Link2Off className="h-4 w-4 mr-1" /> Unlink
            </Button>
          </div>
        </div>
      )}

      <CreateWorkTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        vineyardId={vineyardId}
        draft={draft}
        startTime={startTime}
        finishTime={finishTime}
        legacyLabourHours={legacyLabourHours}
        legacyHourlyRate={legacyHourlyRate}
        userId={user?.id ?? null}
        onCreated={(id, resolved) => {
          onChange(id);
          onLabourResolved?.(resolved);
          setCreateOpen(false);
        }}
      />
      <PickWorkTaskDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        vineyardId={vineyardId}
        activityId={activityId}
        onPicked={(id) => { onChange(id); setPickerOpen(false); }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ create

function CreateWorkTaskDialog({
  open, onOpenChange, vineyardId, draft, startTime, finishTime,
  legacyLabourHours, legacyHourlyRate, userId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  draft: PruningActivityDraft;
  startTime: string;
  finishTime: string;
  legacyLabourHours: number | null;
  legacyHourlyRate: number | null;
  userId: string | null;
  onCreated: (id: string, labour: ResolvedTaskLabour) => void;
}) {
  const totals = activityTotals(draft);
  const blocks = blockSummaryText(draft.allocations);
  const defaultTitle = `Pruning — ${blocks || "vineyard"}`;
  const defaultNotes = [
    draft.method ? `Method: ${draft.method}` : "",
    blocks ? `Blocks: ${blocks}` : "",
    totals.quarters
      ? `${totals.rowEquivalents.toFixed(2)} row equivalents · ~${totals.vines.toLocaleString()} vines`
      : "",
    draft.notes?.trim() ? draft.notes.trim() : "",
  ].filter(Boolean).join("\n");

  // Hours per person come from Start/Finish (overnight aware); never from a
  // pre-existing activity "labour hours" total, which is people × hours.
  const elapsed = elapsedHoursBetween(startTime, finishTime);
  const defaultLabour = (): LabourFieldsValue => ({
    ...emptyLabourValue(),
    workerCount: legacyLabourHours != null && elapsed == null ? "1" : "",
    hoursPerWorker:
      elapsed != null ? String(elapsed)
        : legacyLabourHours != null ? String(legacyLabourHours)
        : "",
    hourlyRate: legacyHourlyRate != null ? String(legacyHourlyRate) : "",
  });

  const catsQ = useLabourTypes(open ? vineyardId : null);
  const categories = catsQ.data ?? [];

  const [title, setTitle] = useState(defaultTitle);
  const [status, setStatus] = useState("completed");
  const [dueDate, setDueDate] = useState(draft.entryDate);
  const [worker, setWorker] = useState(draft.worker);
  const [notes, setNotes] = useState(defaultNotes);
  const [labour, setLabour] = useState<LabourFieldsValue>(defaultLabour);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // SQL 188 — costing method. Default is ALWAYS hourly (contract default).
  const [costingMethod, setCostingMethod] = useState<CostingMethod>(COSTING_METHOD_HOURLY);
  const [ratePerVine, setRatePerVine] = useState("");

  // Piece-rate quantity comes from the rows selected on THIS draft, using each
  // row's effective vine count (rows[].vineCountOverride ?? calculated).
  const pieceRows = useMemo(() => draftPieceRateRows(draft), [draft]);
  const pieceVineCount = useMemo(
    () => pieceRows.reduce((n, r) => n + r.vine_count, 0),
    [pieceRows],
  );
  const rateNum = ratePerVine.trim() === "" ? null : Number(ratePerVine);
  const pieceCost = pieceRateTotalCost(pieceVineCount, Number.isFinite(rateNum as number) ? rateNum : null);

  // Area of the selected blocks, for cost / ha only.
  const areaQ = useQuery({
    queryKey: ["pruning-activity", "piece-rate-area", vineyardId, Object.keys(draft.allocations).sort().join(",")],
    enabled: open && costingMethod === "piece_rate" && Object.keys(draft.allocations).length > 0,
    queryFn: async () => {
      const ids = Object.keys(draft.allocations);
      const { data, error } = await supabase
        .from("paddocks").select("id, polygon_points").in("id", ids);
      if (error) throw error;
      return (data ?? []).reduce(
        (sum, p: any) => sum + (polygonAreaHectares(parsePolygonPoints(p.polygon_points)) ?? 0), 0,
      );
    },
  });
  const pieceCostPerHa = costPerHectare(pieceCost, areaQ.data ?? null);
  const isPieceRate = costingMethod === COSTING_METHOD_PIECE_RATE;

  // Re-seed the prefill each time the dialog opens; the pruning draft itself
  // is never touched.
  if (open && !seeded) {
    setTitle(defaultTitle);
    setDueDate(draft.entryDate);
    setWorker(draft.worker);
    setNotes(defaultNotes);
    setLabour(defaultLabour());
    setCostingMethod(COSTING_METHOD_HOURLY);
    setRatePerVine("");
    setSeeded(true);
  }
  if (!open && seeded) setSeeded(false);

  const calc = labourTotals(labour, categories);
  const needsConfirm = (legacyLabourHours ?? 0) > 0;

  const handleCreate = async () => {
    if (needsConfirm && !window.confirm(
      `This activity already has ${Number(legacyLabourHours).toFixed(2)} legacy labour hours.\n\n` +
      "Create the Work Task and use its labour from now on? The existing labour stays " +
      "untouched unless the task is created successfully.",
    )) return;

    if (isPieceRate && !(rateNum != null && Number.isFinite(rateNum) && rateNum > 0)) {
      toast.error("Enter a rate per vine.");
      return;
    }
    if (isPieceRate && pieceVineCount <= 0) {
      toast.error("Select rows before costing at a piece rate.");
      return;
    }

    setSaving(true);
    try {
      const allocs = Object.values(draft.allocations).filter((a) => allocationQuarterCount(a) > 0);
      const primary = allocs[0] ?? null;
      const workerLine = worker.trim() ? `Worker/crew: ${worker.trim()}` : "";
      const task = await createWorkTask({
        vineyard_id: vineyardId,
        paddock_id: primary?.paddockId ?? null,
        paddock_name: primary?.paddockName ?? null,
        task_type: "Pruning",
        status,
        description: title.trim() || defaultTitle,
        notes: [workerLine, notes].filter(Boolean).join("\n"),
        date: draft.entryDate,
        start_date: draft.entryDate,
        end_date: dueDate || draft.entryDate,
        duration_hours: calc.totalHours ?? 0,
        is_finalized: status === "completed",
        user_id: userId,
        // SQL 188 — explicit on every pruning task so legacy reads stay safe.
        costing_method: costingMethod,
        piece_rate_per_vine: isPieceRate ? rateNum : null,
        piece_vine_count: isPieceRate ? pieceVineCount : null,
      });

      // Write-once commercial snapshot of the costed rows.
      if (isPieceRate && pieceRows.length) {
        await syncWorkTaskPieceRateRows({
          workTaskId: task.id,
          vineyardId,
          rows: pieceRows,
          existing: await fetchPieceRateRowsForTask(task.id),
          userId,
        });
      }

      if (allocs.length) {
        const existing = (await fetchWorkTaskPaddocksForVineyard(vineyardId))
          .filter((r) => r.work_task_id === task.id);
        await syncWorkTaskPaddocks({
          workTaskId: task.id,
          vineyardId,
          selections: allocs.map((a) => ({ paddock_id: a.paddockId, area_ha: null })),
          existing,
          userId,
        });
      }

      // Canonical labour lives on the task, computed as people × hours each.
      let resolved: ResolvedTaskLabour = { hours: calc.totalHours, rate: calc.rate };
      if (calc.people != null && calc.hoursEach != null) {
        await createLabourLine({
          work_task_id: task.id,
          vineyard_id: vineyardId,
          work_date: draft.entryDate,
          worker_type_id: labour.workerTypeId,
          worker_type: labourTypeName(labour, categories, worker.trim() || null),
          worker_count: calc.people,
          hours_per_worker: calc.hoursEach,
          hourly_rate: calc.rate,
          notes: worker.trim() ? `Crew: ${worker.trim()}` : "",
          user_id: userId,
        });
        const canonical = summariseTaskLabour(await fetchLabourLinesForTask(task.id));
        resolved = { hours: canonical.totalHours, rate: canonical.rate };
      }

      toast.success("Work Task created and linked to this activity.");
      onCreated(task.id, resolved);
    } catch (e: any) {
      toast.error(`Couldn't create the Work Task: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Work Task</DialogTitle>
          <DialogDescription>
            Prefilled from this pruning activity. Your pruning draft stays exactly as it is.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="wt-title">Title</Label>
            <Input id="wt-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="planned">Planned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="wt-due">Due date</Label>
              <Input id="wt-due" type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wt-worker">Assigned worker / crew</Label>
            <Input id="wt-worker" value={worker} onChange={(e) => setWorker(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Costing method</Label>
            <Select value={costingMethod} onValueChange={(v) => setCostingMethod(v as CostingMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={COSTING_METHOD_HOURLY}>Hourly</SelectItem>
                <SelectItem value={COSTING_METHOD_PIECE_RATE}>Piece Rate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isPieceRate && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="space-y-1">
                <Label htmlFor="wt-rate-vine">Rate / vine</Label>
                <Input id="wt-rate-vine" type="number" step="0.0001" min="0" placeholder="1.27"
                  value={ratePerVine} disabled={saving}
                  onChange={(e) => setRatePerVine(e.target.value)} />
              </div>
              <div className="rounded bg-muted/40 px-3 py-2 text-sm space-y-0.5 tabular-nums">
                <div className="text-muted-foreground text-xs">Piece Rate</div>
                <div>Rows selected: <b>{pieceRows.length}</b></div>
                <div>Vines: <b>{pieceVineCount.toLocaleString()}</b></div>
                <div>Estimated cost: <b>{pieceCost != null ? money(pieceCost) : "—"}</b></div>
                <div>Cost / ha: <b>{pieceCostPerHa != null ? money(pieceCostPerHa) : "—"}</b></div>
              </div>
              <p className="text-xs text-muted-foreground">
                The vine count is saved with the task as a snapshot. Later changes to vineyard rows
                will not change this job's cost.
              </p>
            </div>
          )}

          <WorkTaskLabourFields
            categories={categories}
            money={money}
            value={labour}
            onChange={setLabour}
            disabled={saving}
          />
          {isPieceRate && (
            <p className="text-xs text-muted-foreground">
              Hours worked (optional). Recorded for operational history only — Piece Rate cost is based
              on vines completed.
            </p>
          )}
          {elapsed != null && (
            <p className="text-xs text-muted-foreground">
              Hours per person prefilled from Start → Finish ({elapsed} h elapsed, overnight aware).
              Total labour = people × hours each.
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="wt-notes">Notes</Label>
            <Textarea id="wt-notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Task type <b>Pruning</b> · {totals.blocks} block{totals.blocks === 1 ? "" : "s"} ·{" "}
            {totals.rowEquivalents.toFixed(2)} row eq. · ~{totals.vines.toLocaleString()} vines
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create and link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ picker

function PickWorkTaskDialog({
  open, onOpenChange, vineyardId, activityId, onPicked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  activityId: string | null;
  onPicked: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const tasksQ = useQuery({
    queryKey: ["pruning-activity", "work-task-picker", vineyardId],
    enabled: open && !!vineyardId,
    queryFn: async () => (await fetchWorkTasksForVineyard(vineyardId, [])).tasks,
  });
  const activitiesQ = usePruningActivities(open ? vineyardId : null, false);

  /** work_task_id -> owning activity id, for tasks owned by ANOTHER activity. */
  const takenBy = useMemo(() => {
    const m = new Map<string, string>();
    (activitiesQ.data ?? []).forEach((a) => {
      if (a.workTaskId && !a.isReversed && a.id !== activityId) m.set(a.workTaskId, a.id);
    });
    return m;
  }, [activitiesQ.data, activityId]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tasksQ.data ?? [])
      .filter((t) => showAll || OPEN_STATUSES.includes(String(t.status ?? "").toLowerCase()))
      .filter((t) => !q || `${t.description ?? ""} ${t.task_type ?? ""} ${t.paddock_name ?? ""}`
        .toLowerCase().includes(q))
      .sort((a, b) => String(b.end_date ?? b.date ?? "").localeCompare(String(a.end_date ?? a.date ?? "")))
      .slice(0, 200);
  }, [tasksQ.data, search, showAll]);

  const dueOf = (t: WorkTask) => t.end_date ?? t.date ?? t.start_date ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link existing Work Task</DialogTitle>
          <DialogDescription>
            Tasks for this vineyard. Tasks already owned by another pruning activity can't be linked.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input placeholder="Search title, type or block" value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Open only" : "Show all"}
          </Button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
          {tasksQ.isLoading && (
            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…
            </div>
          )}
          {!tasksQ.isLoading && !rows.length && (
            <div className="p-4 text-sm text-muted-foreground">No matching Work Tasks.</div>
          )}
          {rows.map((t) => {
            const taken = takenBy.has(t.id);
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {t.description?.trim() || t.task_type || "Work Task"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {statusLabel(t.status)}
                    {dueOf(t) ? ` · due ${formatDate(dueOf(t)!.slice(0, 10))}` : ""}
                    {t.paddock_name ? ` · ${t.paddock_name}` : ""}
                    {(t.resources as any)?.worker ? ` · ${(t.resources as any).worker}` : ""}
                  </div>
                </div>
                {taken ? (
                  <Badge variant="secondary" className="shrink-0">Already linked</Badge>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="shrink-0"
                    onClick={() => onPicked(t.id)}>
                    Link
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
