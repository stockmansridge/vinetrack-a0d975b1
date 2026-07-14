import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckSquare, Square } from "lucide-react";
import type { PruningSeason, RecordSegmentInput } from "@/lib/pruningQuery";
import { useRecordPruningEntry } from "@/lib/pruningQuery";
import type { RowCompletionState } from "@/lib/pruningCalc";
import { parseRowRanges } from "@/lib/pruningCalc";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  season: PruningSeason;
  vineyardId: string;
  paddockId: string;
  paddockName: string;
  rows: RowCompletionState[]; // includes already-completed segments
}

const QUARTERS = [1, 2, 3, 4] as const;
const METHODS = ["spur", "cane", "mechanical", "mixed"];

type SelectionKey = string; // `${rowNumber}:${segment}`
const key = (r: number, s: number) => `${r}:${s}` as SelectionKey;

export default function CompleteTodayDialog({ open, onOpenChange, season, vineyardId, paddockId, paddockName, rows }: Props) {
  const record = useRecordPruningEntry(season.id);

  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [worker, setWorker] = useState("");
  const [labourHours, setLabourHours] = useState("");
  const [startTime, setStartTime] = useState("");
  const [finishTime, setFinishTime] = useState("");
  const [method, setMethod] = useState<string>(season.pruning_method);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set());
  const [rangeInput, setRangeInput] = useState("");

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
  }, [open, season]);

  const rowIndexByNumber = useMemo(() => {
    const m = new Map<number, RowCompletionState>();
    for (const r of rows) m.set(r.identity.rowNumber, r);
    return m;
  }, [rows]);
  const availableRowNumbers = useMemo(() => rows.map((r) => r.identity.rowNumber), [rows]);

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
    const allSelected = available.every((q) => selected.has(key(rowNumber, q)));
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
    const nums = parseRowRanges(rangeInput, availableRowNumbers);
    if (!nums.length) { toast.error("No matching rows"); return; }
    setSelected((cur) => {
      const next = new Set(cur);
      for (const n of nums) {
        const row = rowIndexByNumber.get(n);
        if (!row) continue;
        for (const q of QUARTERS) if (!row.completed.has(q)) next.add(key(n, q));
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

  // Build submission payload
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

  const handleSubmit = async () => {
    if (!segments.length) { toast.error("Select at least one quarter"); return; }
    if (!entryDate) { toast.error("Date is required"); return; }
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
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Failed to record: ${e?.message ?? e}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Complete pruning — {paddockName}</DialogTitle>
          <DialogDescription>
            Select the actual rows and quarters completed. Already-completed quarters are locked to avoid double-counting.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                className="w-56"
                placeholder="Row ranges e.g. 1-10, 15"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyRange())}
              />
              <Button variant="secondary" size="sm" onClick={applyRange}>Apply range</Button>
              <Button variant="outline" size="sm" onClick={selectAllIncomplete}>Select all incomplete</Button>
              <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
            </div>

            <ScrollArea className="h-[420px] rounded border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr>
                    <th className="w-12 p-2 text-left">Row</th>
                    <th className="w-8 p-2"></th>
                    {QUARTERS.map((q) => <th key={q} className="p-2 text-center">Q{q}</th>)}
                    <th className="p-2 text-right pr-3">Vines</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">
                      No rows configured for this block. Add row geometry or a manual row count.
                    </td></tr>
                  )}
                  {rows.map((r) => {
                    const rn = r.identity.rowNumber;
                    const available = QUARTERS.filter((q) => !r.completed.has(q));
                    const allSel = available.length > 0 && available.every((q) => selected.has(key(rn, q)));
                    const doneAll = r.completed.size === 4;
                    return (
                      <tr key={r.identity.paddockRowId ?? rn} className="border-t hover:bg-muted/30">
                        <td className="p-2 font-medium">{r.identity.rowLabel}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="text-muted-foreground disabled:opacity-40"
                            disabled={doneAll}
                            onClick={() => toggleRow(rn)}
                            aria-label="Toggle whole row"
                          >
                            {allSel ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                          </button>
                        </td>
                        {QUARTERS.map((q) => {
                          const done = r.completed.has(q);
                          const isSel = selected.has(key(rn, q));
                          return (
                            <td key={q} className="p-2 text-center">
                              <Checkbox
                                checked={done || isSel}
                                disabled={done}
                                onCheckedChange={() => toggleSegment(rn, q)}
                                aria-label={`Row ${rn} quarter ${q}`}
                              />
                              {done && <div className="text-[10px] text-muted-foreground">done</div>}
                            </td>
                          );
                        })}
                        <td className="p-2 text-right pr-3 tabular-nums text-muted-foreground">
                          {r.identity.estimatedVines || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="rounded border p-3 bg-muted/30">
              <div className="text-xs uppercase text-muted-foreground">Selected</div>
              <div className="text-2xl font-semibold tabular-nums">{rowEquivalents.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">row eq.</span></div>
              <div className="text-sm text-muted-foreground">{segments.length} quarters · ~{estimatedVines.toLocaleString()} vines</div>
            </div>

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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={record.isPending || segments.length === 0}>
            {record.isPending ? "Recording…" : `Record ${segments.length} quarter${segments.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
