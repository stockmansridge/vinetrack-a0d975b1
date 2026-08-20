import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { SetupStatusPill, type SetupStatus } from "./SetupCard";
import { guideVisual } from "./guideVisuals";
import { guideAreaRoute, type GuideArea } from "@/lib/guide/guideAreas";

/**
 * Compact landing row — one per major VineTrack area (Stage 2.8 density pass).
 *
 * Fixed anatomy on desktop, identical for every row, never alternating:
 *   step number → icon → title/description → status/CTA → image (always right)
 *
 * The row targets a 100px desktop height with an 84px image inset by ~8px, so
 * the imagery — not pastel panels — carries the colour.
 *
 * Status is rendered ONLY for areas that opt in (`showsSetupStatus`) — using a
 * tool for the first time must never look like a failed setup check.
 */
export function GuideAreaCard({
  area,
  index,
  setupStatus = "not_checked",
  setupCaption,
}: {
  area: GuideArea;
  index: number;
  setupStatus?: SetupStatus;
  /** Stage 3 slot: "6 of 7 setup areas complete" / "2 actions required". */
  setupCaption?: string;
}) {
  const { Icon } = guideVisual(area.visualKey);
  const to = guideAreaRoute(area);

  return (
    <Link
      to={to}
      aria-label={area.title}
      className={cn(
        "group block rounded-[10px] border border-border bg-card py-2 pl-3 pr-2.5 transition-colors",
        "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      data-guide-row
    >
      <div
        className={cn(
          "grid items-center gap-x-3 gap-y-3",
          "lg:h-[84px] lg:grid-cols-[38px_48px_minmax(0,1fr)_160px_285px] lg:gap-x-4",
        )}
      >
        {/* Step number */}
        <div className="hidden lg:flex lg:justify-center">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-border bg-primary/[0.05] text-[12.5px] font-semibold text-primary">
            {index + 1}
          </span>
        </div>

        {/* Icon */}
        <div className="flex items-center gap-3 lg:justify-center">
          <span className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-muted/40 text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:hidden">
            {index + 1} · {area.stepLabel}
          </span>
        </div>

        {/* Title + description */}
        <div className="min-w-0">
          <h2 className="truncate text-[16.5px] font-semibold leading-tight tracking-tight text-foreground">
            {area.title}
          </h2>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.35] text-muted-foreground">
            {area.description}
          </p>
        </div>

        {/* Status + action (compact column) */}
        <div className="flex flex-wrap items-center gap-1.5 lg:w-full lg:flex-col lg:items-start">
          {area.showsSetupStatus && (
            <>
              <SetupStatusPill status={setupStatus} />
              {setupCaption && (
                <span className="text-[11.5px] text-muted-foreground">{setupCaption}</span>
              )}
            </>
          )}
          {area.metaLabel && (
            <span className="text-[11.5px] font-medium text-muted-foreground">
              {area.metaLabel}
            </span>
          )}
          <span className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-primary/30 bg-primary/[0.06] px-2.5 text-[12px] font-semibold text-primary transition-colors group-hover:bg-primary/10">
            {area.actionLabel}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>

        {/* Image — always right on desktop, nearly filling the row */}
        <GuideVisualSlot
          visualKey={area.visualKey}
          imageSrc={area.imageSrc}
          imageAlt={area.imageAlt}
          aspect=""
          subtle
          className="order-last h-[84px] w-full rounded-[7px]"
        />
      </div>
    </Link>
  );
}
