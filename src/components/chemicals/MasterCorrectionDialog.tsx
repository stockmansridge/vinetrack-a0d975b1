// Admin correction of the SQL 203-supported Master fields.
//
// Manual corrections are never evidence: the backend records them as
// `manual_entry`. Registered uses, rates, WHP, REI, actives and activity
// groups are typed structures and are intentionally absent from this form.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilLine } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import {
  buildCorrectionPatch,
  correctMasterFields,
  correctableFieldsFor,
  identityFieldsCorrectable,
  type MasterActionResult,
  type MasterCorrectableField,
} from "@/lib/masterReviewActions";

const initialValue = (row: MasterChemicalRow, key: MasterCorrectableField, list?: boolean) => {
  const raw = (row as Record<string, any>)[key];
  if (Array.isArray(raw)) return raw.filter(Boolean).join(", ");
  return raw == null ? "" : String(raw);
};

export function MasterCorrectionDialog({
  row,
  open,
  onOpenChange,
  focusField,
  invalidateKey,
  onCorrected,
}: {
  row: MasterChemicalRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  focusField?: MasterCorrectableField | null;
  invalidateKey?: readonly unknown[];
  onCorrected?: (result: MasterActionResult) => void;
}) {
  const qc = useQueryClient();
  const fields = useMemo(() => correctableFieldsFor(row), [row]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initialValue(row, f.key, f.list)])),
  );
  const [reason, setReason] = useState("");

  const changed = fields.filter(
    (f) => (values[f.key] ?? "").trim() !== initialValue(row, f.key, f.list).trim(),
  );

  const mut = useMutation({
    mutationFn: () =>
      correctMasterFields({
        row,
        patch: buildCorrectionPatch(
          Object.fromEntries(changed.map((f) => [f.key, values[f.key] ?? ""])) as any,
        ) as any,
        reason,
      }),
    onSuccess: (res) => {
      const ok = res.outcome === "ok";
      toast({
        title: ok ? "Correction recorded" : "Not corrected",
        description: res.message,
        variant: ok ? undefined : "destructive",
      });
      if (ok) {
        if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey as unknown[] });
        onOpenChange(false);
      }
      onCorrected?.(res);
    },
    onError: (e: any) =>
      toast({ title: "Not corrected", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine className="h-4 w-4" /> Admin correction
          </DialogTitle>
          <DialogDescription>
            Only the fields the shared VineTrack backend accepts as manual corrections are shown.
            Corrections are stored as <span className="font-medium">manual entry</span> — they never
            become official evidence, and they never change registered uses, rates, withholding or
            re-entry data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label
                className={focusField === f.key ? "text-primary" : undefined}
                htmlFor={`correct-${f.key}`}
              >
                {f.label}
              </Label>
              {f.multiline ? (
                <Textarea
                  id={`correct-${f.key}`}
                  rows={3}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`correct-${f.key}`}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
              <div className="text-[11px] text-muted-foreground">{f.help}</div>
            </div>
          ))}

          {!identityFieldsCorrectable(row) && (
            <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] text-muted-foreground">
              Registrant and registered product name are locked because this record is no longer an
              unapproved candidate. Retire and re-create the record if the registration identity is
              wrong.
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="correct-reason">Reason (required)</Label>
            <Textarea
              id="correct-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this correction being made, and on what basis?"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={mut.isPending || changed.length === 0 || !reason.trim()}
            onClick={() => mut.mutate()}
          >
            Record correction{changed.length ? ` (${changed.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
