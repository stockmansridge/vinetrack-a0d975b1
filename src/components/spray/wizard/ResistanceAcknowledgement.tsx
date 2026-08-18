// Stage 3C — the Review-step verdict and its acknowledgement.
//
// The verdict is computed live by the ported CropLife engine every time the
// job is opened. NOTHING here is written to the database: an acknowledgement
// records that a person read today's assessment, not that the spray is
// permanently compliant.
import { AlertTriangle, CheckCircle2, HelpCircle, Info, ShieldAlert } from "lucide-react";
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
  if (!status) return null;
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
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {requiresAcknowledgement && (
        <label className="mt-3 flex items-start gap-2 text-xs">
          <Checkbox
            data-testid="resistance-ack"
            checked={acknowledged}
            disabled={disabled}
            onCheckedChange={(v) => onAcknowledgedChange(v === true)}
          />
          <span>
            {status === "strategy_exceeded"
              ? "I have read the CropLife strategy findings above and choose to proceed with this application."
              : "I understand this rotation cannot be fully assessed from the recorded history and choose to proceed."}
          </span>
        </label>
      )}
    </section>
  );
}
