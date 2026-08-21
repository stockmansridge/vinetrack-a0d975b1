// Stage 4 — projecting Resistance Plan positions into engine events.
//
// A planned position is NOT an application. It becomes a `kind: "planned"`
// event so the Stage 3C engine can place it in the chronology behind the
// season's ACTUAL history without ever being mistaken for something that
// happened. Nothing here changes engine semantics: the engine still decides
// what counts, and `includePlanned` is what admits these events at all.
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import type { ResistancePlanPosition } from "@/lib/resistancePlanContract";
import { groupSignatureOf, type ResistanceDisease } from "./resistanceRuleset";
import {
  type ResistanceApplicationEvent,
  type ResistanceProductLine,
} from "./resistanceEvent";
import { resolveProductGroups } from "./resistanceGroupSource";
import type { ResistanceSeason } from "./resistanceSeason";

export const PLANNED_APPLICATION_PREFIX = "plan-position:";

/** Stable, position-derived application ID — survives edits and reordering. */
export const plannedApplicationId = (positionId: string): string =>
  `${PLANNED_APPLICATION_PREFIX}${positionId}`;

export const isPlannedApplicationId = (id: string): boolean =>
  id.startsWith(PLANNED_APPLICATION_PREFIX);

/** Nominal spacing between planned positions when no dates exist in the plan. */
export const PLANNED_SPACING_MS = 14 * 24 * 60 * 60 * 1000;

function productLines(
  position: ResistancePlanPosition,
  intelligenceById: Map<string, ChemicalIntelligence>,
): ResistanceProductLine[] {
  const intel = position.savedChemicalId
    ? intelligenceById.get(position.savedChemicalId) ?? null
    : null;

  // Group-first: the POSITION's groups are the strategy decision. A chosen
  // product adds identity and verification context, not the group itself —
  // and a linked product can only vouch for codes its own structured
  // chemistry actually carries. Shared with the Live Resistance Check.
  const { codes, availability } = resolveProductGroups({
    intel,
    fallbackCodes: position.groups,
    explicitCodes: position.groups,
  });

  return [
    {
      lineId: position.id,
      productName: position.productName ?? intel?.name ?? null,
      savedChemicalId: position.savedChemicalId,
      groups: groupSignatureOf(codes),
      availability,
    },
  ];
}

export interface PlannedEventsArgs {
  positions: ResistancePlanPosition[];
  blockIds: string[];
  vineyardId: string;
  disease: ResistanceDisease;
  season: ResistanceSeason;
  intelligenceById: Map<string, ChemicalIntelligence>;
  /**
   * Instant the first planned position sits at. Callers pass the later of
   * "now" and the last actual application, clamped into the season.
   */
  anchorEpochMs: number;
}

/** One planned event per position PER BLOCK — histories never merge. */
export function buildPlannedEvents(args: PlannedEventsArgs): ResistanceApplicationEvent[] {
  const { positions, blockIds, vineyardId, disease, season, intelligenceById } = args;
  const ordered = [...positions].sort((a, b) => a.sequence - b.sequence);
  const start = Math.min(
    Math.max(args.anchorEpochMs, season.startEpochMs),
    season.endEpochMs - 1,
  );

  const events: ResistanceApplicationEvent[] = [];
  ordered.forEach((position, index) => {
    const at = Math.min(start + (index + 1) * PLANNED_SPACING_MS, season.endEpochMs - 1);
    const products = productLines(position, intelligenceById);
    for (const blockId of blockIds) {
      events.push({
        applicationId: plannedApplicationId(position.id),
        kind: "planned",
        appliedAtEpochMs: at,
        seasonId: season.id,
        vineyardId,
        blockId,
        targets: [position.target ?? disease],
        targetsRecorded: true,
        products,
        mixturePartnerAtLabelRate: null,
      });
    }
  });
  return events;
}
