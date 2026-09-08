// Recorded ACTUAL usage for a spray trip: water and chemical quantities that
// were really put in each tank, plus the audit trail of who corrected what.
//
// The planned application stays frozen: nothing here rewrites a planned line,
// renames a planned product, or prefills a missing actual with the plan. A
// blank actual means "Not recorded"; a typed zero means "Not added".
//
// Writes go ONLY through the shared, audited RPC `correct_spray_tank_actual_v1`
// (SQL 227). The portal never touches `spray_tank_actuals` or its amendment
// table directly, and never updates worksheet state before the RPC succeeded
// and the canonical report was refreshed.
import { supabase } from "@/integrations/ios-supabase/client";
import type {
  SprayChemicalUnit,
  SprayReportActualAmendment,
  SprayReportPayloadV1,
  SprayReportTank,
  SprayReportTankChemical,
  SprayUsageKind,
} from "@/lib/sprayReportV1";
import { toDisplayAmount, unitLabel } from "@/lib/sprayReportQuantities";
import { generateUuid } from "@/lib/uuid";

export const SPRAY_ACTUALS_VERSION_CONFLICT =
  "This spray was changed by someone else while you were editing. Reload the trip and re-enter your changes.";
export const SPRAY_ACTUALS_SAVE_FAILED =
  "Your changes have not been saved. Please try again.";

/* ------------------------------------------------------------------ */
/* Amendment history                                                    */
/* ------------------------------------------------------------------ */

export interface SprayAmendment {
  /** Server timestamp of the correction (ISO). */
  changedAtUtc: string;
  /** Stable id of the authenticated editor. */
  editorId: string | null;
  /** Display-name snapshot taken at the time of the change. */
  editorName: string | null;
  tankNumber: number | null;
  /** Product the change applies to; null for water. */
  chemicalName: string | null;
  field: string;
  previousValue: number | null;
  previousUnit: SprayChemicalUnit | "L" | null;
  newValue: number | null;
  newUnit: SprayChemicalUnit | "L" | null;
  kind?: string;
  /** Identity used to attach the entry to a worksheet line. */
  chemicalActualId?: string | null;
  plannedChemicalId?: string | null;
  savedChemicalId?: string | null;
  revision?: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** Amount carried by a server amendment value (scalar, or `{ actualAmountBase }`). */
function amendmentAmount(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return (
      num(v.actualAmountBase) ??
      num(v.waterVolumeL) ??
      num(v.water_volume_l) ??
      num(v.value) ??
      null
    );
  }
  if (typeof value === "string" && field) {
    const n = Number(value);
    return isFinite(n) ? n : null;
  }
  return null;
}

function amendmentUnit(unit: unknown, value: unknown, field: string): SprayAmendment["newUnit"] {
  const fromValue =
    value && typeof value === "object" ? (value as Record<string, unknown>).unit : null;
  const raw = (typeof unit === "string" && unit) || (typeof fromValue === "string" && fromValue);
  if (raw === "Litres" || raw === "mL" || raw === "Kg" || raw === "g" || raw === "L") return raw;
  return field.toLowerCase().includes("water") ? "L" : null;
}

function chemicalNameFor(
  payload: SprayReportPayloadV1,
  a: Record<string, unknown>,
): string | null {
  const field = String(a.field ?? "");
  if (field.toLowerCase().includes("water")) return null;
  const ids = [a.chemicalActualId, a.plannedChemicalId, a.savedChemicalId].filter(
    (x) => typeof x === "string" && x,
  ) as string[];
  for (const tank of payload.tanks) {
    for (const c of tank.chemicals) {
      if (
        ids.includes(c.actualChemicalId ?? "") ||
        ids.includes(c.plannedChemicalId ?? "") ||
        ids.includes(c.savedChemicalId ?? "")
      ) {
        return c.name;
      }
    }
  }
  const nested = a.newValue && typeof a.newValue === "object"
    ? (a.newValue as Record<string, unknown>).name
    : null;
  return typeof nested === "string" ? nested : null;
}

/**
 * Amendments carried by the canonical report payload (schema 1.1
 * `amendments[]`). Read defensively — an older payload simply has no history.
 */
export function payloadAmendments(payload: SprayReportPayloadV1): SprayAmendment[] {
  const raw = (payload as unknown as { amendments?: unknown }).amendments;
  if (!Array.isArray(raw)) return [];
  const out: SprayAmendment[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown> & Partial<SprayReportActualAmendment>;
    const changedAtUtc =
      (typeof a.editedAt === "string" && a.editedAt) ||
      (typeof (a as any).changedAtUtc === "string" ? ((a as any).changedAtUtc as string) : null);
    if (!changedAtUtc) continue;
    const field = typeof a.field === "string" ? a.field : "Actual quantity";
    out.push({
      changedAtUtc,
      editorId: typeof a.editedBy === "string" ? a.editedBy : null,
      editorName: typeof a.editorName === "string" ? a.editorName : null,
      tankNumber: num(a.tankNumber),
      chemicalName: chemicalNameFor(payload, a),
      field,
      previousValue: amendmentAmount(a.previousValue, field),
      previousUnit: amendmentUnit(a.previousUnit, a.previousValue, field),
      newValue: amendmentAmount(a.newValue, field),
      newUnit: amendmentUnit(a.newUnit, a.newValue, field),
      kind: typeof a.changeKind === "string" ? a.changeKind : undefined,
      chemicalActualId: (a.chemicalActualId as string) ?? null,
      plannedChemicalId: (a.plannedChemicalId as string) ?? null,
      savedChemicalId: (a.savedChemicalId as string) ?? null,
      revision: num(a.revision) ?? undefined,
    });
  }
  return out.sort((x, y) => x.changedAtUtc.localeCompare(y.changedAtUtc));
}

export function formatAmendmentTime(iso: string, tz: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  try {
    const date = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `${date} at ${time}`;
  } catch {
    return d.toISOString();
  }
}

export function amendmentValueLabel(
  value: number | null,
  unit: SprayAmendment["newUnit"],
): string {
  if (value == null) return "Not recorded";
  if (unit === "L" || unit == null) {
    return value === 0 ? "Not added (0 L)" : `${value} L`;
  }
  const display = toDisplayAmount(value, unit as SprayChemicalUnit);
  if (display == null) return "Not recorded";
  const label = unitLabel(unit as SprayChemicalUnit);
  return display === 0 ? `Not added (0 ${label})` : `${display} ${label}`;
}

/** "Actual updated by Jonathan Hambrook on 9 September 2026 at 10:15 (Australia/Sydney)". */
export function formatAmendmentMarker(a: SprayAmendment, tz: string): string {
  const who = a.editorName || "an authorised user";
  const verb = a.kind === "initial" || a.kind === "created" ? "recorded" : "updated";
  return `Actual ${verb} by ${who} on ${formatAmendmentTime(a.changedAtUtc, tz)} (${tz})`;
}

export function amendmentsForChemical(
  all: SprayAmendment[],
  tankNumber: number,
  chemicalName: string | null,
): SprayAmendment[] {
  return all.filter(
    (a) =>
      a.tankNumber === tankNumber &&
      (chemicalName == null ? a.chemicalName == null : a.chemicalName === chemicalName),
  );
}

/* ------------------------------------------------------------------ */
/* Draft entry and validation                                           */
/* ------------------------------------------------------------------ */

export type ParsedAmount =
  | { kind: "blank" }
  | { kind: "value"; base: number }
  | { kind: "invalid"; message: string };

const UNIT_TO_BASE: Record<SprayChemicalUnit, number> = {
  Litres: 1000,
  mL: 1,
  Kg: 1000,
  g: 1,
};

export function unitDimension(unit: SprayChemicalUnit): "volume" | "mass" {
  return unit === "Litres" || unit === "mL" ? "volume" : "mass";
}

/**
 * Parse a typed actual chemical amount into the frozen base unit (mL or g).
 * Blank stays blank — it is never replaced by the planned amount.
 */
export function parseActualAmount(text: string, unit: SprayChemicalUnit): ParsedAmount {
  const t = text.trim();
  if (!t) return { kind: "blank" };
  const n = Number(t);
  if (!isFinite(n)) return { kind: "invalid", message: "Enter a number." };
  if (n < 0) return { kind: "invalid", message: "Amount can't be negative." };
  return { kind: "value", base: n * UNIT_TO_BASE[unit] };
}

/** Parse a typed actual water amount in litres. */
export function parseActualWater(text: string): ParsedAmount {
  const t = text.trim();
  if (!t) return { kind: "blank" };
  const n = Number(t);
  if (!isFinite(n)) return { kind: "invalid", message: "Enter a number." };
  if (n < 0) return { kind: "invalid", message: "Water can't be negative." };
  return { kind: "value", base: n };
}

/** Input text for an existing actual: blank when nothing was recorded. */
export function actualInputValue(c: SprayReportTankChemical): string {
  const display = toDisplayAmount(c.actualAmountBase, c.unit);
  return display == null ? "" : String(display);
}

export function waterInputValue(t: SprayReportTank): string {
  return t.actualWaterLitres == null ? "" : String(t.actualWaterLitres);
}

export function tankChemicalKey(tankNumber: number, c: SprayReportTankChemical, i: number) {
  return `${tankNumber}::${c.plannedChemicalId ?? c.actualChemicalId ?? c.savedChemicalId ?? `${c.name}-${i}`}`;
}

export interface ActualsDraft {
  /** Keyed by tank number. */
  water: Record<number, string>;
  /** Keyed by `tankChemicalKey`. */
  chemicals: Record<string, string>;
}

export function draftFromPayload(payload: SprayReportPayloadV1): ActualsDraft {
  const water: Record<number, string> = {};
  const chemicals: Record<string, string> = {};
  for (const t of payload.tanks) {
    water[t.tankNumber] = waterInputValue(t);
    t.chemicals.forEach((c, i) => {
      chemicals[tankChemicalKey(t.tankNumber, c, i)] = actualInputValue(c);
    });
  }
  return { water, chemicals };
}

export interface ActualChange {
  tankNumber: number;
  /** null identifies the tank's water. */
  chemical: { plannedChemicalId: string | null; savedChemicalId: string | null; name: string } | null;
  unit: SprayChemicalUnit | "L";
  previousBase: number | null;
  newBase: number | null;
  kind: "initial" | "correction" | "cleared";
}

export interface DraftDiff {
  changes: ActualChange[];
  errors: string[];
}

/**
 * Compare a draft with the canonical payload. No-ops produce no change, so a
 * repeated Save never writes an empty correction.
 */
export function diffActualsDraft(
  payload: SprayReportPayloadV1,
  draft: ActualsDraft,
): DraftDiff {
  const changes: ActualChange[] = [];
  const errors: string[] = [];

  for (const t of payload.tanks) {
    const waterText = draft.water[t.tankNumber] ?? "";
    const parsedWater = parseActualWater(waterText);
    if (parsedWater.kind === "invalid") {
      errors.push(`Tank ${t.tankNumber} water: ${parsedWater.message}`);
    } else {
      const next = parsedWater.kind === "blank" ? null : parsedWater.base;
      const prev = t.actualWaterLitres ?? null;
      if (next !== prev) {
        changes.push({
          tankNumber: t.tankNumber,
          chemical: null,
          unit: "L",
          previousBase: prev,
          newBase: next,
          kind: next == null ? "cleared" : prev == null ? "initial" : "correction",
        });
      }
    }

    t.chemicals.forEach((c, i) => {
      const key = tankChemicalKey(t.tankNumber, c, i);
      const text = draft.chemicals[key] ?? "";
      const parsed = parseActualAmount(text, c.unit);
      if (parsed.kind === "invalid") {
        errors.push(`Tank ${t.tankNumber} ${c.name}: ${parsed.message}`);
        return;
      }
      const next = parsed.kind === "blank" ? null : parsed.base;
      const prev = c.actualAmountBase ?? null;
      if (next === prev) return;
      changes.push({
        tankNumber: t.tankNumber,
        chemical: {
          plannedChemicalId: c.plannedChemicalId ?? null,
          savedChemicalId: c.savedChemicalId ?? null,
          name: c.name,
        },
        unit: c.unit,
        previousBase: prev,
        newBase: next,
        kind: next == null ? "cleared" : prev == null ? "initial" : "correction",
      });
    });
  }

  return { changes, errors };
}

/**
 * A recorded actual above the planned amount is a genuine observation, not an
 * error: surface it as a note, never clamp it.
 */
export function overPlanNotes(payload: SprayReportPayloadV1, draft: ActualsDraft): string[] {
  const notes: string[] = [];
  for (const t of payload.tanks) {
    t.chemicals.forEach((c, i) => {
      const parsed = parseActualAmount(draft.chemicals[tankChemicalKey(t.tankNumber, c, i)] ?? "", c.unit);
      if (parsed.kind !== "value" || c.plannedAmountBase == null) return;
      if (parsed.base > c.plannedAmountBase) {
        notes.push(`Tank ${t.tankNumber}: ${c.name} actual is above the planned amount.`);
      }
    });
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/* Save path — `correct_spray_tank_actual_v1` (SQL 227)                 */
/* ------------------------------------------------------------------ */

export interface ActualChemicalSnapshotLine {
  id: string;
  plannedChemicalId: string | null;
  savedChemicalId: string | null;
  replacesPlannedChemicalId: string | null;
  usageKind: SprayUsageKind;
  name: string;
  actualAmountBase: number;
  unit: SprayChemicalUnit;
}

export interface TankActualSnapshot {
  tankNumber: number;
  actualId: string;
  expectedVersion: number;
  tankSessionId: string | null;
  waterVolumeL: number | null;
  chemicals: ActualChemicalSnapshotLine[];
}

function sessionIdForTank(payload: SprayReportPayloadV1, tankNumber: number): string | null {
  const s = (payload.tankSessions ?? []).find((x) => x.tankNumber === tankNumber);
  return s?.tankSessionId ?? null;
}

/**
 * Complete saved snapshot per edited tank. A blank quantity omits the line
 * (clearing that observation); a typed zero keeps the line at 0.
 */
export function tankSnapshotsForDraft(
  payload: SprayReportPayloadV1,
  draft: ActualsDraft,
): TankActualSnapshot[] {
  const diff = diffActualsDraft(payload, draft);
  const touched = new Set(diff.changes.map((c) => c.tankNumber));
  const out: TankActualSnapshot[] = [];

  for (const t of payload.tanks) {
    if (!touched.has(t.tankNumber)) continue;
    const waterParsed = parseActualWater(draft.water[t.tankNumber] ?? "");
    const chemicals: ActualChemicalSnapshotLine[] = [];
    t.chemicals.forEach((c, i) => {
      const parsed = parseActualAmount(draft.chemicals[tankChemicalKey(t.tankNumber, c, i)] ?? "", c.unit);
      if (parsed.kind !== "value") return; // blank removes the actual line
      chemicals.push({
        id: c.actualChemicalId ?? generateUuid(),
        plannedChemicalId: c.plannedChemicalId ?? null,
        savedChemicalId: c.savedChemicalId ?? null,
        replacesPlannedChemicalId: c.replacesPlannedChemicalId ?? null,
        usageKind:
          c.usageKind ??
          (c.plannedChemicalId
            ? "planned"
            : c.replacesPlannedChemicalId
              ? "substitution"
              : "additional"),
        name: c.name,
        actualAmountBase: parsed.base,
        unit: c.unit,
      });
    });
    out.push({
      tankNumber: t.tankNumber,
      actualId: t.actualId ?? generateUuid(),
      expectedVersion: t.actualVersion ?? 0,
      tankSessionId: sessionIdForTank(payload, t.tankNumber),
      waterVolumeL: waterParsed.kind === "value" ? waterParsed.base : null,
      chemicals,
    });
  }
  return out;
}

export class SprayActualsConflictError extends Error {
  constructor() {
    super(SPRAY_ACTUALS_VERSION_CONFLICT);
    this.name = "SprayActualsConflictError";
  }
}

function isConflict(error: any): boolean {
  return (
    error?.code === "40001" ||
    /40001|serialization|version conflict/i.test(String(error?.message ?? ""))
  );
}

export interface SaveActualsRequest {
  payload: SprayReportPayloadV1;
  draft: ActualsDraft;
  /** One UUID per Save attempt per tank; reuse only when retrying that save. */
  operationIds?: Record<number, string>;
}

/**
 * Save every edited tank through the audited RPC. Each tank is a separate
 * operation with its own operation UUID; a version conflict aborts the save so
 * the user reloads rather than overwriting someone else's correction.
 */
export async function saveSprayActuals(req: SaveActualsRequest): Promise<void> {
  const { payload, draft } = req;
  const snapshots = tankSnapshotsForDraft(payload, draft);
  if (!snapshots.length) return;

  for (const snap of snapshots) {
    const operationId = req.operationIds?.[snap.tankNumber] ?? generateUuid();
    const { error } = await (supabase as any).rpc("correct_spray_tank_actual_v1", {
      p_operation_id: operationId,
      p_actual_id: snap.actualId,
      p_trip_id: payload.identity.tripId,
      p_spray_record_id: payload.identity.sprayRecordId,
      p_tank_session_id: snap.tankSessionId,
      p_tank_number: snap.tankNumber,
      p_expected_version: snap.expectedVersion,
      p_water_volume_l: snap.waterVolumeL,
      p_chemicals: snap.chemicals,
    });
    if (error) {
      if (isConflict(error)) throw new SprayActualsConflictError();
      throw new Error(error.message || SPRAY_ACTUALS_SAVE_FAILED);
    }
  }
}

/** Actual corrections are available through the shared audited contract. */
export function sprayActualsSaveAvailable(): boolean {
  return true;
}
