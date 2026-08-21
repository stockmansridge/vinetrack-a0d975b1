// Refresh from APVMA as a review action.
//
// The ingestion pipeline is owned by the shared VineTrack backend: when it
// re-runs it writes whatever it considers safe onto the Master record itself.
// The portal has no dry-run endpoint, so this dialog does the honest thing:
//   1. states exactly what the refresh will do before it runs,
//   2. snapshots the record beforehand,
//   3. shows a field-level before/after diff of what the backend changed,
//   4. never approves — the record stays in its existing review status.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { refreshFromApvma, type ApvmaImportResult } from "@/lib/masterChemicalImport";
import { diffMasterRows, hasMasterChanges, safeExternalUrl, type MasterFieldDiff } from "@/lib/masterReview";
import type { MasterChemicalRow } from "@/lib/masterChemicals";

function Cell({ value }: { value: string | null }) {
  const url = safeExternalUrl(value);
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-primary underline break-all">
        {value}
      </a>
    );
  }
  return <span className="break-words">{value ?? "—"}</span>;
}

export function MasterRefreshDialog({
  row,
  open,
  onOpenChange,
  invalidateKey,
  onRefreshed,
}: {
  row: MasterChemicalRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invalidateKey: readonly unknown[];
  onRefreshed?: (result: ApvmaImportResult, changed: boolean) => void;
}) {
  const qc = useQueryClient();
  const [diffs, setDiffs] = useState<MasterFieldDiff[] | null>(null);
  const [result, setResult] = useState<ApvmaImportResult | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      const before = row;
      const res = await refreshFromApvma(before);
      return { res, diffs: res.row ? diffMasterRows(before, res.row) : [] };
    },
    onSuccess: ({ res, diffs: d }) => {
      setResult(res);
      setDiffs(d);
      onRefreshed?.(res, hasMasterChanges(d));
      qc.invalidateQueries({ queryKey: invalidateKey });
    },
  });

  const changed = diffs ? diffs.filter((d) => d.changed) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setDiffs(null);
          setResult(null);
          run.reset();
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Refresh from APVMA</DialogTitle>
          <DialogDescription>
            Re-runs the VineTrack APVMA pipeline for{" "}
            {row.registered_product_name?.trim() || "this record"}
            {row.registration_number ? ` (${row.registration_number})` : ""}. The backend decides
            what is safe to update; the review status is never changed and Saved Chemicals are
            untouched. You will see a field-level before/after below.
          </DialogDescription>
        </DialogHeader>

        {run.isError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            {(run.error as any)?.message ?? String(run.error)}
          </div>
        )}

        {result && (
          <div className="rounded-md border border-border/60 p-2 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {result.outcome.replace(/_/g, " ")}
              </Badge>
              {diffs && (
                <span className="text-muted-foreground">
                  {changed.length === 0
                    ? "No field changed."
                    : `${changed.length} field(s) changed.`}
                </span>
              )}
            </div>
            <div className="mt-1 text-muted-foreground">{result.message}</div>
          </div>
        )}

        {diffs && (
          <div className="rounded-md border border-border/60 text-xs">
            <div className="border-b border-border/60 px-3 py-1.5 font-semibold">
              Before / after
            </div>
            <div className="divide-y divide-border/60">
              {diffs.map((d) => (
                <div
                  key={d.key}
                  className={`px-3 py-2 ${d.changed ? "bg-warning/10" : ""}`}
                >
                  <div className="font-medium">{d.label}</div>
                  <div className="mt-0.5 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
                    <div className="text-muted-foreground">
                      <Cell value={d.before} />
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                    <div className={d.changed ? "font-medium" : "text-muted-foreground"}>
                      <Cell value={d.after} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            {diffs ? "Fetch again" : "Fetch current APVMA data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
