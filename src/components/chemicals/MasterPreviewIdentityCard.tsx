// Master Catalogue Review — identity guard explanation.
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  IDENTITY_GUARD_LABEL,
  formatIdentity,
  type MasterReviewPreview,
} from "@/lib/masterReviewPreview";
import type { MasterChemicalRow } from "@/lib/masterChemicals";

export function MasterPreviewIdentityCard({
  preview,
  row,
  blockedReason,
  reasonMissing,
}: {
  preview: MasterReviewPreview;
  row: MasterChemicalRow;
  blockedReason: string | null;
  reasonMissing: boolean;
}) {
  const ok = preview.identityGuard === "match";
  const stored =
    preview.identityStored ?? {
      country: row.registration_country ?? null,
      scheme: row.registration_scheme ?? null,
      number: row.registration_number ?? null,
      productName: row.registered_product_name ?? null,
    };
  const identityBlocks =
    preview.identityGuard === "mismatch" || preview.identityGuard === "rekey_required";

  return (
    <div
      className={`rounded-md border p-2 ${
        ok ? "border-border/60" : "border-warning/60 bg-warning/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={ok ? "secondary" : "destructive"} className="text-[10px]">
          {ok ? <ShieldCheck className="mr-1 h-3 w-3" /> : <ShieldAlert className="mr-1 h-3 w-3" />}
          {IDENTITY_GUARD_LABEL[preview.identityGuard]}
        </Badge>
        {preview.identityFailedCheck && (
          <span className="text-muted-foreground">
            Failed check: <span className="font-medium">{preview.identityFailedCheck}</span>
          </span>
        )}
        {!preview.identityFailedCheck && !ok && (
          <span className="text-muted-foreground">
            The resolver did not confirm the registration identity for this record.
          </span>
        )}
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="min-w-0 rounded border border-border/50 bg-background/60 p-2">
          <div className="text-[10px] text-muted-foreground">
            Current Master identity
          </div>
          <div className="break-words">{formatIdentity(stored)}</div>
        </div>
        <div className="min-w-0 rounded border border-border/50 bg-background/60 p-2">
          <div className="text-[10px] text-muted-foreground">
            Resolver identity
          </div>
          <div className="break-words">{formatIdentity(preview.identityResolved)}</div>
        </div>
      </div>

      {preview.identityGuardDetail && (
        <div className="mt-2 text-muted-foreground">{preview.identityGuardDetail}</div>
      )}

      <div className="mt-2 font-medium">
        {identityBlocks
          ? "Apply is blocked by the identity guard — the registration identity must be re-keyed before this preview can be applied."
          : blockedReason
            ? `Apply is blocked: ${blockedReason}`
            : reasonMissing
              ? "Apply is not blocked by identity — it only needs a review reason below."
              : "Apply is available."}
      </div>
    </div>
  );
}
