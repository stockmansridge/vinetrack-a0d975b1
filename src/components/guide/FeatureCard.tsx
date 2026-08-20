import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PlatformBadges } from "./PlatformBadges";
import { AvailabilityBadge, ImportanceBadge } from "./GuideBadges";
import { guideVisual } from "./guideVisuals";
import type { HowVineTrackWorksItem } from "@/lib/guide/howVineTrackWorksCatalogue";
import { useGuideViewer } from "@/lib/guide/useGuideViewer";
import { guideActionDecision, showsDevelopmentLabels } from "@/lib/guide/guideAccess";

/**
 * Generic guide feature card.
 *
 * - Links only when the catalogue carries a real, verified web route.
 *   The destination keeps its own permissions — this card never bypasses them.
 * - Mobile-only features show platform pills instead of a dead button.
 * - "Learn more" is a local expand (sub-points + platform note). No empty routes.
 */
export function FeatureCard({ item }: { item: HowVineTrackWorksItem }) {
  const [open, setOpen] = useState(false);
  const { Icon, tone } = guideVisual(item.visualKey);
  const isInternal = item.availability !== "available";
  const hasDetail = (item.subItems?.length ?? 0) > 0;
  const viewer = useGuideViewer();
  const internalLabels = showsDevelopmentLabels(viewer);
  const action = guideActionDecision(item.webRoute, viewer);

  return (
    <Card
      className={cn(
        "flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md",
        isInternal && "border-dashed",
      )}
    >
      {/* Visual placeholder area — later receives screenshots / photography. */}
      <div
        className={cn(
          "flex h-24 items-center justify-center bg-gradient-to-br",
          tone,
        )}
        aria-hidden
        data-visual-key={item.visualKey}
      >
        <Icon className="h-8 w-8" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold leading-tight text-foreground">
            {item.title}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <ImportanceBadge importance={item.importance} />
            {internalLabels && <AvailabilityBadge availability={item.availability} />}
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {item.shortDescription}
        </p>

        {hasDetail && open && (
          <ul className="space-y-1 rounded-md bg-muted/50 p-3 text-[12.5px] text-muted-foreground">
            {item.subItems!.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-primary">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <PlatformBadges platforms={item.platforms} />
          <div className="flex items-center gap-2">
            {hasDetail && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                {open ? "Less" : "Learn more"}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                />
              </button>
            )}
            {action.show && item.webRoute && (
              <Link
                to={item.webRoute}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
              >
                Open in portal
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>

        {!item.webRoute && item.platforms.length > 0 && !item.platforms.includes("web") && (
          <p className="text-[11.5px] text-muted-foreground/80">
            Available in the mobile apps only — there is no web screen for this feature.
          </p>
        )}
        {internalLabels && item.mobileFeatureKey && (
          <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground/60">
            Tool ID: {item.mobileFeatureKey}
          </p>
        )}
      </div>
    </Card>
  );
}
