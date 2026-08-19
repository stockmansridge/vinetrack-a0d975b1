// Shared resistance presentation (Stage 3C UI, reused by the Stage 4 planner).
//
// Presentation only: every number, threshold and sentence comes from the
// engine result. Nothing here counts, compares or concludes, and there is no
// score — findings carry the rule, the limit and what was observed.
import { AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { DISEASE_LABEL } from "@/lib/resistance/resistanceRuleset";
import {
  evaluationFindings,
  type ResistanceEvaluation,
  type ResistanceEvaluationStatus,
  type ResistanceRuleResult,
} from "@/lib/resistance/resistanceEvaluation";

export const STATUS_LABEL: Record<ResistanceEvaluationStatus, string> = {
  compliant: "No limit reached",
  approaching_limit: "Approaching a limit",
  limit_reached: "Strategy maximum reached",
  strategy_exceeded: "Strategy exceeded",
  unable_to_fully_assess: "Unable to fully assess",
  not_applicable: "No history this season",
  unsupported_ruleset: "No strategy configured",
};

export const STATUS_TONE: Record<ResistanceEvaluationStatus, string> = {
  compliant: "border-primary/40 bg-primary/5",
  approaching_limit: "border-amber-500/40 bg-amber-500/5",
  limit_reached: "border-amber-600/50 bg-amber-500/10",
  strategy_exceeded: "border-destructive/50 bg-destructive/5",
  unable_to_fully_assess: "border-muted-foreground/30 bg-muted/40",
  not_applicable: "border-muted-foreground/20 bg-muted/20",
  unsupported_ruleset: "border-muted-foreground/20 bg-muted/20",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  high: "Verified evidence",
  qualified: "Unverified chemistry",
  indeterminate: "Incomplete evidence",
};

export function StatusIcon({ status }: { status: ResistanceEvaluationStatus }) {
  if (status === "strategy_exceeded") {
    return <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  }
  if (status === "limit_reached" || status === "approaching_limit") {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />;
  }
  if (status === "compliant") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />;
  }
  return <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function FindingRow({ finding }: { finding: ResistanceRuleResult }) {
  return (
    <div className="rounded-md border px-3 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{finding.explanation}</span>
        <Badge
          variant={
            finding.severity === "critical"
              ? "destructive"
              : finding.severity === "warning"
                ? "default"
                : "outline"
          }
          className="shrink-0"
        >
          {finding.severity}
        </Badge>
      </div>
      <div className="mt-1 text-muted-foreground">
        Limit: {finding.thresholdDescription}. Recorded: {finding.observedDescription}.
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {finding.groups.map((g) => (
          <Badge key={g} variant="secondary" className="text-[10px]">
            Group {g}
          </Badge>
        ))}
        <Badge variant="outline" className="text-[10px]">
          {finding.ruleId}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {finding.rulesetId} · {finding.rulesetVersion}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {EVIDENCE_LABEL[finding.evidenceQuality] ?? finding.evidenceQuality}
        </Badge>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        CropLife Australia — {finding.sourceReference}: “{finding.sourceText}”
      </div>
    </div>
  );
}

export function ResistanceEvaluationCard({
  evaluation,
  heading,
}: {
  evaluation: ResistanceEvaluation;
  heading?: string;
}) {
  const findings = evaluationFindings(evaluation);
  return (
    <div className={cn("rounded-md border p-3", STATUS_TONE[evaluation.status])}>
      <div className="flex items-start gap-2">
        <StatusIcon status={evaluation.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {heading ?? DISEASE_LABEL[evaluation.disease]}
            </span>
            <Badge variant="outline">{STATUS_LABEL[evaluation.status]}</Badge>
            <Badge variant="outline">{EVIDENCE_LABEL[evaluation.evidenceQuality]}</Badge>
          </div>
          <p className="mt-1 text-xs">{evaluation.summary}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {evaluation.totalDiseaseSpraysInSeason} spray
            {evaluation.totalDiseaseSpraysInSeason === 1 ? "" : "s"} counted this season
            {evaluation.candidateApplicationId ? " (including this one)" : ""}
            {evaluation.rulesetVersion ? ` · Strategy ${evaluation.rulesetVersion}` : ""}
          </p>
        </div>
      </div>

      {findings.length > 0 && (
        <Accordion type="single" collapsible className="mt-2">
          <AccordionItem value="findings" className="border-none">
            <AccordionTrigger className="py-1 text-xs">
              {findings.length} rule{findings.length === 1 ? "" : "s"} to review
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pt-1">
              {findings.map((f) => (
                <FindingRow key={`${f.ruleId}:${f.blockId}`} finding={f} />
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
