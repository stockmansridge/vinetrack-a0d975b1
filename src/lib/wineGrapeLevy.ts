// Wine Grapes Levy — preparation worksheet maths and source reconciliation.
//
// Preparatory only. VineTrack never lodges or pays the levy and never writes
// anything here back to yield data. The levy applies to grapes / dried grapes /
// grape juice OWNED when USED IN WINEMAKING during the levy (financial) year —
// harvest figures are only suggestions for the owner to reconcile.

import {
  pickingKey,
  supersedeActualYield,
  aggregatePickingRecords,
  type ActualYieldEntry,
  type PickingRecord,
} from "@/lib/pickingRecordsQuery";
import { extractHistoricalBlockRows, type HistoricalYieldRecord } from "@/lib/yieldReportsQuery";

export const LEVIES_ONLINE_URL = "https://leviesonline.agriculture.gov.au/";
export const DAFF_WINE_GRAPES_LEVY_URL =
  "https://www.agriculture.gov.au/agriculture-land/farm-food-drought/levies/rates/wine-grapes-levy";

/** Fresh-grape-equivalent conversion factors used on the Levies Online return. */
export const DRIED_TO_FRESH_FACTOR = 3;
export const JUICE_LITRES_PER_TONNE = 800;

// ---------------------------------------------------------------------------
// Levy year
// ---------------------------------------------------------------------------

export interface LevyPeriod {
  /** Calendar year in which the levy year ends (30 June). */
  endYear: number;
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  due: string; // 30 September after year end
  label: string; // e.g. 2025-26
}

export function levyPeriod(endYear: number): LevyPeriod {
  return {
    endYear,
    start: `${endYear - 1}-07-01`,
    end: `${endYear}-06-30`,
    due: `${endYear}-09-30`,
    label: `${endYear - 1}-${String(endYear % 100).padStart(2, "0")}`,
  };
}

/**
 * Last COMPLETE levy year as at `now`, using the Australian (Sydney) calendar
 * date. From 1 July the year that just ended is complete.
 */
export function defaultLevyEndYear(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  return m >= 7 ? y : y - 1;
}

/** Date-only comparison on the stored DATE (no timezone shifting). */
export function isWithinLevyPeriod(date: string | null | undefined, p: LevyPeriod): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= p.start && d <= p.end;
}

// ---------------------------------------------------------------------------
// Source reconciliation
// ---------------------------------------------------------------------------

export interface LevyPickLine {
  id: string;
  pickedAt: string;
  blockName: string;
  variety: string | null;
  vintage: number | null;
  tonnes: number;
  sold: boolean;
  soldTo: string | null;
  purpose: string | null;
}

export interface LevyUndatedLine {
  blockName: string;
  variety: string | null;
  vintage: number | null;
  tonnes: number;
}

export interface LevySourceSummary {
  /** Dated picks with picked_at inside the levy year, not marked sold. */
  unsoldPicks: LevyPickLine[];
  /** Dated picks inside the levy year marked sold — excluded by default. */
  soldPicks: LevyPickLine[];
  unsoldTonnes: number;
  soldTonnes: number;
  /** Picks tagged with the matching vintage but dated outside the levy year. */
  vintagePicksOutsidePeriod: number;
  /** Basic (undated) actuals for vintage = levy end year, after precedence. */
  undated: LevyUndatedLine[];
  undatedTonnes: number;
  /** Basic entries dropped because detailed picks supersede them. */
  undatedSuperseded: number;
  hasAnyActual: boolean;
}

const toTonnes = (kg: unknown) => {
  const n = Number(kg);
  return Number.isFinite(n) && n >= 0 ? n / 1000 : null;
};

export function buildLevySources(
  picks: PickingRecord[],
  historical: HistoricalYieldRecord[],
  period: LevyPeriod,
): LevySourceSummary {
  const unsoldPicks: LevyPickLine[] = [];
  const soldPicks: LevyPickLine[] = [];
  let vintagePicksOutsidePeriod = 0;

  for (const r of picks) {
    const t = toTonnes(r.weight_kg);
    if (t == null) continue;
    if (!isWithinLevyPeriod(r.picked_at, period)) {
      if (r.vintage === period.endYear) vintagePicksOutsidePeriod++;
      continue;
    }
    const line: LevyPickLine = {
      id: r.id,
      pickedAt: r.picked_at.slice(0, 10),
      blockName: r.paddock_name ?? "Unknown block",
      variety: r.variety_name?.trim() || null,
      vintage: r.vintage ?? null,
      tonnes: t,
      sold: r.sold === true,
      soldTo: r.sold_to ?? null,
      purpose: r.purpose ?? null,
    };
    (line.sold ? soldPicks : unsoldPicks).push(line);
  }

  // Undated basic actuals: only vintage = levy end year, superseded by ANY
  // detailed pick for the same block/variety/vintage (canonical precedence).
  const detailed = aggregatePickingRecords(picks);
  const basicRows = extractHistoricalBlockRows(historical).filter(
    (r) => r.year === period.endYear && r.yieldTonnes != null && r.yieldTonnes >= 0,
  );
  const basic: ActualYieldEntry[] = basicRows.map((r) => ({
    blockId: r.blockId,
    blockName: r.blockName,
    variety: r.variety,
    vintage: r.year,
    tonnes: r.yieldTonnes,
    source: "basic",
  }));
  const anyDetailedThisVintage = detailed.some((d) => d.vintage === period.endYear);
  const merged = supersedeActualYield(basic, detailed).filter((e) => e.source === "basic");
  // Whole-vineyard rows (no block) cannot be matched by block — drop them when
  // any detailed pick exists for that vintage so fruit is never double counted.
  const kept = merged.filter((e) => e.blockId || !anyDetailedThisVintage);
  const undated: LevyUndatedLine[] = kept.map((e) => ({
    blockName: e.blockName ?? "Unknown block",
    variety: e.variety,
    vintage: e.vintage,
    tonnes: Number(e.tonnes ?? 0),
  }));

  const sum = (xs: { tonnes: number }[]) => xs.reduce((a, b) => a + b.tonnes, 0);
  return {
    unsoldPicks,
    soldPicks,
    unsoldTonnes: sum(unsoldPicks),
    soldTonnes: sum(soldPicks),
    vintagePicksOutsidePeriod,
    undated,
    undatedTonnes: sum(undated),
    undatedSuperseded: basic.length - kept.length,
    hasAnyActual: unsoldPicks.length + soldPicks.length + undated.length > 0,
  };
}

export { pickingKey };

// ---------------------------------------------------------------------------
// Worksheet inputs and conversions
// ---------------------------------------------------------------------------

export interface ParsedNumber {
  value: number | null; // null = blank
  error: string | null;
}

export function parseQuantity(raw: string): ParsedNumber {
  const s = (raw ?? "").trim().replace(/,/g, "");
  if (s === "") return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, error: "Enter a number" };
  if (n < 0) return { value: null, error: "Cannot be negative" };
  return { value: n, error: null };
}

export interface ConcentrateInput {
  id: string;
  litres: string;
  strength: string;
}

export interface WorksheetInputs {
  fresh: string; // 01 tonnes
  dried: string; // 02 tonnes
  juice: string; // 03 litres
  concentrates: ConcentrateInput[]; // 04
}

export interface ConcentrateResult {
  id: string;
  litres: ParsedNumber;
  strength: ParsedNumber;
  equivalentLitres: number;
  strengthError: string | null;
}

export interface WorksheetResult {
  fresh: ParsedNumber;
  dried: ParsedNumber;
  driedFreshEquivalent: number;
  juice: ParsedNumber;
  juiceFreshEquivalent: number;
  concentrates: ConcentrateResult[];
  concentrateEquivalentLitres: number;
  concentrateFreshEquivalent: number;
  totalTonnes: number;
  /** Fields left blank (not entered). */
  blanks: string[];
  hasErrors: boolean;
}

export function computeWorksheet(i: WorksheetInputs): WorksheetResult {
  const fresh = parseQuantity(i.fresh);
  const dried = parseQuantity(i.dried);
  const juice = parseQuantity(i.juice);
  const driedFreshEquivalent = (dried.value ?? 0) * DRIED_TO_FRESH_FACTOR;
  const juiceFreshEquivalent = (juice.value ?? 0) / JUICE_LITRES_PER_TONNE;

  const concentrates: ConcentrateResult[] = i.concentrates.map((c) => {
    const litres = parseQuantity(c.litres);
    const strength = parseQuantity(c.strength);
    let strengthError = strength.error;
    if (!strengthError && (litres.value ?? 0) > 0 && !((strength.value ?? 0) > 0)) {
      strengthError = "Enter a strength greater than 0";
    }
    const equivalentLitres =
      !strengthError && litres.value != null && strength.value != null
        ? litres.value * strength.value
        : 0;
    return { id: c.id, litres, strength, equivalentLitres, strengthError };
  });
  const concentrateEquivalentLitres = concentrates.reduce((a, c) => a + c.equivalentLitres, 0);
  const concentrateFreshEquivalent = concentrateEquivalentLitres / JUICE_LITRES_PER_TONNE;

  const blanks: string[] = [];
  if (fresh.value == null) blanks.push("01");
  if (dried.value == null) blanks.push("02");
  if (juice.value == null) blanks.push("03");
  if (!concentrates.some((c) => c.litres.value != null)) blanks.push("04");

  const hasErrors =
    !!fresh.error ||
    !!dried.error ||
    !!juice.error ||
    concentrates.some((c) => !!c.litres.error || !!c.strengthError);

  return {
    fresh,
    dried,
    driedFreshEquivalent,
    juice,
    juiceFreshEquivalent,
    concentrates,
    concentrateEquivalentLitres,
    concentrateFreshEquivalent,
    totalTonnes:
      (fresh.value ?? 0) + driedFreshEquivalent + juiceFreshEquivalent + concentrateFreshEquivalent,
    blanks,
    hasErrors,
  };
}

export const fmt3 = (n: number) =>
  n.toLocaleString("en-AU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
export const fmtMoney = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

// ---------------------------------------------------------------------------
// Indicative levy payable (verified rate schedule only)
// ---------------------------------------------------------------------------

/**
 * DAFF published wine grapes levy schedule (verified against the DAFF wine
 * grapes levy rates page, Oct 2026) — applied ONLY to levy years listed in
 * VERIFIED_RATE_YEARS. GST is not applied.
 */
const TIERS: { upTo: number; base: number; rate: number; over: number }[] = [
  { upTo: 10, base: 200, rate: 5.0, over: 0 },
  { upTo: 3000, base: 180, rate: 9.2, over: 0 },
  { upTo: 6000, base: 27780, rate: 8.8, over: 3000 },
  { upTo: 9000, base: 54180, rate: 7.0, over: 6000 },
  { upTo: 12000, base: 75180, rate: 6.3, over: 9000 },
  { upTo: 20000, base: 94080, rate: 5.6, over: 12000 },
  { upTo: 40000, base: 138880, rate: 5.5, over: 20000 },
  { upTo: Infinity, base: 248880, rate: 5.4, over: 40000 },
];

export const VERIFIED_RATE_YEARS = new Set<number>([2026]); // 2025-26

/** Returns indicative levy in AUD, or null when the year's rates are unverified. */
export function indicativeLevy(totalTonnes: number, endYear: number): number | null {
  if (!VERIFIED_RATE_YEARS.has(endYear)) return null;
  if (!Number.isFinite(totalTonnes) || totalTonnes < 0) return null;
  if (totalTonnes === 0) return 0;
  const tier = TIERS.find((t) => totalTonnes <= t.upTo)!;
  return tier.base + tier.rate * (totalTonnes - tier.over);
}

export const INSTALMENT_THRESHOLD_TONNES = 100;

// ---------------------------------------------------------------------------
// Copy / CSV
// ---------------------------------------------------------------------------

export function copyAllText(p: LevyPeriod, r: WorksheetResult, levy: number | null): string {
  const v = (x: number | null) => (x == null ? "" : fmt3(x));
  const lines = [
    `Wine Grape Levy Return — Preparation Worksheet (${p.label}, ${p.start} to ${p.end})`,
    `01 Fresh grapes used (tonnes): ${v(r.fresh.value ?? 0)}`,
    `02 Dried grapes used (tonnes): ${v(r.dried.value ?? 0)} → fresh grape equivalent ${fmt3(r.driedFreshEquivalent)} t`,
    `03 Single strength grape juice used (litres): ${v(r.juice.value ?? 0)} → fresh grape equivalent ${fmt3(r.juiceFreshEquivalent)} t`,
    ...r.concentrates
      .filter((c) => c.litres.value != null)
      .map(
        (c, idx) =>
          `04 Concentrated grape juice row ${idx + 1}: ${v(c.litres.value)} L × strength ${c.strength.value ?? ""} = ${fmt3(c.equivalentLitres)} L single strength equivalent`,
      ),
    `04 Concentrated grape juice fresh grape equivalent (tonnes): ${fmt3(r.concentrateFreshEquivalent)}`,
    `Total tonnage: ${fmt3(r.totalTonnes)}`,
    levy == null ? "Total levy payable: calculate in Levies Online" : `Indicative levy (not an assessment, GST not applied): ${fmtMoney(levy)}`,
  ];
  return lines.join("\n");
}

const csvCell = (s: string | number | null | undefined) => {
  const t = s == null ? "" : String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function worksheetCsv(
  p: LevyPeriod,
  r: WorksheetResult,
  levy: number | null,
  note: string,
  suggestion: number,
): string {
  const rows: (string | number | null)[][] = [
    ["Wine Grape Levy Return — Preparation Worksheet (not a lodged return)"],
    ["Levy year", p.label],
    ["Period start", p.start],
    ["Period end", p.end],
    ["Due date", p.due],
    ["VineTrack actuals suggestion (unverified, tonnes)", fmt3(suggestion)],
    [],
    ["Field", "Entered", "Unit", "Conversion", "Fresh grape equivalent (t)"],
    ["01 Fresh grapes used", r.fresh.value ?? "", "tonnes", "×1", fmt3(r.fresh.value ?? 0)],
    ["02 Dried grapes used", r.dried.value ?? "", "tonnes", "×3", fmt3(r.driedFreshEquivalent)],
    ["03 Single strength grape juice used", r.juice.value ?? "", "litres", "÷800", fmt3(r.juiceFreshEquivalent)],
    ...r.concentrates
      .filter((c) => c.litres.value != null)
      .map((c, i) => [
        `04 Concentrated grape juice row ${i + 1}`,
        c.litres.value,
        "litres",
        `×${c.strength.value ?? ""} = ${fmt3(c.equivalentLitres)} L`,
        "",
      ]),
    ["04 Concentrated grape juice total", fmt3(r.concentrateEquivalentLitres), "litres SSE", "÷800", fmt3(r.concentrateFreshEquivalent)],
    ["Total tonnage", "", "", "", fmt3(r.totalTonnes)],
    ["Indicative levy payable", levy == null ? "Calculate in Levies Online" : levy.toFixed(2), "AUD", "GST not applied", ""],
    [],
    ["Reconciliation note", note],
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
