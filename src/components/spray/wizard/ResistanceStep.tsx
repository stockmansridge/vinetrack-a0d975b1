// Stage 3B — Resistance Check placeholder step.
//
// Stage 3C owns rotation rules and season history. This step only surfaces the
// structured activity groups already carried on each product line so the seam
// exists and the workflow order is final. No rule is evaluated here.
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { activityGroupSummary } from "@/lib/chemicalIntelligence";
import type { StepProps } from "./types";

export function ResistanceStep({ app, intelligenceById }: StepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <div className="font-medium">Resistance check is coming next</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Rotation warnings and season history are part of the next stage. The activity groups below
            travel with this application already, so nothing needs to be re-entered later.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Activity groups in this mix</h3>
        {app.products.length === 0 && (
          <p className="text-xs text-muted-foreground">No products added.</p>
        )}
        {app.products.map((line, i) => {
          const intel = line.savedChemicalId ? intelligenceById.get(line.savedChemicalId) ?? null : null;
          const summary = intel ? activityGroupSummary(intel) : null;
          const fallback = line.activityGroups
            .map((g) => `${g.scheme.toUpperCase()} ${g.code}`)
            .join(", ");
          return (
            <div key={i} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="truncate">{line.productName ?? "Product not set"}</span>
              {summary || fallback ? (
                <Badge variant="outline">{summary || fallback}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">No activity group recorded</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
