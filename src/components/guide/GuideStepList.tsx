import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { guideImagePublicUrl } from "@/lib/guide/guideImageStore";
import { GuideScreenshot } from "@/components/guide/GuideScreenshot";
import type { GuideContentStep } from "@/lib/guide/guideContent";

/**
 * The one renderer for managed How VineTrack Works step rows.
 *
 * Used by the public guide AND by the System Admin preview, so what an admin
 * previews is exactly what a reader sees. Step numbers come from row order —
 * never from stored content — while the image side comes from the step's own
 * managed `imagePosition`, never from the row number.
 */
export function GuideStepList({
  steps,
  className,
}: {
  steps: GuideContentStep[];
  className?: string;
}) {
  if (steps.length === 0) return null;

  return (
    <ol className={cn("space-y-4", className)}>
      {steps.map((step, i) => {
        const url = step.image ? guideImagePublicUrl(step.image) : undefined;
        const hasImage = Boolean(url || step.imageKey);
        const imageLeft = (step.imagePosition ?? "right") === "left";
        const imageSide = imageLeft ? "lg:order-first" : undefined;
        return (
          <li key={step.id}>
            <Card
              className={cn(
                "grid gap-4 overflow-hidden p-4 sm:p-5",
                hasImage &&
                  "lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] lg:items-center",
              )}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <h3 className="text-[15px] font-semibold text-foreground">{step.heading}</h3>
                </div>
                {step.body && (
                  <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                )}
                {step.items && step.items.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 pt-0.5">
                    {step.items.map((ex) => (
                      <li
                        key={ex}
                        className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11.5px] font-medium text-foreground/80"
                      >
                        {ex}
                      </li>
                    ))}
                  </ul>
                )}
                {step.platform && (
                  <p className="pt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-primary">
                    {step.platform}
                  </p>
                )}
              </div>

              {hasImage &&
                (url ? (
                  <div
                    data-guide-step-image={step.id}
                    className={cn(
                      "flex w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30 p-3",
                      imageSide,
                    )}
                  >
                    <img
                      src={url}
                      alt={step.heading}
                      loading="lazy"
                      decoding="async"
                      className="max-h-[380px] w-auto max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <GuideScreenshot
                    imageKey={step.imageKey!}
                    alt={step.heading}
                    className={imageSide}
                  />
                ))}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
