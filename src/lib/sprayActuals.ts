// Recorded ACTUAL usage for a spray trip: water and chemical quantities that
// were really put in each tank, plus the audit trail of who corrected what.
//
// The planned application stays frozen: nothing here rewrites a planned line,
// renames a planned product, or prefills a missing actual with the plan. A
// blank actual means "Not recorded"; a typed zero means "Not added".
//
// The write itself belongs to Rork's shared save path (the existing
// `spray_tank_actuals` / actual-chemical contract, committed atomically with
// its audit history). Until that path is published the portal refuses to save
// actuals rather than writing to some other table behind the contract's back.
import type {
  SprayChemicalUnit,
  SprayReportPayloadV1,
  SprayReportTank,
  SprayReportTankChemical,
} from "@/lib/sprayReportV1";
import { toDisplayAmount, unitLabel } from "@/lib/sprayReportQuantities";

export const SPRAY_ACTUALS_SAVE_UNAVAILABLE =
  "Recorded actual water and chemical quantities can't be saved yet: the shared save path for spray_tank_actuals (with its atomic audit history) hasn't been deployed. Your entries are kept on screen until then.";

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
  kind?: "initial" | "correction" | "substitution" | "addition" | "cleared";
}

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * Amendments carried by the canonical report payload. Read defensively: the
 * exact field names come from Rork's contract, and an older payload simply has
 * no history yet.
 */
export function payloadAmendments(payload: SprayReportPayloadV1): SprayAmendment[] {
  const raw = (payload as unknown as { amendments?: unknown }).amendments;
  if (!Array.isArray(raw)) return [];
  const out: SprayAmendment[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    const changedAtUtc = typeof a.changedAtUtc === "string" ? a.changedAtUtc : null;
    if (!changedAtUtc) continue;
    out.push({
      changedAtUtc,
      editorId: typeof a.editorId === "string" ? a.editorId : null,
      editorName: typeof a.editorName === "string" ? a.editorName : null,
      tankNumber: num(a.tankNumber),
      chemicalName: typeof a.chemicalName === "string" ? a.chemicalName : null,
      field: typeof a.field === "string" ? a.field : "Actual quantity",
      previousValue: num(a.previousValue),
      previousUnit: (a.previousUnit as SprayAmendment["previousUnit"]) ?? null,
      newValue: num(a.newValue),
      newUnit: (a.newUnit as SprayAmendment["newUnit"]) ?? null,
      kind: (a.kind as SprayAmendment["kind"]) ?? undefined,
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
  const verb = a.kind === "initial" ? "recorded" : "updated";
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
  return `${tankNumber}::${c.plannedChemicalId ?? c.savedChemicalId ?? `${c.name}-${i}`}`;
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
/* Save path (Rork's shared contract)                                   */
/* ------------------------------------------------------------------ */

export interface SaveActualsRequest {
  tripId: string;
  sprayRecordId: string | null;
  vineyardId: string;
  /** Version the draft was based on, for stale-write detection. */
  expectedVersion?: number | null;
  changes: ActualChange[];
}

export type SprayActualsSaver = (req: SaveActualsRequest) => Promise<void>;

let saver: SprayActualsSaver | null = null;

/**
 * Wire the shared save path once Rork publishes it. One call site, so the
 * portal never grows a competing actuals store.
 */
export function configureSprayActualsSaver(fn: SprayActualsSaver | null) {
  saver = fn;
}

export function sprayActualsSaveAvailable(): boolean {
  return saver != null;
}

export async function saveSprayActuals(req: SaveActualsRequest): Promise<void> {
  if (!req.changes.length) return;
  if (!saver) throw new Error(SPRAY_ACTUALS_SAVE_UNAVAILABLE);
  await saver(req);
}
