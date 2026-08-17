// Stage 3B — Growth stage step (E-L codes, shared list).
import { GROWTH_STAGES } from "@/lib/vspWaterRate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StepProps } from "./types";

export function GrowthStageStep({ app, patch, canEdit }: StepProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Growth stage</h3>
        {app.growthStageCode && canEdit && (
          <Button type="button" size="sm" variant="ghost" onClick={() => patch({ growthStageCode: null })}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Optional. Recording the stage helps with label compliance and reporting.
      </p>
      <div className="grid max-h-[46vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {GROWTH_STAGES.map((g) => (
          <button
            key={g.code}
            type="button"
            disabled={!canEdit}
            aria-pressed={app.growthStageCode === g.code}
            onClick={() => patch({ growthStageCode: g.code })}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition",
              app.growthStageCode === g.code
                ? "border-primary bg-primary/10 ring-2 ring-primary"
                : "hover:bg-muted/50",
            )}
          >
            <span className="font-medium">{g.code}</span>
            <span className="ml-2 text-muted-foreground">{g.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
