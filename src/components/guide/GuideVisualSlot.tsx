import { useState } from "react";
import { cn } from "@/lib/utils";
import { guideVisual } from "./guideVisuals";

/**
 * The single image slot used by every guide surface (hero, landing cards,
 * drill-down heroes).
 *
 * Image resolution order:
 *   1. an explicit `imageSrc` passed by the caller,
 *   2. `imageSrc` registered against the `visualKey` in guideVisuals.ts,
 *   3. a placeholder.
 *
 * Placeholder modes:
 *   - default: icon + optional caption (used by drill-down surfaces),
 *   - `subtle`: a restrained image-shaped surface — very light green/grey, subtle
 *     border, no oversized centred icon (used on the landing page, Stage 2.8).
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
  subtle = false,
  placeholderLabel,
  objectPosition = "center center",
}: {
  visualKey?: string;
  imageSrc?: string;
  imageAlt: string;
  /** Tailwind aspect utility; pass "" when the parent controls the height. */
  aspect?: string;
  className?: string;
  iconClassName?: string;
  caption?: string;
  /** Restrained image-shaped placeholder instead of a big centred icon. */
  subtle?: boolean;
  placeholderLabel?: string;
  /** CSS object-position; images always crop with object-fit: cover. */
  objectPosition?: string;
}) {
  const visual = guideVisual(visualKey);
  const requested = imageSrc ?? visual.imageSrc;
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const src = requested && requested !== failed ? requested : undefined;
  const { Icon, tone } = visual;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        !src && subtle
          ? "border border-border bg-muted/30"
          : cn("bg-gradient-to-br", tone),
        aspect,
        className,
      )}
      data-visual-key={visualKey}
    >
      {src ? (
        <img
          src={src}
          alt={imageAlt}
          loading="lazy"
          style={{ objectPosition }}
          onError={() => setFailed(src)}
          className="h-full w-full object-cover"
        />
      ) : subtle ? (
        <div
          className="flex h-full w-full items-end justify-end p-1.5"
          role="img"
          aria-label={imageAlt}
        >
          {placeholderLabel && (
            <span className="text-[10px] font-medium text-muted-foreground/60">
              {placeholderLabel}
            </span>
          )}
        </div>
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
