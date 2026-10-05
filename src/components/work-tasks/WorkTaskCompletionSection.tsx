// Complete / Reopen / Completed Date for one Work Task.
// Source of truth: work_tasks.is_finalized (see src/lib/workTaskCompletion.ts).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  completeWorkTask,
  reopenWorkTask,
  setWorkTaskCompletedDate,
  type WorkTask,
} from "@/lib/workTasksQuery";
import {
  displayCompletedDate,
  isWorkTaskCompleted,
  todayLocal,
  validateCompletedDate,
  workDateOf,
} from "@/lib/workTaskCompletion";

interface Props {
  task: WorkTask;
  userId: string | null | undefined;
  onSaved: (saved?: WorkTask) => void;
  fmtDate: (v?: string | null) => string;
}

export function WorkTaskCompletionSection({ task, userId, onSaved, fmtDate }: Props) {
  const completed = isWorkTaskCompleted(task);
  const workDate = workDateOf(task);
  const today = todayLocal();
  const shownCompleted = displayCompletedDate(task);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickDate, setPickDate] = useState(today);
  const [editDate, setEditDate] = useState(shownCompleted ?? "");
  const uid = userId ?? null;

  const fail = (e: any) =>
    toast({ title: "Save failed", description: String(e?.message ?? e), variant: "destructive" });

  const complete = useMutation({
    mutationFn: () => completeWorkTask(task, pickDate, uid),
    onSuccess: (saved) => {
      setDialogOpen(false);
      setEditDate(saved.end_date ?? "");
      toast({ title: "Work Task completed" });
      onSaved(saved);
    },
    onError: fail,
  });
  const reopen = useMutation({
    mutationFn: () => reopenWorkTask(task, uid),
    onSuccess: (saved) => {
      setEditDate("");
      toast({ title: "Work Task reopened" });
      onSaved(saved);
    },
    onError: fail,
  });
  const changeDate = useMutation({
    mutationFn: () => setWorkTaskCompletedDate(task, editDate, uid),
    onSuccess: (saved) => {
      toast({ title: "Completed Date updated" });
      onSaved(saved);
    },
    onError: fail,
  });

  const pickError = validateCompletedDate(pickDate, workDate, today);
  const editError = editDate ? validateCompletedDate(editDate, workDate, today) : null;
  const editDirty = !!editDate && editDate !== (task.end_date ?? shownCompleted ?? "");
  const busy = complete.isPending || reopen.isPending || changeDate.isPending;

  return (
    <div className="rounded-md border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          Status
          <Badge variant={completed ? "default" : "outline"}>{completed ? "Completed" : "To do"}</Badge>
        </div>
        {completed ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => reopen.mutate()}>
            {reopen.isPending ? "Reopening…" : "Reopen"}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setPickDate(today);
              setDialogOpen(true);
            }}
          >
            Complete
          </Button>
        )}
      </div>

      {completed && (
        <div className="space-y-1">
          <Label className="text-xs">Completed Date</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={editDate}
              min={workDate ?? undefined}
              max={today}
              onChange={(e) => setEditDate(e.target.value)}
              className="max-w-[180px]"
            />
            {editDirty && (
              <Button size="sm" disabled={busy || !!editError} onClick={() => changeDate.mutate()}>
                {changeDate.isPending ? "Saving…" : "Save date"}
              </Button>
            )}
          </div>
          {!shownCompleted && !editDate && (
            <p className="text-xs text-muted-foreground">No Completed Date recorded.</p>
          )}
          {editError && <p className="text-xs text-destructive">{editError}</p>}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Complete Work Task</DialogTitle>
            <DialogDescription>Choose the date the work was finished. It can be backdated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Work Date</Label>
              <div className="text-sm">{fmtDate(workDate)}</div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="wt-completed-date">Completed Date</Label>
              <Input
                id="wt-completed-date"
                type="date"
                value={pickDate}
                min={workDate ?? undefined}
                max={today}
                onChange={(e) => setPickDate(e.target.value)}
              />
              {pickError && <p className="text-xs text-destructive">{pickError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={!!pickError || complete.isPending} onClick={() => complete.mutate()}>
              {complete.isPending ? "Completing…" : "Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
