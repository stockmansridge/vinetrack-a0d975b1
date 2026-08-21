// Guarded registration identity correction (SQL 203 `master_review_rekey`).
//
// Offered for unapproved candidates with no linked Saved Chemicals only.
// Approved or linked records must be retired and re-created — a grower's saved
// chemistry is never silently re-pointed at a different registration.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldAlert } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { masterIdentityKey, type MasterChemicalRow } from "@/lib/masterChemicals";
import {
  countLinkedSavedChemicals,
  rekeyEligibility,
  rekeyMasterIdentity,
  type MasterActionResult,
} from "@/lib/masterReviewActions";

export function MasterIdentityRekeyDialog({
  row,
  open,
  onOpenChange,
  invalidateKey,
  onRekeyed,
}: {
  row: MasterChemicalRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invalidateKey?: readonly unknown[];
  onRekeyed?: (result: MasterActionResult) => void;
}) {
  const qc = useQueryClient();
  const [country, setCountry] = useState(row.registration_country ?? "");
  const [scheme, setScheme] = useState(row.registration_scheme ?? "");
  const [number, setNumber] = useState(row.registration_number ?? "");
  const [reason, setReason] = useState("");

  const linked = useQuery({
    queryKey: ["master-linked-saved", row.id],
    enabled: open,
    queryFn: () => countLinkedSavedChemicals(row.id),
  });

  const eligibility = rekeyEligibility(
    row,
    linked.isLoading ? null : (linked.data ?? (linked.error ? 1 : 0)),
  );

  const mut = useMutation({
    mutationFn: () => rekeyMasterIdentity({ row, country, scheme, number, reason }),
    onSuccess: (res) => {
      const ok = res.outcome === "ok";
      toast({
        title: ok ? "Registration identity corrected" : "Not re-keyed",
        description: res.message,
        variant: ok ? undefined : "destructive",
      });
      if (ok) {
        if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey as unknown[] });
        onOpenChange(false);
      }
      onRekeyed?.(res);
    },
    onError: (e: any) =>
      toast({ title: "Not re-keyed", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Correct registration identity
          </DialogTitle>
          <DialogDescription>
            Current identity: {masterIdentityKey(row) ?? "none recorded"}. Re-keying is guarded by
            the backend and is only ever available for an unapproved candidate that no Saved
            Chemical is linked to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div
            className={`rounded-md border p-2 text-[11px] ${
              eligibility.allowed
                ? "border-border/60 bg-muted/40 text-muted-foreground"
                : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
          >
            <span className="inline-flex items-center gap-1 font-medium">
              {!eligibility.allowed && <ShieldAlert className="h-3.5 w-3.5" />}
              {eligibility.reason}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="rekey-country">Country</Label>
              <Input
                id="rekey-country"
                value={country}
                disabled={!eligibility.allowed}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rekey-scheme">Scheme</Label>
              <Input
                id="rekey-scheme"
                value={scheme}
                disabled={!eligibility.allowed}
                onChange={(e) => setScheme(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rekey-number">Number</Label>
              <Input
                id="rekey-number"
                value={number}
                disabled={!eligibility.allowed}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rekey-reason">Reason (required)</Label>
            <Textarea
              id="rekey-reason"
              rows={2}
              disabled={!eligibility.allowed}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!eligibility.allowed || mut.isPending || !reason.trim()}
            onClick={() => mut.mutate()}
          >
            Re-key registration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
