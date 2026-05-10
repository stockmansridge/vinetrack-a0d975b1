import { useState } from "react";
import { cn } from "@/lib/utils";
import leafIcon from "@/assets/vinetrack-leaf.png";

interface BrandMarkProps {
  /** Optional vineyard logo URL (signed). Falls back to app icon if missing or fails to load. */
  logoUrl?: string | null;
  size?: number;
  className?: string;
  /** Render as a square tile with brand background (used in headers/login). */
  tile?: boolean;
  /** Render inside a circular frame with a soft accent-green border (sidebar). */
  circle?: boolean;
  alt?: string;
}

/**
 * VineTrack brand mark. Prefers a vineyard logo when provided, otherwise falls
 * back to the grape-leaf app icon used by the iOS app.
 */
export function BrandMark({
  logoUrl,
  size = 32,
  className,
  tile = true,
  circle = false,
  alt = "VineTrack",
}: BrandMarkProps) {
  const [errored, setErrored] = useState(false);
  const showLogo = !!logoUrl && !errored;

  const inner = showLogo ? (
    <img
      src={logoUrl!}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErrored(true)}
      className="h-full w-full object-cover"
    />
  ) : (
    <img
      src={leafIcon}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className="h-[70%] w-[70%] object-contain"
    />
  );

  if (circle) {
    return (
      <div
        className={cn(
          "inline-flex items-center justify-center overflow-hidden rounded-full bg-card",
          className,
        )}
        style={{
          width: size,
          height: size,
          border: "1.5px solid rgba(133, 184, 48, 0.55)",
          boxShadow: "0 0 0 2px rgba(3, 77, 33, 0.35), 0 2px 6px rgba(0,0,0,0.18)",
        }}
      >
        {inner}
      </div>
    );
  }

  if (!tile) {
    return (
      <div
        className={cn("inline-flex items-center justify-center overflow-hidden", className)}
        style={{ width: size, height: size }}
      >
        {inner}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-xl shadow-sm",
        "bg-card",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {inner}
    </div>
  );
}
