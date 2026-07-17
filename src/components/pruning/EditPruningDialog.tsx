// SQL 120: Edit an existing pruning entry.
//
// Critical contract rules enforced here:
//   1. p_segments is ALWAYS the FULL desired quarter set for the entry.
//      Never a delta.
//   2. p_work_task_id: null means "no change to the existing link".
//      Only p_clear_work_task: true unlinks.
//   3. The RPC may return HTTP 200 with { error }, { stale: true } or
//      { conflicts: [...] }; we inspect the response body every time.
//
// Ownership loading: quarters owned by THIS entry are preselected and
// editable; quarters owned by OTHER entries stay locked (green); incomplete
// quarters are available.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckSquare, Plus, Square, Trash2, AlertCircle, Link2, Link2Off, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { PruningEntry, PruningRowSegment, RecordSegmentInput, UpdateEntryResult } from "@/lib/pruningQuery";
import { useUpdatePruningEntry } from "@/lib/pruningQuery";
import type { RowIdentity } from "@/lib/pruningCalc";
import {
  createLabourLine, fetchLabourLinesForTask, fetchWorkTaskById,
  softDeleteLabourLine, updateLabourLine, updateWorkTask, type WorkTaskLabourLine, type UpsertLabourLineInput,
} from "@/lib/workTasksQuery";
import { fetchOperatorCategoriesForVineyard, type OperatorCategory } from "@/lib/operatorCategoriesQuery";
import { useAuth } from "@/context/AuthContext";
import { useCanSeeCosts } from "@/lib/permissions";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entry: PruningEntry;
  identities: RowIdentity[];
  /** All completed segments for this block (any entry). */
  allSegments: PruningRowSegment[];
  vineyardId: string;
  paddockName: string;
}

const QUARTERS = [1, 2, 3, 4] as const;
const METHODS = ["spur", "cane", "mechanical", "mixed"];
const NONE = "__none__";
type Q = (typeof QUARTERS)[number];
type Key = string; // `${rowNumber}:${q}`

const key = (rowNumber: number, q: number): Key => `${Number(rowNumber)}:${q}`;

interface LabourDraft {
  id: string;              // stable id (existing or client-generated)
  isNew: boolean;
  workerTypeId: string;
  workerType: string;
  workerCount: string;
  hoursPerWorker: string;
  hourlyRate: string;
  notes: string;
  syncVersion: number | null;
}

function toDraft(line: WorkTaskLabourLine): LabourDraft {
  return {
    id: line.id,
    isNew: false,
    workerTypeId: line.worker_type_id ?? NONE,
    workerType: line.worker_type ?? "",
    workerCount: String(line.worker_count ?? 1),
    hoursPerWorker: line.hours_per_worker != null ? String(line.hours_per_worker) : "",
    hourlyRate: line.hourly_rate != null ? String(line.hourly_rate) : "",
    notes: line.notes ?? "",
    syncVersion: line.sync_version ?? null,
  };
}

function timeOnly(ts: string | null): string {
  if (!ts) return "";
  try { const d = new Date(ts); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } catch { return ""; }
}

export default function EditPruningDialog({
  open, onOpenChange, entry, identities, allSegments, vineyardId, paddockName,
}: Props) {
  const { user } = useAuth();
  const canSeeCosts = useCanSeeCosts();
  const rf = useRegionFormatters();
  const money = (v: number) => rf.currency(v);
  const update = useUpdatePruningEntry(entry.pruning_season_id, vineyardId);

  // ---------- Ownership split ----------
  const { ownedByThis, ownedByOthers } = useMemo(() => {
    const mine = new Set<Key>();
    const others = new Set<Key>();
    for (const s of allSegments) {
      if (s.completed !== true) continue;
      const k = key(s.row_number, s.segment_number);
      if (s.pruning_entry_id === entry.id) mine.add(k);
      else others.add(k);
    }
    return { ownedByThis: mine, ownedByOthers: others };
  }, [allSegments, entry.id]);

  // Snapshot the original owned set — RPC compares full set to this to
  // compute added/removed.
  const originalOwned = useMemo(() => new Set(ownedByThis), [ownedByThis]);

  // ---------- Form state ----------
  const [entryDate, setEntryDate] = useState(entry.entry_date);
  const [worker, setWorker] = useState(entry.worker_or_crew ?? "");
  const [labourHours, setLabourHours] = useState(entry.labour_hours != null ? String(entry.labour_hours) : "");
  const [startTime, setStartTime] = useState(timeOnly(entry.start_time));
  const [finishTime, setFinishTime] = useState(timeOnly(entry.finish_time));
  const [method, setMethod] = useState(entry.pruning_method || "spur");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [selected, setSelected] = useState<Set<Key>>(() => new Set(ownedByThis));
  const [rangeInput, setRangeInput] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [postSaveWarning, setPostSaveWarning] = useState<UpdateEntryResult | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  // Reset when entry changes.
  useEffect(() => {
    if (!open) return;
    setEntryDate(entry.entry_date);
    setWorker(entry.worker_or_crew ?? "");
    setLabourHours(entry.labour_hours != null ? String(entry.labour_hours) : "");
    setStartTime(timeOnly(entry.start_time));
    setFinishTime(timeOnly(entry.finish_time));
    setMethod(entry.pruning_method || "spur");
    setNotes(entry.notes ?? "");
    setSelected(new Set(ownedByThis));
    setRangeInput("");
    setRangeError(null);
    setPostSaveWarning(null);
  }, [open, entry.id, ownedByThis, entry.entry_date, entry.worker_or_crew, entry.labour_hours, entry.start_time, entry.finish_time, entry.pruning_method, entry.notes]);

  // ---------- Linked Work Task ----------
  const linkedTaskQ = useQuery({
    queryKey: ["pruning-edit", "work-task", entry.work_task_id],
    enabled: open && !!entry.work_task_id,
    queryFn: async () => {
      const [task, lines] = await Promise.all([
        fetchWorkTaskById(entry.work_task_id!),
        fetchLabourLinesForTask(entry.work_task_id!),
      ]);
      return { task, lines };
    },
  });
  const linkedTask = linkedTaskQ.data?.task ?? null;
  const linkedLines = useMemo(() => linkedTaskQ.data?.lines ?? [], [linkedTaskQ.data]);

  const [syncLinkedTask, setSyncLinkedTask] = useState(true);
  const [clearWorkTask, setClearWorkTask] = useState(false);
  const [labourDrafts, setLabourDrafts] = useState<LabourDraft[]>([]);
  const [removedLineIds, setRemovedLineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSyncLinkedTask(true);
    setClearWorkTask(false);
    setRemovedLineIds(new Set());
  }, [open, entry.id]);

  useEffect(() => {
    if (!linkedTaskQ.data) return;
    setLabourDrafts(linkedLines.map(toDraft));
  }, [linkedTaskQ.data, linkedLines]);

  // Worker type categories
  const { data: categoriesResult } = useQuery({
    queryKey: ["worker-types", vineyardId],
    enabled: open && !!vineyardId,
    queryFn: () => fetchOperatorCategoriesForVineyard(vineyardId),
  });
  const categories = categoriesResult?.categories ?? [];
  const categoryById = useMemo(() => {
    const m = new Map<string, OperatorCategory>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  // ---------- Grid ----------
  const displayRows = useMemo(
    () => [...identities].sort((a, b) => Number(a.rowNumber) - Number(b.rowNumber)),
    [identities],
  );

  const toggleQuarter = (rowNumber: number, q: Q) => {
    const k = key(rowNumber, q);
    if (ownedByOthers.has(k)) return; // locked
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const toggleRow = (rowNumber: number) => {
    const available = QUARTERS.filter((q) => !ownedByOthers.has(key(rowNumber, q)));
    const allSel = available.length > 0 && available.every((q) => selected.has(key(rowNumber, q)));
    setSelected((cur) => {
      const next = new Set(cur);
      for (const q of available) {
        const k = key(rowNumber, q);
        if (allSel) next.delete(k); else next.add(k);
      }
      return next;
    });
  };

  const applyRange = () => {
    const m = rangeInput.trim().replace(/\s*-\s*/g, "-");
    if (!m) { setRangeError("Enter a range"); return; }
    const ranges: [number, number][] = [];
    for (const part of m.split(/[,\n]+/)) {
      const t = part.trim(); if (!t) continue;
      const match = t.match(/^(\d+)(?:-(\d+))?$/);
      if (!match) { setRangeError(`Unrecognised: ${t}`); return; }
      const a = Number(match[1]); const b = match[2] ? Number(match[2]) : a;
      ranges.push([Math.min(a, b), Math.max(a, b)]);
    }
    setRangeError(null);
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of identities) {
        const rn = Number(id.rowNumber);
        if (!ranges.some(([lo, hi]) => rn >= lo && rn <= hi)) continue;
        for (const q of QUARTERS) {
          const k = key(rn, q);
          if (!ownedByOthers.has(k)) next.add(k);
        }
      }
      return next;
    });
  };

  // ---------- Derived values ----------
  const identityByRow = useMemo(() => {
    const m = new Map<number, RowIdentity>();
    identities.forEach((i) => m.set(Number(i.rowNumber), i));
    return m;
  }, [identities]);

  const segments: RecordSegmentInput[] = useMemo(() => {
    const out: RecordSegmentInput[] = [];
    for (const k of selected) {
      const [rn, q] = k.split(":").map(Number);
      const id = identityByRow.get(rn);
      out.push({
        rowNumber: rn,
        segmentNumber: q,
        paddockRowId: id?.paddockRowId ?? null,
        rowLabel: id?.rowLabel ?? String(rn),
      });
    }
    return out;
  }, [selected, identityByRow]);

  const estimatedVines = useMemo(() => {
    let v = 0;
    for (const k of selected) {
      const rn = Number(k.split(":")[0]);
      const id = identityByRow.get(rn);
      if (id) v += id.estimatedVines / 4;
    }
    return Math.round(v);
  }, [selected, identityByRow]);

  const rowEquivalents = segments.length / 4;

  const labourTotals = useMemo(() => {
    let hours = 0, cost = 0;
    for (const l of labourDrafts) {
      const wc = Number(l.workerCount) || 0;
      const hpw = Number(l.hoursPerWorker) || 0;
      const rate = Number(l.hourlyRate) || 0;
      hours += wc * hpw;
      cost += wc * hpw * rate;
    }
    return { hours, cost };
  }, [labourDrafts]);

  // Diff summary
  const originalCount = originalOwned.size;
  const newCount = selected.size;
  const originalHours = entry.labour_hours ?? 0;
  const willUpdateTask = !!linkedTask && syncLinkedTask && !clearWorkTask;
  const nextHours = willUpdateTask ? labourTotals.hours : (labourHours ? Number(labourHours) : null);

  // ---------- Labour line editing ----------
  const updateDraft = (id: string, patch: Partial<LabourDraft>) => {
    setLabourDrafts((prev) => prev.map((d) => {
      if (d.id !== id) return d;
      const next = { ...d, ...patch };
      if (patch.workerTypeId) {
        const cat = patch.workerTypeId === NONE ? null : categoryById.get(patch.workerTypeId);
        if (cat) {
          next.workerType = cat.name ?? "";
          if (canSeeCosts && cat.cost_per_hour != null) next.hourlyRate = String(cat.cost_per_hour);
        }
      }
      return next;
    }));
  };
  const addDraft = () => setLabourDrafts((prev) => [...prev, {
    id: crypto.randomUUID(), isNew: true, workerTypeId: NONE, workerType: "",
    workerCount: "1", hoursPerWorker: "", hourlyRate: "", notes: "", syncVersion: null,
  }]);
  const removeDraft = (id: string) => {
    setLabourDrafts((prev) => prev.filter((d) => d.id !== id));
    // Track soft-deletes for pre-existing lines only.
    if (linkedLines.some((l) => l.id === id)) {
      setRemovedLineIds((cur) => { const n = new Set(cur); n.add(id); return n; });
    }
  };

  const toLabourInput = (line: LabourDraft): UpsertLabourLineInput => ({
    id: line.id,
    work_task_id: entry.work_task_id!,
    vineyard_id: vineyardId,
    work_date: entryDate,
    worker_type_id: line.workerTypeId === NONE ? null : line.workerTypeId,
    worker_type: line.workerType.trim() || categoryById.get(line.workerTypeId)?.name || null,
    worker_count: Number(line.workerCount),
    hours_per_worker: Number(line.hoursPerWorker),
    hourly_rate: canSeeCosts && line.hourlyRate !== "" ? Number(line.hourlyRate) : null,
    notes: line.notes,
    user_id: user?.id ?? null,
    current_sync_version: line.syncVersion ?? undefined,
  });

  // ---------- Save ----------
  const handleSave = async () => {
    if (!entryDate) { toast.error("Date is required"); return; }
    if (segments.length === 0 && originalCount > 0) {
      if (!confirm("This edit removes ALL quarters from the entry. Continue?")) return;
    }

    // 1. Sync the linked Work Task (labour lines diff) first when applicable.
    let workTaskSaveError: string | null = null;
    if (linkedTask && syncLinkedTask && !clearWorkTask) {
      try {
        await updateWorkTask({
          id: linkedTask.id,
          vineyard_id: vineyardId,
          paddock_id: linkedTask.paddock_id ?? null,
          paddock_name: linkedTask.paddock_name ?? null,
          task_type: linkedTask.task_type ?? "Pruning",
          status: linkedTask.status ?? null,
          description: linkedTask.description ?? "",
          notes: linkedTask.notes ?? "",
          start_date: entryDate,
          end_date: entryDate,
          date: entryDate,
          area_ha: linkedTask.area_ha ?? null,
          duration_hours: labourTotals.hours,
          is_finalized: linkedTask.is_finalized ?? null,
          user_id: user?.id ?? null,
          current_sync_version: linkedTask.sync_version ?? null,
        });

        // Diff labour lines: create new, update changed, soft-delete removed.
        for (const draft of labourDrafts) {
          const input = toLabourInput(draft);
          if (draft.isNew) await createLabourLine(input);
          else await updateLabourLine(input);
        }
        for (const removedId of removedLineIds) {
          await softDeleteLabourLine(removedId, user?.id ?? null);
        }
      } catch (e: any) {
        workTaskSaveError = e?.message ?? String(e);
      }
    }

    // 2. Call the pruning update RPC.
    const clientUpdatedAt = new Date().toISOString();
    try {
      const res = await update.mutateAsync({
        entryId: entry.id,
        entryDate,
        worker,
        labourHours: nextHours,
        startTime: startTime ? new Date(`${entryDate}T${startTime}:00`).toISOString() : null,
        finishTime: finishTime ? new Date(`${entryDate}T${finishTime}:00`).toISOString() : null,
        method,
        notes,
        estimatedVines,
        segments,
        workTaskId: entry.work_task_id ?? null,
        clearWorkTask,
        clientUpdatedAt,
      });

      // 3. Inspect body — RPC may return HTTP 200 with a logical failure.
      if (res.error) {
        toast.error(`Could not save: ${res.error}`);
        return;
      }
      if (res.stale === true) {
        toast.warning("This record was updated on another device. The latest version has been loaded.");
        setPostSaveWarning(res);
        return;
      }
      const conflicts = res.conflicts ?? [];
      if (conflicts.length > 0) {
        setPostSaveWarning(res);
        toast.warning(`${conflicts.length} quarter${conflicts.length === 1 ? "" : "s"} could not be attributed.`);
        return;
      }
      if (workTaskSaveError) {
        toast.error(`Pruning saved, but linked Work Task update failed: ${workTaskSaveError}`);
        return;
      }
      toast.success("Pruning record updated.");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Failed to save: ${e?.message ?? e}`);
    }
  };

  const handleConfirmUnlink = () => {
    setClearWorkTask(true);
    setSyncLinkedTask(false);
    setUnlinkOpen(false);
    toast.info("Work Task will be unlinked when you save.");
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 gap-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle>Edit Pruning Record — {paddockName}</DialogTitle>
          <DialogDescription>
            Toggle quarters to add or remove them from this entry. Green quarters belong to another entry and are locked.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_400px] px-6 pb-4 max-h-[70vh] overflow-y-auto">
          {/* --- Grid --- */}
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px]">
                <Input
                  placeholder="Row ranges e.g. 44-46, 50"
                  value={rangeInput}
                  onChange={(e) => { setRangeInput(e.target.value); setRangeError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyRange())}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={applyRange}>Apply range</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(originalOwned))}>Reset</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
            {rangeError && (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" /> {rangeError}
              </div>
            )}

            <div className="rounded border overflow-hidden">
              <div className="grid grid-cols-[60px_44px_repeat(4,minmax(0,1fr))_64px] items-center gap-2 px-3 py-2 bg-muted/60 text-xs font-medium text-muted-foreground">
                <div>Row</div><div className="sr-only">Toggle</div>
                <div className="text-center">Q1</div><div className="text-center">Q2</div>
                <div className="text-center">Q3</div><div className="text-center">Q4</div>
                <div className="text-right pr-1">Vines</div>
              </div>
              <div className="divide-y max-h-[420px] overflow-y-auto">
                {displayRows.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">No rows configured.</div>
                )}
                {displayRows.map((id) => {
                  const rn = Number(id.rowNumber);
                  const available = QUARTERS.filter((q) => !ownedByOthers.has(key(rn, q)));
                  const allSel = available.length > 0 && available.every((q) => selected.has(key(rn, q)));
                  const noneAvailable = available.length === 0;
                  return (
                    <div key={id.paddockRowId ?? rn} className="grid grid-cols-[60px_44px_repeat(4,minmax(0,1fr))_64px] items-center gap-2 px-3 py-2 hover:bg-muted/30">
                      <div className="text-sm font-medium tabular-nums">{id.rowLabel}</div>
                      <button
                        type="button"
                        disabled={noneAvailable}
                        onClick={() => toggleRow(rn)}
                        className="h-11 w-11 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                        aria-label={`Toggle row ${id.rowLabel}`}
                      >
                        {allSel ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                      </button>
                      {QUARTERS.map((q) => {
                        const k = key(rn, q);
                        const lockedOther = ownedByOthers.has(k);
                        const isSel = selected.has(k);
                        return (
                          <button
                            key={q}
                            type="button"
                            disabled={lockedOther}
                            onClick={() => toggleQuarter(rn, q)}
                            aria-pressed={isSel || lockedOther}
                            className={cn(
                              "h-11 w-full rounded-md border text-sm font-medium transition",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              lockedOther
                                ? "bg-emerald-500 border-emerald-600 text-white cursor-not-allowed"
                                : isSel
                                ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                : "bg-muted/40 border-input text-foreground/70 hover:bg-muted",
                            )}
                          >
                            Q{q}
                          </button>
                        );
                      })}
                      <div className="text-right pr-1 text-xs text-muted-foreground tabular-nums">
                        {Math.round(id.estimatedVines) || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-500" /> Owned by another entry (locked)</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-primary" /> Owned by this entry / selected</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-muted" /> Available</span>
            </div>

            {postSaveWarning?.conflicts && postSaveWarning.conflicts.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Some quarters could not be attributed</AlertTitle>
                <AlertDescription>
                  <div className="mt-1 space-y-0.5 text-sm">
                    {postSaveWarning.conflicts.map((c, i) => (
                      <div key={i}>Row {c.row}, Quarter {c.segment} — {c.reason.replace(/_/g, " ")}</div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {postSaveWarning?.stale && (
              <Alert variant="destructive">
                <AlertTitle>Stale edit</AlertTitle>
                <AlertDescription>This record was updated on another device. Close and reopen to load the latest version.</AlertDescription>
              </Alert>
            )}
          </div>

          {/* --- Form / metadata --- */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Worker or crew</Label>
              <Input value={worker} onChange={(e) => setWorker(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Labour hours</Label>
              <Input
                type="number" step="0.1"
                value={willUpdateTask ? labourTotals.hours.toFixed(2) : labourHours}
                disabled={willUpdateTask}
                onChange={(e) => setLabourHours(e.target.value)}
              />
              {willUpdateTask && (
                <p className="text-xs text-muted-foreground">Derived from linked Work Task labour lines.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Start</Label><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Finish</Label><Input type="time" value={finishTime} onChange={(e) => setFinishTime(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {/* Linked Work Task section */}
            {entry.work_task_id && (
              <div className="rounded-md border p-3 space-y-3 bg-muted/20">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" /> Linked Work Task</Badge>
                      {clearWorkTask && <Badge variant="destructive">Will unlink</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {linkedTaskQ.isLoading ? "Loading task…" : linkedTask?.description || "Pruning task"}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setUnlinkOpen(true)} disabled={clearWorkTask}>
                    <Link2Off className="h-4 w-4 mr-1" /> Unlink…
                  </Button>
                </div>

                {!clearWorkTask && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="sync-task" className="text-sm">Update linked Work Task</Label>
                      <Switch id="sync-task" checked={syncLinkedTask} onCheckedChange={setSyncLinkedTask} />
                    </div>

                    {syncLinkedTask && (
                      <div className="space-y-2 pt-1 border-t">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Labour lines</div>
                        {labourDrafts.map((line, i) => {
                          const wc = Number(line.workerCount) || 0;
                          const h = Number(line.hoursPerWorker) || 0;
                          const rate = Number(line.hourlyRate) || 0;
                          return (
                            <div key={line.id} className="rounded border bg-background p-2 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1.5 col-span-2">
                                  <Label>Worker / crew type</Label>
                                  <Select value={line.workerTypeId} onValueChange={(v) => updateDraft(line.id, { workerTypeId: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={NONE}>Manual entry</SelectItem>
                                      {categories.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                          {(c.name ?? c.id.slice(0, 8)) + (canSeeCosts && c.cost_per_hour != null ? ` — ${money(Number(c.cost_per_hour))}/h` : "")}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {line.workerTypeId === NONE && (
                                  <div className="space-y-1.5 col-span-2">
                                    <Label>Name</Label>
                                    <Input value={line.workerType} onChange={(e) => updateDraft(line.id, { workerType: e.target.value })} />
                                  </div>
                                )}
                                <div className="space-y-1.5">
                                  <Label>Workers</Label>
                                  <Input type="number" step="1" value={line.workerCount} onChange={(e) => updateDraft(line.id, { workerCount: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                  <Label>Hours each</Label>
                                  <Input type="number" step="0.25" value={line.hoursPerWorker} onChange={(e) => updateDraft(line.id, { hoursPerWorker: e.target.value })} />
                                </div>
                                {canSeeCosts && (
                                  <div className="space-y-1.5">
                                    <Label>Cost / hour</Label>
                                    <Input type="number" step="0.01" value={line.hourlyRate} onChange={(e) => updateDraft(line.id, { hourlyRate: e.target.value })} />
                                  </div>
                                )}
                                <div className="space-y-1.5">
                                  <Label>{canSeeCosts ? "Line total" : "Total hours"}</Label>
                                  <Input readOnly disabled value={canSeeCosts ? money(wc * h * rate) : `${(wc * h).toFixed(2)} h`} />
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <Input placeholder="Notes" value={line.notes} onChange={(e) => updateDraft(line.id, { notes: e.target.value })} />
                                <Button type="button" variant="ghost" size="icon" onClick={() => removeDraft(line.id)} aria-label={`Remove labour line ${i + 1}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                        <Button type="button" variant="outline" size="sm" onClick={addDraft}>
                          <Plus className="h-4 w-4 mr-1" /> Add labour line
                        </Button>
                        <div className="rounded border bg-background px-3 py-2 text-sm space-y-1">
                          <div className="flex justify-between"><span className="text-muted-foreground">Total person-hours</span><b>{labourTotals.hours.toFixed(2)}</b></div>
                          {canSeeCosts && <div className="flex justify-between"><span className="text-muted-foreground">Total labour cost</span><b>{money(labourTotals.cost)}</b></div>}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Preview */}
            <div className="rounded border bg-background/60 p-3 text-xs space-y-0.5 tabular-nums">
              <div className="font-medium text-sm text-foreground mb-1">Change preview</div>
              <div>Quarters: <b>{originalCount}</b> → <b>{newCount}</b></div>
              <div>Row equivalents: <b>{(originalCount / 4).toFixed(2)}</b> → <b>{rowEquivalents.toFixed(2)}</b></div>
              <div>Estimated vines: <b>{(entry.estimated_vines_completed ?? 0).toLocaleString()}</b> → <b>{estimatedVines.toLocaleString()}</b></div>
              {willUpdateTask && <div>Person-hours: <b>{originalHours ? Number(originalHours).toFixed(2) : "—"}</b> → <b>{labourTotals.hours.toFixed(2)}</b></div>}
              {entry.entry_date !== entryDate && <div className="text-amber-600 dark:text-amber-400">Date change: server will resolve vintage for the new date.</div>}
            </div>
          </div>
        </div>

        <div className="border-t bg-background sticky bottom-0 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {originalCount === newCount
              ? `${newCount} quarters (no change)`
              : `${originalCount} → ${newCount} quarters`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unlink Work Task?</AlertDialogTitle>
          <AlertDialogDescription>
            The pruning record will no longer be attached to this Work Task. The Work Task itself will be kept.
            Its labour lines and costs will remain in cost reports.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep linked</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmUnlink}>Unlink</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// Silence unused import
void ExternalLink;
