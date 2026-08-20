import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { type SetupStatus } from "./SetupCard";
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
export type GuideStepTone = "incomplete" | "complete" | "recommended" | "neutral";

const STEP_TONE: Record<GuideStepTone, string> = {
  incomplete: "border-destructive bg-destructive text-destructive-foreground",
  complete: "border-emerald-600 bg-emerald-600 text-white",
  recommended: "border-amber-500 bg-amber-500 text-white",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** Compact landing-row status pill — pale red while unresolved. */
function GuideRowStatusPill({ status }: { status: SetupStatus }) {
  const tone =
    status === "complete"
      ? { dot: "bg-emerald-600", cls: "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-400", label: "Complete" }
      : status === "recommended"
        ? { dot: "bg-amber-500", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", label: "Recommended" }
        : status === "not_applicable"
          ? { dot: "bg-muted-foreground/50", cls: "border-border bg-muted text-muted-foreground", label: "Not applicable" }
          : {
              dot: "bg-destructive",
              cls: "border-destructive/25 bg-destructive/[0.07] text-destructive",
              label: status === "action_required" ? "Action required" : "Not checked yet",
            };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
        tone.cls,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
      {tone.label}
    </span>
  );
}

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
  // One uploaded image per area key feeds both this row and the drill-down hero.
  const uploaded = useGuideImage(area.id as GuideImageKey);
  // No live health data yet (Stage 3): every step is unresolved → red.
  const stepTone: GuideStepTone =
    setupStatus === "complete"
      ? "complete"
      : setupStatus === "recommended"
        ? "recommended"
        : setupStatus === "not_applicable"
          ? "neutral"
          : "incomplete";

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
          {area.showsSetupStatus && (
            <>
              <GuideRowStatusPill status={setupStatus} />
              {setupCaption && (
                <span className="text-[11.5px] leading-none text-muted-foreground">
                  {setupCaption}
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
