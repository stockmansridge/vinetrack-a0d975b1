// Stage 5C — Plan → Proposed → Actual.
//
// SQL 201 added four provenance columns to `spray_jobs`:
//
//   resistance_plan_id
//   resistance_position_id
//   resistance_position_snapshot     (the plan position JSON, VERBATIM)
//   resistance_plan_source_revision  (the plan's SQL 198 server_revision)
//
// Rules this module exists to enforce:
//
//  * The FROZEN snapshot — never the current plan — is the authority on what
//    a job was originally intended to do. A later plan edit cannot rewrite
//    history.
//  * Provenance is read/written on the JOB only. Creating, editing or
//    completing a job never writes to `resistance_plans` and never bumps its
//    server_revision. Progress is DERIVED.
//  * `cross_vineyard_invalid` is never treated as valid provenance.
//    `pending_plan` is temporary/offline-safe, not a failure.
//  * Templates carry no plan provenance.
import {
  parsePositions,
  serialisePositions,
  type ResistancePlan,
  type ResistancePlanPosition,
} from "@/lib/resistancePlanContract";
import { comparePlanExecution, type PlanDeviation } from "./planDeviation";

/* ------------------------------------------------------------ provenance */

export interface SprayJobPlanProvenance {
  planId: string;
  positionId: string;
  /** Verbatim position JSON as it stood when the job was created. */
  positionSnapshot: Record<string, unknown> | null;
  /** Plan `server_revision` at creation time. */
  planSourceRevision: number | null;
}

export interface SprayJobProvenanceRow {
  resistance_plan_id?: string | null;
  resistance_position_id?: string | null;
  resistance_position_snapshot?: unknown;
  resistance_plan_source_revision?: number | null;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const asObject = (v: unknown): Record<string, unknown> | null => {
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
};

/** Legacy jobs (all four columns NULL) are valid and simply have no plan. */
export function provenanceFromJobRow(
  row: SprayJobProvenanceRow | null | undefined,
): SprayJobPlanProvenance | null {
  if (!row) return null;
  const planId = row.resistance_plan_id ?? null;
  const positionId = row.resistance_position_id ?? null;
  if (!planId || !positionId) return null;
  return {
    planId,
    positionId,
    positionSnapshot: asObject(row.resistance_position_snapshot),
    planSourceRevision: numOrNull(row.resistance_plan_source_revision),
  };
}

/** Column payload. `null` provenance writes explicit NULLs (template strip). */
export function provenanceWritePayload(
  provenance: SprayJobPlanProvenance | null,
): Required<SprayJobProvenanceRow> {
  if (!provenance) {
    return {
      resistance_plan_id: null,
      resistance_position_id: null,
      resistance_position_snapshot: null,
      resistance_plan_source_revision: null,
    };
  }
  return {
    resistance_plan_id: provenance.planId,
    resistance_position_id: provenance.positionId,
    resistance_position_snapshot: provenance.positionSnapshot ?? null,
    resistance_plan_source_revision: provenance.planSourceRevision,
  };
}

/** Templates must never retain plan provenance. */
export const strippedTemplateProvenance = (): Required<SprayJobProvenanceRow> =>
  provenanceWritePayload(null);

/** Freeze a live plan position into provenance for a NEW job. */
export function provenanceFromPosition(args: {
  plan: ResistancePlan;
  position: ResistancePlanPosition;
}): SprayJobPlanProvenance {
  const [snapshot] = serialisePositions([args.position]);
  return {
    planId: args.plan.id,
    positionId: args.position.id,
    positionSnapshot: (snapshot ?? null) as Record<string, unknown> | null,
    planSourceRevision: args.plan.serverRevision,
  };
}

/**
 * The ORIGINAL planned intent, read only from the frozen snapshot. Returns
 * null when the snapshot is missing — we never substitute the current plan.
 */
export function frozenIntent(
  provenance: SprayJobPlanProvenance | null,
): ResistancePlanPosition | null {
  if (!provenance?.positionSnapshot) return null;
  const [pos] = parsePositions([provenance.positionSnapshot]);
  return pos ? { ...pos, id: provenance.positionId } : null;
}

/* ------------------------------------------------------------ link state */

export type PlanLinkState =
  | "unlinked"
  | "resolved"
  | "pending_plan"
  | "position_missing"
  | "cross_vineyard_invalid";

export const LINK_STATE_LABEL: Record<PlanLinkState, string> = {
  unlinked: "No resistance plan link",
  resolved: "Linked to resistance plan",
  pending_plan: "Plan not available yet",
  position_missing: "Original planned position no longer exists in the current plan",
  cross_vineyard_invalid: "Plan belongs to a different vineyard — link is not valid provenance",
};

/** cross_vineyard_invalid is NEVER valid provenance. pending_plan is not a failure. */
export const linkStateIsValidProvenance = (state: PlanLinkState): boolean =>
  state === "resolved" || state === "position_missing";

export function normaliseLinkState(raw: unknown): PlanLinkState | null {
  const value =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? String(
            (raw as any).state ?? (raw as any).link_state ?? (raw as any).status ?? "",
          )
        : "";
  const s = value.trim().toLowerCase();
  if (!s) return null;
  if (s === "valid" || s === "resolved" || s === "ok" || s === "linked") return "resolved";
  if (s === "pending_plan" || s === "pending") return "pending_plan";
  if (s === "cross_vineyard_invalid" || s === "cross_vineyard") return "cross_vineyard_invalid";
  if (s === "position_missing" || s === "missing_position") return "position_missing";
  if (s === "unlinked" || s === "none" || s === "null") return "unlinked";
  return null;
}

/** Offline-safe local resolution, also used when the SQL 201 helper is absent. */
export function resolveLinkStateLocally(args: {
  provenance: SprayJobPlanProvenance | null;
  jobVineyardId: string | null;
  /** `null` = plan not loaded/available (offline, deleted, not yet synced). */
  plan: ResistancePlan | null;
}): PlanLinkState {
  if (!args.provenance) return "unlinked";
  if (!args.plan) return "pending_plan";
  if (
    args.jobVineyardId &&
    args.plan.vineyardId &&
    args.plan.vineyardId !== args.jobVineyardId
  ) {
    return "cross_vineyard_invalid";
  }
  const exists = args.plan.positions.some((p) => p.id === args.provenance!.positionId);
  return exists ? "resolved" : "position_missing";
}

/* -------------------------------------------------------------- coverage */

export interface PositionCoverage {
  sprayJobIds: string[];
  /** Proposed blocks — `spray_job_paddocks`. */
  proposedBlockIds: string[];
  /** Actual blocks — frozen `spray_records.application_blocks`. */
  completedBlockIds: string[];
}

/* -------------------------------------------------------------- progress */

export type PositionProgress =
  | "planned"
  | "proposed"
  | "partially_completed"
  | "completed"
  | "deviated";

export const POSITION_PROGRESS_LABEL: Record<PositionProgress, string> = {
  planned: "Planned",
  proposed: "Proposed",
  partially_completed: "Partially completed",
  completed: "Completed",
  deviated: "Deviated",
};

/**
 * DERIVED only — nothing here is ever written back to `resistance_plans`.
 * Multi-block positions complete block by block.
 */
export function derivePositionProgress(args: {
  plannedBlockIds: string[];
  coverage: PositionCoverage;
  /** True when a linked job/record demonstrably differs from the plan. */
  anyDeviation?: boolean;
}): PositionProgress {
  const planned = args.plannedBlockIds;
  const completed = args.coverage.completedBlockIds;
  const hasJobs = args.coverage.sprayJobIds.length > 0;

  if (completed.length > 0) {
    const outstanding = planned.filter((b) => !completed.includes(b));
    if (planned.length === 0 || outstanding.length === 0) {
      return args.anyDeviation ? "deviated" : "completed";
    }
    return "partially_completed";
  }
  return hasJobs ? "proposed" : "planned";
}

/* ------------------------------------------------------------- deviation */

export type DeviationVerdict = "matches" | "differs" | "not_comparable";

export const DEVIATION_VERDICT_LABEL: Record<DeviationVerdict, string> = {
  matches: "Matches plan",
  differs: "Differs from plan",
  not_comparable: "Unable to compare",
};

export interface JobPlanDeviation {
  verdict: DeviationVerdict;
  deviation: PlanDeviation | null;
  summary: string;
}

/**
 * Compare an executed/proposed application with the FROZEN planned intent.
 * This is fidelity to intent, never a resistance-compliance verdict — a job
 * can differ from the plan and still be a good resistance fit.
 */
export function deviationAgainstSnapshot(args: {
  provenance: SprayJobPlanProvenance | null;
  planDisease: string | null;
  /** Blocks the plan intended for this position (plan-level block selection). */
  plannedBlockIds: string[];
  executed: { referenceId: string; groups: string[]; blockIds: string[]; targets: string[] | null };
}): JobPlanDeviation {
  const intent = frozenIntent(args.provenance);
  if (!intent) {
    return {
      verdict: "not_comparable",
      deviation: null,
      summary:
        "No frozen planned position is stored for this job, so it cannot be compared with the plan.",
    };
  }
  const deviation = comparePlanExecution(
    {
      positionId: intent.id,
      groups: intent.groups,
      blockIds: args.plannedBlockIds,
      disease: intent.target ?? args.planDisease ?? "",
    },
    args.executed,
  );
  const verdict: DeviationVerdict =
    deviation.kind === "chemistry_unknown"
      ? "not_comparable"
      : deviation.kind === "exact_match" && !deviation.targetMismatch
        ? "matches"
        : "differs";
  return { verdict, deviation, summary: deviation.summary };
}
