// SQL 200 — Work Tasks section of a pruning activity.
//
// One Activity -> 0..N Work Tasks (work_tasks.pruning_activity_id).
// Labour lines live ONLY inside Work Tasks, so this section is the entire
// costing surface of a pruning activity: the activity itself never owns
// labour any more.
//
// Unlinking clears the link only — the Work Task itself stays intact.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Link2Off, Loader2, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { useAuth } from "@/context/AuthContext";
import {
  CreateWorkTaskDialog, PickWorkTaskDialog,
} from "@/components/pruning/ActivityWorkTaskField";
import {
  linkWorkTaskToActivity, unlinkWorkTaskFromActivity, useActivityWorkTasks,
  type LinkedWorkTaskSummary,
} from "@/lib/pruningActivityWorkTasks";
import type { PruningActivityDraft } from "@/lib/pruningActivityContract";
import { formatDate } from "@/lib/dateFormat";

const money = (n: number) => `$${n.toFixed(2)}`;

const statusLabel = (s?: string | null) =>
  !s ? "—" : s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

interface Props {
  vineyardId: string;
  /** Saved activity id. Null in create mode — links are applied after save. */
  activityId: string | null;
  /** Legacy `pruning_entries.work_task_id`, shown until it is unlinked. */
  legacyTaskId?: string | null;
  draft: PruningActivityDraft;
  startTime?: string;
  finishTime?: string;
  /** Read-only legacy activity labour, shown when there is no linked task. */
  legacyLabourHours?: number | null;
  legacyHourlyRate?: number | null;
  /** Create mode: task ids to link once the activity is saved. */
  onPendingLink?: (taskId: string) => void;
  pendingTaskIds?: string[];
  onLegacyTaskCleared?: () => void;
  disabled?: boolean;
}

export default function PruningWorkTasksSection({
  vineyardId, activityId, legacyTaskId = null, draft, startTime = "", finishTime = "",
  legacyLabourHours = null, legacyHourlyRate = null,
  onPendingLink, pendingTaskIds = [], onLegacyTaskCleared, disabled,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useActivityWorkTasks(activityId, legacyTaskId);
  const tasks: LinkedWorkTaskSummary[] = q.data?.tasks ?? [];
  const totals = q.data?.totals ?? null;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["pruning", "activity-work-tasks"] });
    await qc.invalidateQueries({ queryKey: ["pruning", "work-task-links", vineyardId] });
  };

  const handleUnlink = async (taskId: string) => {
    if (!window.confirm(
      "Remove this Work Task from the pruning activity?\n\n" +
      "The Work Task and its labour lines are kept exactly as they are — only the " +
      "link to this activity (and its contribution to the activity totals) is removed.",
    )) return;
    setBusyId(taskId);
    try {
      await unlinkWorkTaskFromActivity(taskId);
      if (taskId === legacyTaskId) onLegacyTaskCleared?.();
      await refresh();
      toast.success("Work Task unlinked. The task itself is unchanged.");
    } catch (e: any) {
      toast.error(`Couldn't unlink the Work Task: ${e?.message ?? e}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleLink = async (taskId: string) => {
    setPickerOpen(false);
    if (!activityId) { onPendingLink?.(taskId); toast.info("Work Task links when you save."); return; }
    try {
      await linkWorkTaskToActivity(taskId, activityId);
      await refresh();
      toast.success("Work Task linked to this activity.");
    } catch (e: any) {
      toast.error(`Couldn't link the Work Task: ${e?.message ?? e}`);
    }
  };

  const showLegacy =
    !q.isLoading && tasks.length === 0 &&
    ((legacyLabourHours ?? 0) > 0 || legacyHourlyRate != null);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label>Work Tasks</Label>
          <p className="text-xs text-muted-foreground">
            Labour and cost live in Work Tasks. An activity can have any number of them —
            its hours and cost are the sum of the tasks linked here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={disabled}
            onClick={() => setPickerOpen(true)}>
            <Search className="h-4 w-4 mr-1" /> Link existing
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled}
            onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Work Task
          </Button>
        </div>
      </div>

      {q.isLoading && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Work Tasks…
        </div>
      )}

      {!q.isLoading && tasks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No Work Tasks linked. This activity currently carries no labour hours or cost.
        </p>
      )}

      {pendingTaskIds.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            {pendingTaskIds.length} Work Task{pendingTaskIds.length === 1 ? " has" : "s have"} been
            created and will be linked when you save this activity.
          </span>
        </div>
      )}


      {tasks.map((t) => (
        <div key={t.taskId} className="space-y-2 rounded border bg-muted/20 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium truncate">
                {t.task?.description?.trim() || t.task?.task_type || "Work Task"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t.task?.task_type ? `${t.task.task_type} · ` : ""}
                {statusLabel(t.task?.status)}
                {t.task?.end_date || t.task?.date
                  ? ` · ${formatDate((t.task.end_date ?? t.task.date)!.slice(0, 10))}`
                  : ""}
              </div>
            </div>
            {t.isPieceRate && <Badge variant="outline">Piece rate</Badge>}
          </div>

          <div className="grid gap-1 rounded bg-background/60 px-3 py-2 text-xs tabular-nums sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Labour hours: </span>
              <b className="text-foreground">{t.hours != null ? t.hours.toFixed(2) : "—"}</b>
            </div>
            <div>
              <span className="text-muted-foreground">Labour cost: </span>
              <b className="text-foreground">{t.labourCost != null ? money(t.labourCost) : "—"}</b>
            </div>
            <div>
              <span className="text-muted-foreground">Total task cost: </span>
              <b className="text-foreground">{t.totalCost != null ? money(t.totalCost) : "—"}</b>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" asChild>
              <Link to={`/work-tasks?highlight=${t.taskId}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" /> Open
              </Link>
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive"
              disabled={disabled || busyId === t.taskId}
              onClick={() => handleUnlink(t.taskId)}>
              {busyId === t.taskId
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <Link2Off className="h-4 w-4 mr-1" />}
              Unlink
            </Button>
          </div>
        </div>
      ))}

      {tasks.length > 0 && totals && (
        <div className="rounded bg-muted/40 px-3 py-2 text-sm tabular-nums">
          <div className="text-xs text-muted-foreground mb-0.5">
            Activity total — {totals.taskCount} Work Task{totals.taskCount === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {totals.hours != null ? `${totals.hours.toFixed(2)} h` : "— h"}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-semibold">{totals.cost != null ? money(totals.cost) : "—"}</span>
            {totals.cost == null && (
              <span className="text-xs text-muted-foreground">
                No costed Work Task — cost is unknown, not zero.
              </span>
            )}
          </div>
        </div>
      )}

      {showLegacy && (
        <p className="text-xs text-muted-foreground">
          Legacy labour recorded directly on this activity (read-only):{" "}
          <b className="text-foreground">
            {legacyLabourHours != null ? `${Number(legacyLabourHours).toFixed(2)} hours` : "—"}
          </b>
          {legacyHourlyRate != null ? ` @ ${money(Number(legacyHourlyRate))}/h` : ""}. It is kept
          exactly as recorded and is replaced by Work Task totals once a task is linked.
        </p>
      )}

      <CreateWorkTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        vineyardId={vineyardId}
        activityId={activityId}
        draft={draft}
        startTime={startTime}
        finishTime={finishTime}
        legacyLabourHours={legacyLabourHours}
        legacyHourlyRate={legacyHourlyRate}
        userId={user?.id ?? null}
        onCreated={async (id) => {
          setCreateOpen(false);
          if (!activityId) onPendingLink?.(id);
          await refresh();
        }}
      />
      <PickWorkTaskDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        vineyardId={vineyardId}
        activityId={activityId}
        onPicked={handleLink}
      />
    </div>
  );
}
