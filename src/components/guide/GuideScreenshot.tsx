import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGuideImage } from "@/lib/guide/guideImageStore";
import {
  focusToObjectPosition,
  guideImageSlot,
  type GuideImageKey,
} from "@/lib/guide/guideImages";

/**
 * A supporting workflow image tied to one guide step.
 *
 * Real assets only — never a fabricated VineTrack UI. When no image has been
 * uploaded for the key (or the file fails to load) this degrades to a quiet
 * neutral surface so the guide still reads correctly.
 *
 * Presentation follows the slot's declared kind:
 *   screenshot → contain on a neutral surface (nothing is cropped away)
 *   photo      → cover
 */
export function GuideScreenshot({
  imageKey,
  alt,
  className,
}: {
  imageKey: GuideImageKey;
  alt: string;
  className?: string;
}) {
  const { url, focus } = useGuideImage(imageKey);
  const [broken, setBroken] = useState(false);
  const slot = guideImageSlot(imageKey);
  const isScreenshot = (slot?.kind ?? "screenshot") === "screenshot";
  const src = url && !broken ? url : undefined;

  return (
    <div
      data-guide-image-key={imageKey}
      data-guide-image-state={src ? "image" : "placeholder"}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-border bg-muted/30",
        "aspect-[16/10]",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          style={{ objectPosition: focusToObjectPosition(focus) }}
          className={cn("h-full w-full", isScreenshot ? "object-contain p-2" : "object-cover")}
        />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center text-muted-foreground"
        >
          <ImageIcon className="h-6 w-6 opacity-50" aria-hidden />
          <span aria-hidden className="max-w-[20rem] text-[11.5px] leading-relaxed opacity-70">{alt}</span>
        </div>
      )}
    </div>
  );
}
