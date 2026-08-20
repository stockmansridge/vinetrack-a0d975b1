import { cn } from "@/lib/utils";
import type { SetupPresentation } from "@/lib/guide/setupPresentation";

/**
 * Stage 3.2 — the only pill used for OVERALL Core Setup state.
 * Colour is semantic: green = required setup complete, red = required action,
 * neutral = unknown / loading. Never red while unresolved.
 */
export function SetupPresentationPill({
  presentation,
  className,
}: {
  presentation: SetupPresentation;
  className?: string;
}) {
  const tone =
    presentation.state === "complete"
      ? {
          dot: "bg-emerald-600",
          cls: "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-400",
        }
      : presentation.state === "action_required"
        ? { dot: "bg-destructive", cls: "border-destructive/25 bg-destructive/[0.07] text-destructive" }
        : { dot: "bg-muted-foreground/50", cls: "border-border bg-muted text-muted-foreground" };

  return (
    <span
      data-setup-state={presentation.state}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
        tone.cls,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
      {presentation.label}
    </span>
  );
}
