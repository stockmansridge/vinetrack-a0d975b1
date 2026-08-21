// P10 — the single canonical read of a COMPLETED spray record's chemistry.
//
// Everything a report, export or detail view shows about what was actually
// applied must come from the record itself: the `tanks` JSON, the immutable
// `chemicalSnapshot` frozen onto each line at completion, and the geometry
// columns written with the record. The current Saved Chemical / Master
// Chemical is never consulted here — a product re-verified in 2029 must not
// change what the 2026 spray is said to have been.
//
// Where the record froze nothing, this module says so (`snapshot:
// "unavailable"`). It never reconstructs historical truth from live data.
//
// NOT part of the historical snapshot contract: WHP, REI and registered-use
// restrictions. `sprayChemicalSnapshot` does not freeze them, so they are
// deliberately absent from this reader rather than being read out of today's
// Saved Chemical (see P9 — those are label facts of the CURRENT label).
import {
  readChemicalSnapshot,
  type ChemicalLineSnapshot,
} from "@/lib/sprayChemicalSnapshot";
import { qualifiedGroupCode } from "@/lib/resistance/resistanceGroupSource";
import { chemUnitOnly } from "@/lib/rateBasis";

/** How a line's applied rate should be read. */
export type RecordRateBasis = "per_hectare" | "per_100_litres" | "per_100_metres" | "other" | "unknown";

export interface RecordChemicalLine {
  /** Stable-ish identity for keys: line id, else tank/line position. */
  lineId: string;
  tankIndex: number;
  /** Frozen product name; falls back to the line's recorded name. */
  productName: string | null;
  registrationIdentityKey: string | null;
  countryCode: string | null;
  savedChemicalId: string | null;
  activeIngredients: { name: string; concentration?: number; unit?: string }[];
  /** Scheme-qualified: "FRAC 3", "HRAC 9" — never a bare numeral. */
  activityGroups: string[];
  verificationStatus: string | null;
  /** "frozen" when the line carries an immutable snapshot, else "unavailable". */
  snapshot: "frozen" | "unavailable";
  rate: number | null;
  /** Chemical unit only ("L", "mL", "kg", "g"). */
  unit: string | null;
  rateBasis: RecordRateBasis;
  /**
   * False when the recorded rate cannot be read as an applied numeric rate —
   * `basis: "other"` label guidance, or a basis that was never recorded.
   * Exports must render `rateText` instead of a number.
   */
  rateIsApplied: boolean;
  /** Human text for the rate, safe for every basis. */
  rateText: string;
  costPerUnit: number | null;
  notes: string | null;
}

export interface RecordTank {
  tankIndex: number;
  tankNumber: number | null;
  waterLitres: number | null;
  chemicals: RecordChemicalLine[];
}

export interface RecordApplicationFigures {
  litresPerHectare: number | null;
  appliedLitresPer100m: number | null;
  diluteLitresPer100m: number | null;
  concentrationFactor: number | null;
  grossAreaHa: number | null;
  treatedAreaHa: number | null;
  applicationMode: string | null;
  carrierVolumeBasis: string | null;
  /** True when nothing about the applied geometry was recorded. */
  unavailable: boolean;
}

export interface RecordChemistry {
  tanks: RecordTank[];
  lines: RecordChemicalLine[];
  figures: RecordApplicationFigures;
  /** True when no line carries an immutable snapshot. */
  historicalChemistryUnavailable: boolean;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};

/**
 * `tanks` has three historical shapes: an array of tanks, an envelope
 * `{ tanks: [...] }`, or a single tank object. A JSON string is also tolerated.
 */
export function normaliseTanks(tanks: unknown): any[] {
  if (!tanks) return [];
  if (typeof tanks === "string") {
    try {
      return normaliseTanks(JSON.parse(tanks));
    } catch {
      return [];
    }
  }
  if (Array.isArray(tanks)) return tanks;
  if (typeof tanks === "object") {
    const inner = (tanks as any).tanks;
    if (Array.isArray(inner)) return inner;
    return [tanks];
  }
  return [];
}

export function tankChemicalLines(tank: any): any[] {
  if (!tank || typeof tank !== "object") return [];
  for (const key of ["chemicals", "chemical_lines", "chemicalLines", "lines"]) {
    const v = (tank as any)[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function readBasis(line: any, unit: string | null): RecordRateBasis {
  const raw = String(
    line?.product_rate_basis ?? line?.rate_basis ?? line?.rateBasis ?? "",
  )
    .trim()
    .toLowerCase();
  if (raw === "per_100_litres" || raw === "per_100l") return "per_100_litres";
  if (raw === "per_100_metres" || raw === "per_100m") return "per_100_metres";
  if (raw === "per_hectare" || raw === "per_ha" || raw === "whole_block_area" || raw === "treated_area")
    return "per_hectare";
  // `basis: "other"` is label guidance, never an applied rate.
  if (raw === "other") return "other";
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  const composed = String(line?.unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (composed.includes("/100l")) return "per_100_litres";
  if (composed.includes("/100m")) return "per_100_metres";
  if (composed.includes("/ha") || u.endsWith("ha")) return "per_hectare";
  return "unknown";
}

const BASIS_SUFFIX: Record<RecordRateBasis, string> = {
  per_hectare: "/ha",
  per_100_litres: "/100 L",
  per_100_metres: "/100 m",
  other: "",
  unknown: "",
};

/** One completed chemical line, read from the record alone. */
export function readRecordChemicalLine(
  raw: any,
  ctx: { recordId?: string | null; tankIndex: number; lineIndex: number },
): RecordChemicalLine {
  const snap: ChemicalLineSnapshot | null = readChemicalSnapshot(raw?.chemicalSnapshot);
  const activeCodes = (snap?.active_ingredients ?? [])
    .map((a) => qualifiedGroupCode(a.activity_group?.scheme, a.activity_group?.code))
    .filter((c): c is string => !!c);
  const groups: string[] = [];
  for (const code of activeCodes.length ? activeCodes : snap?.activity_groups ?? []) {
    if (code && !groups.includes(code)) groups.push(code);
  }

  const unit = chemUnitOnly(String(raw?.unit ?? "")) || text(raw?.unit);
  const rate = num(raw?.rate ?? raw?.dose ?? raw?.amount_per_unit);
  const basis = readBasis(raw, unit);
  const rateIsApplied = rate != null && basis !== "other" && basis !== "unknown";
  const rateText = (() => {
    if (rate == null) return "Not recorded";
    const body = `${rate}${unit ? ` ${unit}` : ""}`;
    if (basis === "other") return `${body} (label guidance — not an applied rate)`;
    if (basis === "unknown") return `${body} (rate basis not recorded)`;
    return `${body}${BASIS_SUFFIX[basis]}`;
  })();

  return {
    lineId: String(raw?.id ?? `${ctx.recordId ?? "record"}:${ctx.tankIndex}:${ctx.lineIndex}`),
    tankIndex: ctx.tankIndex,
    productName: snap?.product_name ?? text(raw?.name ?? raw?.chemical_name ?? raw?.product),
    registrationIdentityKey: snap?.registration_identity_key ?? null,
    countryCode: snap?.country_code ?? null,
    savedChemicalId:
      snap?.saved_chemical_id ??
      text(raw?.savedChemicalId ?? raw?.saved_chemical_id ?? raw?.chemical_id),
    activeIngredients: (snap?.active_ingredients ?? []).map((a) => ({
      name: a.name,
      ...(a.concentration != null ? { concentration: a.concentration } : {}),
      ...(a.concentration_unit ? { unit: a.concentration_unit } : {}),
    })),
    activityGroups: groups,
    verificationStatus: snap?.verification_status ?? null,
    snapshot: snap ? "frozen" : "unavailable",
    rate,
    unit,
    rateBasis: basis,
    rateIsApplied,
    rateText,
    costPerUnit: num(raw?.costPerUnit ?? raw?.cost_per_unit),
    notes: text(raw?.notes),
  };
}

/** Applied geometry, read from the record's own columns. Never recalculated. */
export function readRecordFigures(record: Record<string, any>): RecordApplicationFigures {
  const f: RecordApplicationFigures = {
    litresPerHectare: num(record?.spray_rate_per_ha ?? record?.litres_per_hectare),
    appliedLitresPer100m: num(record?.applied_litres_per_100m),
    diluteLitresPer100m: num(record?.dilute_litres_per_100m),
    concentrationFactor: num(record?.concentration_factor),
    grossAreaHa: num(record?.gross_area_ha),
    treatedAreaHa: num(record?.treated_area_ha),
    applicationMode: text(record?.application_mode),
    carrierVolumeBasis: text(record?.carrier_volume_basis),
    unavailable: false,
  };
  f.unavailable =
    f.litresPerHectare == null &&
    f.appliedLitresPer100m == null &&
    f.grossAreaHa == null &&
    f.treatedAreaHa == null;
  return f;
}

/** Full frozen chemistry of a completed spray record. */
export function readRecordChemistry(record: Record<string, any>): RecordChemistry {
  const tanks: RecordTank[] = normaliseTanks(record?.tanks).map((t, tankIndex) => ({
    tankIndex,
    tankNumber: num(t?.tank_number ?? t?.tankNumber),
    waterLitres: num(t?.water_volume ?? t?.waterVolume ?? t?.water_litres),
    chemicals: tankChemicalLines(t).map((line, lineIndex) =>
      readRecordChemicalLine(line, { recordId: record?.id, tankIndex, lineIndex }),
    ),
  }));
  const lines = tanks.flatMap((t) => t.chemicals);
  return {
    tanks,
    lines,
    figures: readRecordFigures(record),
    historicalChemistryUnavailable:
      lines.length === 0 || lines.every((l) => l.snapshot === "unavailable"),
  };
}

/** Scheme-qualified groups across the whole record, de-duplicated. */
export function recordGroupCodes(chem: RecordChemistry): string[] {
  const out: string[] = [];
  for (const l of chem.lines) for (const g of l.activityGroups) if (!out.includes(g)) out.push(g);
  return out;
}
