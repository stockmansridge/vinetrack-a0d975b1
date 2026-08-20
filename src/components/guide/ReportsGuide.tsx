import { Link } from "react-router-dom";
import { useGuideViewer } from "@/lib/guide/useGuideViewer";
import { guideActionDecision } from "@/lib/guide/guideAccess";

import { ArrowRight, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GuideScreenshot } from "@/components/guide/GuideScreenshot";
import { HOW_VINETRACK_WORKS_CATALOGUE } from "@/lib/guide/howVineTrackWorksCatalogue";

/**
 * Stage 4B — Reports & Insights guide.
 *
 * The message is a single one: work recorded in the vineyard becomes
 * management information. Everything listed here is a verified portal
 * reporting surface, and every export named is one the portal actually
 * produces today. No consolidated route is invented — "Open Reports" points at
 * the existing /reports index.
 *
 * Education only. Nothing here scores completeness or reads live data.
 */

const SOURCES = [
  {
    title: "Pins, repairs & observations",
    body: "What was found in the vineyard, where it was found and whether it was resolved.",
  },
  {
    title: "Field trips",
    body: "Machinery and field activity captured by GPS while the work happened.",
  },
  {
    title: "Sprays",
    body: "Products, rates, equipment, conditions and what was actually applied.",
  },
  {
    title: "Work tasks",
    body: "Labour hours, piece rates and machine time against the blocks worked.",
  },
  {
    title: "Operational tools",
    body: "Pruning, irrigation, yields, growth stages, fuel and maintenance records.",
  },
];

export interface ReportCategory {
  title: string;
  body: string;
  itemId: string;
  imageKey?: "reports.activity" | "reports.costs" | "reports.sprays";
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    title: "Activity reporting",
    body: "Trip reports, work task reports and pruning activity — what was done, where and how quickly.",
    itemId: "reports.activity",
    imageKey: "reports.activity",
  },
  {
    title: "Cost & labour reporting",
    body: "Season, block and variety costs built from labour lines, piece rates, machine time, fuel and maintenance.",
    itemId: "reports.costs",
    imageKey: "reports.costs",
  },
  {
    title: "Spray records & compliance",
    body: "Chemicals, rates, withholding and re-entry information, conditions and tank mix per application.",
    itemId: "reports.spray",
    imageKey: "reports.sprays",
  },
  {
    title: "Yield & production",
    body: "Estimated against actual yield, year-on-year comparison and picking analysis by block, variety and clone.",
    itemId: "reports.yield",
  },
  {
    title: "Rainfall, growth stage & irrigation",
    body: "Rainfall history and calendar, E-L growth stage history, and irrigation reporting where irrigation applies.",
    itemId: "reports.environment",
  },
  {
    title: "Team & access",
    body: "Who is in the vineyard team, their roles, and who can see financial information.",
    itemId: "reports.team_management",
  },
];

const WHY = [
  {
    title: "Planning",
    body: "Look back at what a job actually took before you plan the next one.",
  },
  {
    title: "Compliance",
    body: "Spray records hold the chemical, rate, conditions and withholding detail when they are asked for.",
  },
  {
    title: "Costing",
    body: "Cost per block, per variety and per season comes from work already recorded, not a spreadsheet.",
  },
  {
    title: "Progress & history",
    body: "See how the season is tracking, and keep a permanent operational history of the vineyard.",
  },
];

const EXPORTS = [
  "PDF — trip, spray, cost, work task, pruning activity and rainfall reports",
  "CSV — trips, costs, work tasks, pruning activity, growth stage records, rainfall, yield and data coverage",
  "Excel — yield analytics, spray reports and work task reports",
  "Documents & Exports is the central launcher for the exports the portal supports",
];


function route(itemId: string): string | undefined {
  return HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === itemId)?.webRoute;
}

export function ReportsGuide() {
  const viewer = useGuideViewer();
  const openable = (r?: string) => (guideActionDecision(r, viewer).show ? r : undefined);
  const reportsRoute = openable(route("reports.activity")) ?? undefined;

  return (
    <div className="space-y-8" data-guide-view="reports">
      <section className="space-y-3">
        <SectionHeading
          title="Work recorded in the vineyard becomes management information"
          description="You do not build reports in VineTrack. Reports are what the recorded work turns into."
        />
        <FlowStrip steps={["Field activity", "VineTrack records", "Reports & insights"]} />
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Where the data comes from"
          description="Every report is built from work that was already recorded — nothing is entered twice."
        />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {SOURCES.map((s) => (
            <div key={s.title} className="rounded-xl border border-border bg-card p-3">
              <p className="text-[13.5px] font-semibold text-foreground">{s.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="What you can review"
          description="The reporting areas currently available in the portal."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {REPORT_CATEGORIES.map((c) => {
            const to = openable(route(c.itemId));
            return (
              <Card key={c.itemId} className="flex h-full flex-col gap-3 p-4">
                {c.imageKey && (
                  <GuideScreenshot imageKey={c.imageKey} alt={`${c.title} in VineTrack`} />
                )}
                <div className="space-y-1">
                  <h3 className="text-[14.5px] font-semibold text-foreground">{c.title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{c.body}</p>
                </div>
                {to && (
                  <Link
                    to={to}
                    className="mt-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
                  >
                    Open in portal
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Why it matters"
          description="The reason it is worth recording work properly in the first place."
        />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {WHY.map((w) => (
            <div key={w.title} className="rounded-xl border border-border bg-card p-3">
              <p className="text-[13.5px] font-semibold text-foreground">{w.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Exports"
          description="The outputs the portal produces today. Availability varies by report."
        />
        <ul className="space-y-1.5 rounded-xl border border-border bg-card p-4">
          {EXPORTS.map((e) => (
            <li key={e} className="flex gap-2 text-[13.5px] leading-relaxed text-foreground/90">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              {e}
            </li>
          ))}
        </ul>
      </section>

      <div className="border-t border-border pt-6">
        <Link
          to={reportsRoute}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open Reports
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function FlowStrip({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-xl border border-primary/20 bg-primary/[0.05] p-3">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className="rounded-lg bg-card px-2.5 py-1.5 text-[12.5px] font-semibold text-foreground shadow-sm">
            {s}
          </span>
          {i < steps.length - 1 && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-border pb-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
