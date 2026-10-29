// Catalogue match box for the Chemical Catalogue Review drawer (System Admin only).
// Match data comes from chemical_v3_admin_review_queue(); the Portal never merges on its own.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { pick, v3ReviewQueue } from "@/lib/chemicalV3";
import { catalogueRegistrationCheck } from "@/lib/chemicalV3ResearchHints";
import {
  MATCH_CONFIRM_TEXT, MATCH_TOAST, catalogueMatchOf, matchRevisionToCatalogue,
} from "@/lib/chemicalV3Review";

export function V3CatalogueMatch({ revisionId, isAdmin, onMatched, registrationNumber = null, productName = null }: {
  revisionId: string; isAdmin: boolean; onMatched: () => void; registrationNumber?: string | null; productName?: string | null;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const q = useQuery({ queryKey: ["chemical-v3-queue"], queryFn: v3ReviewQueue, enabled: isAdmin });
  const row = (q.data ?? []).find((r: any) => String(pick(r, "revision_id", "id")) === revisionId);
  const match = catalogueMatchOf(row);
  const mut = useMutation({
    mutationFn: () => matchRevisionToCatalogue(revisionId, match!.productId, null),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["chemical-v3-queue"] }),
        qc.invalidateQueries({ queryKey: ["chemical-v3-approved"] }),
        qc.invalidateQueries({ queryKey: ["saved_chemicals"] }),
        qc.invalidateQueries({ queryKey: ["saved-chemicals"] }),
      ]);
      toast.success(MATCH_TOAST);
      setConfirm(false);
      onMatched();
    },
  });
  if (!isAdmin || !match || dismissed) return null;
  const high = match.confidence === "high";
  // The match RPC does not yet verify registrations server-side; block known mismatches here.
  const regCheck = catalogueRegistrationCheck(
    { registration: registrationNumber, name: productName },
    { registration: pick(row, "catalogue_match_registration_number", "catalogue_match_registration"), name: match.name },
  );
  const blocked = regCheck === "mismatch";
  return (
    <section data-testid="v3-catalogue-match" data-confidence={match.confidence}
      className={high ? "space-y-2 rounded border border-primary/50 bg-primary/10 p-3 text-sm" : "space-y-2 rounded border border-warning/50 bg-warning/10 p-3 text-sm"}>
      <h3 className="font-semibold">{high ? "Already in the VineTrack catalogue" : "Possible catalogue match"}</h3>
      <p>{high
        ? "This newly discovered product appears to be the same product as an existing approved catalogue entry."
        : "This product looks similar to an existing VineTrack catalogue product. Check that they are the same product before matching them."}</p>
      <div className="rounded border bg-card p-2">
        <div className="text-xs text-muted-foreground">Existing catalogue product</div>
        <div className="font-medium">{match.name ?? "—"}</div>
        <div className="text-muted-foreground">{match.manufacturer ?? "—"}</div>
      </div>
      <p className="text-xs text-destructive" data-testid="v3-match-unsafe">
        Caution: matching does not yet check registrations on the server. Only match products with the exact same registration number — never on shared active ingredients or similar names.
      </p>
      {blocked && <p className="text-sm font-medium text-destructive" data-testid="v3-match-blocked">
        Registration mismatch — this revision and the catalogue product are different registered products. Matching is disabled.</p>}
      {mut.error && <p className="text-destructive">{(mut.error as Error).message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={mut.isPending || blocked} onClick={() => setConfirm(true)}>
          {high ? "Use existing catalogue product" : "Match to this catalogue product"}
        </Button>
        {high && <Button size="sm" variant="outline" onClick={() => setDismissed(true)}>Review this new revision instead</Button>}
      </div>
      <AlertDialog open={confirm} onOpenChange={(o) => !mut.isPending && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use the existing catalogue product?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{MATCH_CONFIRM_TEXT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={mut.isPending} onClick={(e) => { e.preventDefault(); if (!blocked) mut.mutate(); }}>
              Use existing catalogue product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
