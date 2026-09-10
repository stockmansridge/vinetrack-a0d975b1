// Manual spray entry — draft model.
//
// A manual spray records COMPLETED work. It needs no calculator, canopy,
// calibration, GPS route or row plan. Quantities are exactly what the operator
// entered; nothing here recalculates them from a spray recommendation.
//
// Exactly one tractor, one operator and one spray unit per application.
import type { PhysicalForm } from "@/lib/chemicalPhysicalForm";
import {
  toBaseAmount,
  unitDimension,
  type BaseUnit,
  type UnitDimension,
  type WireUnit,
} from "@/lib/manualSpray/units";

/** Deployed contract value of `spray_records.entry_source` for a manual entry. */
export const MANUAL_SPRAY_SOURCE = "manual" as const;

/** One chemical actually put in one tank. */
export interface ManualChemicalLine {
  /** Stable client identity, allocated once and reused on retry. */
  id: string;
  /** Chemical Store product id when chosen from the store; null for free text. */
  savedChemicalId: string | null;
  productName: string;
  /** Product category (e.g. fungicide) — distinct from physical form. */
  category: string | null;
  physicalForm: PhysicalForm;
  /** Entered amount in `unit`; null means not entered (never treated as 0). */
  amount: number | null;
  unit: WireUnit | null;
  /** Frozen facts captured when the product was chosen, with an honest time. */
  snapshot?: Record<string, unknown> | null;
  snapshotAt?: string | null;
}

export interface ManualTank {
  /** Stable client identity, allocated once and reused on retry. */
  id: string;
  /** Stable tank-actual row identity, allocated once and reused on retry. */
  actualId: string;
  /** Sequential display number, recomputed from position. */
  displayNumber: number;
  /** Water actually used in this tank, in litres. Null means not entered. */
  waterLitres: number | null;
  chemicals: ManualChemicalLine[];
}

export interface ManualWeather {
  provenance: "manual" | "station";
  stationId?: string | null;
  observedAt?: string | null;
  /** Recorded source text, preserved exactly as saved. */
  source?: string | null;
  temperature?: number | null;
  humidity?: number | null;
  windSpeed?: number | null;
  /** Recorded gust, in km/h. Preserved through load/edit/save. */
  windGust?: number | null;
  windDirection?: string | null;
  /** Recorded rainfall, in mm. Preserved through load/edit/save. */
  rain?: number | null;
  /** Retrieval status text shown to the user; never fabricated. */
  retrievalStatus?: string | null;
}


export interface ManualSprayDraft {
  /** Stable application identity, allocated once for the draft. */
  id: string;
  /** Canonical manual identity shared by the record and its backing trip. */
  manualEntryId: string;
  sprayRecordId: string;
  tripId: string;
  /** Optimistic-concurrency version: 0 (or null) for a brand new entry. */
  syncVersion: number | null;
  /** IANA zone the entered local times belong to. */
  vineyardTimeZone: string | null;
  vineyardId: string;
  name: string;
  /**
   * Saved operation type. A new manual entry records "manual_spray"; an edit
   * preserves whatever the saved application already carries.
   */
  operationType: string | null;

  /** ISO instants in the vineyard timezone; end may cross midnight. */
  startAt: string | null;
  endAt: string | null;
  tractorId: string | null;
  operatorUserId: string | null;
  sprayEquipmentId: string | null;
  startEngineHours: number | null;
  endEngineHours: number | null;
  blockIds: string[];
  /** Recorded block names by id, preserved alongside the ids. */
  blockNames?: Record<string, string>;
  tanks: ManualTank[];
  weather: ManualWeather[];
  notes: string;
}

let seq = 0;
const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `manual-${Date.now()}-${seq++}`;

export function newChemicalLine(over: Partial<ManualChemicalLine> = {}): ManualChemicalLine {
  return {
    id: newId(),
    savedChemicalId: null,
    productName: "",
    category: null,
    physicalForm: "unknown",
    amount: null,
    unit: null,
    snapshot: null,
    snapshotAt: null,
    ...over,
  };
}

export function newTank(displayNumber: number): ManualTank {
  return { id: newId(), actualId: newId(), displayNumber, waterLitres: null, chemicals: [] };
}

/** Renumber tanks so display numbers stay 1..n after add/remove. */
export function renumberTanks(tanks: ManualTank[]): ManualTank[] {
  return tanks.map((t, i) => ({ ...t, displayNumber: i + 1 }));
}

export function addTank(tanks: ManualTank[]): ManualTank[] {
  return renumberTanks([...tanks, newTank(tanks.length + 1)]);
}

export function removeTank(tanks: ManualTank[], tankId: string): ManualTank[] {
  return renumberTanks(tanks.filter((t) => t.id !== tankId));
}

/**
 * "Copy previous tank": same quantities, BRAND NEW identities. A copied tank is
 * an independent tank, never a second reference to the same one.
 */
export function copyPreviousTank(tanks: ManualTank[]): ManualTank[] {
  const prev = tanks[tanks.length - 1];
  if (!prev) return addTank(tanks);
  const copy: ManualTank = {
    id: newId(),
    actualId: newId(),
    displayNumber: tanks.length + 1,
    waterLitres: prev.waterLitres,
    chemicals: prev.chemicals.map((c) => ({ ...c, id: newId() })),
  };
  return renumberTanks([...tanks, copy]);
}

export function emptyManualSprayDraft(
  vineyardId: string,
  vineyardTimeZone: string | null = null,
): ManualSprayDraft {
  return {
    id: newId(),
    // Allocated ONCE. Every retry of the same save reuses these identities, so
    // a repeated request can never create a second application.
    manualEntryId: newId(),
    sprayRecordId: newId(),
    tripId: newId(),
    syncVersion: 0,
    vineyardTimeZone,
    vineyardId,
    name: "",
    startAt: null,
    endAt: null,
    tractorId: null,
    operatorUserId: null,
    sprayEquipmentId: null,
    startEngineHours: null,
    endEngineHours: null,
    blockIds: [],
    tanks: [newTank(1)],
    weather: [],
    notes: "",
  };
}

/* ------------------------------------------------------------- summaries */

export interface ChemicalTotal {
  key: string;
  productName: string;
  dimension: UnitDimension;
  baseUnit: BaseUnit;
  /** Total in the base unit: mL for liquids/volume, g for solids/mass. */
  base: number;
}

/**
 * Combine chemical amounts ONLY across a compatible identity and physical
 * dimension. A litre total and a kilogram total are never added together.
 */
export function chemicalTotals(tanks: readonly ManualTank[]): ChemicalTotal[] {
  const out = new Map<string, ChemicalTotal>();
  for (const tank of tanks) {
    for (const line of tank.chemicals) {
      const b = toBaseAmount(line.amount, line.unit);
      if (!b) continue;
      const identity =
        line.savedChemicalId ?? line.productName.trim().toLowerCase() ?? "";
      if (!identity) continue;
      const key = `${identity}::${b.dimension}`;
      const existing = out.get(key);
      if (existing) existing.base = round6(existing.base + b.base);
      else
        out.set(key, {
          key,
          productName: line.productName.trim() || "Unnamed product",
          dimension: b.dimension,
          baseUnit: b.baseUnit,
          base: b.base,
        });
    }
  }
  return [...out.values()];
}

/** Total water across tanks, in litres. Tanks with no water entered are skipped. */
export function totalWaterLitres(tanks: readonly ManualTank[]): number {
  return round6(
    tanks.reduce((sum, t) => (typeof t.waterLitres === "number" && Number.isFinite(t.waterLitres) ? sum + t.waterLitres : sum), 0),
  );
}

export const tankCount = (tanks: readonly ManualTank[]): number => tanks.length;

/* --------------------------------------------------------- engine hours */

export type EngineHourBasis = "engine_hours" | "work_duration";

export interface EngineHourOutcome {
  basis: EngineHourBasis;
  hours: number | null;
}

/**
 * Established costing rule, unchanged: use the engine-hour difference ONLY
 * when both readings are finite and end is greater than start; otherwise fall
 * back to the recorded work duration.
 */
export function costingHours(args: {
  startEngineHours: number | null;
  endEngineHours: number | null;
  startAt: string | null;
  endAt: string | null;
}): EngineHourOutcome {
  const { startEngineHours: s, endEngineHours: e } = args;
  if (typeof s === "number" && Number.isFinite(s) && typeof e === "number" && Number.isFinite(e) && e > s) {
    return { basis: "engine_hours", hours: round6(e - s) };
  }
  const start = args.startAt ? Date.parse(args.startAt) : NaN;
  const end = args.endAt ? Date.parse(args.endAt) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { basis: "work_duration", hours: round6((end - start) / 3_600_000) };
  }
  return { basis: "work_duration", hours: null };
}

/** Unit dimension a chemical line is being measured in, or null. */
export const lineDimension = (line: ManualChemicalLine): UnitDimension | null =>
  unitDimension(line.unit);

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
