// Stage 5A — PURE plan-vs-execution comparison. Design artefact only.
//
// Nothing in this module is wired to persistence, and nothing here judges
// resistance compliance. It answers exactly one question:
//
//     Did the executed application match what the plan intended?
//
// That is NOT the same question as "is the strategy exceeded?" — a different
// group can be perfectly compliant, and an on-plan group can still breach the
// strategy. The Resistance Engine owns compliance; this owns fidelity to
// intent. Keeping them separate is the whole point.
import type { ResistanceDisease } from "./resistanceRuleset";
import { normaliseGroupCodes } from "@/lib/resistancePlanContract";

export type DeviationKind =
  /** Executed groups are exactly the planned group set. */
  | "exact_match"
  /** Planned combination satisfied, plus additional group(s) applied. */
  | "superset_match"
  /** Only part of a planned combination was applied. */
  | "partial_combination"
  /** A different group entirely. Not necessarily non-compliant. */
  | "different_group"
  /** Executed chemistry is unknown — fidelity cannot be judged. */
  | "chemistry_unknown";

export interface PlannedIntent {
  positionId: string;
  groups: string[];
  blockIds: string[];
  disease: ResistanceDisease | string;
}

export interface ExecutedApplication {
  /** Spray Job ID or Spray Record ID — the caller says which world it is in. */
  referenceId: string;
  groups: string[];
  /** Blocks as recorded/proposed. Empty = attribution unknown. */
  blockIds: string[];
  targets: (ResistanceDisease | string)[] | null;
}

export interface PlanDeviation {
  positionId: string;
  referenceId: string;
  kind: DeviationKind;
  /** True only for exact_match with full block and target agreement. */
  onPlan: boolean;
  plannedGroups: string[];
  executedGroups: string[];
  /** Planned blocks with no executed coverage. */
  blocksNotCovered: string[];
  /** Executed blocks that were not in the planned intent. */
  blocksNotPlanned: string[];
  /** Executed target does not match the plan's disease. */
  targetMismatch: boolean;
  /** Executed target was not recorded, so agreement is unprovable. */
  targetUnknown: boolean;
  /** Human sentence for the UI. Never a score, never a compliance verdict. */
  summary: string;
}

const sorted = (v: string[]) => [...normaliseGroupCodes(v)].sort();
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && sorted(a).join("|") === sorted(b).join("|");

/** Pure comparison. No engine, no history, no persistence, no score. */
export function comparePlanExecution(
  planned: PlannedIntent,
  executed: ExecutedApplication,
): PlanDeviation {
  const plannedGroups = sorted(planned.groups);
  const executedGroups = sorted(executed.groups);

  const blocksNotCovered = planned.blockIds.filter((b) => !executed.blockIds.includes(b));
  const blocksNotPlanned = executed.blockIds.filter((b) => !planned.blockIds.includes(b));

  const targetUnknown = !executed.targets || executed.targets.length === 0;
  const targetMismatch = !targetUnknown && !executed.targets!.includes(planned.disease);

  let kind: DeviationKind;
  if (executedGroups.length === 0) {
    kind = "chemistry_unknown";
  } else if (sameSet(plannedGroups, executedGroups)) {
    kind = "exact_match";
  } else if (plannedGroups.every((g) => executedGroups.includes(g))) {
    kind = "superset_match";
  } else if (plannedGroups.some((g) => executedGroups.includes(g))) {
    kind = plannedGroups.length > 1 ? "partial_combination" : "different_group";
  } else {
    kind = "different_group";
  }

  const onPlan =
    kind === "exact_match" &&
    blocksNotCovered.length === 0 &&
    blocksNotPlanned.length === 0 &&
    !targetMismatch &&
    !targetUnknown;

  const summary = ((): string => {
    if (kind === "chemistry_unknown") {
      return "Applied chemistry is not recorded, so this cannot be compared with the planned position.";
    }
    const groupText = `planned ${plannedGroups.join(" + ") || "—"}, applied ${executedGroups.join(" + ")}`;
    const base =
      kind === "exact_match"
        ? "Applied groups match the planned position"
        : kind === "superset_match"
          ? `Planned groups were applied with additional chemistry (${groupText})`
          : kind === "partial_combination"
            ? `Only part of the planned combination was applied (${groupText})`
            : `A different activity group was applied (${groupText})`;
    const extras: string[] = [];
    if (blocksNotCovered.length) extras.push(`${blocksNotCovered.length} planned block(s) not covered`);
    if (blocksNotPlanned.length) extras.push(`${blocksNotPlanned.length} block(s) outside the plan`);
    if (targetMismatch) extras.push("different target");
    if (targetUnknown) extras.push("target not recorded");
    return extras.length ? `${base} — ${extras.join(", ")}.` : `${base}.`;
  })();

  return {
    positionId: planned.positionId,
    referenceId: executed.referenceId,
    kind,
    onPlan,
    plannedGroups,
    executedGroups,
    blocksNotCovered,
    blocksNotPlanned,
    targetMismatch,
    targetUnknown,
    summary,
  };
}

/**
 * Display status of a plan position. DERIVED — never persisted, and only
 * meaningful once an authoritative link exists (Stage 5B). With today's schema
 * every position is `planned`, because nothing links a job back to a position.
 */
export type PositionProgressStatus =
  | "planned"
  | "proposed"
  | "completed"
  | "deviated"
  | "cancelled";

export function positionProgressStatus(args: {
  linkedJobIds: string[];
  linkedRecordIds: string[];
  jobCancelled?: boolean;
  deviation?: PlanDeviation | null;
}): PositionProgressStatus {
  if (args.linkedRecordIds.length > 0) {
    return args.deviation && !args.deviation.onPlan ? "deviated" : "completed";
  }
  if (args.linkedJobIds.length > 0) return args.jobCancelled ? "cancelled" : "proposed";
  return "planned";
}
