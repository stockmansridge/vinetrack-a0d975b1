import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { SetupStatusPill, type SetupStatus } from "./SetupCard";
import { guideVisual } from "./guideVisuals";
import { guideAreaRoute, type GuideArea } from "@/lib/guide/guideAreas";

/**
 * Compact landing row — one per major VineTrack area (Stage 2.7).
 *
 * Fixed anatomy on desktop, identical for every row, never alternating:
 *   step number → icon → title/description → status/CTA → image (always right)
 *
 * The image is inset inside the card and never drives the row height; the row
 * targets ~118px. Colour comes from the imagery, not from pastel panels.
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
        "group block rounded-[11px] border border-border bg-card p-2.5 transition-colors",
        "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div
        className={cn(
          "grid items-center gap-x-4 gap-y-3",
          "lg:grid-cols-[44px_56px_minmax(0,1fr)_auto_300px] lg:gap-x-5",
        )}
      >
        {/* Step number */}
        <div className="hidden lg:flex lg:justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/50 text-[13px] font-semibold text-foreground/70">
            {index + 1}
          </span>
        </div>

        {/* Icon */}
        <div className="flex items-center gap-3 lg:justify-center">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted/40 text-muted-foreground">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:hidden">
            {index + 1} · {area.stepLabel}
          </span>
        </div>

        {/* Title + description */}
        <div className="min-w-0 py-1 pl-0.5">
          <h2 className="truncate text-[18px] font-semibold tracking-tight text-foreground">
            {area.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-[13.5px] leading-snug text-muted-foreground">
            {area.description}
          </p>
        </div>

        {/* Status + action */}
        <div className="flex flex-wrap items-center gap-2 lg:w-[168px] lg:flex-col lg:items-start lg:gap-2">
          {area.showsSetupStatus && (
            <>
              <SetupStatusPill status={setupStatus} />
              {setupCaption && (
                <span className="text-[12px] text-muted-foreground">{setupCaption}</span>
              )}
            </>
          )}
          {area.metaLabel && (
            <span className="text-[12px] font-medium text-muted-foreground">
              {area.metaLabel}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-[12.5px] font-semibold text-primary transition-colors group-hover:bg-primary/10">
            {area.actionLabel}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>

        {/* Image — always right on desktop */}
        <GuideVisualSlot
          visualKey={area.visualKey}
          imageSrc={area.imageSrc}
          imageAlt={area.imageAlt}
          aspect=""
          iconClassName="h-6 w-6"
          className="order-last h-[96px] w-full rounded-lg"
        />
      </div>
    </Link>
  );
}
