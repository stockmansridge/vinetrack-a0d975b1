// Presentation of a VineTrack Master Catalogue product.
//
// Master results are visually distinct from AI candidates: they carry the
// verified badge, the registration identity, the label reference and the
// catalogue revision. AI candidates never render this card.
import { BadgeCheck, ExternalLink, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import {
  masterChemicalDraft,
  masterIdentityKey,
  masterRevision,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";

export function MasterChemicalCard({
  master,
  onApply,
  applyLabel = "Use this verified chemical",
  dense,
}: {
  master: MasterChemicalRow;
  onApply?: () => void;
  applyLabel?: string;
  dense?: boolean;
}) {
  const draft = masterChemicalDraft(master);
  const identity = masterIdentityKey(master);
  const revision = masterRevision(master);
  const label = master.label_reference?.trim();
  const hasLabelLink = !!label && /^https?:\/\//i.test(label);

  return (
    <div className="rounded border border-primary/30 bg-primary/5 p-2 text-xs space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold leading-tight">
            {master.registered_product_name?.trim() || "Unnamed product"}
          </div>
          <div className="text-muted-foreground">
            {master.registrant?.trim() || "Registrant unknown"}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
          <Badge className="gap-1 border-transparent bg-primary/15 text-primary text-[10px]">
            <BadgeCheck className="h-3 w-3" /> VineTrack verified
          </Badge>
          {master.registration_country && (
            <Badge variant="secondary" className="text-[10px]">
              {master.registration_country}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <span className="text-muted-foreground">Actives</span>
        <span>
          {draft.actives.length
            ? draft.actives
                .map((a) =>
                  [
                    a.name,
                    a.concentration != null
                      ? `${a.concentration} ${a.concentration_unit ?? ""}`.trim()
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" "),
                )
                .join(" + ")
            : "—"}
        </span>
        <span className="text-muted-foreground">Groups</span>
        <span>
          {draft.actives.length
            ? draft.actives
                .map((a) =>
                  a.activity_group?.code
                    ? `${a.activity_group.scheme?.toUpperCase?.() ?? ""} ${a.activity_group.code}`.trim()
                    : "—",
                )
                .join(", ")
            : "—"}
        </span>
        <span className="text-muted-foreground">Registration</span>
        <span>{identity ?? "—"}</span>
        {!dense && (
          <>
            <span className="text-muted-foreground">Registered uses</span>
            <span>{draft.registeredUses.length || "—"}</span>
            <span className="text-muted-foreground">Catalogue revision</span>
            <span>{revision ?? "—"}</span>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {hasLabelLink ? (
          <a
            href={label}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <FileText className="h-3 w-3" /> Label
          </a>
        ) : label ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ExternalLink className="h-3 w-3" /> {label}
          </span>
        ) : (
          <span className="text-[11px] italic text-muted-foreground">No label reference</span>
        )}
      </div>

      {onApply && (
        <Button type="button" size="sm" onClick={onApply} className="w-full">
          <Check className="h-3.5 w-3.5 mr-1" />
          {applyLabel}
        </Button>
      )}
    </div>
  );
}
