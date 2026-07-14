import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CheckSquare, Square, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PruningSeason, RecordSegmentInput } from "@/lib/pruningQuery";
import { useRecordPruningEntry } from "@/lib/pruningQuery";
import type { RowCompletionState } from "@/lib/pruningCalc";
import { parseRowRangesDetail } from "@/lib/pruningCalc";
import { createWorkTask } from "@/lib/workTasksQuery";
import { useAuth } from "@/context/AuthContext";

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

type SelectionKey = string;
const key = (r: number, s: number) => `${r}:${s}` as SelectionKey;

export default function CompleteTodayDialog({
  open, onOpenChange, season, vineyardId, paddockId, paddockName, rows,
}: Props) {
  const record = useRecordPruningEntry(season.id);
  const { user } = useAuth();

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

  // Work Task integration
  const [createTask, setCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskStatus, setTaskStatus] = useState("Completed");

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
    setCreateTask(false);
    setTaskTitle(`Pruning — ${paddockName}`);
    setTaskStatus("Completed");
  }, [open, season, paddockName]);

  const rowIndexByNumber = useMemo(() => {
    const m = new Map<number, RowCompletionState>();
    for (const r of rows) m.set(Number(r.identity.rowNumber), r);
    return m;
  }, [rows]);
  const availableRowNumbers = useMemo(
    () => rows.map((r) => Number(r.identity.rowNumber)).filter((n) => Number.isFinite(n)),
    [rows],
  );

  const isDone = (rowNumber: number, seg: number) => rowIndexByNumber.get(rowNumber)?.completed.has(seg) ?? false;

  const toggleSegment = (rowNumber: number, seg: number) => {
    if (isDone(rowNumber, seg)) return;
    setSelected((cur) => {
      const next = new Set(cur);
      const k = key(rowNumber, seg);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const toggleRow = (rowNumber: number) => {
    const row = rowIndexByNumber.get(rowNumber);
    if (!row) return;
    const available = QUARTERS.filter((q) => !row.completed.has(q));
    const allSelected = available.length > 0 && available.every((q) => selected.has(key(rowNumber, q)));
    setSelected((cur) => {
      const next = new Set(cur);
      for (const q of available) {
        const k = key(rowNumber, q);
        if (allSelected) next.delete(k); else next.add(k);
      }
      return next;
    });
  };
  const applyRange = () => {
    const { nums, invalid } = parseRowRangesDetail(rangeInput, availableRowNumbers);
    if (invalid.length) {
      setRangeError(`Unrecognised: ${invalid.join(", ")}`);
    } else {
      setRangeError(null);
    }
    if (!nums.length) {
      if (!invalid.length) setRangeError(`No configured rows match "${rangeInput}"`);
      return;
    }
    // Iterate `rows` directly (not via map lookup) and coerce identity.rowNumber
    // to Number to guarantee equality against parsed numbers. This avoids any
    // stale-map or string-vs-number key mismatch that could leave only the
    // first row in the range selected.
    const wanted = new Set<number>(nums.map((n) => Number(n)));
    setSelected((cur) => {
      const next = new Set(cur);
      let addedRows = 0;
      let addedQuarters = 0;
      for (const r of rows) {
        const rn = Number(r.identity.rowNumber);
        if (!wanted.has(rn)) continue;
        let rowAdded = false;
        for (const q of QUARTERS) {
          if (r.completed.has(q)) continue;
          const k = key(rn, q);
          if (!next.has(k)) {
            next.add(k);
            addedQuarters += 1;
            rowAdded = true;
          }
        }
        if (rowAdded) addedRows += 1;
      }
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[pruning] applyRange", {
          input: rangeInput, parsed: nums, available: availableRowNumbers,
          rowsMatched: addedRows, quartersAdded: addedQuarters, selectedTotal: next.size,
        });
      }
      return next;
    });
  };
  const clearAll = () => setSelected(new Set());
  const selectAllIncomplete = () => {
    const next = new Set<SelectionKey>();
    for (const r of rows) for (const q of QUARTERS) if (!r.completed.has(q)) next.add(key(r.identity.rowNumber, q));
    setSelected(next);
  };

  const segments: RecordSegmentInput[] = useMemo(() => {
    const out: RecordSegmentInput[] = [];
    for (const k of selected) {
      const [rn, seg] = k.split(":").map(Number);
      const row = rowIndexByNumber.get(rn);
      if (!row) continue;
      out.push({
        rowNumber: rn,
        segmentNumber: seg,
        paddockRowId: row.identity.paddockRowId,
        rowLabel: row.identity.rowLabel,
      });
    }
    return out;
  }, [selected, rowIndexByNumber]);

  const estimatedVines = useMemo(() => {
    let v = 0;
    for (const k of selected) {
      const [rn] = k.split(":").map(Number);
      const row = rowIndexByNumber.get(rn);
      if (!row) continue;
      v += row.identity.estimatedVines / 4;
    }
    return Math.round(v);
  }, [selected, rowIndexByNumber]);

  const rowEquivalents = segments.length / 4;

  const selectedRowNumbers = useMemo(() => {
    const rns = new Set<number>();
    for (const k of selected) rns.add(Number(k.split(":")[0]));
    return Array.from(rns).sort((a, b) => a - b);
  }, [selected]);

  const rowSummary = useMemo(() => {
    if (!selectedRowNumbers.length) return "";
    // Collapse to ranges
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

  const handleSubmit = async () => {
    if (!segments.length) { toast.error("Select at least one quarter"); return; }
    if (!entryDate) { toast.error("Date is required"); return; }
    if (createTask && !taskTitle.trim()) { toast.error("Task title is required"); return; }
    try {
      const res = await record.mutateAsync({
        vineyardId,
        seasonId: season.id,
        paddockId,
        seasonYear: season.season_year,
        entryDate,
        worker,
        labourHours: labourHours ? Number(labourHours) : null,
        startTime: startTime ? new Date(`${entryDate}T${startTime}:00`).toISOString() : null,
        finishTime: finishTime ? new Date(`${entryDate}T${finishTime}:00`).toISOString() : null,
        method,
        notes,
        estimatedVines,
        segments,
      });
      const dropped = Math.max(0, (res.requested ?? segments.length) - (res.attributed ?? 0));
      if (dropped > 0) {
        toast.warning(`${res.attributed}/${res.requested} quarters saved — ${dropped} were already completed and were skipped.`);
      } else {
        toast.success(`Recorded ${res.attributed} quarter${res.attributed === 1 ? "" : "s"}`);
      }

      if (createTask) {
        try {
          const linkTag = `\n\n[Pruning entry: ${res.entry_id}]`;
          const descParts = [
            rowSummary,
            `${segments.length} quarters · ${rowEquivalents.toFixed(2)} row equivalents · ~${estimatedVines.toLocaleString()} vines`,
            `Method: ${method}`,
            notes,
          ].filter(Boolean).join("\n");
          await createWorkTask({
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
            duration_hours: labourHours ? Number(labourHours) : 0,
            is_finalized: taskStatus === "Completed",
            user_id: user?.id ?? null,
          });
          toast.success("Linked Work Task created");
        } catch (e: any) {
          toast.error(`Pruning saved, but Work Task could not be created: ${e?.message ?? e}`);
          return; // keep dialog open so user can retry with checkbox
        }
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Failed to record: ${e?.message ?? e}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 gap-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle>Record Pruning — {paddockName}</DialogTitle>
          <DialogDescription>
            Select the rows and quarters completed. Already-completed quarters are locked to avoid double-counting.
            The date field determines when the work occurred.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px] px-6 pb-4 max-h-[70vh] overflow-y-auto">
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
                  const rn = r.identity.rowNumber;
                  const available = QUARTERS.filter((q) => !r.completed.has(q));
                  const allSel = available.length > 0 && available.every((q) => selected.has(key(rn, q)));
                  const doneAll = r.completed.size === 4;
                  return (
                    <div
                      key={r.identity.paddockRowId ?? rn}
                      className="grid grid-cols-[60px_44px_repeat(4,minmax(0,1fr))_64px] items-center gap-2 px-3 py-2 hover:bg-muted/30"
                    >
                      <div className="text-sm font-medium tabular-nums">{r.identity.rowLabel}</div>
                      <button
                        type="button"
                        className="h-11 w-11 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={doneAll}
                        onClick={() => toggleRow(rn)}
                        aria-label={`Toggle all quarters in row ${r.identity.rowLabel}`}
                      >
                        {allSel ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                      </button>
                      {QUARTERS.map((q) => {
                        const done = r.completed.has(q);
                        const isSel = selected.has(key(rn, q));
                        return (
                          <button
                            key={q}
                            type="button"
                            disabled={done}
                            onClick={() => toggleSegment(rn, q)}
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
                    Records the same labour, date, block and notes as a linked Work Task.
                  </p>
                </div>
                <Switch id="create-task" checked={createTask} onCheckedChange={setCreateTask} />
              </div>
              {createTask && (
                <div className="space-y-2 pt-1 border-t">
                  <div className="space-y-1.5">
                    <Label>Task title</Label>
                    <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <Select value={taskStatus} onValueChange={setTaskStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Completed">Completed</SelectItem>
                        <SelectItem value="In Progress">In Progress</SelectItem>
                        <SelectItem value="Planned">Planned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Type <b>Pruning</b> · Block <b>{paddockName}</b> · Date, worker, hours and notes reused from above.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sticky summary footer */}
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
