// Runtime renderer for a canopy reference diagram.
//
// Resolution order: System Admin custom override → bundled public/canopy asset.
// If the custom object is missing or broken, the <img> error handler swaps back
// to the bundled default automatically, so a bad upload can never blank the
// Spray Calculator. Presentation only — no calculation input.
import { useEffect, useState } from "react";
import { useCanopyImage } from "@/lib/canopyImageStore";
import { canopyImageKey } from "@/lib/canopyImages";
import type { CanopySize, CanopyType } from "@/lib/sprayCanopy";
import { cn } from "@/lib/utils";

export function CanopyReferenceImage({
  type,
  size,
  alt,
  className,
}: {
  type: CanopyType | null | undefined;
  size: CanopySize | null | undefined;
  alt: string;
  className?: string;
}) {
  const key = type && size ? canopyImageKey(type, size) : null;
  const { url, defaultUrl } = useCanopyImage(key);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [url]);

  const src = broken ? defaultUrl : url;
  if (!src) return null;

  return (
    <img
      src={src}
      loading="lazy"
      width={640}
      height={640}
      alt={alt}
      data-testid="canopy-reference-image"
      onError={() => setBroken(true)}
      className={cn("w-full rounded bg-background object-contain", className)}
    />
  );
}
