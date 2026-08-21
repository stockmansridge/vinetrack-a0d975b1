// Stage 3C — turns stored spray history into canonical engine events.
// Port of `ResistanceEventSource.swift`.
//
// WHICH RECORD STATES COUNT AS RESISTANCE HISTORY
//
// Included: records that are not templates and have a usable date, classified
// `actual` when an end time is present.
//
// Excluded, and why:
// - `is_template` — a template is a reusable recipe, never sprayed on a vine.
// - Soft-deleted records — a deleted record is a retracted claim; counting it
//   would let a mistaken entry permanently consume a group's allowance.
// - No end time — classified `planned` rather than discarded. VineTrack has no
//   cancelled/reversed state; an unfinished record is the closest thing, and
//   the engine excludes planned events while still reporting that it did.
// - No usable date — resistance rules are entirely sequence-based, so an event
//   with no position in the chronology cannot be evaluated. Surfaced in
//   `undatedRecordIds` rather than dropped silently.
//
// BLOCK ATTRIBUTION
//
// Since sql/195 a spray record states which blocks it treated
// (`application_blocks`). This adapter reads that verbatim. A record written
// BEFORE sql/195 carries no attribution, which means "blocks not recorded" and
// nothing else: it produces NO events and is reported in
// `unresolvedBlockApplications`. It is never assigned to a block — not by row
// number, not by name similarity, not by current geometry, and not by "the
// vineyard only has one block".
import { readChemicalSnapshot } from "@/lib/sprayChemicalSnapshot";
import { readApplicationBlocks } from "@/lib/sprayRecordAttribution";
import { qualifiedGroupCode } from "./resistanceGroupSource";
import {
  diseaseFromSprayTargetRaw,
  groupSignatureOf,
  type ResistanceDisease,
} from "./resistanceRuleset";
import {
  availabilityFromVerificationStatus,
  chronological,
  type ChemicalIntelligenceAvailability,
  type ResistanceApplicationEvent,
  type ResistanceEventKind,
  type ResistanceProductLine,
} from "./resistanceEvent";
import {
  seasonForEpochMs,
  type ResistanceSeasonCalendar,
} from "./resistanceSeason";

/** One record's resistance-relevant facts, supplied explicitly. */
export interface ResistanceEventInput {
  recordId: string;
  vineyardId: string;
  appliedAtEpochMs: number | null;
  isTemplate: boolean;
  isDeleted: boolean;
  hasEndTime: boolean;
  /**
   * `null` means targets were never recorded (pre-sql/193). An empty array
   * means recorded as targeting nothing. Those are different facts.
   */
  targets: ResistanceDisease[] | null;
  /**
   * `null` means NEVER RECORDED (pre-sql/195); a populated array means
   * recorded. Silence must not read as "none".
   */
  blockIds: string[] | null;
  products: ResistanceProductLine[];
}

/**
 * A real application that cannot be placed on any block, carried with enough
 * context for a caller to decide whether it could have changed a block's
 * answer. An unattributed spray happened SOMEWHERE in this vineyard: it is not
 * irrelevant, it is unplaceable.
 */
export interface UnresolvedBlockApplication {
  applicationId: string;
  vineyardId: string;
  appliedAtEpochMs: number;
  seasonId: string;
  kind: ResistanceEventKind;
  targets: ResistanceDisease[];
  targetsRecorded: boolean;
  products: ResistanceProductLine[];
}

/** Unrecorded targets count as possibly-relevant: nothing establishes otherwise. */
export const unresolvedMayConcern = (
  app: UnresolvedBlockApplication,
  disease: ResistanceDisease,
): boolean => !app.targetsRecorded || app.targets.includes(disease);

/**
 * Events plus an explicit account of everything that did NOT become an event.
 * Exclusions are returned rather than logged, because a resistance report built
 * on a silently-filtered history is exactly the false clean result this work
 * exists to prevent.
 */
export interface ResistanceEventSourceResult {
  events: ResistanceApplicationEvent[];
  deletedRecordIds: string[];
  templateRecordIds: string[];
  undatedRecordIds: string[];
  unresolvedBlockApplications: UnresolvedBlockApplication[];
}

export const hasUnresolvedBlockAttribution = (r: ResistanceEventSourceResult): boolean =>
  r.unresolvedBlockApplications.length > 0;

export const unresolvedApplicationsConcerning = (
  r: ResistanceEventSourceResult,
  disease: ResistanceDisease,
  seasonId?: string | null,
): UnresolvedBlockApplication[] =>
  r.unresolvedBlockApplications.filter(
    (a) => unresolvedMayConcern(a, disease) && (seasonId == null || a.seasonId === seasonId),
  );

export const hasExclusions = (r: ResistanceEventSourceResult): boolean =>
  r.deletedRecordIds.length > 0 ||
  r.templateRecordIds.length > 0 ||
  r.undatedRecordIds.length > 0 ||
  r.unresolvedBlockApplications.length > 0;

export function buildResistanceEvents(
  inputs: ResistanceEventInput[],
  seasonCalendar: ResistanceSeasonCalendar,
): ResistanceEventSourceResult {
  const events: ResistanceApplicationEvent[] = [];
  const deleted: string[] = [];
  const templates: string[] = [];
  const undated: string[] = [];
  const unresolved: UnresolvedBlockApplication[] = [];

  for (const input of inputs) {
    if (input.isDeleted) {
      deleted.push(input.recordId);
      continue;
    }
    if (input.isTemplate) {
      templates.push(input.recordId);
      continue;
    }
    if (input.appliedAtEpochMs == null) {
      undated.push(input.recordId);
      continue;
    }
    const epochMs = input.appliedAtEpochMs;
    const kind: ResistanceEventKind = input.hasEndTime ? "actual" : "planned";
    const targetsRecorded = input.targets != null;
    const diseases = input.targets ?? [];
    const seasonId = seasonForEpochMs(seasonCalendar, epochMs).id;

    const seen = new Set<string>();
    const blockIds = (input.blockIds ?? []).filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (blockIds.length === 0) {
      unresolved.push({
        applicationId: input.recordId,
        vineyardId: input.vineyardId,
        appliedAtEpochMs: epochMs,
        seasonId,
        kind,
        targets: diseases,
        targetsRecorded,
        products: input.products,
      });
      continue;
    }

    for (const blockId of blockIds) {
      events.push({
        // One spray across three blocks becomes three events, each keeping the
        // spray's own ID so a warning can point back to the record the operator
        // recognises.
        applicationId: input.recordId,
        kind,
        appliedAtEpochMs: epochMs,
        seasonId,
        vineyardId: input.vineyardId,
        blockId,
        targets: diseases,
        targetsRecorded,
        products: input.products,
        mixturePartnerAtLabelRate: null,
      });
    }
  }

  return {
    events: chronological(events),
    deletedRecordIds: deleted,
    templateRecordIds: templates,
    undatedRecordIds: undated,
    unresolvedBlockApplications: unresolved.sort((a, b) =>
      a.appliedAtEpochMs !== b.appliedAtEpochMs
        ? a.appliedAtEpochMs - b.appliedAtEpochMs
        : a.applicationId < b.applicationId
          ? -1
          : a.applicationId > b.applicationId
            ? 1
            : 0,
    ),
  };
}

/* ------------------------------------------- raw `spray_records` adapters */

function tankArray(tanks: unknown): any[] {
  if (!tanks) return [];
  if (Array.isArray(tanks)) return tanks;
  if (typeof tanks === "object" && Array.isArray((tanks as any).tanks)) {
    return (tanks as any).tanks;
  }
  if (typeof tanks === "string") {
    try {
      return tankArray(JSON.parse(tanks));
    } catch {
      return [];
    }
  }
  return [tanks];
}

/**
 * Product lines built from the FROZEN snapshot on each chemical line.
 *
 * Never re-reads the live Chemical Store record: a classification corrected in
 * 2029 must not retroactively change what the 2026 rotation is said to have
 * been. A missing snapshot is `unavailable` — never "no groups".
 */
export function productLinesFromRecord(record: Record<string, any>): ResistanceProductLine[] {
  const lines: ResistanceProductLine[] = [];
  tankArray(record?.tanks).forEach((tank: any, tankIndex: number) => {
    const chemicals = Array.isArray(tank?.chemicals)
      ? tank.chemicals
      : Array.isArray(tank?.lines)
        ? tank.lines
        : [];
    chemicals.forEach((chemical: any, lineIndex: number) => {
      const snapshot = readChemicalSnapshot(chemical?.chemicalSnapshot);
      // P8 — prefer scheme-qualified codes reconstructed from the frozen
      // actives, so a snapshot written before schemes were qualified still
      // reads HRAC/IRAC chemistry as itself rather than as FRAC.
      const activeCodes = (snapshot?.active_ingredients ?? [])
        .map((a) => qualifiedGroupCode(a.activity_group?.scheme, a.activity_group?.code))
        .filter((c): c is string => !!c);
      const codes = activeCodes.length > 0 ? activeCodes : snapshot?.activity_groups ?? [];
      const name = String(chemical?.name ?? chemical?.chemical_name ?? "").trim();
      let availability: ChemicalIntelligenceAvailability = "unavailable";
      // A snapshot can exist and still carry nothing assessable — a legacy line
      // that preserved "Group 3 + 11" as display text has no structured group
      // and must not be mistaken for one.
      if (snapshot && codes.length > 0) {
        availability = availabilityFromVerificationStatus(snapshot.verification_status);
      }
      lines.push({
        lineId: String(chemical?.id ?? `${record?.id ?? "record"}:${tankIndex}:${lineIndex}`),
        productName: snapshot?.product_name ?? (name || null),
        savedChemicalId:
          snapshot?.saved_chemical_id ??
          (chemical?.savedChemicalId ?? chemical?.saved_chemical_id ?? null),
        groups: groupSignatureOf(codes),
        availability,
      });
    });
  });
  return lines;
}

function recordEpochMs(record: Record<string, any>): number | null {
  const date = record?.date ?? record?.applied_at ?? null;
  if (!date) return null;
  const time = String(record?.start_time ?? "").trim();
  const iso =
    typeof date === "string" && !date.includes("T")
      ? `${date}T${/^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "00:00"}:00`
      : String(date);
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Declared targets, read from the record. `null` when the question was never
 * asked (pre-sql/193) — which must not collapse into "no targets".
 */
export function recordTargets(record: Record<string, any>): ResistanceDisease[] | null {
  const raw = record?.targets;
  if (raw == null) return null;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [raw];
          } catch {
            return [raw];
          }
        })()
      : [];
  const out: ResistanceDisease[] = [];
  for (const entry of list) {
    const disease = diseaseFromSprayTargetRaw(
      typeof entry === "string" ? entry : (entry?.target ?? entry?.value ?? null),
    );
    if (disease && !out.includes(disease)) out.push(disease);
  }
  return out;
}

/** Build an engine input from a raw `spray_records` row. */
export function eventInputFromSprayRecord(
  record: Record<string, any>,
): ResistanceEventInput {
  const attribution = readApplicationBlocks(record);
  const blockIds =
    attribution.status === "recorded"
      ? attribution.blocks
          .map((b) => b.blockId)
          .filter((id): id is string => !!id)
      : null;
  return {
    recordId: String(record?.id ?? ""),
    vineyardId: String(record?.vineyard_id ?? ""),
    appliedAtEpochMs: recordEpochMs(record),
    isTemplate: !!record?.is_template,
    isDeleted: !!record?.deleted_at,
    hasEndTime: !!record?.end_time,
    targets: recordTargets(record),
    blockIds: blockIds && blockIds.length > 0 ? blockIds : null,
    products: productLinesFromRecord(record),
  };
}
