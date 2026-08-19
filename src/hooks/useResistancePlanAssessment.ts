// Stage 4 — live evaluation of a Resistance Plan.
//
// Reuses the Stage 3C engine exactly: actual season history (from spray
// records) plus the plan's planned positions, evaluated PER BLOCK. No planner
// specific rules, thresholds or scores exist anywhere in this file.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVintage } from "@/lib/useVintage";
import { useVineyard } from "@/context/VineyardContext";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import type { ResistancePlan } from "@/lib/resistancePlanContract";
import { rulesetDrift, type RulesetDrift } from "@/lib/resistancePlanContract";
import {
  currentRuleset,
  jurisdictionFromCountryCode,
  type ResistanceDisease,
  type ResistanceJurisdiction,
} from "@/lib/resistance/resistanceRuleset";
import { RESISTANCE_REGISTRY } from "@/lib/resistance/resistanceRulesets";
import {
  buildPlannedEvents,
  evaluateResistance,
  makeSeasonCalendar,
  seasonStarting,
  statusRequiresAcknowledgement,
  worstEvaluationStatus,
  type ResistanceApplicationEvent,
  type ResistanceEvaluation,
  type ResistanceEvaluationStatus,
  type ResistanceSeason,
} from "@/lib/resistance";
import { fetchResistanceHistory } from "@/lib/resistance/resistanceHistoryQuery";
import {
  unresolvedApplicationsConcerning,
  type UnresolvedBlockApplication,
} from "@/lib/resistance/resistanceEventSource";

/** `"2026/27"` → 2026. */
export function startYearOfSeasonId(seasonId: string): number | null {
  const m = /^(\d{4})/.exec(seasonId.trim());
  return m ? Number(m[1]) : null;
}

export interface PlanBlockAssessment {
  blockId: string;
  blockName: string;
  evaluation: ResistanceEvaluation;
}

export interface ResistancePlanAssessment {
  isLoading: boolean;
  error: Error | null;
  /** True when history could not be read — never a clean result. */
  historyUnavailable: boolean;
  supported: boolean;
  jurisdiction: ResistanceJurisdiction;
  season: ResistanceSeason | null;
  blocks: PlanBlockAssessment[];
  actualEvents: ResistanceApplicationEvent[];
  plannedEvents: ResistanceApplicationEvent[];
  unresolved: UnresolvedBlockApplication[];
  overallStatus: ResistanceEvaluationStatus | null;
  requiresAcknowledgement: boolean;
  currentRulesetId: string | null;
  currentRulesetVersion: string | null;
  drift: RulesetDrift;
}

export function useResistancePlanAssessment(args: {
  enabled: boolean;
  vineyardId: string;
  plan: ResistancePlan;
  blocks: { id: string; name?: string | null }[];
  intelligenceById: Map<string, ChemicalIntelligence>;
}): ResistancePlanAssessment {
  const { enabled, vineyardId, plan, blocks, intelligenceById } = args;
  const { currentCountry } = useVineyard();
  const { seasonStartMonth, seasonStartDay, countryCode } = useVintage();

  const jurisdiction = jurisdictionFromCountryCode(countryCode ?? currentCountry);
  const seasonCalendar = useMemo(
    () => makeSeasonCalendar({ startMonth: seasonStartMonth, startDay: seasonStartDay }),
    [seasonStartMonth, seasonStartDay],
  );

  const historyQ = useQuery({
    queryKey: ["resistance-history", vineyardId, seasonStartMonth, seasonStartDay],
    enabled: enabled && !!vineyardId,
    queryFn: () => fetchResistanceHistory(vineyardId, seasonCalendar),
    staleTime: 60 * 1000,
  });

  return useMemo(() => {
    const disease = plan.disease as ResistanceDisease;
    const ruleset = currentRuleset(RESISTANCE_REGISTRY, jurisdiction, "grape", disease);
    const drift = rulesetDrift(plan, {
      id: ruleset?.id ?? null,
      version: ruleset?.rulesetVersion ?? null,
    });

    const startYear = startYearOfSeasonId(plan.seasonId);
    const season = startYear != null ? seasonStarting(seasonCalendar, startYear) : null;
    const historyFailed = !!historyQ.error;
    const events = historyQ.data?.events ?? [];

    if (!season) {
      return {
        isLoading: historyQ.isLoading,
        error: (historyQ.error as Error | null) ?? null,
        historyUnavailable: historyFailed,
        supported: !!ruleset,
        jurisdiction,
        season: null,
        blocks: [],
        actualEvents: [],
        plannedEvents: [],
        unresolved: [],
        overallStatus: null,
        requiresAcknowledgement: false,
        currentRulesetId: ruleset?.id ?? null,
        currentRulesetVersion: ruleset?.rulesetVersion ?? null,
        drift,
      } satisfies ResistancePlanAssessment;
    }

    const seasonActual = events.filter(
      (e) =>
        e.kind === "actual" &&
        e.appliedAtEpochMs >= season.startEpochMs &&
        e.appliedAtEpochMs < season.endEpochMs &&
        plan.blockIds.includes(e.blockId),
    );
    const lastActual = seasonActual.reduce((m, e) => Math.max(m, e.appliedAtEpochMs), 0);
    const anchorEpochMs = Math.max(Date.now(), lastActual);

    const plannedEvents = buildPlannedEvents({
      positions: plan.positions,
      blockIds: plan.blockIds,
      vineyardId: plan.vineyardId || vineyardId,
      disease,
      season,
      intelligenceById,
      anchorEpochMs,
    });

    const blockAssessments: PlanBlockAssessment[] = plan.blockIds.map((blockId) => ({
      blockId,
      blockName: blocks.find((b) => b.id === blockId)?.name ?? "Unknown block",
      evaluation: evaluateResistance({
        jurisdiction,
        crop: "grape",
        disease,
        blockId,
        season,
        seasonCalendar,
        // The engine filters: it receives all history plus all planned events.
        events: [...events, ...plannedEvents],
        includePlanned: true,
      }),
    }));

    const engineWorst = worstEvaluationStatus(blockAssessments.map((b) => b.evaluation.status));
    // A failed history read is never a clean season.
    const overallStatus: ResistanceEvaluationStatus | null = historyFailed
      ? "unable_to_fully_assess"
      : engineWorst;

    return {
      isLoading: historyQ.isLoading,
      error: (historyQ.error as Error | null) ?? null,
      historyUnavailable: historyFailed,
      supported: !!ruleset,
      jurisdiction,
      season,
      blocks: blockAssessments,
      actualEvents: seasonActual,
      plannedEvents,
      unresolved: historyQ.data
        ? unresolvedApplicationsConcerning(historyQ.data, disease, season.id)
        : [],
      overallStatus,
      requiresAcknowledgement:
        !historyQ.isLoading && statusRequiresAcknowledgement(overallStatus),
      currentRulesetId: ruleset?.id ?? null,
      currentRulesetVersion: ruleset?.rulesetVersion ?? null,
      drift,
    } satisfies ResistancePlanAssessment;
  }, [
    plan,
    blocks,
    intelligenceById,
    jurisdiction,
    seasonCalendar,
    vineyardId,
    historyQ.data,
    historyQ.isLoading,
    historyQ.error,
  ]);
}
