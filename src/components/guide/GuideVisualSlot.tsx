import { cn } from "@/lib/utils";
import { guideVisual } from "./guideVisuals";

/**
 * The single image slot used by every guide surface (hero, landing cards,
 * drill-down heroes).
 *
 * Image resolution order:
 *   1. an explicit `imageSrc` passed by the caller,
 *   2. `imageSrc` registered against the `visualKey` in guideVisuals.ts,
 *   3. a safe branded placeholder built from the visual key's icon + tone.
 *
 * This keeps image imports out of the pages: the visual mapping decides what a
 * given area should show, so the future image library only touches one file.
 */
export function GuideVisualSlot({
  visualKey,
  imageSrc,
  imageAlt,
  aspect = "aspect-[16/10]",
  className,
  iconClassName = "h-10 w-10",
  caption,
}: {
  visualKey?: string;
  imageSrc?: string;
  imageAlt: string;
  /** Tailwind aspect utility; pass "" when the parent controls the height. */
  aspect?: string;
  className?: string;
  iconClassName?: string;
  caption?: string;
}) {
  const visual = guideVisual(visualKey);
  const src = imageSrc ?? visual.imageSrc;
  const { Icon, tone } = visual;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-gradient-to-br",
        aspect,
        tone,
        className,
      )}
      data-visual-key={visualKey}
    >
      {src ? (
        <img
          src={src}
          alt={imageAlt}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center"
          role="img"
          aria-label={imageAlt}
        >
          <Icon className={cn("opacity-80", iconClassName)} aria-hidden />
          {caption && (
            <span className="max-w-[18rem] text-[11.5px] font-medium leading-relaxed opacity-70">
              {caption}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
