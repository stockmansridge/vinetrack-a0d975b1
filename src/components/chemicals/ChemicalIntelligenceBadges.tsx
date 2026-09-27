// Shared read-only presentation for the SQL 194 Chemical Intelligence model.
// Stage 2A: display only — no Mark Verified / Resolve / Re-verify actions.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  VERIFICATION_TOOLTIP,
  resistanceGroupDisplay,
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
      title={VERIFICATION_TOOLTIP[status]}
    >
      {VERIFICATION_LABEL[status]}
    </Badge>
  );
}

/**
 * Resistance group, driven by the backend's structured classification state:
 * the structured group(s) when classified, "No resistance group applies" when
 * the backend says not applicable, and "Resistance group unknown" plus the
 * rotation warning when it is explicitly unresolved. An unresolved product is
 * never blank and never reads as safe; legacy free-text stays marked as legacy
 * and is never parsed into groups.
 */
export function ActivityGroupSummary({ chem }: { chem: ChemicalIntelligence }) {
  const display = resistanceGroupDisplay(chem);
  if (display.kind === "none") return <span className="text-muted-foreground">—</span>;
  if (display.kind === "legacy") {
    return (
      <span
        className="text-xs text-muted-foreground italic"
        title="Legacy value — structured activity groups unavailable"
      >
        {display.text} (legacy)
      </span>
    );
  }
  if (display.kind === "unresolved") {
    return (
      <Badge className={TONE_CLASS.warning} title={display.warning}>
        {display.text}
      </Badge>
    );
  }
  if (display.kind === "not_applicable") {
    return (
      <span className="text-xs text-muted-foreground">{display.text}</span>
    );
  }
  return <Badge variant="secondary">{display.text}</Badge>;
}
