// Conflict adjudication (SQL 203 `master_review_adjudicate`).
//
// Only two decisions exist: the stored value stands, or the conflict was
// superseded by a later authoritative refresh. Selecting an authoritative
// value is intentionally NOT exposed — the backend returns
// `typed_handler_missing` for it — and registration identity conflicts are
// never adjudicated generically.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import { DATA_SOURCE_KIND_LABEL } from "@/lib/chemicalIntelligenceWrite";
import type { ClassifiedConflict } from "@/lib/masterReview";
import {
  adjudicateMasterConflict,
  MASTER_ADJUDICATION_HELP,
  MASTER_ADJUDICATION_LABEL,
  type MasterActionResult,
  type MasterAdjudicationDecision,
} from "@/lib/masterReviewActions";

const DECISIONS: MasterAdjudicationDecision[] = ["stored", "superseded_by_refresh"];

export function MasterAdjudicateDialog({
  row,
  item,
  open,
  onOpenChange,
  invalidateKey,
  onAdjudicated,
}: {
  row: MasterChemicalRow;
  item: ClassifiedConflict | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invalidateKey?: readonly unknown[];
  onAdjudicated?: (result: MasterActionResult) => void;
}) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<MasterAdjudicationDecision>("stored");
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      adjudicateMasterConflict({
        row,
        field: String(item?.conflict.field ?? ""),
        conflict: (item?.conflict ?? {}) as Record<string, unknown>,
        decision,
        reason,
      }),
    onSuccess: (res) => {
      const ok = res.outcome === "ok";
      toast({
        title: ok ? "Decision recorded" : "Not recorded",
        description: res.message,
        variant: ok ? undefined : "destructive",
      });
      if (ok) {
        if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey as unknown[] });
        onOpenChange(false);
      }
      onAdjudicated?.(res);
    },
    onError: (e: any) =>
      toast({ title: "Not recorded", description: e?.message ?? String(e), variant: "destructive" }),
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" /> Adjudicate conflict
          </DialogTitle>
          <DialogDescription>
            Field: <span className="font-medium">{String(item.conflict.field)}</span>. Recording a
            decision does not overwrite chemistry — the backend logs which evidence stands.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border/60 p-2 text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">
                {DATA_SOURCE_KIND_LABEL[item.conflict.authoritative_source]}:{" "}
              </span>
              {item.conflict.authoritative_value ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">
                {DATA_SOURCE_KIND_LABEL[item.conflict.extracted_source]}:{" "}
              </span>
              {item.conflict.extracted_value ?? "—"}
            </div>
          </div>

          <RadioGroup
            value={decision}
            onValueChange={(v) => setDecision(v as MasterAdjudicationDecision)}
            className="space-y-2"
          >
            {DECISIONS.map((d) => (
              <div key={d} className="flex items-start gap-2">
                <RadioGroupItem value={d} id={`adj-${d}`} className="mt-1" />
                <Label htmlFor={`adj-${d}`} className="font-normal">
                  <span className="font-medium">{MASTER_ADJUDICATION_LABEL[d]}</span>
                  <div className="text-[11px] text-muted-foreground">
                    {MASTER_ADJUDICATION_HELP[d]}
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>

          <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] text-muted-foreground">
            Choosing a specific authoritative value is not available in this release — the backend
            returns <span className="font-mono">typed_handler_missing</span> for evidence-level
            selection.
          </div>

          <div className="space-y-1">
            <Label htmlFor="adj-reason">Reason (required)</Label>
            <Textarea
              id="adj-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={mut.isPending || !reason.trim()} onClick={() => mut.mutate()}>
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
