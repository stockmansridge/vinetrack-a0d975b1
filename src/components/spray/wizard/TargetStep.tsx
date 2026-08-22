// Stage 3B — Target step: structured targets + custom target library + head target.
//
// SQL 204: custom targets are vineyard-shared vocabulary. The identifier is
// always written to the draft's `targets`; adding it to the library is a
// best-effort convenience so the next operator can reuse the exact wording.
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { slugifySprayTarget, sprayTargetLabel } from "@/lib/sprayTargetLibrary";
import { useVineyardSprayTargets } from "@/hooks/useVineyardSprayTargets";
import type { StepProps } from "./types";

export function TargetStep({ app, patch, canEdit, vineyardId }: StepProps) {
  const selected = app.targets ?? [];
  const { labels, customOptions, addTarget } = useVineyardSprayTargets(vineyardId);
  const [newTarget, setNewTarget] = useState("");

  const toggle = (t: string) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    patch({ targets: next, ...(next.includes("other") ? {} : { otherTargetNote: null }) });
  };

  const addCustom = async () => {
    const label = newTarget.trim();
    const identifier = slugifySprayTarget(label);
    if (!identifier) return;
    setNewTarget("");
    // The tag is applied first: the library write is advisory and must never
    // decide whether the operator's target is recorded.
    if (!selected.includes(identifier)) patch({ targets: [...selected, identifier] });
    if (vineyardId) {
      try {
        await addTarget.mutateAsync(label);
      } catch {
        /* library unavailable — the identifier still lives on the spray */
      }
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
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

        {(customOptions.length > 0 || selected.some((t) => !(SPRAY_TARGETS as string[]).includes(t))) && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">This vineyard's targets</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from(
                new Set([
                  ...customOptions.map((o) => o.identifier),
                  ...selected.filter((t) => !(SPRAY_TARGETS as string[]).includes(t)),
                ]),
              ).map((identifier) => (
                <label
                  key={identifier}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/40",
                    selected.includes(identifier) && "border-primary bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={selected.includes(identifier)}
                    disabled={!canEdit}
                    onCheckedChange={() => toggle(identifier)}
                  />
                  <span>{sprayTargetLabel(identifier, labels)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {canEdit && (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-target" className="text-xs">
                Add a target this vineyard uses
              </Label>
              <Input
                id="new-target"
                placeholder="e.g. Eutypa Dieback"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addCustom();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!slugifySprayTarget(newTarget) || addTarget.isPending}
              onClick={() => void addCustom()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add target
            </Button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Targets you add are shared with everyone in this vineyard so the same wording is reused
          across the app.
        </p>

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
