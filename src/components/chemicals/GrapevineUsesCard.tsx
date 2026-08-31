// Grapevine-first display of the structured registered uses.
//
// Normal vineyard workflow only shows grapevine rows. Every other crop on the
// label is preserved and reachable through an explicit collapsed control — it
// is never dumped into the normal form.
//
// Presentation rules (screenshot corrections):
//   * the whole section starts COLLAPSED with a target count summary
//   * rows sharing an identical non-null direction_id render once, with their
//     target names listed together — different direction_id values never merge
//   * a missing-rate warning is shown ONCE for the whole section
//   * WHP / re-entry are shown once when every direction agrees
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import {
  NO_GRAPEVINE_RATE_MESSAGE,
  NOT_RESOLVED,
  grapevineUseView,
  normalGrapevineUses,
  partitionRegisteredUses,
  useDirectionId,
  useGroupKey,
} from "@/lib/chemicalGrapevineUses";

interface DirectionBlock {
  key: string;
  targets: string[];
  view: ReturnType<typeof grapevineUseView>;
}

/** Group by identical non-null direction_id; anything else stays separate. */
export function groupGrapevineDirections(uses: WriteRegisteredUse[]): DirectionBlock[] {
  const blocks: DirectionBlock[] = [];
  const byDirection = new Map<string, DirectionBlock>();
  uses.forEach((use, index) => {
    const view = grapevineUseView(use);
    const direction = useDirectionId(use);
    if (direction) {
      const existing = byDirection.get(direction);
      if (existing) {
        if (!existing.targets.includes(view.target)) existing.targets.push(view.target);
        return;
      }
      const block: DirectionBlock = { key: `direction:${direction}`, targets: [view.target], view };
      byDirection.set(direction, block);
      blocks.push(block);
      return;
    }
    blocks.push({ key: `${useGroupKey(use)}#${index}`, targets: [view.target], view });
  });
  return blocks;
}

function DirectionCard({ block, showPeriods }: { block: DirectionBlock; showPeriods: boolean }) {
  const v = block.view;
  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium leading-tight">{block.targets.join(", ")}</span>
        {v.conditionAmbiguous && (
          <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-500">
            Check label conditions
          </Badge>
        )}
      </div>
      {v.rates.length > 0 && (
        <div className="space-y-1">
          {v.rates.map((r, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{r.text}</span>
                <Badge variant="outline" className="text-[10px]">{r.basisLabel}</Badge>
              </div>
              {(r.label || r.condition) && (
                <div className="text-[11px] text-muted-foreground">
                  {[r.label, r.condition].filter(Boolean).join(" — ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {v.conditions && (
        <div className="text-[11px] text-muted-foreground">{v.conditions}</div>
      )}
      {showPeriods && (v.withholding !== NOT_RESOLVED || v.reEntry !== NOT_RESOLVED) && (
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          {v.withholding !== NOT_RESOLVED && <span>WHP: {v.withholding}</span>}
          {v.reEntry !== NOT_RESOLVED && <span>Re-entry: {v.reEntry}</span>}
        </div>
      )}
    </div>
  );
}

export function GrapevineUsesCard({
  uses,
  className,
  showOtherCrops = false,
}: {
  uses: WriteRegisteredUse[];
  className?: string;
  /**
   * Vineyard-first default: other crops on the label are NOT part of the normal
   * add / re-verify flow. Only an explicit full-label review opts in.
   */
  showOtherCrops?: boolean;
}) {
  // Normal display: rate-less duplicate regulator rows are suppressed when an
  // authoritative rated row exists for the same target. Nothing is deleted.
  const grapevine = normalGrapevineUses(uses);
  const { other } = partitionRegisteredUses(uses);
  const blocks = groupGrapevineDirections(grapevine);
  const [expanded, setExpanded] = useState(false);
  const [showOther, setShowOther] = useState(false);

  const anyRate = blocks.some((b) => b.view.rates.length > 0);
  const whps = Array.from(new Set(blocks.map((b) => b.view.withholding)));
  const reis = Array.from(new Set(blocks.map((b) => b.view.reEntry)));
  const sharedWhp = whps.length === 1 && whps[0] !== NOT_RESOLVED ? whps[0] : null;
  const sharedRei = reis.length === 1 && reis[0] !== NOT_RESOLVED ? reis[0] : null;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">
          Grapevine uses &amp; rates · {blocks.length} {blocks.length === 1 ? "target" : "targets"}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {/* One availability summary for the whole section. */}
      {!anyRate && (
        <p className="mt-1 text-xs text-muted-foreground">{NO_GRAPEVINE_RATE_MESSAGE}</p>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          {(sharedWhp || sharedRei) && (
            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {sharedWhp && <span>WHP: {sharedWhp}</span>}
              {sharedRei && <span>Re-entry: {sharedRei}</span>}
            </div>
          )}
          {blocks.map((b) => (
            <DirectionCard key={b.key} block={b} showPeriods={!sharedWhp && !sharedRei} />
          ))}
        </div>
      )}

      {showOtherCrops && other.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showOther ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Other crops on this label ({other.length})
          </button>
          {showOther && (
            <div className="mt-2 space-y-2">
              {other.map((u, i) => (
                <div key={i} className="rounded-md border border-border/50 p-2 text-xs">
                  <div className="font-medium">{u.crop || "Crop not stated"}</div>
                  <div className="text-muted-foreground">{u.target_raw || "Target not stated"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
