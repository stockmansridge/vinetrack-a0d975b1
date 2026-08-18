// Master Catalogue update review.
//
// A Master change is NEVER applied silently. When the linked Master product
// has a newer catalogue revision, the grower is shown a structured,
// section-grouped diff of what would change and chooses explicitly. Declining
// keeps the saved chemical exactly as it is (and keeps the old revision, so
// the offer returns next time).
import { useMemo } from "react";
import { BadgeCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChemicalIntelligenceDraft } from "@/lib/chemicalIntelligenceWrite";
import { diffChemicalDrafts, SECTION_LABEL, type ReverifySection } from "@/lib/chemicalReverify";
import {
  masterChemicalDraft,
  masterRevision,
  LOCAL_COMMERCIAL_FIELDS,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";

const SECTIONS: ReverifySection[] = ["chemistry", "registration", "uses"];

export function MasterUpdateDialog({
  open,
  onOpenChange,
  current,
  master,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The saved chemical's current structured intelligence. */
  current: ChemicalIntelligenceDraft;
  master: MasterChemicalRow;
  /** Called only when the grower accepts. Receives the Master copy + revision. */
  onAccept: (next: ChemicalIntelligenceDraft, revision: number | null) => void;
}) {
  const proposed = useMemo(() => masterChemicalDraft(master), [master]);
  const diff = useMemo(() => diffChemicalDrafts(current, proposed), [current, proposed]);
  const revision = masterRevision(master) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Updated verified information available</DialogTitle>
          <DialogDescription>
            The VineTrack Master Catalogue entry for this product has been updated
            (revision {revision ?? "—"}). Review the changes below. Nothing is
            changed unless you accept.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge className="gap-1 border-transparent bg-primary/15 text-primary">
              <BadgeCheck className="h-3.5 w-3.5" /> VineTrack verified
            </Badge>
            <span className="font-medium">
              {master.registered_product_name?.trim() || "Master product"}
            </span>
          </div>

          {diff.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No differences in chemistry, registration or registered uses — accepting
              simply records the newer catalogue revision.
            </p>
          ) : (
            SECTIONS.map((section) => {
              const rows = diff.filter((d) => d.section === section);
              if (!rows.length) return null;
              return (
                <div key={section} className="rounded-md border border-border/60">
                  <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
                    {SECTION_LABEL[section]}
                  </div>
                  <div className="divide-y divide-border/60">
                    {rows.map((d, i) => (
                      <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 text-xs">
                        <div className="col-span-3 font-medium">{d.label}</div>
                        <div className="text-muted-foreground line-through">{d.before}</div>
                        <div className="text-muted-foreground">→</div>
                        <div className="font-medium">{d.after}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          <p className="text-[11px] text-muted-foreground">
            Your own commercial details ({LOCAL_COMMERCIAL_FIELDS.join(", ")}) are never
            changed by a catalogue update.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Keep my current information
          </Button>
          <Button
            type="button"
            onClick={() => {
              onAccept(proposed, revision);
              onOpenChange(false);
            }}
          >
            Accept verified update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
