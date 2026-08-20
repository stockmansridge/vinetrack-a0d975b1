import { Lock, Sparkles, HelpCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  GuideAvailability,
  GuideImportance,
} from "@/lib/guide/howVineTrackWorksCatalogue";

/** Internal-only marker for catalogue items that are not customer capabilities. */
export function InternalBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <Lock className="h-3 w-3" />
      Internal
    </span>
  );
}

/**
 * Availability is distinct from platform coverage, from setup status and from
 * importance. "available" renders nothing — the platform pills already say where.
 */
export function AvailabilityBadge({
  availability,
  className,
}: {
  availability: GuideAvailability;
  className?: string;
}) {
  if (availability === "available") return null;
  if (availability === "internal") return <InternalBadge className={className} />;
  if (availability === "coming_soon") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
          className,
        )}
      >
        <Sparkles className="h-3 w-3" />
        Coming soon
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      <HelpCircle className="h-3 w-3" />
      Unclassified
    </span>
  );
}

const IMPORTANCE_LABEL: Record<GuideImportance, string> = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
  conditional: "If applicable",
};

export function ImportanceBadge({
  importance,
  className,
}: {
  importance?: GuideImportance;
  className?: string;
}) {
  if (!importance) return null;
  const tone =
    importance === "required"
      ? "border-primary/40 bg-primary/10 text-primary"
      : importance === "recommended"
        ? "border-border bg-muted text-foreground/70"
        : "border-border bg-muted/60 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone,
        className,
      )}
    >
      {importance === "required" && <CheckCircle2 className="h-3 w-3" />}
      {IMPORTANCE_LABEL[importance]}
    </span>
  );
}
