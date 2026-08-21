// Master Catalogue Review — R2-C1 staged Preview + Apply dialog.
//
// Preview asks the shared VineTrack resolver for a server-side preview; the
// proposed patch shown here is DISPLAY ONLY and is never sent back. Apply
// requires a review reason and calls `master_review_apply(preview_id,
// master_id, reason)` with the signed-in admin's JWT.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Upload } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MasterPreviewFieldDiff } from "@/components/chemicals/MasterPreviewFieldDiff";
import { MasterPreviewUsesDiff } from "@/components/chemicals/MasterPreviewUsesDiff";
import { MasterPreviewIdentityCard } from "@/components/chemicals/MasterPreviewIdentityCard";
import { isRegisteredUsesField } from "@/lib/masterPreviewDiff";
import {
  applyMasterReviewPreview,
  previewApplyBlockedReason,
  previewExpired,
  requestMasterReviewPreview,
  type MasterApplyResult,
  type MasterReviewPreview,
} from "@/lib/masterReviewPreview";
import { masterRevision, type MasterChemicalRow } from "@/lib/masterChemicals";

export function MasterReviewPreviewDialog({
  row,
  open,
  onOpenChange,
  invalidateKey,
  onApplied,
}: {
  row: MasterChemicalRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invalidateKey: readonly unknown[];
  onApplied?: (result: MasterApplyResult) => void;
}) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<MasterReviewPreview | null>(null);
  const [reason, setReason] = useState("");
  const [applyResult, setApplyResult] = useState<MasterApplyResult | null>(null);

  const previewMut = useMutation({
    mutationFn: () => requestMasterReviewPreview(row),
    onSuccess: (p) => {
      setPreview(p);
      setApplyResult(null);
    },
  });

  const applyMut = useMutation({
    mutationFn: () =>
      applyMasterReviewPreview({
        previewId: preview?.previewId ?? "",
        masterId: row.id,
        reason,
      }),
    onSuccess: (res) => {
      setApplyResult(res);
      onApplied?.(res);
      if (res.outcome === "applied" || res.outcome === "already_applied") {
        // Reload the Master row and its version history.
        qc.invalidateQueries({ queryKey: invalidateKey });
        qc.invalidateQueries({ queryKey: [...invalidateKey, "versions", row.id] });
      }
    },
  });

  const blocked = preview ? previewApplyBlockedReason(preview) : null;
  const scalarChanges = (preview?.changes ?? []).filter((c) => !isRegisteredUsesField(c.field));
  const useChanges = (preview?.changes ?? []).filter((c) => isRegisteredUsesField(c.field));
  const applied = applyResult?.outcome === "applied" || applyResult?.outcome === "already_applied";

  const reset = () => {
    setPreview(null);
    setReason("");
    setApplyResult(null);
    previewMut.reset();
    applyMut.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="w-[95vw] max-w-4xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Preview APVMA update</DialogTitle>
          <DialogDescription>
            Asks the VineTrack resolver for a server-side preview of{" "}
            {row.registered_product_name?.trim() || "this record"}
            {row.registration_number ? ` (${row.registration_number})` : ""}. Nothing is written
            until you supply a review reason and apply the stored preview. The proposed values
            below are display only — the portal never sends a patch back.
          </DialogDescription>
        </DialogHeader>

        {previewMut.isError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            {(previewMut.error as any)?.message ?? String(previewMut.error)}
          </div>
        )}
        {applyMut.isError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            {(applyMut.error as any)?.message ?? String(applyMut.error)}
          </div>
        )}

        {applyResult && (
          <div
            className={`rounded-md border p-2 text-xs ${
              applied
                ? "border-primary/40 bg-primary/10"
                : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {applyResult.outcome.replace(/_/g, " ")}
              </Badge>
              {applied && (
                <span>
                  Revision now{" "}
                  {applyResult.revision ?? masterRevision(applyResult.row ?? undefined) ?? "—"}
                </span>
              )}
            </div>
            <div className="mt-1">{applyResult.message}</div>
          </div>
        )}

        {preview && (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2">
              <Badge variant="outline" className="text-[10px]">
                base revision {preview.baseRevision ?? masterRevision(row) ?? "—"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {preview.expiresAt
                  ? `${previewExpired(preview) ? "expired" : "expires"} ${new Date(
                      preview.expiresAt,
                    ).toLocaleString()}`
                  : "no expiry reported"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                preview {preview.previewId ? preview.previewId.slice(0, 8) : "none"}
              </Badge>
            </div>

            <MasterPreviewIdentityCard
              preview={preview}
              row={row}
              blockedReason={blocked}
              reasonMissing={!reason.trim()}
            />

            {preview.message && <div className="text-muted-foreground">{preview.message}</div>}

            <div className="rounded-md border border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5 font-semibold">
                <span>Proposed changes ({preview.changes.length})</span>
                <span className="font-normal text-muted-foreground">
                  display only — the portal never sends a patch
                </span>
              </div>
              {preview.changes.length === 0 ? (
                <div className="px-3 py-2 text-muted-foreground">
                  The resolver proposed no changes to this record.
                </div>
              ) : (
                <div className="space-y-3 p-3">
                  <MasterPreviewFieldDiff changes={scalarChanges} />
                  {useChanges.map((c) => (
                    <MasterPreviewUsesDiff
                      key={c.field}
                      label={c.label}
                      current={c.currentRaw ?? preview.currentValues[c.field] ?? c.current}
                      proposed={c.proposedRaw ?? preview.proposedPatch[c.field] ?? c.proposed}
                    />
                  ))}
                </div>
              )}
            </div>

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  Show technical JSON (debugging only)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2 text-[10px] leading-relaxed">
                  {JSON.stringify(
                    { current_values: preview.currentValues, proposed_patch: preview.proposedPatch },
                    null,
                    2,
                  )}
                </pre>
              </CollapsibleContent>
            </Collapsible>

            {blocked && (
              <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                <span>{blocked}</span>
              </div>
            )}

            {!blocked && !applied && (
              <div>
                <div className="mb-1 text-muted-foreground">
                  Review reason (required — recorded against the new revision)
                </div>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. APVMA label updated: new WHP and eLabel reference"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={previewMut.isPending || applyMut.isPending}
            onClick={() => previewMut.mutate()}
          >
            {previewMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            {preview ? "Preview again" : "Preview from APVMA"}
          </Button>
          <Button
            disabled={
              !preview ||
              !!blocked ||
              applied ||
              !reason.trim() ||
              applyMut.isPending ||
              previewMut.isPending
            }
            onClick={() => applyMut.mutate()}
          >
            {applyMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Apply preview
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
