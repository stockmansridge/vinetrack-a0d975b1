// Work Task controls for the parent pruning activity (SQL 166).
//
// The Work Task belongs to the ACTIVITY, never to a single block allocation.
// Creating or picking a task from here must never mutate or reset the pruning
// draft — this component only ever reports a task id back through `onChange`.
import { useMemo, useState } from "react";
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
  createWorkTask, fetchWorkTaskById, fetchWorkTaskPaddocksForVineyard,
  fetchWorkTasksForVineyard, syncWorkTaskPaddocks, type WorkTask,
} from "@/lib/workTasksQuery";
import { usePruningActivities } from "@/lib/pruningActivityApi";
import {
  activityTotals, allocationQuarterCount, allocationRowSummary,
  type BlockAllocationDraft, type PruningActivityDraft,
} from "@/lib/pruningActivityContract";
import { formatDate } from "@/lib/dateFormat";

const OPEN_STATUSES = ["planned", "in_progress", "in progress", "open", "scheduled", "pending"];

const statusLabel = (s?: string | null) =>
  !s ? "—" : s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** "Pinot Noir W1 (rows 1–4), Shiraz E2 (rows 9–10)" */
export function blockSummaryText(allocations: Record<string, BlockAllocationDraft>): string {
  const parts = Object.values(allocations)
    .filter((a) => allocationQuarterCount(a) > 0)
    .map((a) => `${a.paddockName} (${allocationRowSummary(a)})`);
  return parts.join(", ");
}

interface Props {
  vineyardId: string;
  draft: PruningActivityDraft;
  /** Current activity id (edit mode) — used to ignore self when detecting conflicts. */
  activityId?: string | null;
  value: string | null;
  onChange: (workTaskId: string | null) => void;
  disabled?: boolean;
}

export default function ActivityWorkTaskField({
  vineyardId, draft, activityId = null, value, onChange, disabled,
}: Props) {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const linkedQ = useQuery({
    queryKey: ["pruning-activity", "work-task", value],
    enabled: !!value,
    queryFn: () => fetchWorkTaskById(value!),
  });
  const linked = linkedQ.data ?? null;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">Work Task</Label>
        {value && <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" /> Linked</Badge>}
      </div>

      {!value && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground mr-1">Not linked</span>
          <Button type="button" size="sm" variant="outline" disabled={disabled}
            onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Work Task
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled}
            onClick={() => setPickerOpen(true)}>
            <Search className="h-4 w-4 mr-1" /> Link existing Work Task
          </Button>
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
        userId={user?.id ?? null}
        onCreated={(id) => { onChange(id); setCreateOpen(false); }}
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
  open, onOpenChange, vineyardId, draft, userId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  draft: PruningActivityDraft;
  userId: string | null;
  onCreated: (id: string) => void;
}) {
  const totals = activityTotals(draft);
  const blocks = blockSummaryText(draft.allocations);
  const defaultTitle = `Pruning — ${blocks || "vineyard"}`;
  const defaultNotes = [
    draft.worker ? `Worker/crew: ${draft.worker}` : "",
    draft.method ? `Method: ${draft.method}` : "",
    blocks ? `Blocks: ${blocks}` : "",
    totals.quarters
      ? `${totals.rowEquivalents.toFixed(2)} row equivalents · ~${totals.vines.toLocaleString()} vines`
      : "",
    draft.notes?.trim() ? draft.notes.trim() : "",
  ].filter(Boolean).join("\n");

  const [title, setTitle] = useState(defaultTitle);
  const [status, setStatus] = useState("completed");
  const [dueDate, setDueDate] = useState(draft.entryDate);
  const [notes, setNotes] = useState(defaultNotes);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Re-seed the prefill each time the dialog opens; the pruning draft itself
  // is never touched.
  if (open && !seeded) {
    setTitle(defaultTitle);
    setDueDate(draft.entryDate);
    setNotes(defaultNotes);
    setSeeded(true);
  }
  if (!open && seeded) setSeeded(false);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const allocs = Object.values(draft.allocations).filter((a) => allocationQuarterCount(a) > 0);
      const primary = allocs[0] ?? null;
      const task = await createWorkTask({
        vineyard_id: vineyardId,
        paddock_id: primary?.paddockId ?? null,
        paddock_name: primary?.paddockName ?? null,
        task_type: "Pruning",
        status,
        description: title.trim() || defaultTitle,
        notes,
        date: draft.entryDate,
        start_date: draft.entryDate,
        end_date: dueDate || draft.entryDate,
        duration_hours: draft.labourHours ?? 0,
        is_finalized: status === "completed",
        user_id: userId,
      });
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
      toast.success("Work Task created and linked to this activity.");
      onCreated(task.id);
    } catch (e: any) {
      toast.error(`Couldn't create the Work Task: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
            <Label htmlFor="wt-notes">Notes</Label>
            <Textarea id="wt-notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Task type <b>Pruning</b> · {totals.blocks} block{totals.blocks === 1 ? "" : "s"} ·{" "}
            {totals.rowEquivalents.toFixed(2)} row eq. · ~{totals.vines.toLocaleString()} vines
            {draft.labourHours != null ? ` · ${draft.labourHours} labour hours` : ""}
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
