// Spray worksheet save orchestration.
//
// One Save press = one frozen attempt. The whole draft is validated and every
// request (metadata + one per edited tank) is built BEFORE any write is issued.
// Each request carries its own operation UUID, expected version, actual id and
// chemical line ids; a retry re-issues the EXACT same requests, so the audited
// server contracts treat it as the same correction rather than a new one.
//
// Outcomes are tracked per operation: confirmed saved, refused (conflict),
// failed, or uncertain. A dropped connection is uncertain — the server may have
// committed — and is never reported as "not saved".
//
// Writes still go only through `correct_spray_trip_metadata_v1` and
// `correct_spray_tank_actual_v1`. Nothing here touches tables directly and
// nothing rewrites frozen planned quantities.
import type { SprayReportPayloadV1 } from "@/lib/sprayReportV1";
import {
  diffActualsDraft,
  saveTankActual,
  tankSnapshotsForDraft,
  SprayActualsConflictError,
  SPRAY_ACTUALS_SAVE_FAILED,
  type ActualsDraft,
  type TankActualSnapshot,
} from "@/lib/sprayActuals";
import {
  correctSprayTripMetadata,
  TripMetadataConflictError,
  validateFuelRate,
  type TripMetadataCorrection,
} from "@/lib/sprayTripMetadata";
import { validateTripEngineHours } from "@/lib/tripsQuery";
import { generateUuid } from "@/lib/uuid";
import { ACTUALS_VERSION_CONFLICT } from "@/lib/sprayReportMessaging";

export const SAVE_UNCERTAIN_HINT =
  "Retry to check — retrying won't create a duplicate correction.";

/* ------------------------------------------------------------------ */
/* Plan                                                                 */
/* ------------------------------------------------------------------ */

export interface MetadataRequest {
  operationId: string;
  tripId: string;
  expectedVersion: number;
  correction: TripMetadataCorrection;
}

export interface TankRequest {
  operationId: string;
  tankNumber: number;
  snapshot: TankActualSnapshot;
  tripId: string;
  sprayRecordId: string | null;
}

export interface SavePlan {
  metadata: MetadataRequest | null;
  tanks: TankRequest[];
  /** Validation problems. When non-empty nothing is written at all. */
  errors: string[];
}

export interface MetadataFormValues {
  machineId: string | null;
  sprayEquipmentId: string | null;
  operatorUserId: string | null;
  /** Raw typed text; blank means "no override". */
  fuelRateText: string;
  startHoursText: string;
  endHoursText: string;
}

function numOrNaN(v: string): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}

function sameMetadata(payload: SprayReportPayloadV1, c: TripMetadataCorrection): boolean {
  const currentRate =
    payload.equipment.fuelConsumptionSource === "explicit_correction"
      ? (payload.equipment.fuelConsumptionLPerHour ?? null)
      : null;
  return (
    (payload.equipment.machineId ?? null) === c.machineId &&
    (payload.equipment.tractorId ?? null) === c.tractorId &&
    (payload.equipment.sprayEquipmentId ?? null) === c.sprayEquipmentId &&
    (payload.trip.operatorId ?? null) === c.operatorUserId &&
    currentRate === c.fuelConsumptionLPerHour &&
    (payload.equipment.startEngineHours ?? null) === c.startEngineHours &&
    (payload.equipment.endEngineHours ?? null) === c.endEngineHours
  );
}

/**
 * Validate everything and freeze every request. Unchanged metadata and
 * unchanged tanks are skipped, so a repeated Save never resubmits a no-op.
 */
export function buildSavePlan(
  payload: SprayReportPayloadV1,
  draft: ActualsDraft,
  form: MetadataFormValues,
): SavePlan {
  const errors: string[] = [];

  const diff = diffActualsDraft(payload, draft);
  errors.push(...diff.errors);

  const start = numOrNaN(form.startHoursText);
  const end = numOrNaN(form.endHoursText);
  const rate = numOrNaN(form.fuelRateText);
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(rate)) {
    errors.push("Engine hours and fuel use must be numbers.");
  } else {
    const badHours = validateTripEngineHours(start, end);
    if (badHours) errors.push(badHours);
    const badRate = validateFuelRate(rate);
    if (badRate) errors.push(badRate);
  }

  if (errors.length) return { metadata: null, tanks: [], errors };

  const correction: TripMetadataCorrection = {
    machineId: form.machineId,
    tractorId: payload.equipment.tractorId ?? null,
    sprayEquipmentId: form.sprayEquipmentId,
    operatorUserId: form.operatorUserId,
    fuelConsumptionLPerHour: rate as number | null,
    startEngineHours: start as number | null,
    endEngineHours: end as number | null,
  };

  const metadata: MetadataRequest | null = sameMetadata(payload, correction)
    ? null
    : {
        operationId: generateUuid(),
        tripId: payload.identity.tripId,
        expectedVersion: payload.metadataCorrectionVersion ?? 0,
        correction,
      };

  const tanks: TankRequest[] = tankSnapshotsForDraft(payload, draft).map((snapshot) => ({
    operationId: generateUuid(),
    tankNumber: snapshot.tankNumber,
    snapshot,
    tripId: payload.identity.tripId,
    sprayRecordId: payload.identity.sprayRecordId ?? null,
  }));

  return { metadata, tanks, errors: [] };
}

export function planIsEmpty(plan: SavePlan): boolean {
  return !plan.metadata && plan.tanks.length === 0;
}

/* ------------------------------------------------------------------ */
/* Attempt state                                                        */
/* ------------------------------------------------------------------ */

export type OperationStatus = "pending" | "saved" | "failed" | "uncertain" | "conflict";

export interface OperationResult {
  status: OperationStatus;
  /** Technical text — system-admin diagnostics only. */
  diagnostic: string | null;
}

export interface SaveAttempt {
  plan: SavePlan;
  /** Keys: "metadata" and `tank:<n>`. Frozen for the life of the attempt. */
  results: Record<string, OperationResult>;
}

export function createSaveAttempt(plan: SavePlan): SaveAttempt {
  const results: Record<string, OperationResult> = {};
  if (plan.metadata) results.metadata = { status: "pending", diagnostic: null };
  for (const t of plan.tanks) results[`tank:${t.tankNumber}`] = { status: "pending", diagnostic: null };
  return { plan, results };
}

const NETWORK_HINTS = [
  "failed to fetch",
  "network",
  "networkerror",
  "load failed",
  "timeout",
  "timed out",
  "aborted",
  "connection",
  "econnreset",
  "socket",
  "offline",
  "504",
  "502",
];

/** A dropped connection may still have committed on the server. */
export function isUncertainFailure(error: unknown): boolean {
  const e = error as { message?: unknown; name?: unknown; code?: unknown } | null;
  const text = `${String(e?.name ?? "")} ${String(e?.message ?? "")} ${String(e?.code ?? "")}`.toLowerCase();
  return NETWORK_HINTS.some((h) => text.includes(h));
}

function isConflictError(error: unknown): boolean {
  return (
    error instanceof SprayActualsConflictError ||
    error instanceof TripMetadataConflictError ||
    (error as { code?: string })?.code === "40001"
  );
}

function classify(error: unknown): OperationResult {
  const diagnostic = error instanceof Error ? error.message : String(error);
  if (isConflictError(error)) return { status: "conflict", diagnostic };
  if (isUncertainFailure(error)) return { status: "uncertain", diagnostic };
  return { status: "failed", diagnostic };
}

/* ------------------------------------------------------------------ */
/* Execution                                                            */
/* ------------------------------------------------------------------ */

export interface AttemptSummary {
  saved: string[];
  unresolved: string[];
  uncertain: string[];
  conflicts: string[];
  anySaved: boolean;
  allSaved: boolean;
  /** Customer-safe sentence. Never claims "not saved" when something saved. */
  message: string;
  diagnostics: string[];
  /** Metadata version returned by the server, when it was written. */
  metadataVersion: number | null;
}

const METADATA_LABEL = "Trip details";
const tankLabel = (n: number) => `Tank ${n}`;

/**
 * Run (or retry) a frozen attempt. Operations already confirmed saved are
 * skipped; everything else is re-issued with its ORIGINAL request and
 * operation id, so a committed-but-unconfirmed write is de-duplicated by the
 * server rather than repeated as a new correction.
 */
export async function runSaveAttempt(attempt: SaveAttempt): Promise<AttemptSummary> {
  let metadataVersion: number | null = null;

  if (attempt.plan.metadata && attempt.results.metadata?.status !== "saved") {
    const req = attempt.plan.metadata;
    try {
      const res = await correctSprayTripMetadata({
        tripId: req.tripId,
        expectedVersion: req.expectedVersion,
        correction: req.correction,
        operationId: req.operationId,
      });
      metadataVersion = res.version ?? null;
      attempt.results.metadata = { status: "saved", diagnostic: null };
    } catch (e) {
      attempt.results.metadata = classify(e);
    }
  }

  for (const req of attempt.plan.tanks) {
    const key = `tank:${req.tankNumber}`;
    if (attempt.results[key]?.status === "saved") continue;
    try {
      await saveTankActual({
        operationId: req.operationId,
        tripId: req.tripId,
        sprayRecordId: req.sprayRecordId,
        snapshot: req.snapshot,
      });
      attempt.results[key] = { status: "saved", diagnostic: null };
    } catch (e) {
      attempt.results[key] = classify(e);
    }
  }

  return summariseAttempt(attempt, metadataVersion);
}

export function summariseAttempt(
  attempt: SaveAttempt,
  metadataVersion: number | null = null,
): AttemptSummary {
  const saved: string[] = [];
  const unresolved: string[] = [];
  const uncertain: string[] = [];
  const conflicts: string[] = [];
  const diagnostics: string[] = [];

  const entries: Array<[string, string]> = [];
  if (attempt.plan.metadata) entries.push(["metadata", METADATA_LABEL]);
  for (const t of attempt.plan.tanks) entries.push([`tank:${t.tankNumber}`, tankLabel(t.tankNumber)]);

  for (const [key, label] of entries) {
    const r = attempt.results[key] ?? { status: "pending" as const, diagnostic: null };
    if (r.diagnostic) diagnostics.push(`${label}: ${r.diagnostic}`);
    if (r.status === "saved") saved.push(label);
    else if (r.status === "uncertain") uncertain.push(label);
    else if (r.status === "conflict") {
      conflicts.push(label);
      unresolved.push(label);
    } else unresolved.push(label);
  }

  const allSaved = entries.length > 0 && saved.length === entries.length;
  const anySaved = saved.length > 0;

  const parts: string[] = [];
  if (allSaved) {
    parts.push("Your changes have been saved.");
  } else if (anySaved) {
    parts.push(`Saved: ${saved.join(", ")}.`);
  }
  if (conflicts.length) {
    parts.push(
      `${conflicts.join(", ")}: ${ACTUALS_VERSION_CONFLICT.customer}`,
    );
  }
  const plainlyFailed = unresolved.filter((u) => !conflicts.includes(u));
  if (plainlyFailed.length) {
    parts.push(
      anySaved
        ? `Still to save: ${plainlyFailed.join(", ")}. Please try again.`
        : SPRAY_ACTUALS_SAVE_FAILED,
    );
  }
  if (uncertain.length) {
    parts.push(
      `${uncertain.join(", ")}: the connection dropped before we could confirm, so these may already be saved. ${SAVE_UNCERTAIN_HINT}`,
    );
  }

  return {
    saved,
    unresolved,
    uncertain,
    conflicts,
    anySaved,
    allSaved,
    message: parts.join(" "),
    diagnostics,
    metadataVersion,
  };
}

/** Nothing left to do for this attempt. */
export function attemptComplete(attempt: SaveAttempt): boolean {
  return Object.values(attempt.results).every((r) => r.status === "saved");
}

/** Tank numbers whose edits are still unresolved — keep those draft edits. */
export function unresolvedTankNumbers(attempt: SaveAttempt): number[] {
  return attempt.plan.tanks
    .filter((t) => attempt.results[`tank:${t.tankNumber}`]?.status !== "saved")
    .map((t) => t.tankNumber);
}
