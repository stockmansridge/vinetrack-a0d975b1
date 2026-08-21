// Unresolved / missing fields with an explicit action treatment.
//
// Every row says what an admin can actually do. A gap that has no available
// action says so plainly instead of looking like a pending task.
import { Button } from "@/components/ui/button";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import {
  unresolvedFieldAction,
  type MasterCorrectableField,
} from "@/lib/masterReviewActions";
import { MasterActionBadge } from "@/components/chemicals/MasterActionBadge";

export function MasterUnresolvedList({
  row,
  fields,
  onCorrect,
  onRefresh,
}: {
  row: MasterChemicalRow;
  fields: string[];
  onCorrect?: (field: MasterCorrectableField) => void;
  onRefresh?: () => void;
}) {
  if (!fields.length) return null;

  return (
    <div className="rounded-md border border-border/60">
      <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
        Unresolved fields ({fields.length})
      </div>
      <div className="divide-y divide-border/60 text-xs">
        {fields.map((field) => {
          const act = unresolvedFieldAction(field, row);
          return (
            <div key={field} className="px-3 py-2 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium break-words">{field}</span>
                <MasterActionBadge kind={act.kind} />
              </div>
              <div className="text-[11px] text-muted-foreground">{act.detail}</div>
              {act.kind === "admin_correction_available" && act.correctField && onCorrect && (
                <Button size="sm" variant="outline" onClick={() => onCorrect(act.correctField!)}>
                  Correct {act.correctField.replace(/_/g, " ")}
                </Button>
              )}
              {act.kind === "refresh_from_apvma" && onRefresh && (
                <Button size="sm" variant="outline" onClick={onRefresh}>
                  Preview APVMA update
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
