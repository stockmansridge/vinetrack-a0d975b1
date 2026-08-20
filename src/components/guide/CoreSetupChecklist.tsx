import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SetupStatusIcon, SetupStatusPill, type SetupStatus } from "./SetupCard";
import type { SetupCheckResult } from "@/lib/guide/setupHealth";
import { PlatformBadges } from "./PlatformBadges";
import { ImportanceBadge } from "./GuideBadges";
import { guideVisual } from "./guideVisuals";
import {
  coreSetupGroupRoute,
  coreSetupGroups,
  type CoreSetupGroup,
} from "@/lib/guide/coreSetupGroups";

/**
 * Compact Core Setup checklist with progressive disclosure.
 *
 * Initial state: one short card per setup area — title, one-line summary, a
 * status pill and "View details". No sub-checks are rendered until requested,
 * so the whole section fits comfortably in about one screen.
 *
 * Stage 3 readiness: pass `statuses` (per group id) and `progress`
 * ("7 of 8 complete") — the layout already reserves both, and the expanded
 * rows already render a per-check status pill.
 */
export function CoreSetupChecklist({
  statuses,
  progress,
  checksByGroup,
}: {
  statuses?: Record<string, SetupStatus>;
  progress?: Record<string, string>;
  /** Live resolver checks per group id — rendered with real status icons. */
  checksByGroup?: Record<string, SetupCheckResult[]>;
}) {
  const groups = coreSetupGroups();
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {groups.map((group) => (
        <CoreSetupSummaryCard
          key={group.id}
          group={group}
          status={statuses?.[group.id] ?? "not_checked"}
          progress={progress?.[group.id]}
          checks={checksByGroup?.[group.id]}
        />
      ))}
    </div>
  );
}

function CoreSetupSummaryCard({
  group,
  status,
  progress,
  checks,
}: {
  group: CoreSetupGroup;
  status: SetupStatus;
  progress?: string;
  checks?: SetupCheckResult[];
}) {
  const [open, setOpen] = useState(false);
  const { Icon, tone } = guideVisual(group.visualKey);
  const route = coreSetupGroupRoute(group);
  const panelId = `core-setup-${group.id}`;

  return (
    <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3 p-4">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
            tone,
          )}
          aria-hidden
          data-visual-key={group.visualKey}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[14.5px] font-semibold leading-tight text-foreground">
              {group.title}
            </h3>
            {group.optional && <ImportanceBadge importance="optional" />}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {group.summary}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SetupStatusPill status={status} />
              {progress && (
                <span className="text-[11.5px] font-medium text-muted-foreground">
                  {progress}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={panelId}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
            >
              {open ? "Hide details" : "View details"}
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
              />
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div id={panelId} className="space-y-3 border-t border-border/70 bg-muted/30 p-4">
          {group.items.map((item) => (
            <div key={item.id} className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[13px] font-semibold text-foreground">{item.title}</p>
                  <ImportanceBadge importance={item.importance} />
                </div>
                {item.webRoute && (
                  <Link
                    to={item.webRoute}
                    className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
                  >
                    Open
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                {item.shortDescription}
              </p>
              {item.subItems && item.subItems.length > 0 && (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {item.subItems.map((s) => {
                    const st = checkStatuses?.[`${item.id}:${s}`];
                    return (
                      <li
                        key={s}
                        className="flex items-center justify-between gap-2 rounded-md bg-card px-2 py-1 text-[12px] text-muted-foreground"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <CircleDashed className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          <span className="truncate">{s}</span>
                        </span>
                        {st && <SetupStatusPill status={st} />}
                      </li>
                    );
                  })}
                </ul>
              )}
              <PlatformBadges platforms={item.platforms} />
            </div>
          ))}
          {route && (
            <Link
              to={route}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
            >
              Go to {group.title.toLowerCase()}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
