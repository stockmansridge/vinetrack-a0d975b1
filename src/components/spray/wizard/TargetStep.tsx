// Stage 3B — Target step: structured targets + head target.
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  HEAD_TARGETS,
  HEAD_TARGET_LABEL,
  SPRAY_TARGETS,
  SPRAY_TARGET_LABEL,
  headTargetAllowed,
} from "@/lib/sprayApplicationDomain";
import type { StepProps } from "./types";

export function TargetStep({ app, patch, canEdit }: StepProps) {
  const selected = app.targets ?? [];
  const toggle = (t: (typeof SPRAY_TARGETS)[number]) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    patch({ targets: next, ...(next.includes("other") ? {} : { otherTargetNote: null }) });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">What is being targeted?</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {SPRAY_TARGETS.map((t) => (
            <label
              key={t}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/40",
                selected.includes(t) && "border-primary bg-primary/5",
              )}
            >
              <Checkbox checked={selected.includes(t)} disabled={!canEdit} onCheckedChange={() => toggle(t)} />
              <span>{SPRAY_TARGET_LABEL[t]}</span>
            </label>
          ))}
        </div>
        {selected.includes("other") && (
          <div className="space-y-1">
            <Label htmlFor="other-target" className="text-xs">Describe the other target</Label>
            <Input
              id="other-target"
              disabled={!canEdit}
              value={app.otherTargetNote ?? ""}
              onChange={(e) => patch({ otherTargetNote: e.target.value || null })}
            />
          </div>
        )}
        {app.legacyTargetText && (
          <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
            Recorded previously as free text: “{app.legacyTargetText}”. Choosing targets above keeps this
            job's history intact while making it reportable.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Head target</h3>
        {headTargetAllowed(app.operationType) ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {HEAD_TARGETS.map((h) => (
              <button
                key={h}
                type="button"
                disabled={!canEdit}
                aria-pressed={app.headTarget === h}
                onClick={() => patch({ headTarget: app.headTarget === h ? null : h })}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm transition",
                  app.headTarget === h ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-muted/50",
                )}
              >
                {HEAD_TARGET_LABEL[h]}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Head target only applies to foliar applications.
          </p>
        )}
      </section>
    </div>
  );
}
