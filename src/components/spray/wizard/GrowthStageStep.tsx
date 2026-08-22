// Stage 3B — Growth stage step (E-L codes, shared list).
import { useState } from "react";
import { GROWTH_STAGES } from "@/lib/vspWaterRate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { growthStageImageAlt, growthStageImageUrl } from "@/lib/growthStageImages";
import { cn } from "@/lib/utils";
import type { StepProps } from "./types";

export function GrowthStageStep({ app, patch, canEdit }: StepProps) {
  const [zoom, setZoom] = useState<{ code: string; label: string; src: string } | null>(null);

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
        Optional. Recording the stage helps with label compliance and reporting. Click a thumbnail to enlarge.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {GROWTH_STAGES.map((g) => {
          const label = g.label.replace(/^EL\d+\s*—\s*/i, "");
          const src = growthStageImageUrl(g.code);
          const selected = app.growthStageCode === g.code;
          return (
            <div
              key={g.code}
              className={cn(
                "flex items-start gap-3 rounded-md border p-2 transition",
                selected ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-muted/50",
              )}
            >
              {src ? (
                <button
                  type="button"
                  aria-label={`Enlarge ${g.code} reference photo`}
                  onClick={() => setZoom({ code: g.code, label, src })}
                  className="shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <img
                    src={src}
                    alt={growthStageImageAlt(g.code, label)}
                    loading="lazy"
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded object-cover"
                  />
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  data-testid={`growth-stage-placeholder-${g.code}`}
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
                >
                  {g.code.replace(/^EL/i, "")}
                </span>
              )}
              <button
                type="button"
                disabled={!canEdit}
                aria-pressed={selected}
                aria-label={`Growth stage ${g.code}`}
                onClick={() => patch({ growthStageCode: g.code })}
                className="min-w-0 flex-1 text-left text-sm"
              >
                <span className="block text-xs font-semibold tabular-nums text-muted-foreground">{g.code}</span>
                <span className="block whitespace-normal">{label}</span>
              </button>
            </div>
          );
        })}
      </div>

      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {zoom?.code} — {zoom?.label}
            </DialogTitle>
          </DialogHeader>
          {zoom && (
            <img
              src={zoom.src}
              alt={growthStageImageAlt(zoom.code, zoom.label)}
              className="w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
