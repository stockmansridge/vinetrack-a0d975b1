// Classified conflicts for a Master record, each with an explicit action.
//
// R2-C2: an issue never looks actionable unless an action really exists. Where
// SQL 203 accepts an adjudication (`stored` / `superseded_by_refresh`) the row
// offers it; registration identity and typed/evidence-level conflicts say
// plainly that they cannot be resolved that way.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DATA_SOURCE_KIND_LABEL } from "@/lib/chemicalIntelligenceWrite";
import {
  MASTER_CONFLICT_CLASS_LABEL,
  safeExternalUrl,
  type ClassifiedConflict,
} from "@/lib/masterReview";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import {
  conflictAction,
  type MasterCorrectableField,
} from "@/lib/masterReviewActions";
import { MasterActionBadge } from "@/components/chemicals/MasterActionBadge";

function ValueText({ value }: { value: string | null }) {
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

export function MasterConflictList({
  items,
  row,
  onAdjudicate,
  onCorrect,
  onRefresh,
}: {
  items: ClassifiedConflict[];
  row?: MasterChemicalRow;
  onAdjudicate?: (item: ClassifiedConflict) => void;
  onCorrect?: (field: MasterCorrectableField) => void;
  onRefresh?: () => void;
}) {
  if (items.length === 0) return null;
  const decisions = items.filter((i) => i.klass === "decision_required");

  return (
    <div className="rounded-md border border-border/60">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
        <span>Evidence conflicts ({items.length})</span>
        <span className="font-normal text-muted-foreground">
          {decisions.length} needing a decision
        </span>
      </div>
      <div className="divide-y divide-border/60 text-xs">
        {items.map((item, i) => {
          const act = row ? conflictAction(item, row) : null;
          return (
            <div key={i} className="px-3 py-2 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium break-words">
                  {item.conflict.field}
                  {item.conflict.active_ingredient_name
                    ? ` · ${item.conflict.active_ingredient_name}`
                    : ""}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                    {MASTER_CONFLICT_CLASS_LABEL[item.klass]}
                  </Badge>
                  {act && <MasterActionBadge kind={act.kind} />}
                </div>
              </div>

              {item.klass === "decision_required" ? (
                <div className="space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">
                      {DATA_SOURCE_KIND_LABEL[item.conflict.authoritative_source]}:{" "}
                    </span>
                    <ValueText value={item.conflict.authoritative_value} />
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {DATA_SOURCE_KIND_LABEL[item.conflict.extracted_source]}:{" "}
                    </span>
                    <ValueText value={item.conflict.extracted_value} />
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Value in catalogue: </span>
                    <ValueText value={item.winningValue} />
                    {item.winningSource && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({DATA_SOURCE_KIND_LABEL[item.winningSource]})
                      </span>
                    )}
                  </div>
                  {item.rejectedValue && (
                    <div className="text-muted-foreground line-through decoration-muted-foreground/50">
                      Rejected evidence: {item.rejectedValue}
                      {item.rejectedSource
                        ? ` (${DATA_SOURCE_KIND_LABEL[item.rejectedSource]})`
                        : ""}
                    </div>
                  )}
                </div>
              )}

              <div className="text-[11px] text-muted-foreground/80">{item.explanation}</div>
              {act && (
                <div className="text-[11px] text-muted-foreground/80">{act.detail}</div>
              )}

              {act?.adjudicable && onAdjudicate && (
                <Button size="sm" variant="outline" onClick={() => onAdjudicate(item)}>
                  Record decision
                </Button>
              )}
              {act?.kind === "admin_correction_available" && act.correctField && onCorrect && (
                <Button size="sm" variant="outline" onClick={() => onCorrect(act.correctField!)}>
                  Correct {act.correctField.replace(/_/g, " ")}
                </Button>
              )}
              {act?.kind === "refresh_from_apvma" && onRefresh && (
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
