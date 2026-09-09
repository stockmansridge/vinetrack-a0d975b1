// Manual spray entry — backend contract boundary.
//
// Rork owns the shared backend contract. The Portal must NOT invent a second
// way to store a manual spray, so every production write funnels through the
// named functions below, exactly as documented in SQL 232
// (docs/manual-spray-entry-lovable-handoff.md).
//
//   save_manual_spray_v1(p_operation_id, p_payload, p_expected_version)
//   delete_manual_spray_v1(p_operation_id, p_vineyard_id, p_manual_entry_id,
//                          p_spray_record_id, p_trip_id)
//
// Both are idempotent on the operation id: re-sending an identical request
// after an uncertain response returns the original result rather than making a
// second application.
import { supabase } from "@/integrations/ios-supabase/client";
import { toBaseAmount } from "@/lib/manualSpray/units";
import type { ManualSprayDraft } from "@/lib/manualSpray/domain";

/** Function names agreed for the handoff. Never call anything else. */
export const MANUAL_SPRAY_RPC = {
  save: "save_manual_spray_v1",
  delete: "delete_manual_spray_v1",
  report: "get_spray_report_v1",
} as const;

export const MANUAL_SPRAY_UNAVAILABLE_MESSAGE =
  "Saving manual sprays is waiting on the shared backend. You can fill this form in, but it can't be saved yet.";

export interface ManualSprayContractStatus {
  available: boolean;
  gaps: string[];
}

/**
 * SQL 232 and 233 are deployed, so the save/delete functions exist. No mutation
 * call is ever used as a health check, and there is no stale "not deployed"
 * warning: if the shared project ever answers PGRST202 at save time, ordinary
 * error handling reports it accurately.
 */
export async function probeManualSprayContract(): Promise<ManualSprayContractStatus> {
  return { available: true, gaps: [] };
}

/* --------------------------------------------------------------- payload */

export interface ManualSprayChemicalWire {
  id: string;
  savedChemicalId: string | null;
  name: string;
  /** Base amount: mL for liquids, g for solids. Null stays null. */
  actualAmountBase: number | null;
  unit: string | null;
  productCategory: string | null;
  physicalForm: string;
  snapshotAt: string | null;
  snapshot: Record<string, unknown> | null;
}

export interface ManualSprayTankWire {
  id: string;
  actualId: string;
  tankNumber: number;
  waterVolumeLitres: number | null;
  chemicals: ManualSprayChemicalWire[];
}

export interface ManualSprayPayload {
  vineyardId: string;
  manualEntryId: string;
  sprayRecordId: string;
  tripId: string;
  reference: string;
  operationType: "manual_spray";
  startUtc: string | null;
  endUtc: string | null;
  vineyardTimeZone: string | null;
  tractorId: string | null;
  operatorUserId: string | null;
  sprayEquipmentId: string | null;
  startEngineHours: number | null;
  endEngineHours: number | null;
  notes: string | null;
  clientUpdatedAt: string;
  blocks: Array<{ blockId: string; blockName: string | null }>;
  tanks: ManualSprayTankWire[];
  /** Documented single manual observation, or null when nothing was entered. */
  manualWeather: ManualWeatherWire | null;
}

/** Manual weather evidence, exactly as documented in the handoff. */
export interface ManualWeatherWire {
  observedAt: string | null;
  source: string;
  temperatureC: number | null;
  humidityPct: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  rainMm: number | null;
}

const finite = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

/**
 * Only genuinely entered conditions travel. Nothing is defaulted to zero, and a
 * wind direction that isn't a compass bearing in degrees is sent as null rather
 * than guessed.
 */
export function toManualWeatherWire(
  weather: ManualSprayDraft["weather"],
): ManualWeatherWire | null {
  const w = weather?.[0];
  if (!w) return null;
  const deg = Number(w.windDirection);
  const wire: ManualWeatherWire = {
    observedAt: w.observedAt ?? null,
    source: "Operator observation",
    temperatureC: finite(w.temperature),
    humidityPct: finite(w.humidity),
    windSpeedKmh: finite(w.windSpeed),
    windGustKmh: null,
    windDirectionDeg: w.windDirection != null && Number.isFinite(deg) ? deg : null,
    rainMm: null,
  };
  const hasValue =
    wire.temperatureC != null ||
    wire.humidityPct != null ||
    wire.windSpeedKmh != null ||
    wire.windDirectionDeg != null;
  return hasValue ? wire : null;
}

/**
 * Deterministic mapping from a validated draft to the documented wire payload.
 * `clientUpdatedAt` is stamped here ONCE per logical save; a retry re-sends the
 * frozen payload rather than calling this again.
 */
export function toManualSprayPayload(
  draft: ManualSprayDraft,
  clientUpdatedAt: string = new Date().toISOString(),
): ManualSprayPayload {
  return {
    vineyardId: draft.vineyardId,
    manualEntryId: draft.manualEntryId,
    sprayRecordId: draft.sprayRecordId,
    tripId: draft.tripId,
    reference: draft.name.trim(),
    operationType: "manual_spray",
    startUtc: draft.startAt,
    endUtc: draft.endAt,
    vineyardTimeZone: draft.vineyardTimeZone ?? null,
    tractorId: draft.tractorId,
    operatorUserId: draft.operatorUserId,
    sprayEquipmentId: draft.sprayEquipmentId,
    startEngineHours: draft.startEngineHours,
    endEngineHours: draft.endEngineHours,
    notes: draft.notes.trim() || null,
    clientUpdatedAt,
    blocks: draft.blockIds.map((blockId) => ({
      blockId,
      blockName: draft.blockNames?.[blockId] ?? null,
    })),
    tanks: draft.tanks.map((t) => ({
      id: t.id,
      actualId: t.actualId,
      tankNumber: t.displayNumber,
      waterVolumeLitres: t.waterLitres,
      chemicals: t.chemicals.map((c) => {
        const base = toBaseAmount(c.amount, c.unit);
        return {
          id: c.id,
          savedChemicalId: c.savedChemicalId,
          name: c.productName.trim(),
          actualAmountBase: base ? base.base : null,
          unit: c.unit,
          productCategory: c.category,
          physicalForm: c.physicalForm,
          snapshotAt: c.snapshotAt ?? null,
          snapshot: c.snapshot ?? null,
        };
      }),
    })),
    manualWeather: toManualWeatherWire(draft.weather),
  };
}

/* ----------------------------------------------------- frozen save attempt */

/**
 * One logical save, frozen. The operation id, expected version and the whole
 * payload are allocated once; a retry re-sends exactly this object.
 */
export interface ManualSprayAttempt {
  operationId: string;
  expectedVersion: number | null;
  payload: ManualSprayPayload;
}

export function freezeManualSprayAttempt(
  draft: ManualSprayDraft,
  operationId: string = newOperationId(),
  clientUpdatedAt: string = new Date().toISOString(),
): ManualSprayAttempt {
  return {
    operationId,
    expectedVersion: draft.syncVersion ?? 0,
    payload: toManualSprayPayload(draft, clientUpdatedAt),
  };
}

export function newOperationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* -------------------------------------------------------- save / delete */

export interface ManualSprayIdentities {
  manualEntryId: string;
  sprayRecordId: string;
  tripId: string;
  syncVersion: number;
}

export type ManualSpraySaveOutcome =
  | { kind: "unavailable"; message: string; gaps: string[] }
  | { kind: "saved"; identities: ManualSprayIdentities }
  | { kind: "refused"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "conflict"; message: string }
  /** The application was deleted; the tombstone is authoritative (SQL 233). */
  | { kind: "deleted"; message: string }
  | { kind: "uncertain"; message: string };

export const MANUAL_SPRAY_DELETED_MESSAGE =
  "This spray has been deleted, so it can't be saved again. Start a new manual spray if you still need to record it.";

const UNCERTAIN_PATTERNS = [/failed to fetch/i, /network/i, /timeout/i, /aborted/i, /load failed/i];

export const isUncertainManualFailure = (e: unknown): boolean => {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? "");
  return UNCERTAIN_PATTERNS.some((p) => p.test(m));
};

export const UNCERTAIN_SAVE_MESSAGE =
  "The connection dropped before the server answered. This spray may already be saved — use Retry, which re-sends the same entry rather than creating a second one.";

/** Classify an RPC error honestly: missing, permission, conflict, network. */
function classify(error: { code?: string; message?: string }): ManualSpraySaveOutcome {
  const code = error.code ?? "";
  const message = error.message ?? "Unknown error";
  if (code === "PGRST202")
    return { kind: "unavailable", message: MANUAL_SPRAY_UNAVAILABLE_MESSAGE, gaps: [`${MANUAL_SPRAY_RPC.save} is not deployed.`] };
  if (code === "42501" || /permission denied/i.test(message))
    return { kind: "denied", message: "You don't have permission to record manual sprays for this vineyard." };
  if (code === "401" || /jwt|not authenticated/i.test(message))
    return { kind: "denied", message: "Your session has expired. Sign in again and retry." };
  // SQL 233: a retry of a save whose application has since been deleted. The
  // tombstone wins — never present the old cached response as confirmation.
  if (code === "55000" || /tombstone|deleted/i.test(message))
    return { kind: "deleted", message: MANUAL_SPRAY_DELETED_MESSAGE };
  if (code === "40001" || /conflict|stale/i.test(message))
    return { kind: "conflict", message: "This spray was changed somewhere else. Reopen it to see the newer version before saving again." };
  if (isUncertainManualFailure(error)) return { kind: "uncertain", message: UNCERTAIN_SAVE_MESSAGE };
  return { kind: "refused", message };
}

function readIdentities(data: unknown): ManualSprayIdentities | null {
  const d = data as Record<string, any> | null;
  const row = Array.isArray(d) ? d[0] : d;
  if (!row || typeof row !== "object") return null;
  if (row.serverConfirmed !== true) return null;
  const { manualEntryId, sprayRecordId, tripId, syncVersion } = row;
  if (typeof manualEntryId !== "string" || typeof sprayRecordId !== "string") return null;
  if (typeof tripId !== "string" || typeof syncVersion !== "number") return null;
  return { manualEntryId, sprayRecordId, tripId, syncVersion };
}

/** Send a frozen attempt. Retrying passes the identical attempt object. */
export async function saveManualSpray(attempt: ManualSprayAttempt): Promise<ManualSpraySaveOutcome> {
  try {
    const { data, error } = await supabase.rpc(MANUAL_SPRAY_RPC.save as any, {
      p_operation_id: attempt.operationId,
      p_payload: attempt.payload,
      p_expected_version: attempt.expectedVersion,
    } as any);
    if (error) return classify(error as any);
    const identities = readIdentities(data);
    if (!identities) {
      return {
        kind: "uncertain",
        message: "The server answered without a confirmation. Check the spray records list before retrying.",
      };
    }
    return { kind: "saved", identities };
  } catch (e) {
    if (isUncertainManualFailure(e)) return { kind: "uncertain", message: UNCERTAIN_SAVE_MESSAGE };
    return { kind: "refused", message: e instanceof Error ? e.message : String(e) };
  }
}

export interface ManualSprayDeleteRequest {
  operationId: string;
  vineyardId: string;
  manualEntryId: string;
  sprayRecordId: string;
  tripId: string;
}

/** Coordinated soft delete. Never an isolated table write. */
export async function deleteManualSpray(req: ManualSprayDeleteRequest): Promise<ManualSpraySaveOutcome> {
  try {
    const { error } = await supabase.rpc(MANUAL_SPRAY_RPC.delete as any, {
      p_operation_id: req.operationId,
      p_vineyard_id: req.vineyardId,
      p_manual_entry_id: req.manualEntryId,
      p_spray_record_id: req.sprayRecordId,
      p_trip_id: req.tripId,
    } as any);
    if (error) {
      const out = classify(error as any);
      if (out.kind === "uncertain")
        return { kind: "uncertain", message: "The connection dropped — this spray may already be deleted. Retry re-sends the same request." };
      // Deleting something already tombstoned is the intended end state.
      if (out.kind !== "deleted") return out;
    }
    return {
      kind: "saved",
      identities: {
        manualEntryId: req.manualEntryId,
        sprayRecordId: req.sprayRecordId,
        tripId: req.tripId,
        syncVersion: 0,
      },
    };
  } catch (e) {
    return isUncertainManualFailure(e)
      ? { kind: "uncertain", message: "The connection dropped — this spray may already be deleted. Retry re-sends the same request." }
      : { kind: "refused", message: e instanceof Error ? e.message : String(e) };
  }
}
