// Stage 3B — Growth stage step (E-L codes, shared list).
//
// Selection uses the SAME shared SelectTile control as Application Type and
// Canopy & Spray Volume, so every choice in the wizard reads as a control.
// "Not set" is an explicit, selectable state: it stores `growthStageCode: null`
// exactly as an untouched job does — no sentinel code is ever invented.
import { useState } from "react";
import { GROWTH_STAGES } from "@/lib/vspWaterRate";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { growthStageImageAlt, growthStageImageUrl } from "@/lib/growthStageImages";
import { SelectTile } from "./controls";
import type { StepProps } from "./types";

export function GrowthStageStep({ app, patch, canEdit }: StepProps) {
  const [zoom, setZoom] = useState<{ code: string; label: string; src: string } | null>(null);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Growth stage</h3>
      <p className="text-xs text-muted-foreground">
        Optional. Recording the stage helps with label compliance and reporting. Click a thumbnail
        to enlarge.
      </p>

      <div role="radiogroup" aria-label="Growth stage" className="grid gap-3 grid-cols-2">
        <SelectTile
          className="col-span-2"
          selected={!app.growthStageCode}
          disabled={!canEdit}
          onSelect={() => patch({ growthStageCode: null })}
          title="Not set"
          hint="No growth stage is recorded for this application."
        />
        {GROWTH_STAGES.map((g) => {
          const label = g.label.replace(/^EL\d+\s*—\s*/i, "");
          const src = growthStageImageUrl(g.code);
          const selected = app.growthStageCode === g.code;
          return (
            <div key={g.code} className="flex items-start gap-2">
              <SelectTile
                className="flex-1"
                selected={selected}
                disabled={!canEdit}
                onSelect={() => patch({ growthStageCode: g.code })}
                title={g.code}
                hint={label}
              />
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
