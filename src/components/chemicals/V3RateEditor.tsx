// Chemical Lookup V3 — System Admin rate option editor. Values are saved exactly
// as entered; the Portal never calculates or converts between /ha and /100 L.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildRateOptionArgs, type V3RateDraft } from "@/lib/chemicalV3";

export function V3RateEditor({
  draft, revisionId, busy, error, onCancel, onSave,
}: {
  draft: V3RateDraft | null;
  revisionId: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (d: V3RateDraft) => void;
}) {
  const [d, setD] = useState<V3RateDraft | null>(draft);
  const [localErr, setLocalErr] = useState<string | null>(null);
  useEffect(() => { setD(draft); setLocalErr(null); }, [draft]);
  if (!d) return null;
  const set = (k: keyof V3RateDraft, v: string) => setD({ ...d, [k]: v } as V3RateDraft);
  const submit = () => {
    const built = buildRateOptionArgs(revisionId, d);
    if ("error" in built) { setLocalErr(built.error); return; }
    setLocalErr(null);
    onSave(d);
  };
  const unitHint = d.basis === "per_hectare" ? "e.g. L/ha" : "e.g. mL/100 L";
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-lg" data-testid="v3-rate-editor">
        <DialogHeader><DialogTitle>{d.optionId ? "Edit rate" : "Add rate"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Basis</Label>
              <Select value={d.basis} onValueChange={(v) => set("basis", v)}>
                <SelectTrigger aria-label="Basis"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_hectare">Per hectare</SelectItem>
                  <SelectItem value="per_100_litres">Per 100 litres</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Rate type</Label>
              <Select value={d.rateType} onValueChange={(v) => set("rateType", v)}>
                <SelectTrigger aria-label="Rate type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="range">Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {d.rateType === "single" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="v3r-value">Rate</Label><Input id="v3r-value" inputMode="decimal" value={d.value} onChange={(e) => set("value", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="v3r-unit">Unit</Label><Input id="v3r-unit" placeholder={unitHint} value={d.unit} onChange={(e) => set("unit", e.target.value)} /></div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label htmlFor="v3r-min">Minimum</Label><Input id="v3r-min" inputMode="decimal" value={d.min} onChange={(e) => set("min", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="v3r-max">Maximum</Label><Input id="v3r-max" inputMode="decimal" value={d.max} onChange={(e) => set("max", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="v3r-unit">Unit</Label><Input id="v3r-unit" placeholder={unitHint} value={d.unit} onChange={(e) => set("unit", e.target.value)} /></div>
            </div>
          )}
          <div className="space-y-1"><Label htmlFor="v3r-targets">Targets (one per line)</Label><Textarea id="v3r-targets" rows={3} value={d.targets} onChange={(e) => set("targets", e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="v3r-method">Application method</Label><Input id="v3r-method" value={d.method} onChange={(e) => set("method", e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="v3r-cond">Condition</Label><Input id="v3r-cond" value={d.condition} onChange={(e) => set("condition", e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="v3r-notes">Printed wording / notes</Label><Textarea id="v3r-notes" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          {(localErr || error) && <p className="text-sm text-destructive">{localErr || error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save rate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
