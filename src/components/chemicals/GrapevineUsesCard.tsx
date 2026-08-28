// Grapevine-first display of the structured registered uses.
//
// Normal vineyard workflow only shows grapevine rows. Every other crop on the
// label is preserved and reachable through an explicit collapsed control — it
// is never dumped into the normal form.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import {
  NO_GRAPEVINE_RATE_MESSAGE,
  grapevineUseView,
  normalGrapevineUses,
  partitionRegisteredUses,
  useGroupKey,
} from "@/lib/chemicalGrapevineUses";

function UseCard({ use }: { use: WriteRegisteredUse }) {
  const v = grapevineUseView(use);
  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium leading-tight">{v.target}</span>
        {v.conditionAmbiguous && (
          <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-500">
            Check label conditions
          </Badge>
        )}
      </div>
      {v.rates.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{NO_GRAPEVINE_RATE_MESSAGE}</p>
      ) : (
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
      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span>WHP: {v.withholding}</span>
        <span>Re-entry: {v.reEntry}</span>
      </div>
    </div>
  );
}

export function GrapevineUsesCard({
  uses,
  className,
}: {
  uses: WriteRegisteredUse[];
  className?: string;
}) {
  // Normal display: rate-less duplicate regulator rows are suppressed when an
  // authoritative rated row exists for the same target. Nothing is deleted.
  const grapevine = normalGrapevineUses(uses);
  const { other } = partitionRegisteredUses(uses);
  const [showOther, setShowOther] = useState(false);


  return (
    <div className={className}>
      {grapevine.length === 0 ? (
        <p className="text-xs text-muted-foreground">{NO_GRAPEVINE_RATE_MESSAGE}</p>
      ) : (
        <div className="space-y-2">
          {/* Keyed by DIRECTION identity — two legal directions for the same
              target both survive and are never unioned. */}
          {grapevine.map((u, i) => (
            <UseCard key={`${useGroupKey(u)}#${i}`} use={u} />
          ))}
        </div>
      )}

      {other.length > 0 && (
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
