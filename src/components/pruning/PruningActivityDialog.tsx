// Create / edit a parent pruning activity (SQL 166).
//
// One activity -> many block allocations. Saving makes exactly ONE RPC call:
//   create -> record_pruning_activity(p_payload)
//   edit   -> update_pruning_activity(p_activity_id, p_activity, p_allocations)
// The legacy one-entry-per-block path is never used from here.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import MultiBlockAllocationEditor from "@/components/pruning/MultiBlockAllocationEditor";
import ActivityWorkTaskField from "@/components/pruning/ActivityWorkTaskField";
import PruningLabourLinesEditor, {
  labourDraftsFromLines, labourPayloadFromDrafts, type PruningLabourLineDraft,
} from "@/components/pruning/PruningLabourLinesEditor";
import { useLabourTypes } from "@/components/work-tasks/WorkTaskLabourFields";

import {
  activityTotals, allocationKey, allocationQuarterCount, allocationSegments,
  type BlockAllocationDraft, type PruningActivityDraft,
} from "@/lib/pruningActivityContract";
import {
  usePruningActivityDetail, useSavePruningActivity,
  type ActivitySaveConflict, type PruningActivity,
} from "@/lib/pruningActivityApi";
import {
  savePruningActivityLabourLines, usePruningActivityLabourLines,
} from "@/lib/pruningActivityLabour";
import { ensurePruningSeasonId, recordSkippedPruningEntry } from "@/lib/pruningQuery";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { formatDate } from "@/lib/dateFormat";



const METHODS = ["spur", "cane", "mechanical", "minimal"];

const today = () => new Date().toISOString().slice(0, 10);

/** "2026-08-04T07:30:00Z" | "07:30:00" -> "07:30" for a time input. */
function toTimeInput(v: string | null): string {
  if (!v) return "";
  const raw = v.trim();
  if (raw.includes("T") || (raw.includes(" ") && raw.length > 10)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }
  const hm = /^(\d{1,2}):(\d{2})/.exec(raw);
  return hm ? `${hm[1].padStart(2, "0")}:${hm[2]}` : "";
}

const toIso = (date: string, time: string): string | null =>
  time ? new Date(`${date}T${time}:00`).toISOString() : null;

function emptyDraft(): PruningActivityDraft {
  return {
    activityId: null,
    entryDate: today(),
    worker: "",
    method: "spur",
    labourHours: null,
    hourlyRate: null,
    startTime: null,
    finishTime: null,
    notes: "",
    workTaskId: null,
    allocations: {},
  };
}

function draftFromActivity(a: PruningActivity): PruningActivityDraft {
  const allocations: Record<string, BlockAllocationDraft> = {};
  a.allocations.forEach((al) => {
    const quarters: BlockAllocationDraft["quarters"] = {};
    al.segments.forEach((s) => {
      quarters[allocationKey(s.row, s.segment)] = {
        rowNumber: s.row,
        segmentNumber: s.segment,
        paddockRowId: s.row_id,
        rowLabel: s.label || String(s.row),
        vines: al.segments.length ? al.vines / al.segments.length : 0,
      };
    });
    allocations[al.paddockId] = {
      paddockId: al.paddockId,
      paddockName: al.blockName,
      variety: al.variety,
      quarters,
      seasonId: al.seasonId,
      allocationId: al.id,
      seasonYear: al.seasonYear,
      vintageYear: al.vintageYear,
    };
  });
  return {
    activityId: a.id,
    entryDate: a.date,
    worker: a.worker === "—" ? "" : a.worker,
    method: a.method === "—" ? "spur" : a.method,
    labourHours: a.labourHours,
    hourlyRate: a.hourlyRate,
    startTime: a.startTime,
    finishTime: a.finishTime,
    notes: a.notes,
    workTaskId: a.workTaskId,
    allocations,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vineyardId: string;
  seasonYear: number;
  /** Edit mode when set. */
  activityId?: string | null;
  /** Pre-select a block in create mode. */
  paddockId?: string | null;
  onPrev?: () => void;
  onNext?: () => void;
  navLabel?: string;
  onSaved?: (activity: PruningActivity | null) => void;
}

export default function PruningActivityDialog({
  open, onOpenChange, vineyardId, seasonYear, activityId = null, paddockId = null,
  onPrev, onNext, navLabel, onSaved,
}: Props) {
  const isEdit = !!activityId;
  const detailQ = usePruningActivityDetail(open && isEdit ? activityId : null);
  const save = useSavePruningActivity(isEdit ? "edit" : "create");
  const { resolve: resolveUser } = useTeamLookup(vineyardId);

  const [draft, setDraft] = useState<PruningActivityDraft>(emptyDraft);
  const [startInput, setStartInput] = useState("");
  const [finishInput, setFinishInput] = useState("");
  const [conflicts, setConflicts] = useState<ActivitySaveConflict[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // SQL 168 — skipped mode. One workflow: the same dialog records normal
  // pruning and skipped rows; only the save routing differs.
  const [skipped, setSkipped] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [savingSkip, setSavingSkip] = useState(false);
  // Stable per-block entry ids so a retry of a skipped save is idempotent.
  const skipEntryIds = useRef<Record<string, string>>({});
  const qc = useQueryClient();
  // Client uuid, generated once per dialog instance so a retry is idempotent.
  const [newId] = useState(() => crypto.randomUUID());


  const loaded = detailQ.data ?? null;

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      if (loaded) {
        setDraft(draftFromActivity(loaded));
        setStartInput(toTimeInput(loaded.startTime));
        setFinishInput(toTimeInput(loaded.finishTime));
      }
    } else {
      setDraft(emptyDraft());
      setStartInput("");
      setFinishInput("");
      setSkipped(false);
      skipEntryIds.current = {};
    }
    setConfirmSkip(false);
    setConflicts([]);
    setSaveError(null);

  }, [open, isEdit, loaded]);

  /** Quarters already owned by THIS activity — they must stay selectable. */
  const ownedByActivity = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    loaded?.allocations.forEach((al) => {
      map[al.paddockId] = new Set(al.segments.map((s) => allocationKey(s.row, s.segment)));
    });
    return map;
  }, [loaded]);

  /** Allocations that existed on the server when the dialog opened. */
  const originalCounts = useMemo(() => {
    const m: Record<string, number> = {};
    loaded?.allocations.forEach((al) => { m[al.paddockId] = al.segments.length; });
    return m;
  }, [loaded]);

  const handleAllocationsChange = (next: Record<string, BlockAllocationDraft>) => {
    // Confirm before dropping or emptying an allocation that has recorded quarters.
    for (const [paddockId, count] of Object.entries(originalCounts)) {
      if (count <= 0) continue;
      const before = draft.allocations[paddockId];
      const after = next[paddockId];
      const nowEmpty = !after || allocationQuarterCount(after) === 0;
      const wasFilled = !!before && allocationQuarterCount(before) > 0;
      if (wasFilled && nowEmpty) {
        const name = before?.paddockName ?? "this block";
        const ok = window.confirm(
          `Remove ${name} from this activity?\n\n${count} recorded quarter${count === 1 ? "" : "s"} ` +
          "will be released back to the pruning tracker when you save.",
        );
        if (!ok) return;
      }
    }
    setDraft((d) => ({ ...d, allocations: next }));
  };

  const totals = activityTotals(draft);
  const busy = save.isPending || savingSkip;
  const canSave =
    !!draft.entryDate && totals.quarters > 0 && !busy && (!isEdit || !!loaded);

  /** SQL 168: one skipped entry per block, presented as a single save. */
  const handleSkippedSave = async () => {
    setConfirmSkip(false);
    setSaveError(null);
    const allocations = Object.values(draft.allocations)
      .filter((a) => allocationQuarterCount(a) > 0);
    if (!draft.entryDate || allocations.length === 0) {
      setSaveError("Select at least one row or row section to mark as skipped.");
      return;
    }
    setSavingSkip(true);
    try {
      for (const alloc of allocations) {
        const seasonId = alloc.seasonId
          ?? (await ensurePruningSeasonId(vineyardId, alloc.paddockId, seasonYear));
        const entryId = skipEntryIds.current[alloc.paddockId]
          ?? (skipEntryIds.current[alloc.paddockId] = crypto.randomUUID());
        await recordSkippedPruningEntry({
          entryId,
          vineyardId,
          seasonId,
          paddockId: alloc.paddockId,
          seasonYear,
          entryDate: draft.entryDate,
          notes: draft.notes ?? "",
          segments: allocationSegments(alloc).map((s) => ({
            rowNumber: s.row,
            segmentNumber: s.segment,
            paddockRowId: s.row_id,
            rowLabel: s.label,
          })),
        });
      }
      await qc.invalidateQueries({ queryKey: ["pruning"] });
      await qc.refetchQueries({ queryKey: ["pruning"], type: "active" });
      toast.success(
        allocations.length === 1
          ? "Rows marked as skipped."
          : `Rows marked as skipped across ${allocations.length} blocks.`,
      );
      onSaved?.(null);
      onOpenChange(false);
    } catch (e: any) {
      setSaveError(e?.message ?? String(e));
    } finally {
      setSavingSkip(false);
    }
  };


  const handleSave = async () => {
    setConflicts([]);
    setSaveError(null);
    try {
      const result = await save.mutateAsync({
        draft: {
          ...draft,
          startTime: toIso(draft.entryDate, startInput),
          finishTime: toIso(draft.entryDate, finishInput),
        },
        vineyardId,
        activityId: activityId ?? newId,
      });

      if (result.error) { setSaveError(result.error); return; }
      if (result.stale) {
        setSaveError("This activity was changed elsewhere. Reopen it and apply your edit again.");
        return;
      }
      if (result.conflicts.length) setConflicts(result.conflicts);

      // Canonical server state replaces the editor state.
      if (result.activity) {
        setDraft(draftFromActivity(result.activity));
        setStartInput(toTimeInput(result.activity.startTime));
        setFinishInput(toTimeInput(result.activity.finishTime));
      }
      onSaved?.(result.activity);
      toast.success(
        isEdit ? "Pruning activity updated." : "Pruning activity recorded.",
        result.conflicts.length
          ? { description: `${result.conflicts.length} quarter(s) were rejected — see the dialog.` }
          : undefined,
      );
      if (!result.conflicts.length) onOpenChange(false);
    } catch (e: any) {
      setSaveError(e?.message ?? String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1200px,95vw)] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle>
                {isEdit ? "Edit pruning activity" : "New pruning activity"}
              </DialogTitle>
              <DialogDescription>
                One activity can cover several blocks. Labour, times, worker, method and
                notes belong to the activity and are counted once.
              </DialogDescription>
            </div>
            {(onPrev || onNext) && (
              <div className="flex items-center gap-1 pr-6">
                <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                  disabled={!onPrev} onClick={onPrev} aria-label="Previous activity">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {navLabel && <span className="text-xs text-muted-foreground tabular-nums px-1">{navLabel}</span>}
                <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                  disabled={!onNext} onClick={onNext} aria-label="Next activity">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {isEdit && detailQ.isLoading && (
          <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
          </div>
        )}
        {isEdit && detailQ.error && (
          <div className="p-4 text-sm text-destructive">
            Couldn't load this activity: {(detailQ.error as any)?.message ?? String(detailQ.error)}
          </div>
        )}

        {(!isEdit || loaded) && (
          <div className="space-y-4">
            {/* SQL 168 — skipped mode toggle. Same dialog, same selectors. */}
            {!isEdit && (
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="pa-skipped">Mark selected rows as skipped</Label>
                  <p className="text-xs text-muted-foreground">
                    Skipped rows count as complete in pruning progress, but no labour,
                    cost or pruning work is recorded.
                  </p>
                </div>
                <Switch
                  id="pa-skipped"
                  aria-label="Mark selected rows as skipped"
                  checked={skipped}
                  onCheckedChange={setSkipped}
                  disabled={busy}
                />
              </div>
            )}

            {/* ---------------- Activity-level fields ---------------- */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="pa-date">Date</Label>
                <Input id="pa-date" type="date" value={draft.entryDate}
                  onChange={(e) => setDraft((d) => ({ ...d, entryDate: e.target.value }))} />
              </div>
              {!skipped && (<>
              <div className="space-y-1">
                <Label htmlFor="pa-worker">Worker / crew</Label>
                <Input id="pa-worker" value={draft.worker} placeholder="Who did the work"
                  onChange={(e) => setDraft((d) => ({ ...d, worker: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Method</Label>
                <Select value={draft.method} onValueChange={(v) => setDraft((d) => ({ ...d, method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from(new Set([...METHODS, draft.method].filter(Boolean))).map((m) => (
                      <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-start">Start</Label>
                <Input id="pa-start" type="time" value={startInput}
                  onChange={(e) => setStartInput(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-finish">Finish</Label>
                <Input id="pa-finish" type="time" value={finishInput}
                  onChange={(e) => setFinishInput(e.target.value)} />
              </div>
              </>)}
            </div>

            {/* Labour hours, rate and cost belong to the linked Work Task — the
                activity mirrors them read-only and never owns a second source. */}
            {!skipped && (
              <ActivityWorkTaskField
                vineyardId={vineyardId}
                draft={draft}
                activityId={activityId}
                value={draft.workTaskId}
                startTime={startInput}
                finishTime={finishInput}
                legacyLabourHours={draft.workTaskId ? null : draft.labourHours}
                legacyHourlyRate={draft.workTaskId ? null : draft.hourlyRate}
                onChange={(taskId) => setDraft((d) => ({ ...d, workTaskId: taskId }))}
                onLabourResolved={({ hours, rate }) => setDraft((d) =>
                  d.labourHours === hours && d.hourlyRate === rate
                    ? d
                    : { ...d, labourHours: hours, hourlyRate: rate })}
                disabled={busy}
              />
            )}




            <div className="space-y-1">
              <Label htmlFor="pa-notes">Notes</Label>
              <Textarea id="pa-notes" rows={2} value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            </div>

            {isEdit && loaded && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/20 p-2.5 text-xs text-muted-foreground">
                <span>Created by <b className="text-foreground">{resolveUser(loaded.createdById) ?? "—"}</b></span>
                <span>Created <b className="text-foreground">{loaded.createdAt ? formatDate(loaded.createdAt.slice(0, 10)) : "—"}</b></span>
                <span>Updated <b className="text-foreground">{loaded.updatedAt ? formatDate(loaded.updatedAt.slice(0, 10)) : "—"}</b></span>
                <span>Season <b className="text-foreground">{loaded.seasonYear ?? "—"}</b></span>
                <span>Vintage <b className="text-foreground">{loaded.vintageYear ?? "—"}</b></span>
                <span>Status <b className="text-foreground">{loaded.isReversed ? "Reversed" : "Recorded"}</b></span>
              </div>
            )}

            {/* ---------------- Allocations ---------------- */}
            <MultiBlockAllocationEditor
              vineyardId={vineyardId}
              seasonYear={seasonYear}
              value={draft.allocations}
              onChange={handleAllocationsChange}
              ownedByActivity={ownedByActivity}
              initialPaddockId={paddockId}
              disabled={busy}
            />

            {conflicts.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  {conflicts.length} quarter{conflicts.length === 1 ? " was" : "s were"} rejected
                </div>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {conflicts.map((c, i) => (
                    <li key={i}>
                      Row {c.row ?? "?"} Q{c.segment ?? "?"} — {c.reason ?? "already recorded by another activity"}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {saveError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {saveError}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs text-muted-foreground tabular-nums">
            {totals.blocks} block{totals.blocks === 1 ? "" : "s"} · {totals.quarters} quarters ·{" "}
            {totals.rowEquivalents.toFixed(2)} row eq.
            {!skipped && ` · ~${totals.vines.toLocaleString()} vines`}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => {
                if (!skipped) { handleSave(); return; }
                if (totals.quarters === 0) {
                  setSaveError("Select at least one row or row section to mark as skipped.");
                  return;
                }
                setSaveError(null);
                setConfirmSkip(true);
              }}
              disabled={skipped ? busy || !draft.entryDate : !canSave}
            >
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {skipped ? "Mark skipped" : isEdit ? "Save changes" : "Record activity"}
            </Button>
          </div>
        </DialogFooter>

        <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Mark selected rows as skipped?</AlertDialogTitle>
              <AlertDialogDescription>
                These rows will count as complete in pruning progress, but no labour,
                cost or pruning work will be recorded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSkippedSave}>Mark Skipped</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>

    </Dialog>
  );
}
