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
  partitionRegisteredUses,
} from "@/lib/chemicalGrapevineUses";

function UseCard({ use }: { use: WriteRegisteredUse }) {
  const v = grapevineUseView(use);
  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1.5">
      <div className="text-sm font-medium leading-tight">{v.target}</div>
      {v.rates.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{NO_GRAPEVINE_RATE_MESSAGE}</p>
      ) : (
        <div className="space-y-1">
          {v.rates.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{r.text}</span>
              <Badge variant="outline" className="text-[10px]">{r.basisLabel}</Badge>
              {r.condition && <span className="text-muted-foreground">{r.condition}</span>}
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
  const { grapevine, other } = partitionRegisteredUses(uses);
  const [showOther, setShowOther] = useState(false);

  return (
    <div className={className}>
      {grapevine.length === 0 ? (
        <p className="text-xs text-muted-foreground">{NO_GRAPEVINE_RATE_MESSAGE}</p>
      ) : (
        <div className="space-y-2">
          {grapevine.map((u, i) => (
            <UseCard key={i} use={u} />
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
