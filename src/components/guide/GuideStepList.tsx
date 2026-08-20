import { ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGuideImages, guideImagePublicUrl } from "@/lib/guide/guideImageStore";
import type { GuideContentStep } from "@/lib/guide/guideContent";
import type { GuideImageKey } from "@/lib/guide/guideImages";

/**
 * The one renderer for managed How VineTrack Works step rows.
 *
 * Used by the public guide AND by the System Admin preview, so what an admin
 * previews is exactly what a reader sees. Step numbers come from row order —
 * never from stored content — and the image side alternates automatically.
 */
export function GuideStepList({
  steps,
  className,
}: {
  steps: GuideContentStep[];
  className?: string;
}) {
  const { data: imageMap } = useGuideImages();

  const resolve = (step: GuideContentStep): string | undefined => {
    if (step.image?.path) return guideImagePublicUrl(step.image);
    if (step.imageKey) return guideImagePublicUrl(imageMap?.[step.imageKey as GuideImageKey]);
    return undefined;
  };

  if (steps.length === 0) return null;

  return (
    <ol className={cn("space-y-4", className)}>
      {steps.map((step, i) => {
        const url = resolve(step);
        const hasImage = Boolean(url || step.imageKey || step.image);
        return (
          <li key={step.id}>
            <Card
              className={cn(
                "grid gap-4 overflow-hidden p-4 sm:p-5",
                hasImage && "lg:grid-cols-[minmax(0,1fr)_minmax(0,42%)] lg:items-center",
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

              {hasImage && (
                <div
                  data-guide-step-image={step.id}
                  className={cn(
                    "relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border bg-muted/30",
                    // Alternating placement on desktop; stacks together on mobile.
                    i % 2 === 1 ? "lg:order-first" : undefined,
                  )}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={step.heading}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain p-2"
                    />
                  ) : (
                    <div
                      role="img"
                      aria-label={step.heading}
                      className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center text-muted-foreground"
                    >
                      <ImageIcon className="h-6 w-6 opacity-50" aria-hidden />
                      <span aria-hidden className="max-w-[20rem] text-[11.5px] leading-relaxed opacity-70">
                        {step.heading}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
