// Manual entry identifier — purple badge with a pencil icon.
//
// Manual origin comes ONLY from the backend source field. It is never inferred
// from a missing route, a missing trip or a manually typed chemical.
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export const MANUAL_ENTRY_LABEL = "Manual entry";
export const MANUAL_ENTRY_STATUS_LABEL = "Completed · Manual entry";

/** Deployed contract: `entry_source === "manual"`. Never inferred. */
export function isManualSpraySource(source: unknown): boolean {
  return String(source ?? "") === "manual";
}

export function ManualEntryBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-purple-400/60 bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300",
        className,
      )}
    >
      <Pencil className="h-3 w-3" aria-hidden />
      {MANUAL_ENTRY_LABEL}
    </span>
  );
}
