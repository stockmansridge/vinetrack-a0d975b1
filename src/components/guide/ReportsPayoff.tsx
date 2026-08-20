import { ArrowRight, Sprout, Grape, FileBarChart } from "lucide-react";
import { Card } from "@/components/ui/card";

const OUTPUTS = [
  "Activity reporting",
  "Spray records",
  "Cost reporting",
  "Labour information",
  "Equipment information",
  "Exports",
  "Team management",
];

/**
 * The payoff concept: Field activity → VineTrack → Reports & Management.
 * Deliberately concise — the detailed management cards sit behind an
 * "Explore reports & management" toggle.
 */
export function ReportsPayoff() {
  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 sm:p-5">
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1.4fr]">
        <Stage Icon={Sprout} title="Field activity" caption="Pins, trips, sprays, tasks, yield." />
        <Arrow />
        <Stage Icon={Grape} title="VineTrack" caption="Linked to blocks, rows, crews and costs." />
        <Arrow />
        <div className="rounded-lg border border-border/70 bg-card/80 p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500/15 to-teal-500/5 text-teal-600 dark:text-teal-400">
              <FileBarChart className="h-4 w-4" />
            </span>
            <p className="text-[13px] font-semibold text-foreground">Reports & Management</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {OUTPUTS.map((o) => (
              <span
                key={o}
                className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground/80"
              >
                {o}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stage({
  Icon,
  title,
  caption,
}: {
  Icon: typeof Sprout;
  title: string;
  caption: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/80 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{caption}</p>
    </div>
  );
}

function Arrow() {
  return (
    <ArrowRight
      className="mx-auto hidden h-4 w-4 shrink-0 text-muted-foreground/50 lg:block"
      aria-hidden
    />
  );
}
