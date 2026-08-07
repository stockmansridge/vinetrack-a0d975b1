// Growth Stage picker — reuses the existing shared E-L growth-stage catalogue
// (`GROWTH_STAGES` in src/lib/vspWaterRate.ts), the same source and stored
// identifiers used by Spray Jobs and the Growth Stage records report.
// No second catalogue is defined here.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GROWTH_STAGES } from "@/lib/vspWaterRate";
import { growthStageImageAlt, growthStageImageUrl } from "@/lib/growthStageImages";


export default function GrowthStagePickerDialog({
  open,
  onOpenChange,
  value,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value?: string | null;
  onSelect: (code: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string | null>(value ?? null);

  useEffect(() => {
    if (!open) return;
    setFilter("");
    setPicked(value ?? null);
  }, [open, value]);

  const stages = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return GROWTH_STAGES;
    return GROWTH_STAGES.filter((s) => s.label.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select growth stage</DialogTitle>
          <DialogDescription>
            Modified E-L stages — the same list used across VineTrack.
          </DialogDescription>
        </DialogHeader>

        <Input
          aria-label="Search growth stages"
          placeholder="Search stage"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="grid gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {stages.map((s) => {
            const src = growthStageImageUrl(s.code);
            return (
              <button
                key={s.code}
                type="button"
                aria-label={`Growth stage ${s.code}`}
                onClick={() => setPicked(s.code)}
                className={`flex items-start gap-3 rounded-md border p-2 text-left text-sm transition-colors ${
                  picked === s.code ? "border-primary bg-accent" : "hover:bg-muted"
                }`}
              >
                {src ? (
                  <img
                    src={src}
                    alt={growthStageImageAlt(s.code, s.label)}
                    loading="lazy"
                    width={64}
                    height={64}
                    className="h-16 w-16 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    data-testid={`growth-stage-placeholder-${s.code}`}
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
                  >
                    {s.code.replace(/^EL/i, "")}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-xs font-semibold tabular-nums text-muted-foreground">{s.code}</span>
                  <span className="block whitespace-normal">{s.label.replace(/^EL\d+\s*—\s*/i, "")}</span>
                  {!src && <span className="sr-only">No reference image available</span>}
                </span>
              </button>
            );
          })}
          {stages.length === 0 && (
            <p className="text-sm text-muted-foreground">No stages match that search.</p>
          )}
        </div>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!picked}
            onClick={() => {
              if (picked) onSelect(picked);
            }}
          >
            Use stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
