import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
  suffix?: string;
  suffixClassName?: string;
}

/**
 * VineTrack brand name text. "Vine" inherits the current text color from the
 * parent so it works on both light and dark backgrounds. "Track" is always
 * rendered in the brand green (#85B830). Uses Montserrat ExtraBold with
 * slightly tight letter spacing.
 */
export function BrandName({ className, suffix, suffixClassName }: BrandNameProps) {
  return (
    <span
      className={cn("inline-flex items-baseline font-extrabold", className)}
      style={{
        fontFamily: "'Montserrat', sans-serif",
        letterSpacing: "-0.015em",
      }}
    >
      <span>Vine</span>
      <span style={{ color: "#85B830" }}>Track</span>
      {suffix && (
        <span className={cn("ml-1.5", suffixClassName)}>{suffix}</span>
      )}
    </span>
  );
}
