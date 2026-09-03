import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { guideImagePublicUrl } from "@/lib/guide/guideImageStore";
import { GuideScreenshot } from "@/components/guide/GuideScreenshot";
import { GuideImageZoom } from "@/components/guide/GuideImageLightbox";
import { stepImages, type GuideContentStep } from "@/lib/guide/guideContent";

/**
 * The one renderer for managed How VineTrack Works step rows.
 *
 * Used by the public guide AND by the System Admin preview, so what an admin
 * previews is exactly what a reader sees. Step numbers come from row order —
 * never from stored content — while the image side comes from the step's own
 * managed `imagePosition`, never from the row number.
 *
 * A step may carry up to three uploaded screenshots; every image can be
 * clicked to expand it in a centred overlay.
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
        const urls = stepImages(step)
          .map((img) => guideImagePublicUrl(img))
          .filter((u): u is string => Boolean(u));
        const hasImage = urls.length > 0 || Boolean(step.imageKey);
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
                (urls.length > 0 ? (
                  <div
                    data-guide-step-image={step.id}
                    className={cn(
                      "grid w-full gap-2 overflow-hidden rounded-xl border border-border bg-muted/30 p-3",
                      urls.length > 1 && "sm:grid-cols-2",
                      imageSide,
                    )}
                  >
                    {urls.map((u, n) => {
                      const alt = urls.length > 1 ? `${step.heading} (${n + 1})` : step.heading;
                      return (
                        <GuideImageZoom
                          key={u}
                          src={u}
                          alt={alt}
                          className="flex items-center justify-center"
                        >
                          <img
                            src={u}
                            alt={alt}
                            loading="lazy"
                            decoding="async"
                            className={cn(
                              "mx-auto w-auto max-w-full object-contain transition-transform group-hover:scale-[1.01]",
                              urls.length > 1 ? "max-h-[220px]" : "max-h-[380px]",
                            )}
                          />
                        </GuideImageZoom>
                      );
                    })}
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
