// Spray chemical FINANCIAL cost — pure resolver (no queries).
//
//   chemical cost = quantity used × SQL 264 seasonal weighted purchase price
//
// Precedence per usage line:
//   A. `season_weighted_purchase_average` with a matching physical dimension
//      → SQL 264 price per base unit (mL / g).
//   B. `season_purchase_cost_unavailable` ONLY → a genuine historical spray
//      line snapshot (`costPerUnit` > 0) labelled `legacy_stored_spray_snapshot`.
//   C. `currency_conflict` / `physical_dimension_conflict` /
//      `invalid_purchase_data` → incomplete; NEVER a fallback.
//
// Never used: saved_chemicals.purchase, price_per_pack, Saved Chemical editor
// pricing, or a chemical-name match. Identity is `savedChemicalId` only.
//
// Quantities: completed trips use Tank Actuals when they are complete
// (planned-as-used, substitutions and additions each priced as themselves);
// otherwise the planned quantities, marked estimated/planned.
import type { SprayReportPayloadV1 } from "@/lib/sprayReportV1";
import type { TripCostAllocation } from "@/lib/tripCostAllocationsQuery";
import type { SeasonPriceMap, SeasonPricingBasis } from "@/lib/chemicalSeasonPricing";
import { normaliseTanks } from "@/lib/sprayRecordChemistry";
import { warningsToList } from "@/lib/unifiedCostDataset";

export type ChemicalPricingBasis = SeasonPricingBasis | "legacy_stored_spray_snapshot";
export type ChemicalQuantityBasis = "actual" | "estimated_planned";
export type QuantityDimension = "volume" | "mass";
export type UsageKind = "planned" | "substitution" | "additional";
export type ChemicalCostStatus = "complete" | "partial" | "unavailable" | "no_chemicals";

export const PARTIAL_CHEMICAL_WARNING =
  "Some chemicals have no usable season purchase cost or Saved Chemical identity.";
export const MIXED_CURRENCY_WARNING =
  "Chemical purchase costs are in more than one currency and cannot be added together.";
export const UNAVAILABLE_LABEL = "Unavailable / incomplete";

/* ------------------------------------------------------------ units */

/**
 * Financial quantity conversion ONLY (never dosage/rate maths).
 * Returns the dimension and the factor from the token's unit to the base unit
 * (mL for volume, g for mass). Rate suffixes ("L/ha") are stripped.
 */
export function unitToBase(unit: string | null | undefined): { dimension: QuantityDimension; factor: number } | null {
  if (!unit) return null;
  const u = String(unit).split("/")[0].trim().toLowerCase().replace(/\s+/g, "");
  if (["l", "litre", "litres", "liter", "liters", "lt", "ltr"].includes(u)) return { dimension: "volume", factor: 1000 };
  if (["ml", "millilitre", "millilitres", "milliliter", "milliliters"].includes(u)) return { dimension: "volume", factor: 1 };
  if (["kg", "kgs", "kilogram", "kilograms"].includes(u)) return { dimension: "mass", factor: 1000 };
  if (["g", "gram", "grams", "gm"].includes(u)) return { dimension: "mass", factor: 1 };
  return null;
}

export function baseUnitDimension(baseUnit: string | null | undefined): QuantityDimension | null {
  const u = String(baseUnit ?? "").trim().toLowerCase();
  if (u === "ml") return "volume";
  if (u === "g") return "mass";
  return null;
}

/** Normalise a quantity to base units. `isBase` = already in mL/g. */
export function toBaseQuantity(
  amount: number | null | undefined,
  unit: string | null | undefined,
  isBase = false,
): { dimension: QuantityDimension; base: number; factor: number } | null {
  const u = unitToBase(unit);
  if (!u || amount == null || !Number.isFinite(amount) || amount < 0) return null;
  return { dimension: u.dimension, base: isBase ? amount : amount * u.factor, factor: u.factor };
}

/* ------------------------------------------------------- usage lines */

export interface ChemicalUsageLine {
  savedChemicalId: string | null;
  name?: string | null;
  amount: number | null;
  unit: string | null;
  /** True when `amount` is already in base units (mL / g). */
  amountIsBase: boolean;
  usageKind: UsageKind;
  /** Genuine historical spray-line snapshot per DISPLAY unit, > 0 only. */
  legacyCostPerUnit: number | null;
}

export interface ResolvedChemicalLine extends ChemicalUsageLine {
  pricingBasis: ChemicalPricingBasis | null;
  cost: number | null;
  currency: string | null;
  incompleteReason: string | null;
}

export interface ChemicalCostResult {
  /** Defensible amount (partial allowed). Null when nothing resolved or currencies mix. */
  cost: number | null;
  currency: string | null;
  status: ChemicalCostStatus;
  quantityBasis: ChemicalQuantityBasis | null;
  pricingBases: ChemicalPricingBasis[];
  lineCount: number;
  resolvedLines: number;
  incompleteLines: number;
  mixedCurrency: boolean;
  warnings: string[];
  lines: ResolvedChemicalLine[];
}

/** A snapshot is only a genuine legacy price when it is a positive number. */
export function legacySnapshotValue(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function priceUsageLine(
  line: ChemicalUsageLine,
  prices: SeasonPriceMap | null,
): ResolvedChemicalLine {
  const out = (p: Partial<ResolvedChemicalLine>): ResolvedChemicalLine => ({
    ...line,
    pricingBasis: null,
    cost: null,
    currency: null,
    incompleteReason: null,
    ...p,
  });
  if (!line.savedChemicalId) return out({ incompleteReason: "No Saved Chemical identity" });
  const q = toBaseQuantity(line.amount, line.unit, line.amountIsBase);
  if (!q) return out({ incompleteReason: "Quantity or unit not usable" });
  if (!prices) return out({ incompleteReason: "Season purchase prices not loaded" });

  const row = prices.get(line.savedChemicalId);
  const basis: SeasonPricingBasis = row?.pricing_basis ?? "season_purchase_cost_unavailable";

  if (basis === "season_weighted_purchase_average") {
    const price = row?.weighted_cost_per_base_unit;
    const dim = baseUnitDimension(row?.base_unit);
    if (price == null || !Number.isFinite(price) || price < 0) {
      return out({ pricingBasis: "invalid_purchase_data", incompleteReason: "Invalid season price" });
    }
    if (dim !== q.dimension) {
      return out({ pricingBasis: "physical_dimension_conflict", incompleteReason: "Purchase unit does not match spray unit" });
    }
    return out({ pricingBasis: basis, cost: q.base * price, currency: row?.currency ?? null });
  }

  if (basis === "season_purchase_cost_unavailable") {
    const legacy = legacySnapshotValue(line.legacyCostPerUnit);
    if (legacy != null) {
      // Snapshot is per the line's display unit.
      const display = q.base / q.factor;
      return out({ pricingBasis: "legacy_stored_spray_snapshot", cost: display * legacy });
    }
    return out({ pricingBasis: basis, incompleteReason: "No season purchase cost" });
  }

  // Explicit conflicts: never fall back.
  return out({ pricingBasis: basis, incompleteReason: row?.warning ?? basis });
}

export function resolveChemicalCost(
  lines: ChemicalUsageLine[],
  prices: SeasonPriceMap | null,
  quantityBasis: ChemicalQuantityBasis | null,
): ChemicalCostResult {
  const resolved = lines.map((l) => priceUsageLine(l, prices));
  const ok = resolved.filter((l) => l.cost != null);
  const incomplete = resolved.length - ok.length;
  const currencies = new Set(ok.map((l) => l.currency).filter((c): c is string => !!c));
  const mixedCurrency = currencies.size > 1;
  const warnings: string[] = [];
  const bases = Array.from(
    new Set(resolved.map((l) => l.pricingBasis).filter((b): b is ChemicalPricingBasis => !!b)),
  );

  if (resolved.length === 0) {
    return {
      cost: null, currency: null, status: "no_chemicals", quantityBasis,
      pricingBases: [], lineCount: 0, resolvedLines: 0, incompleteLines: 0,
      mixedCurrency: false, warnings, lines: resolved,
    };
  }
  let cost: number | null = ok.length ? ok.reduce((s, l) => s + (l.cost ?? 0), 0) : null;
  let status: ChemicalCostStatus =
    ok.length === 0 ? "unavailable" : incomplete > 0 ? "partial" : "complete";
  if (mixedCurrency) {
    cost = null;
    status = "unavailable";
    warnings.push(MIXED_CURRENCY_WARNING);
  }
  if (incomplete > 0) warnings.push(PARTIAL_CHEMICAL_WARNING);
  if (bases.includes("legacy_stored_spray_snapshot")) {
    warnings.push("Some chemical costs use the price stored on the historical spray record (legacy_stored_spray_snapshot).");
  }
  if (quantityBasis === "estimated_planned") {
    warnings.push("Chemical quantities are estimated from the plan (Tank Actuals incomplete).");
  }
  return {
    cost,
    currency: mixedCurrency ? null : (Array.from(currencies)[0] ?? null),
    status,
    quantityBasis,
    pricingBases: bases,
    lineCount: resolved.length,
    resolvedLines: ok.length,
    incompleteLines: incomplete,
    mixedCurrency,
    warnings,
    lines: resolved,
  };
}

/* ------------------------------------------------------ Tank Actuals */

export interface PlannedTankLine {
  plannedChemicalId: string | null;
  savedChemicalId: string | null;
  name: string | null;
  unit: string | null;
  amount: number | null;
  amountIsBase: boolean;
  legacyCostPerUnit: number | null;
}
export interface PlannedTank { tankNumber: number; lines: PlannedTankLine[] }

export interface ActualTankLine {
  plannedChemicalId: string | null;
  savedChemicalId: string | null;
  replacesPlannedChemicalId: string | null;
  usageKind: UsageKind;
  name: string | null;
  unit: string | null;
  /** Base units (mL / g). Null = not recorded. */
  actualAmountBase: number | null;
}
export interface ActualTank { tankNumber: number; recorded: boolean; lines: ActualTankLine[] }

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const numv = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Tank Actuals are complete when every planned tank has a recorded actual and
 * every planned product in it has a recorded actual quantity (a typed zero
 * counts) or was replaced by a substitution. A plan-less (manual) record is
 * complete when at least one tank actual is recorded.
 */
export function tankActualsComplete(planned: PlannedTank[], actual: ActualTank[]): boolean {
  const recorded = actual.filter((t) => t.recorded);
  if (recorded.length === 0) return false;
  if (planned.length === 0) return true;
  for (const pt of planned) {
    const at = recorded.find((t) => t.tankNumber === pt.tankNumber);
    if (!at) return false;
    for (const pl of pt.lines) {
      const covered = at.lines.some((al) => {
        if (pl.plannedChemicalId) {
          return (
            (al.plannedChemicalId === pl.plannedChemicalId && al.actualAmountBase != null) ||
            al.replacesPlannedChemicalId === pl.plannedChemicalId
          );
        }
        // No planned id: only an exact Saved Chemical identity can cover it.
        return (
          !!pl.savedChemicalId &&
          al.usageKind === "planned" &&
          al.savedChemicalId === pl.savedChemicalId &&
          al.actualAmountBase != null
        );
      });
      if (!covered) return false;
    }
  }
  return true;
}

/** Pick actual vs planned quantities. Actuals are never clamped to the plan. */
export function selectChemicalUsage(
  planned: PlannedTank[],
  actual: ActualTank[],
): { quantityBasis: ChemicalQuantityBasis; lines: ChemicalUsageLine[] } {
  if (tankActualsComplete(planned, actual)) {
    const lines: ChemicalUsageLine[] = [];
    for (const at of actual) {
      if (!at.recorded) continue;
      const pt = planned.find((p) => p.tankNumber === at.tankNumber);
      for (const al of at.lines) {
        if (al.actualAmountBase == null) continue;
        // Legacy snapshot only for the SAME planned product (never inherited
        // by a substitute or an additional product).
        const pl =
          al.usageKind === "planned" && pt
            ? pt.lines.find(
                (l) =>
                  (al.plannedChemicalId && l.plannedChemicalId === al.plannedChemicalId) ||
                  (!l.plannedChemicalId && l.savedChemicalId && l.savedChemicalId === al.savedChemicalId),
              )
            : undefined;
        lines.push({
          savedChemicalId: al.savedChemicalId,
          name: al.name,
          amount: al.actualAmountBase,
          unit: al.unit,
          amountIsBase: true,
          usageKind: al.usageKind,
          legacyCostPerUnit:
            pl && pl.savedChemicalId && pl.savedChemicalId === al.savedChemicalId
              ? pl.legacyCostPerUnit
              : null,
        });
      }
    }
    return { quantityBasis: "actual", lines };
  }
  return {
    quantityBasis: "estimated_planned",
    lines: planned.flatMap((pt) =>
      pt.lines.map((l) => ({
        savedChemicalId: l.savedChemicalId,
        name: l.name,
        amount: l.amount,
        unit: l.unit,
        amountIsBase: l.amountIsBase,
        usageKind: "planned" as const,
        legacyCostPerUnit: l.legacyCostPerUnit,
      })),
    ),
  };
}

/* ------------------------------------------------------------ adapters */

function plannedLineFromRaw(line: any): PlannedTankLine {
  const baseAmt = numv(line?.amountBase ?? line?.amount_base ?? line?.plannedAmountBase ?? line?.planned_amount_base);
  const amt = numv(line?.amount ?? line?.totalAmount ?? line?.total_amount ?? line?.quantity ?? line?.qty);
  const unit = str(
    line?.amountUnit ?? line?.amount_unit ?? line?.totalAmountUnit ?? line?.total_amount_unit ??
      line?.quantityUnit ?? line?.quantity_unit ?? line?.unit,
  );
  return {
    plannedChemicalId: str(line?.plannedChemicalId ?? line?.planned_chemical_id ?? line?.id),
    savedChemicalId: str(line?.savedChemicalId ?? line?.saved_chemical_id ?? line?.chemical_id),
    name: str(line?.name ?? line?.chemical_name),
    unit,
    amount: baseAmt ?? amt,
    amountIsBase: baseAmt != null,
    legacyCostPerUnit: legacySnapshotValue(line?.costPerUnit ?? line?.cost_per_unit),
  };
}

/** Planned tanks from `spray_records.tanks` (any of the stored envelopes). */
export function plannedTanksFromSprayRecord(tanks: unknown): PlannedTank[] {
  const arr = normaliseTanks(tanks as any) as any[];
  const out: PlannedTank[] = [];
  const loose: PlannedTankLine[] = [];
  arr.forEach((item, i) => {
    if (!item) return;
    const inner = item.chemicals ?? item.chemicalLines ?? item.chemical_lines;
    if (Array.isArray(inner)) {
      out.push({
        tankNumber: numv(item.tankNumber ?? item.tank_number ?? item.number) ?? i + 1,
        lines: inner.map(plannedLineFromRaw),
      });
    } else if (item.savedChemicalId != null || item.saved_chemical_id != null || item.chemical_id != null || item.name != null) {
      loose.push(plannedLineFromRaw(item));
    }
  });
  if (loose.length) out.push({ tankNumber: 1, lines: loose });
  return out;
}

function usageKindOf(v: unknown, l: any): UsageKind {
  if (v === "planned" || v === "substitution" || v === "additional") return v;
  if (l?.plannedChemicalId ?? l?.planned_chemical_id) return "planned";
  if (l?.replacesPlannedChemicalId ?? l?.replaces_planned_chemical_id) return "substitution";
  return "additional";
}

function actualLineFromRaw(l: any): ActualTankLine {
  return {
    plannedChemicalId: str(l?.plannedChemicalId ?? l?.planned_chemical_id),
    savedChemicalId: str(l?.savedChemicalId ?? l?.saved_chemical_id),
    replacesPlannedChemicalId: str(l?.replacesPlannedChemicalId ?? l?.replaces_planned_chemical_id),
    usageKind: usageKindOf(l?.usageKind ?? l?.usage_kind, l),
    name: str(l?.name),
    unit: str(l?.unit),
    actualAmountBase: numv(l?.actualAmountBase ?? l?.actual_amount_base),
  };
}

/** Actual tanks from `spray_tank_actuals` rows (read-only). */
export function actualTanksFromRows(rows: ReadonlyArray<any>): ActualTank[] {
  return (rows ?? [])
    .filter((r) => r && !r.deleted_at)
    .map((r) => {
      const raw = r.chemicals ?? r.actual_chemicals ?? r.chemical_lines ?? [];
      const list = Array.isArray(raw) ? raw : [];
      return {
        tankNumber: numv(r.tank_number ?? r.tankNumber) ?? 0,
        recorded: true,
        lines: list.map(actualLineFromRaw),
      };
    });
}

/** Planned + actual tanks from the canonical Spray Report payload. */
export function tanksFromSprayReportPayload(
  payload: Pick<SprayReportPayloadV1, "tanks">,
  legacyByPlannedId: Map<string, number> = new Map(),
): { planned: PlannedTank[]; actual: ActualTank[] } {
  const planned: PlannedTank[] = [];
  const actual: ActualTank[] = [];
  for (const t of payload.tanks ?? []) {
    const plannedLines = t.chemicals.filter(
      (c) => (c.usageKind ?? (c.plannedChemicalId ? "planned" : "additional")) === "planned" && c.plannedAmountBase != null,
    );
    if (plannedLines.length || t.plannedWaterLitres != null) {
      planned.push({
        tankNumber: t.tankNumber,
        lines: plannedLines.map((c) => ({
          plannedChemicalId: c.plannedChemicalId ?? null,
          savedChemicalId: c.savedChemicalId ?? null,
          name: c.name,
          unit: c.unit,
          amount: c.plannedAmountBase,
          amountIsBase: true,
          legacyCostPerUnit: c.plannedChemicalId ? legacyByPlannedId.get(c.plannedChemicalId) ?? null : null,
        })),
      });
    }
    const recorded = (t.actualVersion ?? 0) > 0 || !!t.actualId;
    actual.push({
      tankNumber: t.tankNumber,
      recorded,
      lines: t.chemicals.map((c) => ({
        plannedChemicalId: c.plannedChemicalId ?? null,
        savedChemicalId: c.savedChemicalId ?? null,
        replacesPlannedChemicalId: c.replacesPlannedChemicalId ?? null,
        usageKind: c.usageKind ?? (c.plannedChemicalId ? "planned" : c.replacesPlannedChemicalId ? "substitution" : "additional"),
        name: c.name,
        unit: c.unit,
        actualAmountBase: c.actualAmountBase,
      })),
    });
  }
  return { planned, actual };
}

/* --------------------------------------------------------- trip level */

export interface TripChemicalInputs {
  /** Spray records linked to this trip. */
  sprayRecords: ReadonlyArray<{ id?: string; trip_id?: string | null; tanks?: unknown }>;
  /** spray_tank_actuals rows for this trip (any records). */
  tankActualRows?: ReadonlyArray<any>;
  prices: SeasonPriceMap | null;
}

/** Resolve one trip's chemical cost ONCE (all its spray records). */
export function resolveTripChemicalCost(inp: TripChemicalInputs): ChemicalCostResult {
  const allLines: ChemicalUsageLine[] = [];
  let anyPlanned = false;
  let anyActual = false;
  const recCount = inp.sprayRecords.length;
  for (const rec of inp.sprayRecords) {
    const planned = plannedTanksFromSprayRecord(rec.tanks);
    const rows = (inp.tankActualRows ?? []).filter((r) => {
      const sid = r?.spray_record_id ?? r?.sprayRecordId;
      return recCount <= 1 || !sid || sid === rec.id;
    });
    const sel = selectChemicalUsage(planned, actualTanksFromRows(rows));
    if (sel.lines.length) {
      if (sel.quantityBasis === "actual") anyActual = true;
      else anyPlanned = true;
    }
    allLines.push(...sel.lines);
  }
  const basis: ChemicalQuantityBasis | null = anyPlanned ? "estimated_planned" : anyActual ? "actual" : null;
  return resolveChemicalCost(allLines, inp.prices, basis);
}

/* ------------------------------------------- Cost Report overlay */

export interface ChemicalOverlayMeta {
  stored_chemical_cost: number;
  stored_total_cost: number;
  resolved_trip_chemical_cost: number | null;
  share: number;
  status: ChemicalCostStatus;
  quantity_basis: ChemicalQuantityBasis | null;
  pricing_bases: ChemicalPricingBasis[];
  currency: string | null;
}

export type OverlaidAllocation = TripCostAllocation & { chemical_overlay?: ChemicalOverlayMeta };

const n0 = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Reporting-only overlay: replace each allocation's stored chemical cost with
 * its area share of the trip's resolved chemical cost. Returns NEW objects —
 * the stored rows are never mutated or written back. Labour, fuel and input
 * stay exactly as stored.
 */
export function overlayAllocationsWithChemicalCost(
  allocations: ReadonlyArray<TripCostAllocation>,
  tripChemical: ReadonlyMap<string, ChemicalCostResult>,
): OverlaidAllocation[] {
  const byTrip = new Map<string, TripCostAllocation[]>();
  for (const a of allocations) {
    if (!a.trip_id) continue;
    const list = byTrip.get(a.trip_id) ?? [];
    list.push(a);
    byTrip.set(a.trip_id, list);
  }
  const shareOf = new Map<string, number>();
  for (const [, list] of byTrip) {
    const areas = list.map((a) => n0(a.allocation_area_ha));
    const totalArea = areas.reduce((s, x) => s + (x > 0 ? x : 0), 0);
    list.forEach((a, i) => {
      shareOf.set(a.id, totalArea > 0 ? (areas[i] > 0 ? areas[i] / totalArea : 0) : 1 / list.length);
    });
  }
  return allocations.map((a) => {
    const res = a.trip_id ? tripChemical.get(a.trip_id) : undefined;
    if (!res || res.status === "no_chemicals") return { ...a };
    const share = shareOf.get(a.id) ?? 0;
    const oldChem = n0(a.chemical_cost);
    const oldTotal = n0(a.total_cost);
    const newChem = (res.cost ?? 0) * share;
    const total = oldTotal - oldChem + newChem;
    const area = n0(a.allocation_area_ha);
    const yt = n0(a.yield_tonnes);
    const warnings = warningsToList(a.warnings);
    for (const w of res.warnings) if (!warnings.includes(w)) warnings.push(w);
    if (res.status === "unavailable" && !warnings.includes(UNAVAILABLE_LABEL)) {
      warnings.push(`Chemical cost ${UNAVAILABLE_LABEL.toLowerCase()}.`);
    }
    return {
      ...a,
      chemical_cost: newChem,
      total_cost: total,
      cost_per_ha: area > 0 ? total / area : null,
      cost_per_tonne: yt > 0 ? total / yt : null,
      warnings,
      costing_status:
        res.status === "complete" ? a.costing_status ?? null : res.status === "partial" ? "partial" : "incomplete",
      chemical_overlay: {
        stored_chemical_cost: oldChem,
        stored_total_cost: oldTotal,
        resolved_trip_chemical_cost: res.cost,
        share,
        status: res.status,
        quantity_basis: res.quantityBasis,
        pricing_bases: res.pricingBases,
        currency: res.currency,
      },
    };
  });
}

/* ------------------------------------------- Spray Report cost overlay */

export function quantityBasisLabel(b: ChemicalQuantityBasis | null): string {
  return b === "actual" ? "Actual" : b === "estimated_planned" ? "Estimated / planned" : "—";
}

export function chemicalStatusLabel(s: ChemicalCostStatus): string {
  switch (s) {
    case "complete": return "Complete";
    case "partial": return "Partial / incomplete";
    case "unavailable": return UNAVAILABLE_LABEL;
    default: return "No chemicals";
  }
}

const TOTAL_KEY = /^(total|total_?cost|total_?estimated_?cost|estimated_?total(_?cost)?)$/i;
const CHEM_KEY = /chem/i;
const PER_HA_KEY = /per_?ha$|per_?hectare$/i;
const AREA_KEY = /(treated_?area|area_?ha|hectares)$/i;

/**
 * Display-only copy of the canonical payload cost with the seasonal chemical
 * cost applied. The canonical payload itself is never mutated.
 */
export function overlaySprayReportCost(
  cost: Record<string, unknown>,
  res: ChemicalCostResult,
): Record<string, unknown> {
  if (res.status === "no_chemicals") return { ...cost };
  const out: Record<string, unknown> = { ...cost };
  const keys = Object.keys(cost);
  const chemKey = keys.find((k) => CHEM_KEY.test(k) && /cost|total|amount/i.test(k)) ?? "chemicalCost";
  const totalKey = keys.find((k) => TOTAL_KEY.test(k));
  const oldChem = n0(cost[chemKey]);
  const usable = res.cost != null && res.status !== "unavailable";
  out[chemKey] = usable ? res.cost : UNAVAILABLE_LABEL;
  let newTotal: number | null = null;
  if (totalKey) {
    const oldTotal = typeof cost[totalKey] === "number" ? (cost[totalKey] as number) : null;
    newTotal = usable && oldTotal != null ? oldTotal - oldChem + (res.cost ?? 0) : null;
    out[totalKey] = newTotal ?? UNAVAILABLE_LABEL;
  }
  const perHaKey = keys.find((k) => PER_HA_KEY.test(k));
  if (perHaKey) {
    const areaKey = keys.find((k) => AREA_KEY.test(k));
    const area = areaKey && typeof cost[areaKey] === "number" ? (cost[areaKey] as number) : null;
    out[perHaKey] = newTotal != null && area && area > 0 ? newTotal / area : UNAVAILABLE_LABEL;
  }
  out.chemicalCostStatus = chemicalStatusLabel(res.status);
  out.chemicalQuantityBasis = quantityBasisLabel(res.quantityBasis);
  out.chemicalPricingBasis = res.pricingBases.join(", ") || "—";
  return out;
}
