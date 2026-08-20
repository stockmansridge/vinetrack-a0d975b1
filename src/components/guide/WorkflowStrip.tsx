import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";

const STEPS = [
  {
    label: "Plan",
    detail: "Spray jobs, work tasks and rotations are planned in the portal.",
  },
  {
    label: "Perform",
    detail: "Crews work in the field with the iOS and Android apps, online or offline.",
  },
  {
    label: "Record",
    detail: "Trips, pins, sprays, labour and yield are captured as they happen.",
  },
  {
    label: "Complete",
    detail: "Work is closed out, linked to blocks and rows, and costed.",
  },
  {
    label: "Report",
    detail: "Activity, cost, compliance and yield reporting in the portal.",
  },
];

/** Explains that field features are one connected workflow, not separate screens. */
export function WorkflowStrip() {
  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 sm:p-5">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">
        How work flows through VineTrack
      </p>
      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex flex-1 items-stretch gap-2">
            <div className="flex-1 rounded-lg border border-border/70 bg-card/70 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-[13px] font-semibold text-foreground">{s.label}</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                {s.detail}
              </p>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight
                className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground/50 lg:block"
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
