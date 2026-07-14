import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CheckSquare, Plus, Square, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PruningSeason, RecordSegmentInput } from "@/lib/pruningQuery";
import { useRecordPruningEntry } from "@/lib/pruningQuery";
import type { RowCompletionState, RowIdentity } from "@/lib/pruningCalc";
import { createWorkTask, createLabourLine, syncWorkTaskPaddocks } from "@/lib/workTasksQuery";
import type { UpsertLabourLineInput } from "@/lib/workTasksQuery";
import { fetchOperatorCategoriesForVineyard, type OperatorCategory } from "@/lib/operatorCategoriesQuery";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { useCanSeeCosts } from "@/lib/permissions";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { useQuery } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  season: PruningSeason;
  vineyardId: string;
  paddockId: string;
  paddockName: string;
  rows: RowCompletionState[];
}

const QUARTERS = [1, 2, 3, 4] as const;
const METHODS = ["spur", "cane", "mechanical", "mixed"];
const NONE = "__none__";

type SelectionKey = string;
type Quarter = (typeof QUARTERS)[number];

interface ParsedRange {
  start: number;
  end: number;
}

interface RangeDiagnostic {
  parsed: string;
  matchedRows: number[];
  quartersAdded: number;
  selectedTotal: number;
}

interface LabourDraft {
  id: string;
  workerTypeId: string;
  workerType: string;
  workerCount: string;
  hoursPerWorker: string;
  hourlyRate: string;
  notes: string;
}

const selectionKey = (identity: RowIdentity, quarter: Quarter): SelectionKey =>
  `${Number(identity.rowNumber)}:${quarter}`;

function parseRequestedRanges(input: string): { ranges: ParsedRange[]; invalid: string[] } {
  const normalized = input.trim().replace(/\s*[-–—]\s*/g, "-");
  if (!normalized) return { ranges: [], invalid: [] };
  const ranges: ParsedRange[] = [];
  const invalid: string[] = [];
  for (const raw of normalized.split(/[,\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      invalid.push(part);
      continue;
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    ranges.push({ start, end });
  }
  return { ranges, invalid };
}

function rangeLabel(ranges: ParsedRange[]) {
  return ranges.map(({ start, end }) => (start === end ? `${start}` : `${start}–${end}`)).join(", ");
}

function rowNumberFromKey(k: SelectionKey) {
  return Number(k.split(":")[0]);
}

function segmentFromKey(k: SelectionKey) {
  return Number(k.split(":")[1]);
}

export default function CompleteTodayDialog({
  open, onOpenChange, season, vineyardId, paddockId, paddockName, rows,
}: Props) {
  const record = useRecordPruningEntry(season.id);
  const { user } = useAuth();
  const { currentRole } = useVineyard();
  const canSeeCosts = useCanSeeCosts();
  const { isAdmin: isSystemAdmin } = useIsSystemAdmin();
  const rf = useRegionFormatters();
  const money = (v: number) => rf.currency(v);

  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [worker, setWorker] = useState("");
  const [labourHours, setLabourHours] = useState("");
  const [startTime, setStartTime] = useState("");
  const [finishTime, setFinishTime] = useState("");
  const [method, setMethod] = useState<string>(season.pruning_method);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [rangeDiagnostic, setRangeDiagnostic] = useState<RangeDiagnostic | null>(null);

  const [createTask, setCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskStatus, setTaskStatus] = useState("completed");
  const [labourLines, setLabourLines] = useState<LabourDraft[]>([]);
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!open) return;
    setEntryDate(new Date().toISOString().slice(0, 10));
    setWorker(season.assigned_crew ?? "");
    setLabourHours("");
    setStartTime("");
    setFinishTime("");
    setMethod(season.pruning_method);
    setNotes("");
    setSelected(new Set());
    setRangeInput("");
    setRangeError(null);
    setRangeDiagnostic(null);
    setCreateTask(false);
    setTaskTitle(`Pruning — ${paddockName}`);
    setTaskStatus("completed");
    setLabourLines([]);
    setPendingEntryId(null);
    setPendingTaskId(null);
  }, [open, season, paddockName]);

  const rowBySelectionKey = useMemo(() => {
    const m = new Map<SelectionKey, RowCompletionState>();
    for (const row of rows) for (const q of QUARTERS) m.set(selectionKey(row.identity, q), row);
    return m;
  }, [rows]);

  const isQuarterCompleted = (identity: RowIdentity, quarter: Quarter) =>
    rows.find((row) => row.identity === identity)?.completed.has(quarter) ?? false;

  const toggleSegment = (identity: RowIdentity, quarter: Quarter) => {
    if (isQuarterCompleted(identity, quarter)) return;
    const k = selectionKey(identity, quarter);
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const toggleRow = (identity: RowIdentity) => {
    const row = rows.find((r) => r.identity === identity);
    if (!row) return;
    const available = QUARTERS.filter((q) => !row.completed.has(q));
    const allSelected = available.length > 0 && available.every((q) => selected.has(selectionKey(identity, q)));
    setSelected((cur) => {
      const next = new Set(cur);
      for (const q of available) {
        const k = selectionKey(identity, q);
        if (allSelected) next.delete(k); else next.add(k);
      }
      return next;
    });
  };

  const applyRange = () => {
    const { ranges, invalid } = parseRequestedRanges(rangeInput);
    if (invalid.length) setRangeError(`Unrecognised: ${invalid.join(", ")}`);
    else setRangeError(null);
    if (!ranges.length) {
      if (!invalid.length) setRangeError(`No range entered`);
      setRangeDiagnostic(null);
      return;
    }

    const additions = new Set<SelectionKey>();
    const matchedRows: number[] = [];

    for (const row of rows) {
      const rowNumber = Number(row.identity.rowNumber);
      if (!Number.isFinite(rowNumber)) continue;
      const isInRequestedRange = ranges.some(
        ({ start, end }) => rowNumber >= Math.min(start, end) && rowNumber <= Math.max(start, end),
      );
      if (!isInRequestedRange) continue;

      let matchedAnyQuarter = false;
      for (const quarter of QUARTERS) {
        const k = selectionKey(row.identity, quarter);
        if (!isQuarterCompleted(row.identity, quarter)) {
          additions.add(k);
          matchedAnyQuarter = true;
        }
      }
      if (matchedAnyQuarter) matchedRows.push(rowNumber);
    }

    if (!additions.size && !invalid.length) setRangeError(`No incomplete quarters match "${rangeInput}"`);
    setSelected((previous) => {
      const next = new Set(previous);
      additions.forEach((value) => next.add(value));
      setRangeDiagnostic({
        parsed: rangeLabel(ranges),
        matchedRows,
        quartersAdded: additions.size,
        selectedTotal: next.size,
      });
      return next;
    });
  };

  const clearAll = () => {
    setSelected(new Set());
    setRangeDiagnostic(null);
  };
  const selectAllIncomplete = () => {
    const next = new Set<SelectionKey>();
    for (const r of rows) for (const q of QUARTERS) if (!r.completed.has(q)) next.add(selectionKey(r.identity, q));
    setSelected(next);
  };

  const segments: RecordSegmentInput[] = useMemo(() => {
    const out: RecordSegmentInput[] = [];
    for (const k of selected) {
      const row = rowBySelectionKey.get(k);
      if (!row) continue;
      out.push({
        rowNumber: Number(row.identity.rowNumber),
        segmentNumber: segmentFromKey(k),
        paddockRowId: row.identity.paddockRowId,
        rowLabel: row.identity.rowLabel,
      });
    }
    return out;
  }, [selected, rowBySelectionKey]);

  const estimatedVines = useMemo(() => {
    let v = 0;
    for (const k of selected) {
      const row = rowBySelectionKey.get(k);
      if (!row) continue;
      v += row.identity.estimatedVines / 4;
    }
    return Math.round(v);
  }, [selected, rowBySelectionKey]);

  const rowEquivalents = segments.length / 4;

  const selectedRowNumbers = useMemo(() => {
    const rns = new Set<number>();
    for (const k of selected) rns.add(rowNumberFromKey(k));
    return Array.from(rns).filter(Number.isFinite).sort((a, b) => a - b);
  }, [selected]);

  const rowSummary = useMemo(() => {
    if (!selectedRowNumbers.length) return "";
    const parts: string[] = [];
    let start = selectedRowNumbers[0], prev = start;
    for (let i = 1; i <= selectedRowNumbers.length; i++) {
      const n = selectedRowNumbers[i];
      if (n === prev + 1) { prev = n; continue; }
      parts.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = n; prev = n;
    }
    return `Rows ${parts.join(", ")}`;
  }, [selectedRowNumbers]);

  const makeLabourLine = (seed?: Partial<LabourDraft>): LabourDraft => ({
    id: crypto.randomUUID(),
    workerTypeId: seed?.workerTypeId ?? NONE,
    workerType: seed?.workerType ?? "",
    workerCount: seed?.workerCount ?? "1",
    hoursPerWorker: seed?.hoursPerWorker ?? "",
    hourlyRate: seed?.hourlyRate ?? "",
    notes: seed?.notes ?? "",
  });

  const seedLabourLines = () => {
    if (labourLines.length) return;
    setLabourLines([makeLabourLine({ workerType: worker, hoursPerWorker: labourHours })]);
  };

  const setCreateTaskChecked = (checked: boolean) => {
    setCreateTask(checked);
    if (checked) seedLabourLines();
  };

  const updateLabourLine = (id: string, patch: Partial<LabourDraft>) => {
    setLabourLines((prev) => prev.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      if (patch.workerTypeId) {
        const cat = patch.workerTypeId === NONE ? null : categoryById.get(patch.workerTypeId);
        next.workerType = cat?.name ?? (patch.workerTypeId === NONE ? next.workerType : "");
        if (cat?.cost_per_hour != null && canSeeCosts) next.hourlyRate = String(cat.cost_per_hour);
      }
      return next;
    }));
  };

  const addLabourLine = () => setLabourLines((prev) => [...prev, makeLabourLine()]);
  const removeLabourLine = (id: string) => setLabourLines((prev) => prev.filter((line) => line.id !== id));

  const labourTotals = useMemo(() => {
    let hours = 0;
    let cost = 0;
    for (const line of labourLines) {
      const workerCount = Number(line.workerCount || 0) || 0;
      const hoursPerWorker = Number(line.hoursPerWorker || 0) || 0;
      const rate = Number(line.hourlyRate || 0) || 0;
      hours += workerCount * hoursPerWorker;
      cost += workerCount * hoursPerWorker * rate;
    }
    return { hours, cost };
  }, [labourLines]);

  const validateLabourLines = () => {
    if (!createTask) return true;
    if (!labourLines.length) { toast.error("Add at least one labour line"); return false; }
    for (const [idx, line] of labourLines.entries()) {
      const workerCount = Number(line.workerCount);
      const hoursPerWorker = Number(line.hoursPerWorker);
      if (!Number.isFinite(workerCount) || workerCount <= 0) { toast.error(`Labour line ${idx + 1}: worker count is required`); return false; }
      if (!Number.isFinite(hoursPerWorker) || hoursPerWorker <= 0) { toast.error(`Labour line ${idx + 1}: hours are required`); return false; }
      if (canSeeCosts && line.hourlyRate && (!Number.isFinite(Number(line.hourlyRate)) || Number(line.hourlyRate) < 0)) {
        toast.error(`Labour line ${idx + 1}: hourly cost is invalid`);
        return false;
      }
    }
    return true;
  };

  const toLabourInput = (taskId: string, line: LabourDraft): UpsertLabourLineInput => ({
    id: line.id,
    work_task_id: taskId,
    vineyard_id: vineyardId,
    work_date: entryDate,
    worker_type_id: line.workerTypeId === NONE ? null : line.workerTypeId,
    worker_type: (line.workerType.trim() || categoryById.get(line.workerTypeId)?.name || null),
    worker_count: Number(line.workerCount),
    hours_per_worker: Number(line.hoursPerWorker),
    hourly_rate: canSeeCosts && line.hourlyRate !== "" ? Number(line.hourlyRate) : null,
    notes: line.notes,
    user_id: user?.id ?? null,
  });

  const handleSubmit = async () => {
    if (!segments.length) { toast.error("Select at least one quarter"); return; }
    if (!entryDate) { toast.error("Date is required"); return; }
    if (createTask && !taskTitle.trim()) { toast.error("Task title is required"); return; }
    if (!validateLabourLines()) return;

    const entryId = pendingEntryId ?? crypto.randomUUID();
    const taskId = pendingTaskId ?? crypto.randomUUID();
    setPendingEntryId(entryId);
    if (createTask) setPendingTaskId(taskId);

    const totalLabourHours = createTask ? labourTotals.hours : (labourHours ? Number(labourHours) : null);

    try {
      const res = await record.mutateAsync({
        entryId,
        vineyardId,
        seasonId: season.id,
        paddockId,
        seasonYear: season.season_year,
        entryDate,
        worker,
        labourHours: totalLabourHours,
        startTime: startTime ? new Date(`${entryDate}T${startTime}:00`).toISOString() : null,
        finishTime: finishTime ? new Date(`${entryDate}T${finishTime}:00`).toISOString() : null,
        method,
        notes,
        estimatedVines,
        segments,
      });

      if (createTask) {
        try {
          const linkTag = `\n\n[Pruning entry: ${res.entry_id ?? entryId}]`;
          const descParts = [
            rowSummary,
            `${segments.length} quarters · ${rowEquivalents.toFixed(2)} row equivalents · ~${estimatedVines.toLocaleString()} vines`,
            `Method: ${method}`,
            notes,
          ].filter(Boolean).join("\n");
          const task = await createWorkTask({
            id: taskId,
            vineyard_id: vineyardId,
            paddock_id: paddockId,
            paddock_name: paddockName,
            task_type: "Pruning",
            status: taskStatus,
            description: taskTitle.trim(),
            notes: descParts + linkTag,
            date: entryDate,
            start_date: entryDate,
            end_date: entryDate,
            duration_hours: totalLabourHours ?? 0,
            is_finalized: taskStatus === "completed",
            user_id: user?.id ?? null,
          });
          await syncWorkTaskPaddocks({
            workTaskId: task.id,
            vineyardId,
            selections: [{ paddock_id: paddockId, area_ha: null }],
            existing: [],
            userId: user?.id ?? null,
          });
          for (const line of labourLines) await createLabourLine(toLabourInput(task.id, line));
          setPendingTaskId(null);
        } catch (e: any) {
          toast.error(`Pruning saved, but Work Task labour could not be saved: ${e?.message ?? e}`);
          return;
        }
      }

      const dropped = Math.max(0, (res.requested ?? segments.length) - (res.attributed ?? 0));
      if (dropped > 0) toast.warning(`${res.attributed}/${res.requested} quarters saved — ${dropped} were already completed and were skipped.`);
      else toast.success(createTask ? `Recorded pruning and Work Task labour` : `Recorded ${res.attributed} quarter${res.attributed === 1 ? "" : "s"}`);
      setPendingEntryId(null);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Failed to record: ${e?.message ?? e}`);
    }
  };

  const showDiagnostic = import.meta.env.DEV && isSystemAdmin;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 gap-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle>Record Pruning — {paddockName}</DialogTitle>
          <DialogDescription>
            Select the rows and quarters completed. Already-completed quarters are locked to avoid double-counting.
            The date field determines when the work occurred.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px] px-6 pb-4 max-h-[70vh] overflow-y-auto">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px]">
                <Input
                  className="w-full"
                  placeholder="Row ranges e.g. 44-46, 50, 55-58"
                  value={rangeInput}
                  onChange={(e) => { setRangeInput(e.target.value); setRangeError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyRange())}
                  aria-invalid={!!rangeError}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={applyRange}>Apply range</Button>
              <Button variant="outline" size="sm" onClick={selectAllIncomplete}>Select all incomplete</Button>
              <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
            </div>
            {rangeError && (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" /> {rangeError}
              </div>
            )}
            {showDiagnostic && rangeDiagnostic && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
                <div>Parsed: {rangeDiagnostic.parsed}</div>
                <div>Matched rows: {rangeDiagnostic.matchedRows.join(", ") || "—"}</div>
                <div>Quarters added: {rangeDiagnostic.quartersAdded}</div>
                <div>Selected quarters: {rangeDiagnostic.selectedTotal}</div>
              </div>
            )}

            <div className="rounded border overflow-hidden">
              <div className="grid grid-cols-[60px_44px_repeat(4,minmax(0,1fr))_64px] items-center gap-2 px-3 py-2 bg-muted/60 text-xs font-medium text-muted-foreground sticky top-0">
                <div>Row</div>
                <div className="sr-only">Toggle</div>
                <div className="text-center">Q1</div>
                <div className="text-center">Q2</div>
                <div className="text-center">Q3</div>
                <div className="text-center">Q4</div>
                <div className="text-right pr-1">Vines</div>
              </div>
              <div className="divide-y max-h-[420px] overflow-y-auto">
                {rows.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No rows configured for this block. Add row geometry or a manual row count.
                  </div>
                )}
                {rows.map((r) => {
                  const available = QUARTERS.filter((q) => !r.completed.has(q));
                  const allSel = available.length > 0 && available.every((q) => selected.has(selectionKey(r.identity, q)));
                  const doneAll = r.completed.size === 4;
                  return (
                    <div
                      key={r.identity.paddockRowId ?? r.identity.rowNumber}
                      className="grid grid-cols-[60px_44px_repeat(4,minmax(0,1fr))_64px] items-center gap-2 px-3 py-2 hover:bg-muted/30"
                    >
                      <div className="text-sm font-medium tabular-nums">{r.identity.rowLabel}</div>
                      <button
                        type="button"
                        className="h-11 w-11 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={doneAll}
                        onClick={() => toggleRow(r.identity)}
                        aria-label={`Toggle all quarters in row ${r.identity.rowLabel}`}
                      >
                        {allSel ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                      </button>
                      {QUARTERS.map((q) => {
                        const done = r.completed.has(q);
                        const isSel = selected.has(selectionKey(r.identity, q));
                        return (
                          <button
                            key={q}
                            type="button"
                            disabled={done}
                            onClick={() => toggleSegment(r.identity, q)}
                            aria-label={`Row ${r.identity.rowLabel} quarter ${q}${done ? " (already completed)" : isSel ? " (selected)" : ""}`}
                            aria-pressed={isSel || done}
                            className={cn(
                              "h-11 w-full rounded-md border text-sm font-medium tabular-nums transition",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                              done
                                ? "bg-emerald-500 border-emerald-600 text-white cursor-not-allowed"
                                : isSel
                                ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                : "bg-muted/40 border-input text-foreground/70 hover:bg-muted hover:text-foreground",
                            )}
                          >
                            Q{q}
                          </button>
                        );
                      })}
                      <div className="text-right pr-1 text-xs text-muted-foreground tabular-nums">
                        {r.identity.estimatedVines || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

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
              <Input type="number" step="0.1" value={labourHours} onChange={(e) => setLabourHours(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Finish</Label>
                <Input type="time" value={finishTime} onChange={(e) => setFinishTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="rounded-md border p-3 space-y-3 bg-muted/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="create-task" className="text-sm">Create a Work Task for this pruning work</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Records the same date, block and notes with detailed labour lines.
                  </p>
                </div>
                <Switch id="create-task" checked={createTask} onCheckedChange={setCreateTaskChecked} />
              </div>
              {createTask && (
                <div className="space-y-3 pt-1 border-t">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Work Task</div>
                    <div className="space-y-1.5">
                      <Label>Task title</Label>
                      <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={taskStatus} onValueChange={setTaskStatus}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="on_hold">On Hold</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Labour lines</div>
                    {labourLines.map((line, index) => {
                      const workerCount = Number(line.workerCount || 0) || 0;
                      const hours = Number(line.hoursPerWorker || 0) || 0;
                      const rate = Number(line.hourlyRate || 0) || 0;
                      const total = workerCount * hours * rate;
                      return (
                        <div key={line.id} className="rounded border bg-background p-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1.5 col-span-2">
                              <Label>Worker / crew type</Label>
                              <Select value={line.workerTypeId} onValueChange={(v) => updateLabourLine(line.id, { workerTypeId: v })}>
                                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
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
                                <Input value={line.workerType} onChange={(e) => updateLabourLine(line.id, { workerType: e.target.value })} />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <Label>Workers</Label>
                              <Input type="number" step="1" value={line.workerCount} onChange={(e) => updateLabourLine(line.id, { workerCount: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Hours each</Label>
                              <Input type="number" step="0.25" value={line.hoursPerWorker} onChange={(e) => updateLabourLine(line.id, { hoursPerWorker: e.target.value })} />
                            </div>
                            {canSeeCosts && (
                              <div className="space-y-1.5">
                                <Label>Cost / hour</Label>
                                <Input type="number" step="0.01" value={line.hourlyRate} onChange={(e) => updateLabourLine(line.id, { hourlyRate: e.target.value })} />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <Label>{canSeeCosts ? "Line total" : "Total hours"}</Label>
                              <Input readOnly disabled value={canSeeCosts ? money(total) : `${(workerCount * hours).toFixed(2)} h`} />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <Input
                              placeholder="Notes"
                              value={line.notes}
                              onChange={(e) => updateLabourLine(line.id, { notes: e.target.value })}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeLabourLine(line.id)}
                              disabled={labourLines.length === 1 || (currentRole !== "owner" && currentRole !== "manager" && currentRole !== "supervisor")}
                              aria-label={`Remove labour line ${index + 1}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    <Button type="button" variant="outline" size="sm" onClick={addLabourLine}>
                      <Plus className="h-4 w-4 mr-1" /> Add labour line
                    </Button>
                    <div className="rounded border bg-background px-3 py-2 text-sm space-y-1">
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total person-hours</span><b>{labourTotals.hours.toFixed(2)}</b></div>
                      {canSeeCosts && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total labour cost</span><b>{money(labourTotals.cost)}</b></div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t bg-background sticky bottom-0 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {segments.length === 0 ? (
              <span className="text-muted-foreground">Nothing selected yet</span>
            ) : (
              <span className="tabular-nums">
                <b>{segments.length}</b> quarters · <b>{rowEquivalents.toFixed(2)}</b> row equivalents · ~<b>{estimatedVines.toLocaleString()}</b> vines
                {rowSummary && <span className="text-muted-foreground"> · {rowSummary}</span>}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={record.isPending || segments.length === 0}>
              {record.isPending
                ? "Recording…"
                : `Record ${segments.length} quarter${segments.length === 1 ? "" : "s"}${createTask ? " + task" : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}