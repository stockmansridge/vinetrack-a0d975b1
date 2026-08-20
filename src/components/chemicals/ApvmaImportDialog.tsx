// System Admin — import an APVMA-registered product into the Master Catalogue.
//
// The ingestion itself is performed by the shared VineTrack backend. This
// dialog only submits an identity (registration number or registered product
// name), then shows what came back with full field-level evidence. Nothing is
// ever approved here: an import lands as a Candidate.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { MasterEvidencePanel } from "@/components/chemicals/MasterEvidencePanel";
import {
  importFromApvma,
  parseApvmaQuery,
  type ApvmaImportResult,
} from "@/lib/masterChemicalImport";
import { MASTER_REVIEW_STATUS_LABEL, type MasterChemicalRow } from "@/lib/masterChemicals";

export function ApvmaImportDialog({
  open,
  onOpenChange,
  onReview,
  invalidateKey,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onReview?: (row: MasterChemicalRow) => void;
  invalidateKey?: readonly unknown[];
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ApvmaImportResult | null>(null);
  const parsed = parseApvmaQuery(value);

  const mut = useMutation({
    mutationFn: () => importFromApvma(value),
    onSuccess: (res) => {
      setResult(res);
      if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
      toast({
        title:
          res.outcome === "identity_mismatch" || res.outcome === "unresolved"
            ? "Nothing imported"
            : "APVMA lookup complete",
        description: res.message,
        variant: res.outcome === "identity_mismatch" ? "destructive" : undefined,
      });
    },
    onError: (e: any) =>
      toast({
        title: "APVMA import failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setValue("");
          setResult(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from APVMA</DialogTitle>
          <DialogDescription>
            Search the live APVMA ingestion pipeline by registration number or registered product
            name. Imported records always land as Candidates — approval stays a manual step, and
            Saved Chemicals are never changed by an import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="e.g. 66541 or Custodia 320 SC"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && parsed && !mut.isPending) mut.mutate();
                }}
              />
            </div>
            <Button disabled={!parsed || mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Import
            </Button>
          </div>

          {parsed && (
            <div className="text-xs text-muted-foreground">
              Will search: {parsed.description}
            </div>
          )}

          {result && result.outcome === "identity_mismatch" && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Identity mismatch
              </div>
              <div className="mt-0.5 text-muted-foreground">{result.message}</div>
            </div>
          )}

          {result && result.outcome === "unresolved" && (
            <div className="rounded-md border border-border/60 p-2 text-xs text-muted-foreground">
              {result.message}
            </div>
          )}

          {result?.row && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">
                  {result.row.registered_product_name?.trim() || "Imported product"}
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {MASTER_REVIEW_STATUS_LABEL[
                    (result.row.review_status as "candidate") ?? "candidate"
                  ] ?? result.row.review_status}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  APVMA {result.row.registration_number ?? "—"}
                </Badge>
              </div>
              <MasterEvidencePanel row={result.row} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {result?.row && onReview && (
            <Button
              onClick={() => {
                onReview(result.row as MasterChemicalRow);
                onOpenChange(false);
              }}
            >
              Open for review
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
