// "Plan Spray → From Program" — pick the Program Step to plan from.
// Read-only: choosing a step only opens a prefilled wizard.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchSprayJobs, type SprayJob } from "@/lib/sprayJobsQuery";
import {
  chemicalLineRateText, growthStageDescription, growthStageOrder,
  programLines, programSearchHaystack,
} from "@/lib/sprayProgramStep";

export function ProgramStepPickerDialog({
  open, onOpenChange, vineyardId, onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  onPick: (step: SprayJob) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: steps = [], isLoading } = useQuery({
    queryKey: ["spray_jobs", vineyardId, "templates"],
    enabled: open && !!vineyardId,
    queryFn: () => fetchSprayJobs(vineyardId, { template: true, archived: false }),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? steps.filter((s) => programSearchHaystack(s).includes(q)) : steps;
    return [...list].sort(
      (a, b) =>
        (growthStageOrder(a.growth_stage_code) ?? 999) - (growthStageOrder(b.growth_stage_code) ?? 999),
    );
  }, [steps, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plan Spray from Program</DialogTitle>
          <DialogDescription>
            Choose a Program Step. Its configuration is copied into a new Planned Spray —
            nothing is saved until you finish the wizard, and the Program Step is unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search program by stage, name, target or product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ScrollArea className="max-h-[55vh]">
          <div className="space-y-2 pr-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No Program Steps match.</p>
            )}
            {rows.map((s) => {
              const stage = s.growth_stage_code;
              const desc = growthStageDescription(stage);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick(s)}
                  className="w-full rounded-md border p-3 text-left transition hover:bg-muted/60"
                >
                  <div className="text-xs text-muted-foreground">
                    {stage ? `${stage}${desc ? ` — ${desc}` : ""}` : "No growth stage"}
                  </div>
                  <div className="font-medium">{s.name ?? "Untitled Program Step"}</div>
                  <div className="text-xs text-muted-foreground">
                    {programLines(s)
                      .map((l) => [l.name, chemicalLineRateText(l)].filter(Boolean).join(" — "))
                      .join(", ") || "No products"}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
