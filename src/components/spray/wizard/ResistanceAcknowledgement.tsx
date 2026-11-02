// Stage 3C — the Review-step verdict and its acknowledgement.
//
// The verdict is computed live by the ported CropLife engine every time the
// job is opened. NOTHING here is written to the database: an acknowledgement
// records that a person read today's assessment, not that the spray is
// permanently compliant.
//
// Layout contract: the acknowledgement checkbox sits directly under the
// verdict, BEFORE the verbatim rule lines. A long findings list (Greg hit 23)
// must never push the required control below the fold — the lines live in an
// expandable details section instead.
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Info, ShieldAlert } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResistanceEvaluationStatus } from "@/lib/resistance/resistanceEvaluation";

export const RESISTANCE_STATUS_LABEL: Record<ResistanceEvaluationStatus, string> = {
  compliant: "Good fit — no limit reached",
  approaching_limit: "Approaching a strategy limit",
  limit_reached: "Strategy maximum reached",
  strategy_exceeded: "Strategy exceeded",
  unable_to_fully_assess: "Unable to fully assess",
  not_applicable: "No history this season",
  unsupported_ruleset: "No strategy configured for this country",
};

// What the verdict actually means, in plain words. `unable_to_fully_assess`
// is about missing or disputed history — it is NOT a count of confirmed label
// violations, and must never be worded as one. Limit states quote the engine
// result exactly and are never downgraded.
const STATUS_EXPLANATION: Partial<Record<ResistanceEvaluationStatus, string>> = {
  unable_to_fully_assess:
    "Recorded spray history is missing or disputed, so this rotation cannot be fully assessed. This is not a list of confirmed label violations — the exact engine findings are kept verbatim in the details below and on the Resistance step.",
  approaching_limit:
    "The strategy engine reports this application is approaching a CropLife strategy limit. The exact findings are kept verbatim in the details below and on the Resistance step.",
  limit_reached:
    "The strategy engine reports this application reaches a CropLife strategy maximum. The exact findings are kept verbatim in the details below and on the Resistance step.",
  strategy_exceeded:
    "The strategy engine reports this application exceeds a CropLife strategy maximum. The exact findings are kept verbatim in the details below and on the Resistance step.",
};

// Above this many findings the details start collapsed so the acknowledgement
// stays visible; fewer findings are shown inline.
const COLLAPSE_THRESHOLD = 3;

function Icon({ status }: { status: ResistanceEvaluationStatus }) {
  if (status === "strategy_exceeded") return <ShieldAlert className="h-4 w-4 text-destructive" />;
  if (status === "limit_reached" || status === "approaching_limit") {
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  }
  if (status === "compliant") return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (status === "unsupported_ruleset") return <Info className="h-4 w-4 text-muted-foreground" />;
  return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
}

export function ResistanceAcknowledgement({
  status,
  lines,
  requiresAcknowledgement,
  acknowledged,
  onAcknowledgedChange,
  disabled,
}: {
  status: ResistanceEvaluationStatus | null;
  /** One sentence per block/disease, verbatim from the engine. */
  lines: string[];
  requiresAcknowledgement: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  // The findings arrive asynchronously and `lines` is rebuilt by the parent on
  // every render, so identity is the CONTENT, not the array reference. A user
  // toggle is recorded against the current content key; when the findings
  // change (empty → 23, 23 → 2, …) the auto default applies again, while
  // unrelated rerenders with the same findings keep the user's choice.
  const linesKey = lines.join("\n");
  const [toggled, setToggled] = useState<{ key: string; open: boolean } | null>(null);
  const detailsOpen =
    toggled && toggled.key === linesKey ? toggled.open : lines.length <= COLLAPSE_THRESHOLD;
  if (!status) return null;
  const explanation = STATUS_EXPLANATION[status];
  return (
    <section
      data-testid="resistance-verdict"
      className={cn(
        "rounded-md border p-3",
        status === "strategy_exceeded"
          ? "border-destructive/50 bg-destructive/5"
          : status === "limit_reached" || status === "approaching_limit"
            ? "border-amber-500/40 bg-amber-500/5"
            : "bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon status={status} />
        <span className="text-sm font-semibold">Resistance check</span>
        <Badge variant="outline">{RESISTANCE_STATUS_LABEL[status]}</Badge>
      </div>
      {explanation && <p className="mt-2 text-xs text-muted-foreground">{explanation}</p>}
      {lines.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {lines.length} block/disease evaluation{lines.length === 1 ? "" : "s"} listed.
        </p>
      )}
      {requiresAcknowledgement && (
        <label className="mt-3 flex items-start gap-2 rounded-md border border-border bg-background p-2 text-xs">
          <Checkbox
            id="resistance-ack"
            data-testid="resistance-ack"
            checked={acknowledged}
            disabled={disabled}
            onCheckedChange={(v) => onAcknowledgedChange(v === true)}
          />
          <span>
            {status === "strategy_exceeded"
              ? "I have read the CropLife strategy findings and choose to proceed with this application."
              : "I understand this rotation cannot be fully assessed from the recorded history and choose to proceed."}
          </span>
        </label>
      )}
      {lines.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls="resistance-details"
            onClick={() => setToggled({ key: linesKey, open: !detailsOpen })}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            {detailsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {detailsOpen ? "Hide" : "Show"} resistance details ({lines.length})
          </button>
          {detailsOpen && (
            <ul id="resistance-details" className="mt-1 space-y-1 text-xs text-muted-foreground">
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
