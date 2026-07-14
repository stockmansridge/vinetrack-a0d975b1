// Block pruning settings dialog. Scoped to a single block + the current
// vineyard season year (resolved from shared vineyard season settings).
// - No block picker (the caller already knows the block).
// - No season-year field (comes from shared settings).
// - Manual row count is hidden when the block has configured rows.
// - Archive is available only to system admins and clearly labelled.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { DAY_LABELS, ISO_DAY_NUMBERS } from "@/lib/pruningCalc";
import type { PruningSeason, SeasonUpsertInput } from "@/lib/pruningQuery";
import { useUpsertPruningSeason, useDeletePruningSeason } from "@/lib/pruningQuery";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  paddockId: string;
  paddockName: string;
  seasonYear: number;
  existing?: PruningSeason | null;
  hasConfiguredRows: boolean;
  isSystemAdmin?: boolean;
}

const METHODS = ["spur", "cane", "mechanical", "mixed"];

export default function SeasonDialog({
  open, onOpenChange, vineyardId, paddockId, paddockName, seasonYear,
  existing, hasConfiguredRows, isSystemAdmin,
}: Props) {
  const upsert = useUpsertPruningSeason(vineyardId);
  const softDelete = useDeletePruningSeason(vineyardId);

  const [startDate, setStartDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [method, setMethod] = useState<string>("spur");
  const [crew, setCrew] = useState<string>("");
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [manualRowCount, setManualRowCount] = useState<string>("");
  const [labourHours, setLabourHours] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setStartDate(existing.start_date ?? "");
      setDueDate(existing.due_date ?? "");
      setMethod(existing.pruning_method || "spur");
      setCrew(existing.assigned_crew ?? "");
      setWorkingDays(existing.working_days?.length ? existing.working_days : [1, 2, 3, 4, 5]);
      setManualRowCount(existing.manual_row_count?.toString() ?? "");
      setLabourHours(existing.estimated_labour_hours?.toString() ?? "");
      setNotes(existing.notes ?? "");
    } else {
      setStartDate("");
      setDueDate("");
      setMethod("spur");
      setCrew("");
      setWorkingDays([1, 2, 3, 4, 5]);
      setManualRowCount("");
      setLabourHours("");
      setNotes("");
    }
  }, [open, existing]);

  const toggleDay = (d: number) =>
    setWorkingDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const handleSubmit = async () => {
    const input: SeasonUpsertInput = {
      id: existing?.id,
      vineyard_id: vineyardId,
      paddock_id: paddockId,
      season_year: seasonYear,
      start_date: startDate || null,
      due_date: dueDate || null,
      pruning_method: method,
      assigned_crew: crew,
      working_days: workingDays,
      manual_row_count: hasConfiguredRows ? null : (manualRowCount ? Number(manualRowCount) : null),
      estimated_labour_hours: labourHours ? Number(labourHours) : null,
      notes,
      status: existing?.status ?? "active",
    };
    try {
      await upsert.mutateAsync(input);
      toast.success("Pruning settings saved");
      onOpenChange(false);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("pruning_seasons_active_unique") || msg.includes("duplicate")) {
        toast.error("This block already has settings for this season");
      } else {
        toast.error(`Failed to save: ${msg}`);
      }
    }
  };

  const handleArchive = async () => {
    if (!existing) return;
    if (!confirm(
      "Reset this block's pruning setup? Recorded pruning history is preserved, " +
      "but the block will return to an unconfigured state.",
    )) return;
    try {
      await softDelete.mutateAsync(existing.id);
      toast.success("Pruning setup reset");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Failed to reset: ${e?.message ?? e}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pruning settings — {paddockName}</DialogTitle>
          <DialogDescription>
            Season {seasonYear} · shared with iOS &amp; Android
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Pruning method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Assigned crew</Label>
            <Input value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="Crew or contractor" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-3 pt-1">
              {ISO_DAY_NUMBERS.map((d, i) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={workingDays.includes(d)} onCheckedChange={() => toggleDay(d)} />
                  {DAY_LABELS[i]}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Estimated labour hours</Label>
            <Input type="number" step="0.1" value={labourHours} onChange={(e) => setLabourHours(e.target.value)} />
          </div>

          {!hasConfiguredRows && (
            <div className="space-y-1.5">
              <Label>Manual row count</Label>
              <Input type="number" value={manualRowCount} onChange={(e) => setManualRowCount(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Used because this block has no saved row geometry.
              </p>
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {isSystemAdmin && existing && (
              <Button variant="ghost" className="text-destructive" onClick={handleArchive} disabled={softDelete.isPending}>
                Reset setup (admin)
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
