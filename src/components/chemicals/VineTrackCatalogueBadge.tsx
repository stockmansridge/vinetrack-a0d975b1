import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Certified-style "VineTrack catalogue" badge matching the brand logo. */
export function VineTrackCatalogueBadge({ className, size = "sm" }: { className?: string; size?: "xs" | "sm" }) {
  return (
    <span
      title="Approved VineTrack catalogue product"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border-2 bg-card font-extrabold shadow-sm align-middle",
        size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2.5 py-0.5 text-xs",
        className,
      )}
      style={{ borderColor: "#85B830", fontFamily: "'Montserrat', sans-serif", letterSpacing: "-0.01em", boxShadow: "0 0 0 2px rgba(133,184,48,0.18)" }}
    >
      <BadgeCheck className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} style={{ color: "#85B830" }} aria-hidden />
      <span>
        <span style={{ color: "#000000" }}>Vine</span>
        <span style={{ color: "#85B830" }}>Track</span>
      </span>
      <span className="font-semibold text-muted-foreground">catalogue</span>
    </span>
  );
}
