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
        showLogo ? "bg-card" : "bg-sidebar-primary",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {inner}
    </div>
  );
}
