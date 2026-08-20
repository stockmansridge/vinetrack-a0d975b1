import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { SetupPresentationPill } from "./SetupPresentationPill";
import { setupPresentationMeta, type SetupPresentation } from "@/lib/guide/setupPresentation";
import { guideVisual } from "./guideVisuals";
import { guideAreaRoute, type GuideArea } from "@/lib/guide/guideAreas";
import { useGuideImage } from "@/lib/guide/guideImageStore";
import { focusToObjectPosition, type GuideImageKey } from "@/lib/guide/guideImages";

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
/**
 * Visual variants for the numbered step circle. Only `incomplete` and
 * `neutral` are reachable today — Stage 3 will map real setup health onto
 * `complete` / `recommended`. No completion is inferred here.
 */
/**
 * Stage 3.2 — step circle variants.
 *
 * Only step 1 (Setup) carries a semantic state: green = required setup
 * complete, red = required action, neutral = unknown/loading. Every other step
 * is a neutral educational sequence number and is NEVER status-coloured.
 */
export type GuideStepTone = "incomplete" | "complete" | "neutral" | "sequence";

const STEP_TONE: Record<GuideStepTone, string> = {
  incomplete: "border-destructive bg-destructive text-destructive-foreground",
  complete: "border-emerald-600 bg-emerald-600 text-white",
  neutral: "border-border bg-muted text-muted-foreground",
  sequence: "border-border bg-muted/60 text-foreground/80",
};

export function GuideAreaCard({
  area,
  index,
  setup,
}: {
  area: GuideArea;
  index: number;
  /** Live overall Setup presentation — supplied for the Setup row only. */
  setup?: SetupPresentation;
}) {
  const { Icon } = guideVisual(area.visualKey);
  const to = guideAreaRoute(area);
  // One uploaded image per area key feeds both this row and the drill-down hero.
  const uploaded = useGuideImage(area.id as GuideImageKey);
  // Only the Setup row consumes live health; all other rows stay neutral.
  const stepTone: GuideStepTone = !setup
    ? "sequence"
    : setup.state === "complete"
      ? "complete"
      : setup.state === "action_required"
        ? "incomplete"
        : "neutral";

  return (
    <Link
      to={to}
      aria-label={
        setup
          ? `${index + 1}. ${area.title} — core setup: ${setup.label}. Learn more`
          : `${index + 1}. ${area.title}. Learn more`
      }

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
        {/* Step number — red while unresolved/incomplete (Stage 3 will flip
            complete steps to the green variant; variants defined above). */}
        <div className="hidden lg:flex lg:justify-center">
          <span
            className={cn(
              "flex h-[30px] w-[30px] items-center justify-center rounded-full border text-[12.5px] font-semibold",
              STEP_TONE[stepTone],
            )}
          >
            {index + 1}
          </span>
        </div>

        {/* Icon */}
        <div className="flex items-center gap-3 lg:justify-center">
          <span className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground">
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

        {/* Fixed action column — identical geometry on EVERY row (Stage 2.9).
            Status/count sits directly above the CTA and never shifts it. */}
        <div className="flex flex-wrap items-center gap-1.5 lg:h-full lg:w-full lg:flex-col lg:flex-nowrap lg:items-start lg:justify-center lg:gap-[5px]">
          {setup && (
            <>
              <SetupPresentationPill presentation={setup} />
              {setupPresentationMeta(setup) && (
                <span className="text-[11.5px] leading-none text-muted-foreground">
                  {setupPresentationMeta(setup)}
                </span>
              )}
            </>
          )}
          {area.metaLabel && (
            <span className="text-[11.5px] font-medium leading-none text-muted-foreground">
              {area.metaLabel}
            </span>
          )}
          {/* Standardised landing CTA — identical label + geometry on all rows */}
          <span className="inline-flex h-[31px] w-[100px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-card px-3 text-[12px] font-semibold text-foreground/80 transition-colors group-hover:border-primary/30 group-hover:bg-muted group-hover:text-primary">
            Learn more
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>


        {/* Image — always right on desktop, nearly filling the row */}
        <GuideVisualSlot
          visualKey={area.visualKey}
          imageSrc={uploaded.url ?? area.imageSrc}
          imageAlt={area.imageAlt}
          objectPosition={focusToObjectPosition(uploaded.focus)}
          aspect=""
          subtle
          className="order-last h-[84px] w-full rounded-[7px]"
        />
      </div>
    </Link>
  );
}
