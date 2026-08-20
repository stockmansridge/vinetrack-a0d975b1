import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface WorkflowStep {
  label: string;
  /** The VineTrack feature that carries this stage of the lifecycle. */
  feature?: string;
  detail?: string;
}

/**
 * The default field-work lifecycle: what happens, and which VineTrack feature
 * carries each stage. This is an educational visual — it does not imply every
 * job must follow the sequence exactly.
 */
export const FIELD_WORK_LIFECYCLE: WorkflowStep[] = [
  { label: "Observe", feature: "Pins / Observations" },
  { label: "Plan", feature: "Work Tasks" },
  { label: "Perform", feature: "Trips / Field Work" },
  { label: "Record", feature: "Spray Jobs" },
  { label: "Complete", feature: "Completed Records" },
  { label: "Report", feature: "Reports" },
];

/** Explains that field features are one connected workflow, not separate screens. */
export function WorkflowStrip({
  steps = FIELD_WORK_LIFECYCLE,
  title = "How work flows through VineTrack",
  className,
}: {
  steps?: WorkflowStep[];
  title?: string;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 sm:p-5",
        className,
      )}
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-primary">
        {title}
      </p>
      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {steps.map((s, i) => (
          <div key={s.label} className="flex flex-1 items-stretch gap-2">
            <div className="flex-1 rounded-lg border border-border/70 bg-card/80 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-[13px] font-semibold text-foreground">{s.label}</span>
              </div>
              {s.feature && (
                <p className="mt-1.5 text-[12px] font-medium leading-snug text-primary/90">
                  {s.feature}
                </p>
              )}
              {s.detail && (
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {s.detail}
                </p>
              )}
            </div>
            {i < steps.length - 1 && (
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
