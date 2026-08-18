// Stage 3C — wiring the Resistance Rules Engine into the portal.
//
// Everything numeric comes from the engine. This hook only supplies the four
// things the engine cannot know: the vineyard's jurisdiction, its season
// calendar, the recorded history, and the draft being assessed.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import type { SprayApplication } from "@/lib/sprayApplicationDomain";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import {
  DISEASE_LABEL,
  RESISTANCE_DISEASES,
  jurisdictionFromCountryCode,
  type ResistanceDisease,
} from "@/lib/resistance/resistanceRuleset";
import {
  evaluateResistance,
  type ResistanceEvaluation,
} from "@/lib/resistance";
import {
  makeSeasonCalendar,
  seasonForEpochMs,
  type ResistanceSeason,
} from "@/lib/resistance/resistanceSeason";
import {
  buildCandidateEvents,
  candidateDiseases,
} from "@/lib/resistance/resistanceCandidate";
import { fetchResistanceHistory } from "@/lib/resistance/resistanceHistoryQuery";
import {
  unresolvedApplicationsConcerning,
  type UnresolvedBlockApplication,
} from "@/lib/resistance/resistanceEventSource";

export interface ResistanceBlockAssessment {
  blockId: string;
  blockName: string;
  evaluations: ResistanceEvaluation[];
}

export interface ResistanceAssessment {
  isLoading: boolean;
  error: Error | null;
  /** Null while the vineyard country is unknown. */
  season: ResistanceSeason | null;
  diseases: ResistanceDisease[];
  blocks: ResistanceBlockAssessment[];
  /** Recorded sprays that could bear on this assessment but have no block. */
  unresolvedByDisease: Record<string, UnresolvedBlockApplication[]>;
  /** True when a strategy exists for this vineyard's jurisdiction. */
  supported: boolean;
  jurisdictionLabelCode: string;
}

export function useResistanceAssessment(args: {
  enabled: boolean;
  vineyardId: string;
  application: SprayApplication;
  intelligenceById: Map<string, ChemicalIntelligence>;
  blocks: { id: string; name?: string | null }[];
}): ResistanceAssessment {
  const { enabled, vineyardId, application, intelligenceById, blocks } = args;
  const { currentCountry } = useVineyard();
  const { seasonStartMonth, seasonStartDay, countryCode } = useVintage();

  // Jurisdiction follows the VINEYARD, never the browser: an Australian
  // operator can legitimately manage a New Zealand vineyard.
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
    const diseases = candidateDiseases(application);
    const nowEpochMs = Date.now();
    const candidates = buildCandidateEvents({
      application,
      intelligenceById,
      seasonCalendar,
      nowEpochMs,
    });
    const anchorEpochMs = candidates[0]?.appliedAtEpochMs ?? nowEpochMs;
    const season = seasonForEpochMs(seasonCalendar, anchorEpochMs);
    const history = historyQ.data;
    const events = history?.events ?? [];

    const assessed = diseases.length > 0 ? diseases : RESISTANCE_DISEASES;

    const blockAssessments: ResistanceBlockAssessment[] = (application.blockIds ?? []).map(
      (blockId) => {
        const candidate = candidates.find((c) => c.blockId === blockId) ?? null;
        return {
          blockId,
          blockName: blocks.find((b) => b.id === blockId)?.name ?? "Unknown block",
          evaluations: assessed.map((disease) =>
            evaluateResistance({
              jurisdiction,
              crop: "grape",
              disease,
              blockId,
              season,
              seasonCalendar,
              events,
              candidate,
            }),
          ),
        };
      },
    );

    const unresolvedByDisease: Record<string, UnresolvedBlockApplication[]> = {};
    for (const disease of assessed) {
      unresolvedByDisease[disease] = history
        ? unresolvedApplicationsConcerning(history, disease, season.id)
        : [];
    }

    return {
      isLoading: historyQ.isLoading,
      error: (historyQ.error as Error | null) ?? null,
      season,
      diseases: assessed,
      blocks: blockAssessments,
      unresolvedByDisease,
      supported: jurisdiction === "AU",
      jurisdictionLabelCode: jurisdiction,
    };
  }, [
    application,
    intelligenceById,
    seasonCalendar,
    historyQ.data,
    historyQ.isLoading,
    historyQ.error,
    jurisdiction,
    blocks,
  ]);
}

export { DISEASE_LABEL };
