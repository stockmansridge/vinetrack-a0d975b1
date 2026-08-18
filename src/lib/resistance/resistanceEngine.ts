// Stage 3C — the Resistance Rules Engine. Port of `ResistanceEngine.swift`
// (mirrored by `ResistanceEngine.kt`).
//
// Pure domain logic: no React, no Supabase, no clock. Everything it knows
// arrives in the request, which is what lets ONE implementation serve saved
// history, an unsaved wizard draft, and a test fixture — and what keeps the
// portal's answer identical to the phone's.
import {
  DISEASE_LABEL,
  currentRuleset,
  maxUseColumn,
  maxUseFor,
  selectorDescribedGroups,
  signatureKey,
  type ResistanceCrop,
  type ResistanceDisease,
  type ResistanceGroupSelector,
  type ResistanceJurisdiction,
  type ResistanceRule,
  type ResistanceRuleset,
  type ResistanceRulesetRegistry,
} from "./resistanceRuleset";
import { RESISTANCE_REGISTRY } from "./resistanceRulesets";
import {
  availabilityIsDependable,
  chronological,
  eventAvailability,
  eventCanAssessChemistry,
  eventCoformulationSignatures,
  eventComponentGroups,
  eventGroupsOtherThan,
  eventTargets,
  type ResistanceApplicationEvent,
  type ResistanceEventKind,
} from "./resistanceEvent";
import {
  previousSeason,
  seasonContains,
  type ResistanceSeason,
  type ResistanceSeasonCalendar,
} from "./resistanceSeason";
import type {
  ResistanceEvaluation,
  ResistanceEvaluationStatus,
  ResistanceEvidenceQuality,
  ResistanceMixtureRequirement,
  ResistanceRuleResult,
  ResistanceRuleStatus,
  ResistanceSeverity,
} from "./resistanceEvaluation";
import { ruleStatusIsAtLimit, ruleStatusIsBreach } from "./resistanceEvaluation";

/** What to evaluate. The same request produces the same result on every platform. */
export interface ResistanceEvaluationRequest {
  jurisdiction: ResistanceJurisdiction;
  crop: ResistanceCrop;
  disease: ResistanceDisease;
  blockId: string;
  season: ResistanceSeason;
  seasonCalendar: ResistanceSeasonCalendar;
  /**
   * Every candidate event, any block, any disease, any season. The ENGINE does
   * the filtering, so callers cannot accidentally pre-filter away the previous
   * season's tail that a cross-season rule needs.
   */
  events: ResistanceApplicationEvent[];
  /** A proposed next spray. Need not be saved and need not have a real ID. */
  candidate?: ResistanceApplicationEvent | null;
  /** Whether scheduled-but-unapplied events count as history. False in v1. */
  includePlanned?: boolean;
  registry?: ResistanceRulesetRegistry;
}

/* ------------------------------------------------------------- selectors */

export function selectorMatches(
  selector: ResistanceGroupSelector,
  event: ResistanceApplicationEvent,
): boolean {
  switch (selector.kind) {
    case "containsGroup":
      return eventComponentGroups(event).has(selector.code);
    case "coformulation": {
      const key = signatureKey(selector.signature);
      return eventCoformulationSignatures(event).some((s) => signatureKey(s) === key);
    }
    case "anyCoformulation": {
      const keys = new Set(selector.signatures.map(signatureKey));
      return eventCoformulationSignatures(event).some((s) => keys.has(signatureKey(s)));
    }
    case "anyGroup": {
      const groups = eventComponentGroups(event);
      return selector.codes.some((c) => groups.has(c));
    }
  }
}

/* ---------------------------------------------------------------- context */

interface EvaluationContext {
  request: ResistanceEvaluationRequest;
  ruleset: ResistanceRuleset;
  currentSeasonSequence: ResistanceApplicationEvent[];
  crossSeasonSequence: ResistanceApplicationEvent[];
  candidate: ResistanceApplicationEvent | null;
  totalDiseaseSprays: number;
  unattributedInSeason: ResistanceApplicationEvent[];
}

const sequenceForRule = (
  ctx: EvaluationContext,
  rule: ResistanceRule,
): ResistanceApplicationEvent[] =>
  rule.crossSeason ? ctx.crossSeasonSequence : ctx.currentSeasonSequence;

/** An intermediate result, before availability gating and packaging. */
interface Partial_ {
  status: ResistanceRuleStatus;
  threshold: number | null;
  thresholdDescription: string;
  observedValue: number | null;
  observedDescription: string;
  explanation: string;
  contributing: ResistanceApplicationEvent[];
  mixtureRequirement?: ResistanceMixtureRequirement | null;
  /** Pure guidance is never gated by availability. */
  isGuidance?: boolean;
}

const plural = (n: number, suffix = "s"): string => (n === 1 ? "" : suffix);
const groupsText = (selector: ResistanceGroupSelector): string =>
  selectorDescribedGroups(selector).join(" + ");

/* -------------------------------------------------------- consecutive runs */

/** Maximal runs of adjacent matching events. */
function maximalRuns(
  sequence: ResistanceApplicationEvent[],
  selector: ResistanceGroupSelector,
): ResistanceApplicationEvent[][] {
  const runs: ResistanceApplicationEvent[][] = [];
  let current: ResistanceApplicationEvent[] = [];
  for (const event of sequence) {
    if (selectorMatches(selector, event)) current.push(event);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

/** The run of matching events ending at the end of the sequence. */
function trailingRun(
  sequence: ResistanceApplicationEvent[],
  selector: ResistanceGroupSelector,
): ResistanceApplicationEvent[] {
  const trailing: ResistanceApplicationEvent[] = [];
  for (let i = sequence.length - 1; i >= 0; i -= 1) {
    if (!selectorMatches(selector, sequence[i])) break;
    trailing.unshift(sequence[i]);
  }
  return trailing;
}

function longestRun(runs: ResistanceApplicationEvent[][]): ResistanceApplicationEvent[] {
  let best: ResistanceApplicationEvent[] = [];
  for (const run of runs) if (run.length >= best.length && run.length > 0) best = run;
  return best;
}

function spansSeasonBoundary(
  run: ResistanceApplicationEvent[],
  ctx: EvaluationContext,
): boolean {
  if (run.length < 2) return false;
  const inSeason = run.some((e) => seasonContains(ctx.request.season, e.appliedAtEpochMs));
  const outSeason = run.some((e) => !seasonContains(ctx.request.season, e.appliedAtEpochMs));
  return inSeason && outSeason;
}

function notTriggered(
  rule: ResistanceRule,
  threshold: number | null,
  thresholdText: string,
): Partial_ {
  return {
    status: "not_triggered",
    threshold,
    thresholdDescription: thresholdText,
    observedValue: 0,
    observedDescription: "no matching applications",
    explanation: `Group ${groupsText(rule.selector)} does not appear in this history.`,
    contributing: [],
  };
}

function evaluateConsecutive(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  limit: number,
): Partial_ {
  const sequence = sequenceForRule(ctx, rule);
  const groups = groupsText(rule.selector);
  const candidateId = ctx.candidate?.applicationId ?? null;
  const historyOnly = sequence.filter((e) => e.applicationId !== candidateId);

  const historyRuns = maximalRuns(historyOnly, rule.selector);
  const historyLongest = historyRuns.reduce((m, r) => Math.max(m, r.length), 0);
  const candidateMatches = ctx.candidate ? selectorMatches(rule.selector, ctx.candidate) : false;
  const candidateRun = candidateMatches ? trailingRun(sequence, rule.selector) : [];

  const runForNote = candidateRun.length === 0 ? longestRun(historyRuns) : candidateRun;
  const crossSeasonNote =
    rule.crossSeason && spansSeasonBoundary(runForNote, ctx)
      ? " This run continues from the previous season, which the strategy counts as consecutive."
      : "";

  const thresholdText =
    limit === 1
      ? `Group ${groups} must not be applied consecutively`
      : `a maximum of ${limit} consecutive Group ${groups} applications`;
  const disease = DISEASE_LABEL[ctx.request.disease];
  const firstLongest = historyRuns.find((r) => r.length === historyLongest) ?? [];

  if (historyLongest > limit) {
    return {
      status: "limit_exceeded",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: historyLongest,
      observedDescription: `${historyLongest} consecutive applications recorded`,
      explanation: `Group ${groups} has already been applied ${historyLongest} times in a row for ${disease}. The strategy allows ${limit}.${crossSeasonNote}`,
      contributing: firstLongest,
    };
  }
  if (candidateMatches && candidateRun.length > limit) {
    return {
      status: "would_exceed_limit",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: candidateRun.length,
      observedDescription: `${candidateRun.length} consecutive applications including this one`,
      explanation: `This would be consecutive Group ${groups} application number ${candidateRun.length}. The strategy allows ${limit}.${crossSeasonNote}`,
      contributing: candidateRun,
    };
  }
  if (candidateMatches && candidateRun.length === limit) {
    return {
      status: "would_reach_limit",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: candidateRun.length,
      observedDescription: `${candidateRun.length} consecutive applications including this one`,
      explanation: `This would reach the strategy maximum of ${limit} consecutive Group ${groups} applications. A different group should follow.${crossSeasonNote}`,
      contributing: candidateRun,
    };
  }
  if (historyLongest === limit) {
    return {
      status: "limit_reached",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: historyLongest,
      observedDescription: `${historyLongest} consecutive applications recorded`,
      explanation: `Group ${groups} has reached the strategy maximum of ${limit} consecutive applications. A different group should be used next.${crossSeasonNote}`,
      contributing: firstLongest,
    };
  }
  if (historyLongest === 0 && !candidateMatches) {
    return notTriggered(rule, limit, thresholdText);
  }
  const longest = Math.max(historyLongest, candidateRun.length);
  if (limit >= 2 && longest === limit - 1) {
    return {
      status: "approaching_limit",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: longest,
      observedDescription: `${longest} consecutive applications`,
      explanation: `One more consecutive Group ${groups} application would reach the strategy maximum of ${limit}.`,
      contributing: candidateRun.length === 0 ? longestRun(historyRuns) : candidateRun,
    };
  }
  return {
    status: "within_limit",
    threshold: limit,
    thresholdDescription: thresholdText,
    observedValue: longest,
    observedDescription: `${longest} consecutive applications`,
    explanation: `Within the strategy limit for consecutive Group ${groups} applications.`,
    contributing: [],
  };
}

/* --------------------------------------------------------- simple counts */

/**
 * @param provisionalCeiling True when the ceiling itself can still rise this
 * season — the Powdery table's maxima are a function of the total spray count.
 * With a provisional ceiling "reached" and "approaching" are not meaningful: at
 * one total spray the table permits one application of every group, so a single
 * spray would otherwise report "strategy maximum reached" in a season that has
 * barely started. Only a genuine EXCEEDANCE is reported, because that cannot be
 * undone by spraying more.
 */
function countOutcome(args: {
  rule: ResistanceRule;
  ctx: EvaluationContext;
  matching: ResistanceApplicationEvent[];
  limit: number;
  thresholdText: string;
  groups: string;
  observedNoun: string;
  provisionalCeiling?: boolean;
}): Partial_ {
  const { rule, ctx, matching, limit, thresholdText, groups, observedNoun } = args;
  const candidateId = ctx.candidate?.applicationId ?? null;
  const historyMatching = matching.filter((e) => e.applicationId !== candidateId);
  const candidateMatches =
    candidateId != null && matching.some((e) => e.applicationId === candidateId);
  const total = matching.length;
  const disease = DISEASE_LABEL[ctx.request.disease];

  let outcome: Partial_;
  if (historyMatching.length > limit) {
    outcome = {
      status: "limit_exceeded",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: historyMatching.length,
      observedDescription: `${historyMatching.length} ${observedNoun} recorded`,
      explanation: `Group ${groups} has been applied ${historyMatching.length} times for ${disease}. The strategy allows ${limit}.`,
      contributing: historyMatching,
    };
  } else if (candidateMatches && total > limit) {
    outcome = {
      status: "would_exceed_limit",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: total,
      observedDescription: `${total} ${observedNoun} including this one`,
      explanation: `This would be Group ${groups} application number ${total} for ${disease}. The strategy allows ${limit}.`,
      contributing: matching,
    };
  } else if (candidateMatches && total === limit) {
    outcome = {
      status: "would_reach_limit",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: total,
      observedDescription: `${total} ${observedNoun} including this one`,
      explanation: `This would reach the strategy maximum of ${limit} Group ${groups} applications for ${disease}.`,
      contributing: matching,
    };
  } else if (!candidateMatches && historyMatching.length === limit) {
    outcome = {
      status: "limit_reached",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: historyMatching.length,
      observedDescription: `${historyMatching.length} ${observedNoun} recorded`,
      explanation: `Group ${groups} has reached the strategy maximum of ${limit} applications for ${disease}.`,
      contributing: historyMatching,
    };
  } else if (total === 0) {
    outcome = notTriggered(rule, limit, thresholdText);
  } else if (total === limit - 1) {
    outcome = {
      status: "approaching_limit",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: total,
      observedDescription: `${total} ${observedNoun}`,
      explanation: `One more Group ${groups} application would reach the strategy maximum of ${limit} for ${disease}.`,
      contributing: matching,
    };
  } else {
    outcome = {
      status: "within_limit",
      threshold: limit,
      thresholdDescription: thresholdText,
      observedValue: total,
      observedDescription: `${total} ${observedNoun}`,
      explanation: `Within the strategy maximum of ${limit} Group ${groups} applications.`,
      contributing: matching,
    };
  }

  if (args.provisionalCeiling) {
    if (
      outcome.status === "limit_reached" ||
      outcome.status === "would_reach_limit" ||
      outcome.status === "approaching_limit"
    ) {
      outcome = {
        ...outcome,
        status: "within_limit",
        explanation: `Group ${groups} is within the current strategy ceiling of ${limit}. That ceiling rises if more sprays target ${disease} this season.`,
      };
    }
  }
  return outcome;
}

function evaluateCount(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  limit: number,
  window: string,
): Partial_ {
  const matching = ctx.currentSeasonSequence.filter((e) => selectorMatches(rule.selector, e));
  const groups = groupsText(rule.selector);
  return countOutcome({
    rule,
    ctx,
    matching,
    limit,
    thresholdText: `a maximum of ${limit} Group ${groups} applications per ${window}`,
    groups,
    observedNoun: "applications",
  });
}

function evaluateSoloCount(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  limit: number,
): Partial_ {
  const ruleGroups = selectorDescribedGroups(rule.selector);
  const matching = ctx.currentSeasonSequence.filter(
    (e) => selectorMatches(rule.selector, e) && eventGroupsOtherThan(e, ruleGroups).size === 0,
  );
  const groups = ruleGroups.join(" + ");
  return countOutcome({
    rule,
    ctx,
    matching,
    limit,
    thresholdText: `a maximum of ${limit} solo (unmixed) Group ${groups} applications per season`,
    groups,
    observedNoun: "solo applications",
  });
}

/* ------------------------------------------------------------- fractions */

/**
 * Percentage restrictions, compared as exact rationals.
 *
 * ROUNDING, stated explicitly: the permitted count is the largest integer `c`
 * with `c × denominator ≤ total × numerator`. Comparison never goes through a
 * rounded display percentage, so 2 of 6 is evaluated as `2 × 3 ≤ 6 × 1` —
 * satisfied exactly — rather than as "33.33% > 33%".
 */
function evaluateFraction(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  numerator: number,
  denominator: number,
): Partial_ {
  const matching = ctx.currentSeasonSequence.filter((e) => selectorMatches(rule.selector, e));
  const candidateId = ctx.candidate?.applicationId ?? null;
  const historyMatching = matching.filter((e) => e.applicationId !== candidateId);
  const candidateMatches =
    candidateId != null && matching.some((e) => e.applicationId === candidateId);

  const total = ctx.totalDiseaseSprays;
  const groups = groupsText(rule.selector);
  const disease = DISEASE_LABEL[ctx.request.disease];
  const percent = (numerator * 100) / denominator;
  const percentText = percent % 1 === 0 ? `${Math.trunc(percent)}%` : `${percent.toFixed(1)}%`;
  const permitted = Math.trunc((total * numerator) / denominator);
  const thresholdText = `${percentText} of the ${total} ${disease} spray${plural(total)} this season (${permitted} application${plural(permitted)})`;

  // History-only denominator, for judging whether history alone breaches.
  const historyTotal = candidateId == null ? total : total - 1;
  const historyPermitted = Math.trunc((historyTotal * numerator) / denominator);

  if (historyMatching.length * denominator > historyTotal * numerator) {
    return {
      status: "limit_exceeded",
      threshold: historyPermitted,
      thresholdDescription: thresholdText,
      observedValue: historyMatching.length,
      observedDescription: `${historyMatching.length} of ${historyTotal} sprays`,
      explanation: `Group ${groups} accounts for ${historyMatching.length} of ${historyTotal} ${disease} sprays, above the strategy maximum of ${percentText}.`,
      contributing: historyMatching,
    };
  }
  if (candidateMatches && matching.length * denominator > total * numerator) {
    return {
      status: "would_exceed_limit",
      threshold: permitted,
      thresholdDescription: thresholdText,
      observedValue: matching.length,
      observedDescription: `${matching.length} of ${total} sprays including this one`,
      explanation: `This would make Group ${groups} ${matching.length} of ${total} ${disease} sprays, above the strategy maximum of ${percentText}.`,
      contributing: matching,
    };
  }
  if (candidateMatches && matching.length * denominator === total * numerator) {
    return {
      status: "would_reach_limit",
      threshold: permitted,
      thresholdDescription: thresholdText,
      observedValue: matching.length,
      observedDescription: `${matching.length} of ${total} sprays including this one`,
      explanation: `This would put Group ${groups} exactly on the strategy maximum of ${percentText} of ${disease} sprays.`,
      contributing: matching,
    };
  }
  if (
    !candidateMatches &&
    historyMatching.length > 0 &&
    historyMatching.length * denominator === historyTotal * numerator
  ) {
    return {
      status: "limit_reached",
      threshold: historyPermitted,
      thresholdDescription: thresholdText,
      observedValue: historyMatching.length,
      observedDescription: `${historyMatching.length} of ${historyTotal} sprays`,
      explanation: `Group ${groups} is on the strategy maximum of ${percentText} of ${disease} sprays.`,
      contributing: historyMatching,
    };
  }
  if (matching.length === 0) return notTriggered(rule, permitted, thresholdText);
  return {
    status: "within_limit",
    threshold: permitted,
    thresholdDescription: thresholdText,
    observedValue: matching.length,
    observedDescription: `${matching.length} of ${total} sprays`,
    explanation: `Group ${groups} is within the strategy maximum of ${percentText} of ${disease} sprays.`,
    contributing: matching,
  };
}

/* ------------------------------------------------------ one-in-every-N */

/**
 * "One in every three sprays" as SPACING, not as a percentage. Two Group 49
 * sprays out of six satisfies a 33% cap, but if both land inside the same
 * window of three they violate one-in-three.
 */
function evaluateOneInEveryN(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  window: number,
): Partial_ {
  const sequence = ctx.currentSeasonSequence;
  const groups = groupsText(rule.selector);
  const disease = DISEASE_LABEL[ctx.request.disease];
  const thresholdText = `no more than one Group ${groups} application in every ${window} ${disease} sprays`;
  const candidateId = ctx.candidate?.applicationId ?? null;

  let worstWindow: ResistanceApplicationEvent[] = [];
  let worstCount = 0;
  let worstIncludesCandidate = false;
  if (sequence.length > 0) {
    const upper = Math.max(0, sequence.length - window);
    for (let start = 0; start <= upper; start += 1) {
      const end = Math.min(start + window, sequence.length);
      const matches = sequence.slice(start, end).filter((e) => selectorMatches(rule.selector, e));
      if (matches.length > worstCount) {
        worstCount = matches.length;
        worstWindow = matches;
        worstIncludesCandidate =
          candidateId != null && matches.some((e) => e.applicationId === candidateId);
      }
    }
  }

  if (worstCount === 0) return notTriggered(rule, 1, thresholdText);
  if (worstCount <= 1) {
    return {
      status: "within_limit",
      threshold: 1,
      thresholdDescription: thresholdText,
      observedValue: worstCount,
      observedDescription: `at most ${worstCount} in any ${window} consecutive sprays`,
      explanation: `Group ${groups} spacing satisfies one in every ${window} sprays.`,
      contributing: worstWindow,
    };
  }
  if (worstIncludesCandidate) {
    return {
      status: "would_exceed_limit",
      threshold: 1,
      thresholdDescription: thresholdText,
      observedValue: worstCount,
      observedDescription: `${worstCount} within ${window} consecutive sprays including this one`,
      explanation: `This would place ${worstCount} Group ${groups} applications inside ${window} consecutive ${disease} sprays. The strategy allows one in every ${window}.`,
      contributing: worstWindow,
    };
  }
  return {
    status: "limit_exceeded",
    threshold: 1,
    thresholdDescription: thresholdText,
    observedValue: worstCount,
    observedDescription: `${worstCount} within ${window} consecutive sprays`,
    explanation: `${worstCount} Group ${groups} applications fall inside ${window} consecutive ${disease} sprays. The strategy allows one in every ${window}.`,
    contributing: worstWindow,
  };
}

/* --------------------------------------------- intervening applications */

function evaluateMinIntervening(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  required: number,
): Partial_ {
  const sequence = ctx.currentSeasonSequence;
  const groups = groupsText(rule.selector);
  const thresholdText = `at least ${required} applications of a different group between Group ${groups} applications`;
  const candidateId = ctx.candidate?.applicationId ?? null;

  const matchingIndices = sequence
    .map((e, i) => (selectorMatches(rule.selector, e) ? i : -1))
    .filter((i) => i >= 0);
  if (matchingIndices.length === 0) return notTriggered(rule, required, thresholdText);

  let worstGap: number | null = null;
  let worstPair: ResistanceApplicationEvent[] = [];
  let worstIncludesCandidate = false;
  for (let position = 1; position < matchingIndices.length; position += 1) {
    const previous = matchingIndices[position - 1];
    const current = matchingIndices[position];
    const intervening = current - previous - 1;
    if (worstGap == null || intervening < worstGap) {
      worstGap = intervening;
      worstPair = [sequence[previous], sequence[current]];
      worstIncludesCandidate =
        candidateId != null && worstPair.some((e) => e.applicationId === candidateId);
    }
  }

  if (worstGap == null) {
    return {
      status: "within_limit",
      threshold: required,
      thresholdDescription: thresholdText,
      observedValue: null,
      observedDescription: "one application, no reuse to assess",
      explanation: `Group ${groups} has been applied once, so no intervening-group requirement applies yet.`,
      contributing: matchingIndices.map((i) => sequence[i]),
    };
  }
  if (worstGap >= required) {
    return {
      status: "within_limit",
      threshold: required,
      thresholdDescription: thresholdText,
      observedValue: worstGap,
      observedDescription: `${worstGap} intervening applications at the closest reuse`,
      explanation: `Group ${groups} reuse is separated by at least ${required} different-group applications.`,
      contributing: worstPair,
    };
  }
  if (worstIncludesCandidate) {
    return {
      status: "would_exceed_limit",
      threshold: required,
      thresholdDescription: thresholdText,
      observedValue: worstGap,
      observedDescription: `${worstGap} intervening applications`,
      explanation: `Group ${groups} was used ${worstGap} ${worstGap === 1 ? "spray" : "sprays"} ago and the strategy requires at least ${required} applications of a different group before it is reapplied.`,
      contributing: worstPair,
    };
  }
  return {
    status: "limit_exceeded",
    threshold: required,
    thresholdDescription: thresholdText,
    observedValue: worstGap,
    observedDescription: `${worstGap} intervening applications`,
    explanation: `Two Group ${groups} applications are separated by only ${worstGap} different-group ${worstGap === 1 ? "application" : "applications"}. The strategy requires at least ${required}.`,
    contributing: worstPair,
  };
}

/* ---------------------------------------------------- mixture requirements */

/**
 * Mixture requirements, answered honestly.
 *
 * CropLife defines a mixture as a co-formulation or a tank mix AT LABEL RATE of
 * an alternative mode of action. The rate condition is the part group codes
 * cannot establish, so:
 *   - no alternative mode of action at all  -> not_satisfied (definitive)
 *   - partner present, adequacy unknown     -> unknown (never a pass)
 *   - partner confirmed at label rate       -> satisfied
 *
 * The engine will usually return `unknown`. That is the correct answer, not a
 * gap: claiming a mixture requirement was met when nothing established the
 * partner rate would be the most dangerous false pass this engine could make.
 */
function evaluateMixture(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  onlyWhenConsecutive: boolean,
): Partial_ {
  const sequence = sequenceForRule(ctx, rule);
  const ruleGroups = selectorDescribedGroups(rule.selector);
  const groups = ruleGroups.join(" + ");

  const scope = onlyWhenConsecutive
    ? maximalRuns(sequence, rule.selector)
        .filter((r) => r.length >= 2)
        .flat()
    : sequence.filter((e) => selectorMatches(rule.selector, e));

  const thresholdText = onlyWhenConsecutive
    ? `consecutive Group ${groups} applications require a mixture or co-formulation with an alternative mode of action`
    : `Group ${groups} must be applied in a mixture with an effective alternative mode of action`;

  if (scope.length === 0) return notTriggered(rule, null, thresholdText);

  const unmixed = scope.filter((e) => eventGroupsOtherThan(e, ruleGroups).size === 0);
  const unproven = scope.filter(
    (e) => eventGroupsOtherThan(e, ruleGroups).size > 0 && e.mixturePartnerAtLabelRate !== true,
  );
  const candidateId = ctx.candidate?.applicationId ?? null;

  if (unmixed.length > 0) {
    const isCandidate = unmixed.some((e) => e.applicationId === candidateId);
    return {
      status: "requirement_not_met",
      threshold: null,
      thresholdDescription: thresholdText,
      observedValue: unmixed.length,
      observedDescription: `${unmixed.length} application${plural(unmixed.length)} with no alternative mode of action`,
      explanation: isCandidate
        ? `This Group ${groups} application carries no alternative mode of action, and the strategy requires one.`
        : `${unmixed.length} Group ${groups} application${plural(unmixed.length)} carried no alternative mode of action, which the strategy requires.`,
      contributing: unmixed,
      mixtureRequirement: "not_satisfied",
    };
  }
  if (unproven.length > 0) {
    return {
      status: "requirement_unproven",
      threshold: null,
      thresholdDescription: thresholdText,
      observedValue: unproven.length,
      observedDescription: `${unproven.length} application${plural(unproven.length)} with an unconfirmed mixture partner`,
      explanation: `A different mode of action was present alongside Group ${groups}, but VineTrack cannot confirm it was applied at an effective rate, so the mixture requirement cannot be confirmed from the recorded data.`,
      contributing: unproven,
      mixtureRequirement: "unknown",
    };
  }
  return {
    status: "within_limit",
    threshold: null,
    thresholdDescription: thresholdText,
    observedValue: scope.length,
    observedDescription: `${scope.length} application${plural(scope.length)} mixed`,
    explanation: `Group ${groups} was applied with a confirmed alternative mode of action.`,
    contributing: scope,
    mixtureRequirement: "satisfied",
  };
}

/* -------------------------------------------------- last spray of season */

/**
 * Reported as guidance rather than a breach: whether a spray is the LAST of a
 * season is unknowable until the season ends, and flagging every mid-season
 * Group 40 spray for being the most recent one would train operators to ignore
 * the warning.
 */
function evaluateNotLastSpray(rule: ResistanceRule, ctx: EvaluationContext): Partial_ {
  const groups = groupsText(rule.selector);
  const disease = DISEASE_LABEL[ctx.request.disease];
  const thresholdText = `Group ${groups} should not be the last spray of the season`;
  const last = ctx.currentSeasonSequence[ctx.currentSeasonSequence.length - 1];
  if (!last) return notTriggered(rule, null, thresholdText);

  if (!selectorMatches(rule.selector, last)) {
    return {
      status: "within_limit",
      threshold: null,
      thresholdDescription: thresholdText,
      observedValue: null,
      observedDescription: `the most recent spray does not contain Group ${groups}`,
      explanation: `The most recent ${disease} spray does not contain Group ${groups}.`,
      contributing: [],
    };
  }

  const isCandidate = last.applicationId === (ctx.candidate?.applicationId ?? null);
  return {
    status: "guidance",
    threshold: null,
    thresholdDescription: thresholdText,
    observedValue: null,
    observedDescription: `currently the final ${disease} spray of the season`,
    explanation: isCandidate
      ? `The strategy advises against Group ${groups} as the last spray of the season. If no further ${disease} spray follows this one, that advice would not be met.`
      : `Group ${groups} is currently the final ${disease} spray of the season. The strategy advises the season should not end on Group ${groups}.`,
    contributing: [last],
    isGuidance: true,
  };
}

/* --------------------------------------------------- total-spray-count table */

/**
 * The Powdery table, whose ceiling MOVES with the season's total spray count.
 *
 * UNKNOWN FUTURE TOTALS, stated explicitly: the engine uses the total it can
 * actually see — applied history plus the candidate — and never invents future
 * sprays to unlock a higher ceiling.
 */
function evaluateTable(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  columnKey: string,
): Partial_ {
  const groups = groupsText(rule.selector);
  const table = ctx.ruleset.maxUseTable;
  const column = table ? maxUseColumn(table, columnKey) : null;
  if (!table || !column) {
    return {
      status: "unable_to_assess",
      threshold: null,
      thresholdDescription: "maximum-use table unavailable",
      observedValue: null,
      observedDescription: "not assessed",
      explanation: `The strategy's maximum-use table is not available for Group ${groups}.`,
      contributing: [],
    };
  }

  const total = ctx.totalDiseaseSprays;
  const limit = maxUseFor(table, columnKey, total);
  if (limit == null) {
    return notTriggered(rule, null, `no published maximum at ${total} sprays`);
  }

  const matching = ctx.currentSeasonSequence.filter((e) => selectorMatches(rule.selector, e));
  const disease = DISEASE_LABEL[ctx.request.disease];
  const thresholdText = `a maximum of ${limit} Group ${column.displayName} application${plural(limit)} when ${total} ${disease} spray${plural(total)} are applied`;

  // The ceiling stops moving once the total reaches the table's open-ended
  // final row (CropLife's 9+), after which reached/approaching are real.
  const openEnded = table.rows.find((r) => r.isOrMore);
  const provisional = openEnded != null && total < openEnded.totalSprays;

  return countOutcome({
    rule,
    ctx,
    matching,
    limit,
    thresholdText,
    groups: column.displayName,
    observedNoun: "applications",
    provisionalCeiling: provisional,
  });
}

function evaluateGuidance(rule: ResistanceRule): Partial_ {
  return {
    status: "guidance",
    threshold: null,
    thresholdDescription: "published guidance, no numeric limit",
    observedValue: null,
    observedDescription: "informational",
    explanation: rule.sourceText,
    contributing: [],
    isGuidance: true,
  };
}

/* ------------------------------------------- availability gating & packaging */

function severityFor(status: ResistanceRuleStatus): ResistanceSeverity {
  switch (status) {
    case "limit_exceeded":
    case "would_exceed_limit":
    case "requirement_not_met":
      return "critical";
    case "limit_reached":
    case "would_reach_limit":
      return "warning";
    case "unable_to_assess":
    case "requirement_unproven":
      return "indeterminate";
    case "approaching_limit":
      return "advisory";
    default:
      return "informational";
  }
}

function ruleEvidence(
  scope: ResistanceApplicationEvent[],
  opaque: ResistanceApplicationEvent[],
  unattributed: ResistanceApplicationEvent[],
  partial: Partial_,
): ResistanceEvidenceQuality {
  if (partial.isGuidance) return "high";
  if (opaque.length > 0 || unattributed.length > 0) return "indeterminate";
  const relevant = partial.contributing.length === 0 ? scope : partial.contributing;
  if (relevant.length === 0) return "high";
  return relevant.every((e) => availabilityIsDependable(eventAvailability(e)))
    ? "high"
    : "qualified";
}

/**
 * Applies Chemical Intelligence availability to a computed result.
 *
 * A breach computed from known chemistry SURVIVES gating — an unverified Group
 * 11 sequence that appears to exceed the published maximum is still worth
 * telling the operator about, qualified by its evidence. A non-breach does NOT
 * survive when any application in scope has conflicting or missing chemistry,
 * because that application might have contained the very group being counted.
 * This is where a missing snapshot is prevented from meaning "no issue".
 */
function finalise(
  rule: ResistanceRule,
  ctx: EvaluationContext,
  partial: Partial_,
): ResistanceRuleResult {
  const scope = sequenceForRule(ctx, rule);
  const opaque = scope.filter((e) => !eventCanAssessChemistry(e));
  const unattributed = ctx.unattributedInSeason;

  let status = partial.status;
  let explanation = partial.explanation;
  let contributing = partial.contributing;

  const blocked = opaque.length > 0 || unattributed.length > 0;
  if (
    blocked &&
    !partial.isGuidance &&
    !ruleStatusIsBreach(partial.status) &&
    partial.status !== "requirement_unproven"
  ) {
    status = "unable_to_assess";
    const reasons: string[] = [];
    if (opaque.length > 0) {
      reasons.push(
        `${opaque.length} application${plural(opaque.length)} with missing or disputed chemistry`,
      );
    }
    if (unattributed.length > 0) {
      reasons.push(
        `${unattributed.length} application${plural(unattributed.length)} with no recorded target disease`,
      );
    }
    explanation = `This rule cannot be assessed: ${reasons.join(" and ")} could change the result. The recorded groups alone show ${partial.observedDescription}.`;
    const seen = new Set<string>();
    contributing = [...partial.contributing, ...opaque, ...unattributed].filter((event) => {
      if (seen.has(event.applicationId)) return false;
      seen.add(event.applicationId);
      return true;
    });
  }

  const evidence = ruleEvidence(scope, opaque, unattributed, partial);
  const qualified =
    evidence === "qualified" && ruleStatusIsBreach(status)
      ? explanation + " This is based on recorded groups that have not been independently verified."
      : explanation;

  return {
    ruleId: rule.id,
    rulesetId: ctx.ruleset.id,
    rulesetVersion: ctx.ruleset.rulesetVersion,
    disease: ctx.request.disease,
    blockId: ctx.request.blockId,
    status,
    severity: severityFor(status),
    groups: selectorDescribedGroups(rule.selector),
    threshold: partial.threshold,
    thresholdDescription: partial.thresholdDescription,
    observedValue: partial.observedValue,
    observedDescription: partial.observedDescription,
    explanation: qualified,
    contributingApplicationIds: contributing.map((e) => e.applicationId),
    contributingDatesEpochMs: contributing.map((e) => e.appliedAtEpochMs),
    evidenceQuality: evidence,
    mixtureRequirement: partial.mixtureRequirement ?? null,
    sourceReference: rule.sourceReference,
    sourceText: rule.sourceText,
  };
}

function evaluateRule(rule: ResistanceRule, ctx: EvaluationContext): ResistanceRuleResult {
  let partial: Partial_;
  switch (rule.kind.kind) {
    case "maxConsecutiveApplications":
      partial = evaluateConsecutive(rule, ctx, rule.kind.limit);
      break;
    case "noConsecutiveApplications":
      partial = evaluateConsecutive(rule, ctx, 1);
      break;
    case "maxApplicationsPerSeason":
      partial = evaluateCount(rule, ctx, rule.kind.limit, "season");
      break;
    case "maxApplicationsPerCrop":
      partial = evaluateCount(rule, ctx, rule.kind.limit, "crop");
      break;
    case "maxFractionOfDiseaseSprays":
      partial = evaluateFraction(rule, ctx, rule.kind.numerator, rule.kind.denominator);
      break;
    case "maxOneInEveryNSprays":
      partial = evaluateOneInEveryN(rule, ctx, rule.kind.window);
      break;
    case "minInterveningDifferentGroupApplications":
      partial = evaluateMinIntervening(rule, ctx, rule.kind.count);
      break;
    case "mixtureRequired":
      partial = evaluateMixture(rule, ctx, false);
      break;
    case "mixtureRequiredWhenConsecutive":
      partial = evaluateMixture(rule, ctx, true);
      break;
    case "maxSoloApplicationsPerSeason":
      partial = evaluateSoloCount(rule, ctx, rule.kind.limit);
      break;
    case "notLastSprayOfSeason":
      partial = evaluateNotLastSpray(rule, ctx);
      break;
    case "maxFromTotalSprayCountTable":
      partial = evaluateTable(rule, ctx, rule.kind.columnKey);
      break;
    case "preventativeApplicationGuidance":
      partial = evaluateGuidance(rule);
      break;
  }
  return finalise(rule, ctx, partial);
}

/* ----------------------------------------------------------- aggregation */

function overallStatus(
  results: ResistanceRuleResult[],
  unassessable: string[],
  unattributed: ResistanceApplicationEvent[],
): ResistanceEvaluationStatus {
  if (results.some((r) => ruleStatusIsBreach(r.status))) return "strategy_exceeded";
  if (unassessable.length > 0 || unattributed.length > 0) return "unable_to_fully_assess";
  if (results.some((r) => r.status === "unable_to_assess")) return "unable_to_fully_assess";
  if (results.some((r) => r.status === "requirement_unproven")) return "unable_to_fully_assess";
  if (results.some((r) => ruleStatusIsAtLimit(r.status))) return "limit_reached";
  // Escalate only once at least two applications have accumulated. A single
  // Group 3 spray is one step from a limit of two, but calling a season
  // "approaching a limit" after its first spray would make the status
  // meaningless. The rule-level detail is still reported.
  if (results.some((r) => r.status === "approaching_limit" && (r.observedValue ?? 0) >= 2)) {
    return "approaching_limit";
  }
  return "compliant";
}

function overallEvidence(
  sequence: ResistanceApplicationEvent[],
  unattributed: ResistanceApplicationEvent[],
): ResistanceEvidenceQuality {
  if (unattributed.length > 0 || sequence.some((e) => !eventCanAssessChemistry(e))) {
    return "indeterminate";
  }
  return sequence.every((e) => availabilityIsDependable(eventAvailability(e)))
    ? "high"
    : "qualified";
}

/**
 * A clean arithmetic result over unverified chemistry is never reported as "all
 * good" — it is reported as what it is: no limit detected USING THE RECORDED
 * GROUPS, with the quality of those groups stated.
 */
function summarise(
  status: ResistanceEvaluationStatus,
  evidence: ResistanceEvidenceQuality,
  results: ResistanceRuleResult[],
  disease: ResistanceDisease,
  unattributedCount: number,
): string {
  const label = DISEASE_LABEL[disease];
  switch (status) {
    case "strategy_exceeded": {
      const breach = results.find((r) => ruleStatusIsBreach(r.status));
      const prefix = `Resistance strategy warning: ${breach?.explanation ?? ""}`;
      return evidence === "indeterminate"
        ? prefix + " Other applications could not be assessed, so the full picture may be worse."
        : prefix;
    }
    case "limit_reached": {
      const reached = results.find((r) => ruleStatusIsAtLimit(r.status));
      return `CropLife strategy maximum reached: ${reached?.explanation ?? ""}`;
    }
    case "approaching_limit": {
      const near = results.find((r) => r.status === "approaching_limit");
      return `Approaching a CropLife strategy limit: ${near?.explanation ?? ""}`;
    }
    case "unable_to_fully_assess": {
      const reasons: string[] = [];
      if (unattributedCount > 0) {
        reasons.push(
          `${unattributedCount} application${plural(unattributedCount)} have no recorded target disease`,
        );
      }
      if (results.some((r) => r.status === "unable_to_assess")) {
        reasons.push("chemistry is missing or disputed on one or more applications");
      }
      if (results.some((r) => r.status === "requirement_unproven")) {
        reasons.push("a required mixture cannot be confirmed from the recorded data");
      }
      return `Unable to fully assess the ${label} resistance strategy for this block: ${reasons.join("; ")}. No clean result can be given.`;
    }
    case "compliant":
      if (evidence === "high") {
        return `No ${label} resistance strategy limit is reached for this block.`;
      }
      if (evidence === "qualified") {
        return "No strategy limit detected using the recorded groups; one or more chemical records are unverified.";
      }
      return "No strategy limit detected using the recorded groups, but some applications could not be assessed.";
    case "not_applicable":
      return `No applications targeting ${label} are recorded for this block this season.`;
    case "unsupported_ruleset":
      return "A VineTrack resistance strategy is not yet configured for this jurisdiction.";
  }
}

/* ---------------------------------------------------------- early exits */

/**
 * No strategy for this jurisdiction. Australian maximum-use rules are NOT
 * applied as a fallback: a New Zealand vineyard assessed against CropLife
 * Australia limits would be given confident, specific, wrong advice.
 */
function unsupported(request: ResistanceEvaluationRequest): ResistanceEvaluation {
  return {
    status: "unsupported_ruleset",
    jurisdiction: request.jurisdiction,
    crop: request.crop,
    disease: request.disease,
    blockId: request.blockId,
    seasonId: request.season.id,
    rulesetId: null,
    rulesetVersion: null,
    rulesetValidFrom: null,
    ruleResults: [],
    totalDiseaseSpraysInSeason: 0,
    consideredApplicationIds: [],
    unassessableApplicationIds: [],
    unattributedApplicationIds: [],
    excludedPlannedApplicationIds: [],
    evidenceQuality: "indeterminate",
    summary: "A VineTrack resistance strategy is not yet configured for this jurisdiction.",
    candidateApplicationId: request.candidate?.applicationId ?? null,
  };
}

function notApplicable(
  request: ResistanceEvaluationRequest,
  ruleset: ResistanceRuleset,
  excludedPlanned: ResistanceApplicationEvent[],
): ResistanceEvaluation {
  return {
    status: "not_applicable",
    jurisdiction: request.jurisdiction,
    crop: request.crop,
    disease: request.disease,
    blockId: request.blockId,
    seasonId: request.season.id,
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.rulesetVersion,
    rulesetValidFrom: ruleset.validFrom,
    ruleResults: [],
    totalDiseaseSpraysInSeason: 0,
    consideredApplicationIds: [],
    unassessableApplicationIds: [],
    unattributedApplicationIds: [],
    excludedPlannedApplicationIds: excludedPlanned.map((e) => e.applicationId),
    evidenceQuality: "high",
    summary: `No applications targeting ${DISEASE_LABEL[request.disease]} are recorded for this block this season.`,
    candidateApplicationId: request.candidate?.applicationId ?? null,
  };
}

/* ------------------------------------------------------------- evaluate */

export function evaluateResistance(
  request: ResistanceEvaluationRequest,
): ResistanceEvaluation {
  const registry = request.registry ?? RESISTANCE_REGISTRY;
  const ruleset = currentRuleset(registry, request.jurisdiction, request.crop, request.disease);
  if (!ruleset) return unsupported(request);

  // --- Scope to the block ---
  const blockEvents = request.events.filter((e) => e.blockId === request.blockId);
  const includePlanned = request.includePlanned === true;
  const excludedPlanned = includePlanned ? [] : blockEvents.filter((e) => e.kind === "planned");
  const includedKinds = new Set<ResistanceEventKind>(["actual", "candidate"]);
  if (includePlanned) includedKinds.add("planned");
  const history = blockEvents.filter((e) => includedKinds.has(e.kind));

  // Applications with no recorded target cannot be attributed to a disease.
  // They are NOT dropped: an unattributable spray inside the season is a hole
  // in the history, and a hole must suppress a clean result rather than quietly
  // shrink the denominator.
  const unattributedInSeason = chronological(
    history.filter(
      (e) => seasonContains(request.season, e.appliedAtEpochMs) && !e.targetsRecorded,
    ),
  );

  // A candidate is only relevant to the block AND disease being evaluated.
  // Without the block check, assessing a spray planned for block B would
  // silently consume block A's allowance.
  const rawCandidate = request.candidate ?? null;
  const candidate =
    rawCandidate && eventTargets(rawCandidate, request.disease) && rawCandidate.blockId === request.blockId
      ? rawCandidate
      : null;

  const diseaseHistory = chronological(
    history.filter((e) => e.targetsRecorded && eventTargets(e, request.disease)),
  );

  const currentSeasonHistory = diseaseHistory.filter((e) =>
    seasonContains(request.season, e.appliedAtEpochMs),
  );
  const prevSeason = previousSeason(request.seasonCalendar, request.season);
  const previousSeasonHistory = diseaseHistory.filter((e) =>
    seasonContains(prevSeason, e.appliedAtEpochMs),
  );

  const currentSeasonSequence = chronological([
    ...currentSeasonHistory,
    ...(candidate ? [candidate] : []),
  ]);
  const crossSeasonSequence = chronological([
    ...previousSeasonHistory,
    ...currentSeasonSequence,
  ]);

  // Denominator for every percentage rule: applications targeting THIS disease,
  // for THIS block, in THIS season. Never all vineyard sprays, never tank
  // lines, never other diseases. A mixture is one application.
  const totalDiseaseSprays = currentSeasonSequence.length;

  if (totalDiseaseSprays === 0 && unattributedInSeason.length === 0) {
    return notApplicable(request, ruleset, excludedPlanned);
  }

  const ctx: EvaluationContext = {
    request,
    ruleset,
    currentSeasonSequence,
    crossSeasonSequence,
    candidate,
    totalDiseaseSprays,
    unattributedInSeason,
  };

  const ruleResults = ruleset.rules.map((rule) => evaluateRule(rule, ctx));
  const unassessable = currentSeasonSequence
    .filter((e) => !eventCanAssessChemistry(e))
    .map((e) => e.applicationId);
  const overall = overallStatus(ruleResults, unassessable, unattributedInSeason);
  const evidence = overallEvidence(currentSeasonSequence, unattributedInSeason);

  return {
    status: overall,
    jurisdiction: request.jurisdiction,
    crop: request.crop,
    disease: request.disease,
    blockId: request.blockId,
    seasonId: request.season.id,
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.rulesetVersion,
    rulesetValidFrom: ruleset.validFrom,
    ruleResults,
    totalDiseaseSpraysInSeason: totalDiseaseSprays,
    consideredApplicationIds: currentSeasonSequence.map((e) => e.applicationId),
    unassessableApplicationIds: unassessable,
    unattributedApplicationIds: unattributedInSeason.map((e) => e.applicationId),
    excludedPlannedApplicationIds: excludedPlanned.map((e) => e.applicationId),
    evidenceQuality: evidence,
    summary: summarise(
      overall,
      evidence,
      ruleResults,
      request.disease,
      unattributedInSeason.length,
    ),
    candidateApplicationId: candidate?.applicationId ?? null,
  };
}
