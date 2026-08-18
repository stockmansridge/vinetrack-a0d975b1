// Stage 3C — the engine's ONLY input type, plus the availability model.
//
// Port of `ChemicalIntelligenceAvailability.swift` and
// `ResistanceApplicationEvent.swift`.
import type { ResistanceDisease, ResistanceGroupSignature } from "./resistanceRuleset";
import { isCoformulation } from "./resistanceRuleset";

/* ------------------------------------------------------------ availability */

/**
 * Whether a recorded application's chemistry can be assessed at all.
 *
 * Exists as its own concept for one reason: a missing snapshot must never read
 * as "no resistance issue". Plenty of legitimate VineTrack history predates
 * Chemical Intelligence, and treating that silence as safety produces a green
 * report for a season nobody can account for.
 */
export type ChemicalIntelligenceAvailability =
  | "available_verified"
  | "available_partially_verified"
  | "available_unverified"
  | "conflict"
  | "unavailable";

export const AVAILABILITY_LABEL: Record<ChemicalIntelligenceAvailability, string> = {
  available_verified: "Verified chemistry",
  available_partially_verified: "Partially verified chemistry",
  available_unverified: "Unverified chemistry",
  conflict: "Conflicting chemistry",
  unavailable: "Chemical intelligence unavailable",
};

export const availabilityCanAssess = (a: ChemicalIntelligenceAvailability): boolean =>
  a === "available_verified" ||
  a === "available_partially_verified" ||
  a === "available_unverified";

export const availabilityIsDependable = (a: ChemicalIntelligenceAvailability): boolean =>
  a === "available_verified";

export const availabilityRequiresQualification = (
  a: ChemicalIntelligenceAvailability,
): boolean => a !== "available_verified";

/** No availability state is ever a silent pass. */
export const availabilityPermitsCleanResult = availabilityCanAssess;

export const AVAILABILITY_SEVERITY_RANK: Record<ChemicalIntelligenceAvailability, number> = {
  unavailable: 0,
  conflict: 1,
  available_unverified: 2,
  available_partially_verified: 3,
  available_verified: 4,
};

export function availabilityCaveat(a: ChemicalIntelligenceAvailability): string | null {
  switch (a) {
    case "available_verified":
      return null;
    case "available_partially_verified":
      return "Some of this product's resistance information was unconfirmed when it was applied.";
    case "available_unverified":
      return "This product's activity groups were entered manually or carried over from an older record.";
    case "conflict":
      return "Sources disagreed about this product's resistance information when it was applied.";
    case "unavailable":
      return "No chemical intelligence was recorded for this application, so it cannot be fully assessed.";
  }
}

/** Map a FROZEN snapshot verification status onto availability. */
export function availabilityFromVerificationStatus(
  status: string | null | undefined,
): ChemicalIntelligenceAvailability {
  switch ((status ?? "").trim().toLowerCase()) {
    case "verified":
      return "available_verified";
    case "partially_verified":
      return "available_partially_verified";
    case "conflict":
      return "conflict";
    // A legacy record nobody ever matched has chemistry of a sort, but nobody
    // confirmed which product it describes: unverified, not partial.
    case "unverified":
    case "needs_match":
      return "available_unverified";
    default:
      return "available_unverified";
  }
}

/* ------------------------------------------------------------------ events */

/**
 * Whether an event happened, is planned, or is being hypothesised. The engine
 * must answer "what if I spray this next?" for a plan that was never saved, so
 * completion can never be a precondition for evaluation.
 */
export type ResistanceEventKind = "actual" | "planned" | "candidate";

export const eventKindIsHistory = (kind: ResistanceEventKind): boolean => kind === "actual";

/**
 * One product line, reduced to what resistance analysis needs. Groups arrive
 * from the FROZEN snapshot on the spray record — never from today's Chemical
 * Store, or a classification corrected in 2029 would rewrite what the 2026
 * rotation is said to have been.
 */
export interface ResistanceProductLine {
  lineId: string;
  productName: string | null;
  savedChemicalId: string | null;
  /** Groups carried by THIS product. Two codes means a co-formulation. */
  groups: ResistanceGroupSignature;
  availability: ChemicalIntelligenceAvailability;
}

export const productLineHasGroups = (line: ResistanceProductLine): boolean =>
  line.groups.codes.length > 0;

/**
 * The canonical unit of resistance history: ONE application, for ONE block.
 * A spray covering three blocks becomes three events — block 1 having had two
 * Group 11 sprays says nothing about block 3.
 */
export interface ResistanceApplicationEvent {
  applicationId: string;
  kind: ResistanceEventKind;
  appliedAtEpochMs: number;
  seasonId: string;
  vineyardId: string;
  blockId: string;
  /** What the operator declared the spray was FOR. Never inferred from chemistry. */
  targets: ResistanceDisease[];
  /**
   * Whether targets were recorded at all. False for pre-sql/193 history, and
   * critically different from an empty list: "never asked" is an unknown that
   * must suppress a clean result, not quietly remove the spray from history.
   */
  targetsRecorded: boolean;
  products: ResistanceProductLine[];
  /**
   * Whether a partner from an alternative mode of action was present AT AN
   * EFFECTIVE RATE, when genuinely known. `null` — the default — means unknown,
   * which is the honest answer from group codes alone.
   */
  mixturePartnerAtLabelRate: boolean | null;
}

export const eventId = (e: ResistanceApplicationEvent): string =>
  `${e.applicationId}|${e.blockId}`;

/** Every group present, however it arrived (solo, co-formulated, tank-mixed). */
export function eventComponentGroups(e: ResistanceApplicationEvent): Set<string> {
  const out = new Set<string>();
  for (const p of e.products) for (const c of p.groups.codes) out.add(c);
  return out;
}

/** Signatures of products carrying more than one group — true co-formulations. */
export const eventCoformulationSignatures = (
  e: ResistanceApplicationEvent,
): ResistanceGroupSignature[] => e.products.map((p) => p.groups).filter(isCoformulation);

/**
 * How far this event's chemistry can be trusted: the WEAKEST product line wins,
 * because one unverifiable product makes the whole group set uncertain.
 */
export function eventAvailability(
  e: ResistanceApplicationEvent,
): ChemicalIntelligenceAvailability {
  if (e.products.length === 0 || !e.products.some(productLineHasGroups)) return "unavailable";
  let worst: ChemicalIntelligenceAvailability = e.products[0].availability;
  for (const p of e.products) {
    if (AVAILABILITY_SEVERITY_RANK[p.availability] < AVAILABILITY_SEVERITY_RANK[worst]) {
      worst = p.availability;
    }
  }
  return worst;
}

export const eventCanAssessChemistry = (e: ResistanceApplicationEvent): boolean =>
  availabilityCanAssess(eventAvailability(e));

export const eventTargets = (
  e: ResistanceApplicationEvent,
  disease: ResistanceDisease,
): boolean => e.targets.includes(disease);

/** Groups present that are NOT among `groups` — candidate mixture partners. */
export function eventGroupsOtherThan(
  e: ResistanceApplicationEvent,
  groups: string[],
): Set<string> {
  const out = new Set<string>();
  for (const code of eventComponentGroups(e)) if (!groups.includes(code)) out.add(code);
  return out;
}

/**
 * Chronological ordering: by instant, then by application ID. The tie-breaker
 * makes results reproducible — a morning and an afternoon job are two sprays,
 * and database row order changes with sync.
 */
export function eventIsOrderedBefore(
  lhs: ResistanceApplicationEvent,
  rhs: ResistanceApplicationEvent,
): boolean {
  if (lhs.appliedAtEpochMs !== rhs.appliedAtEpochMs) {
    return lhs.appliedAtEpochMs < rhs.appliedAtEpochMs;
  }
  return lhs.applicationId < rhs.applicationId;
}

export const chronological = (
  events: ResistanceApplicationEvent[],
): ResistanceApplicationEvent[] =>
  [...events].sort((a, b) =>
    a.appliedAtEpochMs !== b.appliedAtEpochMs
      ? a.appliedAtEpochMs - b.appliedAtEpochMs
      : a.applicationId < b.applicationId
        ? -1
        : a.applicationId > b.applicationId
          ? 1
          : 0,
  );

export function makeEvent(
  input: Partial<ResistanceApplicationEvent> &
    Pick<ResistanceApplicationEvent, "applicationId" | "appliedAtEpochMs" | "blockId">,
): ResistanceApplicationEvent {
  return {
    kind: "actual",
    seasonId: "",
    vineyardId: "",
    targets: [],
    targetsRecorded: true,
    products: [],
    mixturePartnerAtLabelRate: null,
    ...input,
  };
}
