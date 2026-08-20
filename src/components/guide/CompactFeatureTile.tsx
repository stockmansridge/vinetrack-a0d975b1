import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformBadges } from "./PlatformBadges";
import { AvailabilityBadge } from "./GuideBadges";
import { guideVisual } from "./guideVisuals";
import type { HowVineTrackWorksItem } from "@/lib/guide/howVineTrackWorksCatalogue";

/**
 * Compact feature preview — the low-noise alternative to FeatureCard.
 *
 * Used wherever the page shows a *preview* of a section's contents. Platform
 * badges are opt-in so high-level areas stay visually calm; the full
 * FeatureCard is still used once a section is expanded.
 */
export function CompactFeatureTile({
  item,
  showPlatforms = false,
  className,
}: {
  item: HowVineTrackWorksItem;
  showPlatforms?: boolean;
  className?: string;
}) {
  const { Icon, tone } = guideVisual(item.visualKey);
  const body = (
    <>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
          tone,
        )}
        aria-hidden
        data-visual-key={item.visualKey}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13.5px] font-semibold leading-tight text-foreground">
            {item.title}
          </span>
          <AvailabilityBadge availability={item.availability} />
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {item.shortDescription}
        </span>
        {showPlatforms && <PlatformBadges platforms={item.platforms} className="mt-1.5" />}
      </span>
      {item.webRoute && (
        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      )}
    </>
  );

  const shell = cn(
    "flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3 transition-colors",
    item.webRoute && "hover:border-primary/40 hover:bg-accent/40",
    item.availability !== "available" && "border-dashed",
    className,
  );

  if (item.webRoute) {
    return (
      <Link to={item.webRoute} className={shell}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
