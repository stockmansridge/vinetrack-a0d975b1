import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

/** Blue companion to the VineTrack catalogue badge: product added by this vineyard. */
export const VINEYARD_PRODUCT_LABEL = "Vineyard product";

export function VineyardProductBadge({ className, size = "sm" }: { className?: string; size?: "xs" | "sm" }) {
  return (
    <span
      title="Added by this vineyard — not from the VineTrack catalogue"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border-2 bg-card font-bold shadow-sm align-middle",
        size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2.5 py-0.5 text-xs",
        className,
      )}
      style={{ borderColor: "#2F7FD8", color: "#1F5FA8", fontFamily: "'Montserrat', sans-serif", letterSpacing: "-0.01em", boxShadow: "0 0 0 2px rgba(47,127,216,0.18)" }}
    >
      <Home className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} style={{ color: "#2F7FD8" }} aria-hidden />
      <span>{VINEYARD_PRODUCT_LABEL}</span>
    </span>
  );
}
