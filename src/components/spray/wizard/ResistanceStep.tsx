// Stage 3C — the live Resistance Check.
//
// Every word of judgement on this screen comes from the ported CropLife rules
// engine. This component renders; it never counts, compares or concludes.
//
// It also never says "safe", "compliant" or "approved" on its own authority:
// the engine's own summary sentence is shown verbatim, so a result computed
// from unverified chemistry reads as exactly that.
import { AlertTriangle, CheckCircle2, HelpCircle, Info, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { activityGroupSummary } from "@/lib/chemicalIntelligence";
import { useResistanceAssessment } from "@/hooks/useResistanceAssessment";
import { DISEASE_LABEL } from "@/lib/resistance/resistanceRuleset";
import {
  evaluationFindings,
  type ResistanceEvaluation,
  type ResistanceEvaluationStatus,
  type ResistanceRuleResult,
} from "@/lib/resistance/resistanceEvaluation";
import type { StepProps } from "./types";

const STATUS_LABEL: Record<ResistanceEvaluationStatus, string> = {
  compliant: "No limit reached",
  approaching_limit: "Approaching a limit",
  limit_reached: "Strategy maximum reached",
  strategy_exceeded: "Strategy exceeded",
  unable_to_fully_assess: "Unable to fully assess",
  not_applicable: "No history this season",
  unsupported_ruleset: "No strategy configured",
};

const STATUS_TONE: Record<ResistanceEvaluationStatus, string> = {
  compliant: "border-primary/40 bg-primary/5",
  approaching_limit: "border-amber-500/40 bg-amber-500/5",
  limit_reached: "border-amber-600/50 bg-amber-500/10",
  strategy_exceeded: "border-destructive/50 bg-destructive/5",
  unable_to_fully_assess: "border-muted-foreground/30 bg-muted/40",
  not_applicable: "border-muted-foreground/20 bg-muted/20",
  unsupported_ruleset: "border-muted-foreground/20 bg-muted/20",
};

function StatusIcon({ status }: { status: ResistanceEvaluationStatus }) {
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

const EVIDENCE_LABEL: Record<string, string> = {
  high: "Verified evidence",
  qualified: "Unverified chemistry",
  indeterminate: "Incomplete evidence",
};

function FindingRow({ finding }: { finding: ResistanceRuleResult }) {
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
      <div className="mt-1 text-[11px] text-muted-foreground">
        CropLife Australia — {finding.sourceReference}: “{finding.sourceText}”
      </div>
    </div>
  );
}

function EvaluationCard({ evaluation }: { evaluation: ResistanceEvaluation }) {
  const findings = evaluationFindings(evaluation);
  return (
    <div className={cn("rounded-md border p-3", STATUS_TONE[evaluation.status])}>
      <div className="flex items-start gap-2">
        <StatusIcon status={evaluation.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{DISEASE_LABEL[evaluation.disease]}</span>
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

export function ResistanceStep({ app, intelligenceById, vineyardId, lookups }: StepProps) {
  const blocks = (lookups.paddocks ?? []).map((p: any) => ({ id: p.id, name: p.name }));
  const assessment = useResistanceAssessment({
    enabled: true,
    vineyardId,
    application: app,
    intelligenceById,
    blocks,
  });

  const targets = app.targets ?? [];
  const assessableTargets = targets.filter(
    (t) => t === "powdery_mildew" || t === "downy_mildew",
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <div className="font-medium">
            CropLife Australia resistance management strategies (valid as at 22 July 2026)
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            These are resistance management guides, not label directions and not law. VineTrack
            reports what the published strategies say about this rotation so you can decide.
            Always follow the product label.
          </p>
        </div>
      </div>

      {!assessment.supported && (
        <div className="rounded-md border border-muted-foreground/30 bg-muted/40 p-3 text-xs">
          A VineTrack resistance strategy is not yet configured for this vineyard's country
          {assessment.jurisdictionLabelCode === "unknown"
            ? " (no country recorded)"
            : ` (${assessment.jurisdictionLabelCode})`}
          . Australian limits are deliberately not applied as a fallback.
        </div>
      )}

      {app.isTemplate && (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          Templates have no blocks and no date, so they have no position in any block's spray
          history. The resistance check runs when the template is used to create a job.
        </div>
      )}

      {!app.isTemplate && assessableTargets.length === 0 && (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          No powdery or downy mildew target is selected on the Target step. The CropLife
          strategies VineTrack carries cover those two diseases, and a spray is only counted
          against the disease it was declared for.
        </div>
      )}

      {!app.isTemplate && (app.blockIds ?? []).length === 0 && (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          Select blocks to assess this rotation — resistance history belongs to the vines that
          received the chemistry, so it is always evaluated per block.
        </div>
      )}

      {assessment.isLoading && (
        <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading season spray history…
        </div>
      )}

      {assessment.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          Season history could not be read, so no resistance result can be given:{" "}
          {assessment.error.message}
        </div>
      )}

      {!assessment.isLoading &&
        !assessment.error &&
        assessment.blocks.map((block) => (
          <div key={block.blockId} className="space-y-2">
            <h3 className="text-sm font-semibold">{block.blockName}</h3>
            {block.evaluations.map((evaluation) => (
              <EvaluationCard key={evaluation.disease} evaluation={evaluation} />
            ))}
          </div>
        ))}

      {!assessment.isLoading &&
        assessment.diseases.map((disease) => {
          const unresolved = assessment.unresolvedByDisease[disease] ?? [];
          if (unresolved.length === 0) return null;
          return (
            <div
              key={`unresolved-${disease}`}
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs"
            >
              {unresolved.length} recorded {DISEASE_LABEL[disease]} spray
              {unresolved.length === 1 ? "" : "s"} this season {unresolved.length === 1 ? "has" : "have"}{" "}
              no recorded blocks, so {unresolved.length === 1 ? "it" : "they"} cannot be placed on any
              block's history. Block results above may therefore be incomplete.
            </div>
          );
        })}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Activity groups in this mix</h3>
        {app.products.length === 0 && (
          <p className="text-xs text-muted-foreground">No products added.</p>
        )}
        {app.products.map((line, i) => {
          const intel = line.savedChemicalId ? intelligenceById.get(line.savedChemicalId) ?? null : null;
          const summary = intel ? activityGroupSummary(intel) : null;
          const fallback = line.activityGroups
            .map((g) => `${g.scheme.toUpperCase()} ${g.code}`)
            .join(", ");
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="truncate">
                {line.productName ?? SPRAY_TARGET_LABEL_FALLBACK}
              </span>
              {summary || fallback ? (
                <Badge variant="outline">{summary || fallback}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No activity group recorded — this application cannot be fully assessed
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
