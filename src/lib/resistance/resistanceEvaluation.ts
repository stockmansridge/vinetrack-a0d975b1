// Stage 3C — evaluation result model. Port of `ResistanceEvaluation.swift`.
import type {
  ResistanceCrop,
  ResistanceDisease,
  ResistanceJurisdiction,
} from "./resistanceRuleset";

/**
 * The outcome of one rule against one block's history for one disease.
 *
 * Deliberately never a Boolean. "Two Group 11 sprays already applied" and "this
 * would be the third consecutive Group 3" require different operator decisions,
 * and collapsing both to `false` throws away the only information that makes a
 * warning actionable.
 */
export type ResistanceRuleStatus =
  | "not_triggered"
  | "within_limit"
  | "approaching_limit"
  | "limit_reached"
  | "would_reach_limit"
  | "would_exceed_limit"
  | "limit_exceeded"
  | "requirement_not_met"
  | "requirement_unproven"
  | "unable_to_assess"
  | "guidance";

export const ruleStatusIsBreach = (s: ResistanceRuleStatus): boolean =>
  s === "limit_exceeded" || s === "would_exceed_limit" || s === "requirement_not_met";

export const ruleStatusIsAtLimit = (s: ResistanceRuleStatus): boolean =>
  s === "limit_reached" || s === "would_reach_limit";

/** Kept separate from status so the domain never carries UI colours. */
export type ResistanceSeverity =
  | "informational"
  | "advisory"
  | "warning"
  | "critical"
  | "indeterminate";

export const SEVERITY_RANK: Record<ResistanceSeverity, number> = {
  critical: 5,
  warning: 4,
  indeterminate: 3,
  advisory: 2,
  informational: 1,
};

/**
 * How much the evidence behind a result can be relied on. A count derived from
 * verified chemistry and the same count derived from an operator's unverified
 * typing are not the same claim.
 */
export type ResistanceEvidenceQuality = "high" | "qualified" | "indeterminate";

/**
 * `satisfied` is reachable only when something independent establishes that a
 * partner from an alternative mode of action was applied at an effective rate.
 * Group codes alone cannot establish that.
 */
export type ResistanceMixtureRequirement = "satisfied" | "not_satisfied" | "unknown";

/** The overall verdict for one disease, one block, one season. */
export type ResistanceEvaluationStatus =
  | "compliant"
  | "approaching_limit"
  | "limit_reached"
  | "strategy_exceeded"
  | "unable_to_fully_assess"
  | "not_applicable"
  | "unsupported_ruleset";

/**
 * A single explainable finding. There is deliberately no opaque score anywhere
 * in this engine: "Resistance Score 73" cannot be argued with, acted on, or
 * corrected, whereas "this would be a third consecutive Group 3 application,
 * CropLife Guideline 4 permits two" can be all three.
 */
export interface ResistanceRuleResult {
  ruleId: string;
  rulesetId: string;
  rulesetVersion: string;
  disease: ResistanceDisease;
  blockId: string;
  status: ResistanceRuleStatus;
  severity: ResistanceSeverity;
  groups: string[];
  threshold: number | null;
  thresholdDescription: string;
  observedValue: number | null;
  observedDescription: string;
  explanation: string;
  contributingApplicationIds: string[];
  contributingDatesEpochMs: number[];
  evidenceQuality: ResistanceEvidenceQuality;
  mixtureRequirement: ResistanceMixtureRequirement | null;
  /** Published clause, e.g. `"Guideline 4"`. */
  sourceReference: string;
  /** The published sentence, verbatim. */
  sourceText: string;
}

export const ruleResultId = (r: ResistanceRuleResult): string =>
  `${r.rulesetId}|${r.ruleId}|${r.blockId}`;

/** The complete evaluation for one disease against one block. */
export interface ResistanceEvaluation {
  status: ResistanceEvaluationStatus;
  jurisdiction: ResistanceJurisdiction;
  crop: ResistanceCrop;
  disease: ResistanceDisease;
  blockId: string;
  seasonId: string;
  /** Null only for `unsupported_ruleset`. */
  rulesetId: string | null;
  rulesetVersion: string | null;
  rulesetValidFrom: string | null;
  ruleResults: ResistanceRuleResult[];
  /** Denominator for every percentage rule. */
  totalDiseaseSpraysInSeason: number;
  consideredApplicationIds: string[];
  /** Chemistry disputed or missing — these stay in the chronology. */
  unassessableApplicationIds: string[];
  /** Pre-sql/193 records with no recorded target disease. */
  unattributedApplicationIds: string[];
  /** Excluded because planned rather than applied — surfaced, not hidden. */
  excludedPlannedApplicationIds: string[];
  evidenceQuality: ResistanceEvidenceQuality;
  summary: string;
  candidateApplicationId: string | null;
}

/** Findings worth showing, worst first. */
export const evaluationFindings = (e: ResistanceEvaluation): ResistanceRuleResult[] =>
  e.ruleResults
    .filter((r) => r.status !== "not_triggered" && r.status !== "within_limit")
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

export const evaluationBreaches = (e: ResistanceEvaluation): ResistanceRuleResult[] =>
  e.ruleResults.filter((r) => ruleStatusIsBreach(r.status));

export const evaluationHasCandidate = (e: ResistanceEvaluation): boolean =>
  e.candidateApplicationId != null;

/**
 * Whether this result may be presented as a clean pass. False whenever
 * chemistry is missing, disputed or unattributable, no matter how empty the
 * arithmetic came out.
 */
export const evaluationIsCleanResult = (e: ResistanceEvaluation): boolean =>
  e.status === "compliant" && e.evidenceQuality === "high";

/* --------------------------------------------------- overall aggregation */

/**
 * Ordering used to reduce many block/disease evaluations to ONE headline.
 * Aggregation is worst-case, never an average: a rotation that exceeds the
 * strategy on one block out of five is an exceeded rotation, and averaging it
 * away is precisely the false clean result this engine exists to prevent.
 */
export const EVALUATION_STATUS_RANK: Record<ResistanceEvaluationStatus, number> = {
  strategy_exceeded: 6,
  unable_to_fully_assess: 5,
  limit_reached: 4,
  approaching_limit: 3,
  compliant: 2,
  not_applicable: 1,
  unsupported_ruleset: 0,
};

export function worstEvaluationStatus(
  statuses: ResistanceEvaluationStatus[],
): ResistanceEvaluationStatus | null {
  let worst: ResistanceEvaluationStatus | null = null;
  for (const s of statuses) {
    if (worst == null || EVALUATION_STATUS_RANK[s] > EVALUATION_STATUS_RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * A result the operator must consciously accept before the job can be saved.
 * Acknowledgement is a UI act only — nothing about it is written to the
 * database, because a stored verdict would go stale the moment the history or
 * the published strategy changes.
 */
export const statusRequiresAcknowledgement = (
  s: ResistanceEvaluationStatus | null,
): boolean => s === "strategy_exceeded" || s === "unable_to_fully_assess";
