// Stage 3C — turning the in-progress spray draft into candidate events.
//
// A candidate is the ONLY place the engine may read live Chemical Intelligence:
// the spray has not happened, so there is no frozen snapshot to read and
// today's classification is the correct one to plan against. Recorded history
// still comes exclusively from snapshots (see `resistanceEventSource.ts`).
import type { SprayApplication } from "@/lib/sprayApplicationDomain";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import {
  groupSignatureOf,
  type ResistanceDisease,
} from "./resistanceRuleset";
import {
  availabilityFromVerificationStatus,
  type ChemicalIntelligenceAvailability,
  type ResistanceApplicationEvent,
  type ResistanceProductLine,
} from "./resistanceEvent";
import { seasonForEpochMs, type ResistanceSeasonCalendar } from "./resistanceSeason";

/** Stable ID for the unsaved draft, so warnings can point at "this spray". */
export const CANDIDATE_APPLICATION_ID = "candidate:current-draft";

export const candidateDiseases = (app: SprayApplication): ResistanceDisease[] =>
  (app.targets ?? []).filter(
    (t): t is ResistanceDisease => t === "powdery_mildew" || t === "downy_mildew",
  );

/** Product lines for the draft, from live intelligence plus the line's own groups. */
export function candidateProductLines(
  app: SprayApplication,
  intelligenceById: Map<string, ChemicalIntelligence>,
): ResistanceProductLine[] {
  return app.products.map((line, index) => {
    const intel = line.savedChemicalId ? intelligenceById.get(line.savedChemicalId) ?? null : null;
    // Scheme is carried through, not discarded: an HRAC or IRAC code must
    // never be read as the fungicide group with the same numeral. Resolution
    // and evidence quality are shared with the Resistance Planner so both
    // surfaces describe the same product the same way.
    const { codes, availability } = resolveProductGroups({
      intel,
      fallbackCodes: (line.activityGroups ?? [])
        .filter((g) => g.scheme !== "NA")
        .map((g) =>
          g.code
            ? g.scheme === "HRAC" || g.scheme === "IRAC"
              ? `${g.scheme} ${g.code}`
              : g.code
            : null,
        )
        .filter((c): c is string => !!c),
    });


    return {
      lineId: line.savedChemicalId ?? `draft-line-${index}`,
      productName: line.productName ?? intel?.name ?? null,
      savedChemicalId: line.savedChemicalId ?? null,
      groups: groupSignatureOf(codes),
      availability,
    };
  });
}

/**
 * One candidate event per selected block. Templates produce none: a template
 * has no blocks and no date, so it has no position in any block's chronology.
 */
export function buildCandidateEvents(args: {
  application: SprayApplication;
  intelligenceById: Map<string, ChemicalIntelligence>;
  seasonCalendar: ResistanceSeasonCalendar;
  /** Planned date of the draft; falls back to now. */
  nowEpochMs: number;
}): ResistanceApplicationEvent[] {
  const { application: app, intelligenceById, seasonCalendar } = args;
  if (app.isTemplate) return [];

  const diseases = candidateDiseases(app);
  const products = candidateProductLines(app, intelligenceById);
  const planned = app.plannedDate ? Date.parse(`${app.plannedDate}T12:00:00`) : NaN;
  const epochMs = Number.isFinite(planned) ? planned : args.nowEpochMs;
  const seasonId = seasonForEpochMs(seasonCalendar, epochMs).id;

  return (app.blockIds ?? []).map((blockId) => ({
    applicationId: CANDIDATE_APPLICATION_ID,
    kind: "candidate" as const,
    appliedAtEpochMs: epochMs,
    seasonId,
    vineyardId: app.vineyardId ?? "",
    blockId,
    targets: diseases,
    // The operator is choosing targets in this wizard right now, so the
    // question has been asked even when the answer is still empty.
    targetsRecorded: true,
    products,
    mixturePartnerAtLabelRate: null,
  }));
}
