// Display conversion and labelling for canonical Spray Report v1 quantities.
//
// The backend freezes chemical amounts in BASE units: millilitres for liquids
// and grams for solids. `unit` is the chemical's declared display unit. This
// module converts base → display exactly once, formats readably, and produces
// canonical totals. It never re-derives, re-matches or repairs payload facts.
import type {
  SprayReportPayloadV1,
  SprayReportTank,
  SprayReportTankChemical,
} from "./sprayReportV1";

export const NOT_RECORDED = "Not recorded";
export const NOT_ADDED = "Not added";

export type QuantityDimension = "volume" | "mass";

/** Base unit for each declared display unit (mL for volume, g for mass). */
export function unitDimension(unit: SprayReportTankChemical["unit"]): QuantityDimension {
  return unit === "Litres" || unit === "mL" ? "volume" : "mass";
}

/** Divisor from base units to the declared display unit. */
export function baseDivisor(unit: SprayReportTankChemical["unit"]): number {
  return unit === "Litres" || unit === "Kg" ? 1000 : 1;
}

/** Short label used in the report tables. */
export function unitLabel(unit: SprayReportTankChemical["unit"]): string {
  switch (unit) {
    case "Litres":
      return "L";
    case "Kg":
      return "kg";
    default:
      return unit;
  }
}

/** Convert a frozen base amount to its display unit. Null stays null. */
export function toDisplayAmount(
  base: number | null | undefined,
  unit: SprayReportTankChemical["unit"],
): number | null {
  if (base == null || !isFinite(base)) return null;
  return base / baseDivisor(unit);
}

/**
 * Readable number: thousands separators, up to 3 decimals, trailing zeros
 * trimmed. 35714.28 mL → "35.714", 1500000 mL → "1,500".
 */
export function formatAmountNumber(value: number, maxDecimals = 3): string {
  const rounded = Number(value.toFixed(maxDecimals));
  return rounded.toLocaleString("en-AU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

/** Planned quantity in display units; missing planned data is honest. */
export function formatPlanned(c: SprayReportTankChemical): string {
  const v = toDisplayAmount(c.plannedAmountBase, c.unit);
  if (v == null) return NOT_RECORDED;
  return `${formatAmountNumber(v)} ${unitLabel(c.unit)}`;
}

/** Actual quantity: null = unrecorded, confirmed 0 = "Not added". */
export function formatActual(c: SprayReportTankChemical): string {
  if (c.actualAmountBase == null) return NOT_RECORDED;
  if (c.actualAmountBase === 0) return NOT_ADDED;
  const v = toDisplayAmount(c.actualAmountBase, c.unit);
  return v == null ? NOT_RECORDED : `${formatAmountNumber(v)} ${unitLabel(c.unit)}`;
}

export function formatWaterLitres(litres: number | null | undefined): string {
  if (litres == null || !isFinite(litres)) return NOT_RECORDED;
  if (litres === 0) return NOT_ADDED;
  return `${formatAmountNumber(litres, 1)} L`;
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Canonical identity for totalling: the saved chemical when the backend
 * matched one, otherwise the normalised name. Amounts are only combined when
 * their units share a dimension (volume with volume, mass with mass).
 */
export function chemicalTotalKey(c: SprayReportTankChemical): string {
  const identity = c.savedChemicalId ?? `name:${normaliseName(c.name)}`;
  return `${identity}|${unitDimension(c.unit)}`;
}

export interface ChemicalTotal {
  key: string;
  name: string;
  unit: SprayReportTankChemical["unit"];
  plannedBase: number | null;
  actualBase: number | null;
  /** True when at least one contributing tank had no recorded actual. */
  actualIncomplete: boolean;
}

/**
 * Sum planned and actual amounts per canonical chemical across all tanks.
 * Displayed in the largest declared unit seen for that chemical, so a mix of
 * "mL" and "Litres" rows still totals correctly.
 */
export function chemicalTotals(tanks: SprayReportTank[]): ChemicalTotal[] {
  const map = new Map<string, ChemicalTotal>();
  for (const tank of tanks) {
    for (const c of tank.chemicals) {
      const key = chemicalTotalKey(c);
      const existing = map.get(key);
      const entry: ChemicalTotal = existing ?? {
        key,
        name: c.name,
        unit: c.unit,
        plannedBase: null,
        actualBase: null,
        actualIncomplete: false,
      };
      // Prefer the larger display unit (Litres over mL, Kg over g).
      if (baseDivisor(c.unit) > baseDivisor(entry.unit)) entry.unit = c.unit;
      if (c.plannedAmountBase != null && isFinite(c.plannedAmountBase)) {
        entry.plannedBase = (entry.plannedBase ?? 0) + c.plannedAmountBase;
      }
      if (c.actualAmountBase != null && isFinite(c.actualAmountBase)) {
        entry.actualBase = (entry.actualBase ?? 0) + c.actualAmountBase;
      } else {
        entry.actualIncomplete = true;
      }
      map.set(key, entry);
    }
  }
  return [...map.values()];
}

export function formatTotalPlanned(t: ChemicalTotal): string {
  const v = toDisplayAmount(t.plannedBase, t.unit);
  return v == null ? NOT_RECORDED : `${formatAmountNumber(v)} ${unitLabel(t.unit)}`;
}

export function formatTotalActual(t: ChemicalTotal): string {
  if (t.actualBase == null) return NOT_RECORDED;
  const v = toDisplayAmount(t.actualBase, t.unit)!;
  const shown = v === 0 ? NOT_ADDED : `${formatAmountNumber(v)} ${unitLabel(t.unit)}`;
  return t.actualIncomplete ? `${shown} (partial)` : shown;
}

/** Total water across tanks: planned always, actual only when all recorded. */
export function waterTotals(tanks: SprayReportTank[]): {
  planned: number | null;
  actual: number | null;
  actualIncomplete: boolean;
} {
  let planned: number | null = null;
  let actual: number | null = null;
  let actualIncomplete = false;
  for (const t of tanks) {
    if (t.plannedWaterLitres != null && isFinite(t.plannedWaterLitres)) {
      planned = (planned ?? 0) + t.plannedWaterLitres;
    }
    if (t.actualWaterLitres != null && isFinite(t.actualWaterLitres)) {
      actual = (actual ?? 0) + t.actualWaterLitres;
    } else {
      actualIncomplete = true;
    }
  }
  return { planned, actual, actualIncomplete };
}

// ---------------------------------------------------------------- labels ---

function humanise(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Plain-English label for the payload's chemical match provenance. */
export function matchSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "plannedChemicalId":
      return "Matched to the planned spray line";
    case "savedChemicalId":
      return "Matched to a saved chemical";
    case "nameUnit":
    case "normalisedName":
      return "Matched by name and unit";
    case "ambiguous":
      return "Ambiguous — left unrecorded";
    case "unmatched":
    case null:
    case undefined:
      return NOT_RECORDED;
    default:
      return humanise(source);
  }
}

/** Plain-English label for the payload's row attribution source. */
export function rowSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "completedPaths":
      return "Recorded as completed";
    case "incompletePlannedPath":
      return "Planned, not completed";
    case "rowApplications":
      return "Planned row application";
    case "sessionBoundary":
      return "Tank session boundary";
    case "skippedPaths":
      return "Marked skipped";
    case null:
    case undefined:
      return NOT_RECORDED;
    default:
      return humanise(source);
  }
}

// ------------------------------------------------------------------ cost ---

export type CostValueKind = "currency" | "hours" | "litres" | "area" | "number";

/** Choose the unit for a cost field from its canonical key, not blindly $. */
export function costValueKind(key: string): CostValueKind {
  const k = key.toLowerCase();
  if (/hours?$|hrs?$/.test(k)) return "hours";
  if (/litres|liters|fuelused|volume/.test(k)) return "litres";
  if (/(area|hectare|ha)$/.test(k)) return "area";
  if (/cost|price|total|rate|amount|charge|spend/.test(k)) return "currency";
  return "number";
}

export function costFieldLabel(key: string): string {
  return humanise(key)
    .replace(/ per ha$/i, " per hectare")
    .replace(/\bha\b/i, "hectare");
}

/** True when the payload exposes any chemical rate/basis detail. */
export function hasRateDetail(payload: SprayReportPayloadV1): boolean {
  return payload.tanks.some((t) =>
    t.chemicals.some((c) => (c as any).ratePerUnit != null || (c as any).rateBasis != null),
  );
}
