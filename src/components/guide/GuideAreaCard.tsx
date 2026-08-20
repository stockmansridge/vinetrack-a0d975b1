import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { SetupStatusPill, type SetupStatus } from "./SetupCard";
import { guideVisual } from "./guideVisuals";
import { guideAreaRoute, type GuideArea } from "@/lib/guide/guideAreas";

/**
 * Large, full-width landing card — one per major VineTrack area.
 *
 * Layout: ~60–70% text, ~30–40% image on desktop; stacked on narrow screens.
 * Exactly one action per card, and it always drills into the focused guide
 * view rather than expanding content underneath.
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
  const imageLeft = area.imagePosition === "left";

  return (
    <Card className="group overflow-hidden transition-shadow hover:shadow-lg">
      <div
        className={cn(
          "grid lg:grid-cols-[minmax(0,1fr)_minmax(0,35%)]",
          imageLeft && "lg:grid-cols-[minmax(0,35%)_minmax(0,1fr)]",
        )}
      >
        <GuideVisualSlot
          visualKey={area.visualKey}
          imageSrc={area.imageSrc}
          imageAlt={area.imageAlt}
          aspect="aspect-[16/9] lg:aspect-auto"
          iconClassName="h-12 w-12"
          className={cn(
            "order-first min-h-[180px] lg:order-none lg:min-h-[240px]",
            !imageLeft && "lg:order-last",
          )}
        />

        <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-foreground/80">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {String(index + 1).padStart(2, "0")} · {area.stepLabel}
            </span>
          </div>

          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {area.title}
            </h2>
            <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
              {area.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {area.showsSetupStatus && (
              <>
                <SetupStatusPill status={setupStatus} />
                {setupCaption && (
                  <span className="text-[12.5px] font-medium text-muted-foreground">
                    {setupCaption}
                  </span>
                )}
              </>
            )}
            {area.metaLabel && (
              <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[12px] font-medium text-foreground/80">
                {area.metaLabel}
              </span>
            )}
          </div>

          <div>
            <Link
              to={to}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {area.actionLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
