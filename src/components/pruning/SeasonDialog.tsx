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

interface Paddock { id: string; name: string | null }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  paddocks: Paddock[];
  existing?: PruningSeason | null;
  defaultPaddockId?: string | null;
}

const METHODS = ["spur", "cane", "mechanical", "mixed"];

export default function SeasonDialog({ open, onOpenChange, vineyardId, paddocks, existing, defaultPaddockId }: Props) {
  const upsert = useUpsertPruningSeason(vineyardId);
  const softDelete = useDeletePruningSeason(vineyardId);
  const isEdit = !!existing;
  const currentYear = new Date().getUTCFullYear();

  const [paddockId, setPaddockId] = useState<string>("");
  const [year, setYear] = useState<number>(currentYear);
  const [startDate, setStartDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [method, setMethod] = useState<string>("spur");
  const [crew, setCrew] = useState<string>("");
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [manualRowCount, setManualRowCount] = useState<string>("");
  const [labourHours, setLabourHours] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [status, setStatus] = useState<"active" | "complete" | "archived">("active");

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setPaddockId(existing.paddock_id);
      setYear(existing.season_year);
      setStartDate(existing.start_date ?? "");
      setDueDate(existing.due_date ?? "");
      setMethod(existing.pruning_method);
      setCrew(existing.assigned_crew ?? "");
      setWorkingDays(existing.working_days ?? [1, 2, 3, 4, 5]);
      setManualRowCount(existing.manual_row_count?.toString() ?? "");
      setLabourHours(existing.estimated_labour_hours?.toString() ?? "");
      setNotes(existing.notes ?? "");
      setStatus(existing.status);
    } else {
      setPaddockId(defaultPaddockId ?? "");
      setYear(currentYear);
      setStartDate(new Date().toISOString().slice(0, 10));
      setDueDate("");
      setMethod("spur");
      setCrew("");
      setWorkingDays([1, 2, 3, 4, 5]);
      setManualRowCount("");
      setLabourHours("");
      setNotes("");
      setStatus("active");
    }
  }, [open, existing, defaultPaddockId, currentYear]);

  const toggleDay = (d: number) => setWorkingDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const handleSubmit = async () => {
    if (!paddockId) { toast.error("Choose a block"); return; }
    if (!year || year < 1900 || year > 2200) { toast.error("Enter a valid season year"); return; }
    const input: SeasonUpsertInput = {
      id: existing?.id,
      vineyard_id: vineyardId,
      paddock_id: paddockId,
      season_year: year,
      start_date: startDate || null,
      due_date: dueDate || null,
      pruning_method: method,
      assigned_crew: crew,
      working_days: workingDays,
      manual_row_count: manualRowCount ? Number(manualRowCount) : null,
      estimated_labour_hours: labourHours ? Number(labourHours) : null,
      notes,
      status,
    };
    try {
      await upsert.mutateAsync(input);
      toast.success(isEdit ? "Season updated" : "Season created");
      onOpenChange(false);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("pruning_seasons_active_unique") || msg.includes("duplicate")) {
        toast.error("This block already has a season for that year");
      } else {
        toast.error(`Failed to save: ${msg}`);
      }
    }
  };

  const handleArchive = async () => {
    if (!existing) return;
    if (!confirm("Archive this pruning season? Progress will be preserved but the season will no longer be visible.")) return;
    try {
      await softDelete.mutateAsync(existing.id);
      toast.success("Season archived");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Failed to archive: ${e?.message ?? e}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit pruning season" : "New pruning season"}</DialogTitle>
          <DialogDescription>
            One active season per block per year. Crews and mobile apps immediately see updates.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Block</Label>
            <Select value={paddockId} onValueChange={setPaddockId} disabled={isEdit}>
              <SelectTrigger><SelectValue placeholder="Choose a block" /></SelectTrigger>
              <SelectContent>
                {paddocks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name ?? "Unnamed block"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Season year</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={isEdit} />
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
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Assigned crew</Label>
            <Input value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="Crew name or contractor" />
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
            <Label>Manual row count (fallback)</Label>
            <Input type="number" value={manualRowCount} onChange={(e) => setManualRowCount(e.target.value)}
                   placeholder="Only used when the block has no configured rows" />
          </div>
          <div className="space-y-1.5">
            <Label>Estimated labour hours</Label>
            <Input type="number" step="0.1" value={labourHours} onChange={(e) => setLabourHours(e.target.value)} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {isEdit && (
            <Button variant="destructive" onClick={handleArchive} disabled={softDelete.isPending}>
              Archive season
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : isEdit ? "Save changes" : "Create season"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
