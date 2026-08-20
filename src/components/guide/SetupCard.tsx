import { Link } from "react-router-dom";
import { ArrowRight, AlertTriangle, CircleAlert, CheckCircle2, MinusCircle, CircleDashed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PlatformBadges } from "./PlatformBadges";
import { ImportanceBadge } from "./GuideBadges";
import { guideVisual } from "./guideVisuals";
import type { HowVineTrackWorksItem } from "@/lib/guide/howVineTrackWorksCatalogue";

/**
 * Setup status model. Stage 2 renders `not_checked` for everything —
 * no completion is calculated and no heuristic is invented here.
 * Stage 3 will supply real values from `src/lib/dataCoverageQuery.ts`
 * plus `get_irrigation_capabilities` / `is_irrigated`.
 */
export type SetupStatus =
  | "action_required"
  | "recommended"
  | "complete"
  | "not_applicable"
  | "not_checked";

const STATUS_META: Record<
  SetupStatus,
  { label: string; Icon: typeof CheckCircle2; badge: string; stripe: string }
> = {
  action_required: {
    label: "Action required",
    Icon: AlertTriangle,
    badge:
      "border-destructive/40 bg-destructive/10 text-destructive",
    stripe: "bg-destructive",
  },
  recommended: {
    label: "Recommended",
    Icon: CircleAlert,
    badge:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    stripe: "bg-amber-500",
  },
  complete: {
    label: "Complete",
    Icon: CheckCircle2,
    badge:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    stripe: "bg-emerald-500",
  },
  not_applicable: {
    label: "Not applicable",
    Icon: MinusCircle,
    badge: "border-border bg-muted text-muted-foreground",
    stripe: "bg-muted-foreground/40",
  },
  not_checked: {
    label: "Not checked yet",
    Icon: CircleDashed,
    badge: "border-border bg-muted text-muted-foreground",
    stripe: "bg-muted-foreground/25",
  },
};

export function SetupStatusPill({
  status,
  className,
}: {
  status: SetupStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        meta.badge,
        className,
      )}
    >
      <meta.Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export function SetupCard({
  item,
  status = "not_checked",
}: {
  item: HowVineTrackWorksItem;
  status?: SetupStatus;
}) {
  const { Icon, tone } = guideVisual(item.visualKey);
  const meta = STATUS_META[status];

  return (
    <Card className="relative flex h-full flex-col gap-3 overflow-hidden p-4 pl-5 transition-shadow hover:shadow-md">
      <span className={cn("absolute inset-y-0 left-0 w-1", meta.stripe)} aria-hidden />

      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
            tone,
          )}
          aria-hidden
          data-visual-key={item.visualKey}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">
              {item.title}
            </h3>
            <ImportanceBadge importance={item.importance} />
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {item.shortDescription}
          </p>
        </div>
      </div>

      {item.subItems && item.subItems.length > 0 && (
        <ul className="grid gap-1 rounded-md bg-muted/50 p-3 text-[12.5px] text-muted-foreground sm:grid-cols-2">
          {item.subItems.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <CircleDashed className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="truncate">{s}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <SetupStatusPill status={status} />
          <PlatformBadges platforms={item.platforms} />
        </div>
        {item.webRoute && (
          <Link
            to={item.webRoute}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
          >
            Set up
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </Card>
  );
}
