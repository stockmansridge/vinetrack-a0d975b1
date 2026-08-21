// Classified conflicts for a Master record.
//
// The screen must distinguish an automatically-resolved precedence conflict
// (authoritative source beat AI) from a genuine admin decision. Neither can be
// written from the portal today — there is no backend action for recording a
// per-field conflict resolution — so this surface is explicit about that.
import { AlertTriangle, ShieldCheck, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DATA_SOURCE_KIND_LABEL } from "@/lib/chemicalIntelligenceWrite";
import {
  MASTER_CONFLICT_CLASS_LABEL,
  safeExternalUrl,
  type ClassifiedConflict,
} from "@/lib/masterReview";

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

function ClassBadge({ item }: { item: ClassifiedConflict }) {
  const map = {
    decision_required: {
      cls: "border-transparent bg-destructive/15 text-destructive",
      Icon: AlertTriangle,
    },
    auto_resolved: { cls: "border-transparent bg-secondary text-secondary-foreground", Icon: ShieldCheck },
    unresolved_missing: { cls: "border-transparent bg-muted text-muted-foreground", Icon: CircleHelp },
  }[item.klass];
  const Icon = map.Icon;
  return (
    <Badge className={`${map.cls} text-[10px] gap-1 whitespace-nowrap`}>
      <Icon className="h-3 w-3" /> {MASTER_CONFLICT_CLASS_LABEL[item.klass]}
    </Badge>
  );
}

export function MasterConflictList({ items }: { items: ClassifiedConflict[] }) {
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
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium break-words">
                {item.conflict.field}
                {item.conflict.active_ingredient_name
                  ? ` · ${item.conflict.active_ingredient_name}`
                  : ""}
              </div>
              <ClassBadge item={item} />
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
          </div>
        ))}
      </div>
      {decisions.length > 0 && (
        <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          Selecting between competing values is not yet writable from the portal — the shared
          VineTrack backend exposes no per-field conflict resolution action. Record the decision in
          the review notes, or re-run the APVMA refresh so the backend resolves it.
        </div>
      )}
    </div>
  );
}
