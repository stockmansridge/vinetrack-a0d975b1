// Conspicuous approved-catalogue physical form / rate-unit check for a saved
// chemical, plus an explicit Owner/Manager correction preview. The confirm
// action stays disabled until the shared backend correction function exists.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/ios-supabase/client";
import { canManageChemicalInventory } from "@/lib/chemicalInventory";
import type { CatalogueReference } from "@/lib/chemicalCatalogueReference";
import { PHYSICAL_FORM_LABEL } from "@/lib/chemicalPhysicalForm";
import {
  SAVED_CHEMICAL_UNIT_CORRECTION_RPC,
  SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED,
  assessPhysicalUnit,
  buildUnitCorrectionArgs,
} from "@/lib/chemicalPhysicalUnitConsistency";

type Row = Record<string, any>;

export function PhysicalUnitConsistency({ row, reference, role }: { row: Row | null | undefined; reference: CatalogueReference | undefined; role: string | null | undefined }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const a = reference?.state === "approved" ? assessPhysicalUnit(row, reference.revision) : null;
  const canManage = canManageChemicalInventory(role);
  const mut = useMutation({
    mutationFn: async () => {
      if (!SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED) throw new Error("Correction is not available yet.");
      if (!canManage) throw new Error("Only an Owner or Manager can correct this product.");
      const args = a && row?.id ? buildUnitCorrectionArgs(row.id, a) : null;
      if (!args) throw new Error("This product is not eligible for correction.");
      const { data, error } = await (supabase as any).rpc(SAVED_CHEMICAL_UNIT_CORRECTION_RPC, args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["saved_chemicals"] });
      void qc.invalidateQueries({ queryKey: ["saved-chemicals"] });
      void qc.invalidateQueries({ queryKey: ["chemical-catalogue-reference"] });
    },
  });
  if (!a) return null;

  const rates = a.rateUnits.length ? a.rateUnits.map((r) => r.unit).join(", ") : "none listed";
  const summary = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" data-testid="physical-unit-summary">
      <dt className="text-muted-foreground">Approved catalogue formulation</dt>
      <dd className="font-medium">{a.catalogueProductForm ?? "Not stated"} · {PHYSICAL_FORM_LABEL[a.catalogueForm]}</dd>
      <dt className="text-muted-foreground">Catalogue rate units</dt>
      <dd className="font-medium">{rates}</dd>
      <dt className="text-muted-foreground">Saved in this vineyard</dt>
      <dd className="font-medium">unit {a.savedUnit ?? "—"} · form {a.savedProductForm ?? "—"} · pack {a.savedPackUnit ?? "—"}</dd>
    </dl>
  );

  if (!a.mismatch)
    return (
      <div className="rounded border p-3" data-testid="physical-unit-ok">
        <div className="mb-1 text-xs font-semibold">Physical form</div>
        {summary}
        {a.reasons.map((r) => <p key={r} className="mt-1 text-xs text-muted-foreground">{r}</p>)}
      </div>
    );

  return (
    <Alert variant="destructive" data-testid="physical-unit-mismatch">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Unit does not match the approved catalogue</AlertTitle>
      <AlertDescription className="space-y-2">
        <ul className="list-disc pl-4 text-xs">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {summary}
        <p className="text-xs">Spray calculations may refuse rates for this product until its unit is corrected.</p>
        {!a.correctionEligible ? (
          <p className="text-xs" data-testid="physical-unit-ineligible">{a.ineligibleReason}</p>
        ) : !canManage ? (
          <p className="text-xs" data-testid="physical-unit-role">Ask a vineyard Owner or Manager to review this product's unit.</p>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => { setAck(false); mut.reset(); setOpen(true); }}>
            Review unit correction
          </Button>
        )}
      </AlertDescription>
      <Dialog open={open} onOpenChange={(o) => !mut.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct saved unit to weight</DialogTitle>
            <DialogDescription>Only these fields on this vineyard product would change. Nothing is converted.</DialogDescription>
          </DialogHeader>
          <table className="w-full text-sm" data-testid="physical-unit-preview">
            <thead><tr className="text-left text-xs text-muted-foreground"><th>Field</th><th>Now</th><th>After</th></tr></thead>
            <tbody>
              {a.preview.map((p) => (
                <tr key={p.field}><td className="font-mono text-xs">{p.field}</td><td>{p.from ?? "—"}</td><td className="font-medium">{p.to}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            Not changed: past sprays and spray records, tank actuals, saved and preferred rates, density, pack size and pack unit,
            purchases, prices and inventory. Review pack details in Chemical Purchase afterwards.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} aria-label="I confirm this product is a dry formulation measured by weight" />
            <span>I confirm this product is a dry formulation measured by weight.</span>
          </label>
          {!SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED && (
            <p role="status" className="text-xs text-muted-foreground" data-testid="physical-unit-pending">
              This correction is not available yet: the VineTrack server step that checks permission and records the change is still being added.
            </p>
          )}
          {mut.isError && <p role="alert" className="text-xs text-destructive">{(mut.error as any)?.message ?? "The correction was refused."}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={mut.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!ack || mut.isPending || !SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED} onClick={() => mut.mutate()}>
              Confirm correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Alert>
  );
}
