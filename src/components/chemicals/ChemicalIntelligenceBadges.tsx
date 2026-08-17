// Shared read-only presentation for the SQL 194 Chemical Intelligence model.
// Stage 2A: display only — no Mark Verified / Resolve / Re-verify actions.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  groupDisplay,
  type ChemicalIntelligence,
  type VerificationStatus,
} from "@/lib/chemicalIntelligence";

const TONE_CLASS: Record<string, string> = {
  success: "border-transparent bg-primary/15 text-primary",
  warning: "border-transparent bg-warning/20 text-warning-foreground",
  danger: "border-transparent bg-destructive text-destructive-foreground",
  neutral: "border-transparent bg-muted text-muted-foreground",
};

export function VerificationBadge({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  return (
    <Badge
      className={cn(TONE_CLASS[VERIFICATION_TONE[status]], className)}
      title={
        status === "conflict"
          ? "Sources disagree about this product's registration details."
          : status === "needs_match"
            ? "This product has not been matched to a registered label."
            : undefined
      }
    >
      {VERIFICATION_LABEL[status]}
    </Badge>
  );
}

/** Structured activity-group summary, e.g. "FRAC 3 + 11". Legacy free-text is
 *  shown clearly marked as legacy and is never parsed into groups. */
export function ActivityGroupSummary({ chem }: { chem: ChemicalIntelligence }) {
  const display = groupDisplay(chem);
  if (!display) return <span className="text-muted-foreground">—</span>;
  if (display.legacy) {
    return (
      <span
        className="text-xs text-muted-foreground italic"
        title="Legacy value — structured activity groups unavailable"
      >
        {display.text} (legacy)
      </span>
    );
  }
  return <Badge variant="secondary">{display.text}</Badge>;
}
