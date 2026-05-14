// Trip Cost Summary computation — owner/manager only.
//
// Inputs (per trip):
//  - trip: trips row (must include start_time/end_time, optional pause/resume,
//          tractor_id, operator_user_id, operator_category_id)
//  - tractor: matching tractors row (fuel_usage_l_per_hour) or null
//  - operatorCategories: full list for the vineyard (id -> cost_per_hour)
//  - members: vineyard_members rows (user_id -> operator_category_id)
//  - fuelPurchases: vineyard_id-scoped fuel_purchases rows (volume_litres,
//                   total_cost) used to derive a weighted cost per litre
//  - sprayRecords: vineyard_id-scoped spray_records rows; we look up by trip_id
//
// Logic mirrors the iOS calculator:
//   labour = active_hours * operator_category.cost_per_hour
//   operator category priority:
//     1) trips.operator_category_id
//     2) vineyard_members.operator_category_id (for trips.operator_user_id)
//   fuel = active_hours * tractor.fuel_usage_l_per_hour * weighted_cost_per_litre
//   weighted_cost_per_litre = sum(total_cost) / sum(volume_litres)
//   chemicals = sum over linked spray_records.tanks[*].costPerUnit * amount
//
// Missing data is collected as warnings instead of throwing.
import type { Trip } from "@/lib/tripsQuery";
import type { OperatorCategory } from "@/lib/operatorCategoriesQuery";
import type { FuelPurchase } from "@/lib/fuelPurchasesQuery";
import type { SprayRecord } from "@/lib/sprayRecordsQuery";
import type { VineyardMemberRow } from "@/lib/teamMembersQuery";
import type { SavedChemical } from "@/lib/savedChemicalsQuery";
import type { SavedInput } from "@/lib/savedInputsQuery";
import type { HistoricalYieldRecord } from "@/lib/yieldReportsQuery";
import { parsePolygonPoints, polygonAreaHectares } from "@/lib/paddockGeometry";

/** Subset of saved_chemicals used for cost fallback resolution. */
export type SavedChemicalLite = Pick<SavedChemical, "id" | "name" | "purchase">;

/** Subset of saved_inputs used for cost fallback resolution. */
export type SavedInputLite = Pick<SavedInput, "id" | "name" | "cost_per_unit">;

/** Pull a cost-per-base-unit out of saved_chemicals.purchase JSON. */
export function savedChemicalCostPerUnit(c: SavedChemicalLite | null | undefined): number | null {
  const p: any = c?.purchase;
  if (!p) return null;
  const candidates = [p.costPerBaseUnit, p.cost_per_base_unit, p.costPerUnit, p.cost_per_unit];
  for (const v of candidates) {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n;
  }
  return null;
}

export interface TractorLite {
  id: string;
  name?: string | null;
  fuel_usage_l_per_hour?: number | null;
}

/** Subset of paddocks used for treated-area resolution. */
export interface PaddockGeoLite {
  id: string;
  name?: string | null;
  polygon_points?: any;
}

export interface TripCostBreakdown {
  activeHours: number | null;
  labour: { hours: number | null; ratePerHour: number | null; cost: number | null; categoryName: string | null };
  fuel: { hours: number | null; litresPerHour: number | null; costPerLitre: number | null; litres: number | null; cost: number | null };
  chemicals: { cost: number | null; lineCount: number; missingCostLines: number };
  inputs: { cost: number | null; lineCount: number; missingCostLines: number };
  total: number | null;
  /** Treated hectares resolved from linked paddock polygons. null when unavailable. */
  treatedAreaHa: number | null;
  /** total / treatedAreaHa. null when either is unavailable. */
  costPerHa: number | null;
  /** Yield tonnes resolved from historical_yield_records.block_results. null when unavailable. */
  yieldTonnes: number | null;
  /** total / yieldTonnes. null when either is unavailable. */
  costPerTonne: number | null;
  /** Human-readable warning when treated area can't be resolved. */
  areaWarning: string | null;
  /** Human-readable warning when yield tonnes can't be resolved. */
  yieldWarning: string | null;
  warnings: string[];
}

function activeMs(trip: Trip): number | null {
  if (!trip.start_time || !trip.end_time) return null;
  const start = new Date(trip.start_time).getTime();
  const end = new Date(trip.end_time).getTime();
  if (!isFinite(start) || !isFinite(end) || end <= start) return null;
  let ms = end - start;
  // Subtract paused intervals if pause/resume timestamps exist (parallel arrays).
  const pauses = (trip.pause_timestamps as any) ?? [];
  const resumes = (trip.resume_timestamps as any) ?? [];
  if (Array.isArray(pauses) && Array.isArray(resumes)) {
    const n = Math.min(pauses.length, resumes.length);
    for (let i = 0; i < n; i++) {
      const p = new Date(pauses[i]).getTime();
      const r = new Date(resumes[i]).getTime();
      if (isFinite(p) && isFinite(r) && r > p) ms -= r - p;
    }
  }
  return Math.max(0, ms);
}

export function weightedFuelCostPerLitre(fuel: FuelPurchase[]): number | null {
  let totalCost = 0;
  let totalLitres = 0;
  for (const f of fuel) {
    if (typeof f.total_cost === "number" && typeof f.volume_litres === "number" && f.volume_litres > 0) {
      totalCost += f.total_cost;
      totalLitres += f.volume_litres;
    }
  }
  return totalLitres > 0 ? totalCost / totalLitres : null;
}

function chemicalCostFromTanks(
  tanks: any,
  savedChemicals: SavedChemicalLite[] = [],
): { cost: number; lines: number; missing: number } {
  if (!tanks) return { cost: 0, lines: 0, missing: 0 };
  // tanks may be an array of tanks, each with `chemicals` / `chemicalLines`,
  // OR a flat array of chemical lines, OR a single tank object.
  const arr = Array.isArray(tanks) ? tanks : [tanks];
  let cost = 0;
  let lines = 0;
  let missing = 0;
  const byId = new Map(savedChemicals.map((c) => [c.id, c] as const));
  const byName = new Map(
    savedChemicals
      .filter((c) => c.name)
      .map((c) => [String(c.name).trim().toLowerCase(), c] as const),
  );
  const resolveCpu = (line: any): number | null => {
    // 1) Snapshot on the line itself (incl. zero treated as genuine 0).
    const raw = line?.costPerUnit ?? line?.cost_per_unit;
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (isFinite(n) && n >= 0) return n;
    }
    // 2) savedChemicalId lookup.
    const sid = line?.savedChemicalId ?? line?.saved_chemical_id ?? line?.chemical_id;
    if (sid) {
      const cpu = savedChemicalCostPerUnit(byId.get(String(sid)));
      if (cpu != null) return cpu;
    }
    // 3) Case-insensitive name match fallback.
    const nm = (line?.name ?? line?.chemical_name ?? "").toString().trim().toLowerCase();
    if (nm) {
      const cpu = savedChemicalCostPerUnit(byName.get(nm));
      if (cpu != null) return cpu;
    }
    return null;
  };
  const visitLine = (line: any) => {
    lines++;
    const cpu = resolveCpu(line);
    const amount = Number(
      line?.amount ?? line?.totalAmount ?? line?.total_amount ?? line?.quantity ?? line?.qty,
    );
    if (cpu != null && isFinite(amount) && amount > 0) {
      cost += cpu * amount;
    } else {
      missing++;
    }
  };
  for (const item of arr) {
    if (!item) continue;
    const innerLines = item.chemicals ?? item.chemicalLines ?? item.chemical_lines;
    if (Array.isArray(innerLines)) {
      innerLines.forEach(visitLine);
    } else if (
      item.costPerUnit != null || item.cost_per_unit != null ||
      item.savedChemicalId != null || item.saved_chemical_id != null ||
      item.chemical_id != null || item.name != null
    ) {
      visitLine(item);
    }
  }
  return { cost, lines, missing };
}

/**
 * Resolve seed/input cost from a trip's seeding_details JSON.
 * Looks for input lines (mix_lines, seeds, inputs, lines, etc.) carrying
 * either an explicit costPerUnit, a savedInputId, or a name we can match
 * against the saved_inputs library.
 */
function inputCostFromSeedingDetails(
  seedingDetails: any,
  savedInputs: SavedInputLite[] = [],
): { cost: number; lines: number; missing: number } {
  if (!seedingDetails) return { cost: 0, lines: 0, missing: 0 };
  const collected: any[] = [];
  const candidateKeys = ["mix_lines", "mixLines", "inputs", "input_lines", "inputLines", "seeds", "seed_lines", "lines", "items"];
  const visit = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== "object") return;
    for (const k of candidateKeys) {
      if (Array.isArray(node[k])) node[k].forEach((l: any) => collected.push(l));
    }
  };
  if (Array.isArray(seedingDetails)) seedingDetails.forEach(visit);
  else visit(seedingDetails);
  if (collected.length === 0) return { cost: 0, lines: 0, missing: 0 };

  const byId = new Map(savedInputs.map((c) => [c.id, c] as const));
  const byName = new Map(
    savedInputs
      .filter((c) => c.name)
      .map((c) => [String(c.name).trim().toLowerCase(), c] as const),
  );
  const resolveCpu = (line: any): number | null => {
    const raw = line?.costPerUnit ?? line?.cost_per_unit;
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (isFinite(n) && n >= 0) return n;
    }
    const sid = line?.savedInputId ?? line?.saved_input_id ?? line?.input_id;
    if (sid) {
      const cpu = byId.get(String(sid))?.cost_per_unit;
      if (cpu != null && isFinite(Number(cpu))) return Number(cpu);
    }
    const nm = (line?.name ?? line?.input_name ?? "").toString().trim().toLowerCase();
    if (nm) {
      const cpu = byName.get(nm)?.cost_per_unit;
      if (cpu != null && isFinite(Number(cpu))) return Number(cpu);
    }
    return null;
  };
  let cost = 0;
  let missing = 0;
  for (const line of collected) {
    const cpu = resolveCpu(line);
    const amount = Number(
      line?.amount ?? line?.totalAmount ?? line?.total_amount ?? line?.quantity ?? line?.qty ?? line?.kg ?? line?.kg_total,
    );
    if (cpu != null && isFinite(amount) && amount > 0) {
      cost += cpu * amount;
    } else {
      missing++;
    }
  }
  return { cost, lines: collected.length, missing };
}

export interface TripCostInputs {
  trip: Trip;
  tractor: TractorLite | null;
  operatorCategories: Pick<OperatorCategory, "id" | "name" | "cost_per_hour">[];
  members: Pick<VineyardMemberRow, "user_id" | "operator_category_id">[];
  fuelPurchases: FuelPurchase[];
  sprayRecords: Pick<SprayRecord, "trip_id" | "tanks">[];
  /** Optional saved-chemical library for cost fallback resolution. */
  savedChemicals?: SavedChemicalLite[];
  /** Optional saved-input library for seed/fertiliser cost resolution. */
  savedInputs?: SavedInputLite[];
  /** Vineyard paddocks (id + polygon_points) for treated-area resolution. */
  paddocks?: PaddockGeoLite[];
  /** Historical yield records used to resolve yield tonnes per paddock. */
  historicalYields?: Pick<HistoricalYieldRecord, "block_results" | "year" | "season" | "archived_at" | "created_at">[];
}

/** Collect linked paddock IDs for a trip. */
function tripPaddockIds(trip: Trip): string[] {
  const ids = new Set<string>();
  if (Array.isArray(trip.paddock_ids)) {
    for (const v of trip.paddock_ids as any[]) {
      if (v != null && v !== "") ids.add(String(v));
    }
  }
  if (trip.paddock_id) ids.add(String(trip.paddock_id));
  return Array.from(ids);
}

/** Sum polygon area (ha) across the trip's linked paddocks. Returns null when none resolvable. */
export function resolveTreatedAreaHa(
  trip: Trip,
  paddocks: PaddockGeoLite[],
): { areaHa: number | null; matched: number; total: number; warning: string | null } {
  const ids = tripPaddockIds(trip);
  if (ids.length === 0) {
    return { areaHa: null, matched: 0, total: 0, warning: "No paddock linked to this trip — treated area unknown." };
  }
  const byId = new Map(paddocks.map((p) => [p.id, p] as const));
  let area = 0;
  let matched = 0;
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const a = polygonAreaHectares(parsePolygonPoints(p.polygon_points));
    if (isFinite(a) && a > 0) {
      area += a;
      matched++;
    }
  }
  if (matched === 0) {
    return {
      areaHa: null,
      matched: 0,
      total: ids.length,
      warning: "Treated paddock polygons unavailable — treated area unknown.",
    };
  }
  if (matched < ids.length) {
    return {
      areaHa: area,
      matched,
      total: ids.length,
      warning: `Treated area derived from ${matched} of ${ids.length} linked paddocks (others missing geometry).`,
    };
  }
  return { areaHa: area, matched, total: ids.length, warning: null };
}

/** Pull a per-paddock tonne value out of a single block_results entry. */
function blockEntryTonnes(entry: any): number | null {
  if (!entry || typeof entry !== "object") return null;
  const candidates = [
    entry.total_yield_tonnes, entry.totalYieldTonnes,
    entry.yield_tonnes, entry.yieldTonnes,
    entry.tonnes, entry.tonnage, entry.estimated_tonnes, entry.estimatedTonnes,
    entry.actual_tonnes, entry.actualTonnes,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n;
  }
  return null;
}

function blockEntryPaddockId(entry: any): string | null {
  if (!entry || typeof entry !== "object") return null;
  const v =
    entry.paddock_id ?? entry.paddockId ??
    entry.block_id ?? entry.blockId ?? entry.id ?? null;
  return v == null ? null : String(v);
}

/** Resolve trip yield tonnes from historical yield records. Conservative: only when all linked paddocks match. */
export function resolveTripYieldTonnes(
  trip: Trip,
  records: Pick<HistoricalYieldRecord, "block_results" | "year" | "season" | "archived_at" | "created_at">[],
): { tonnes: number | null; warning: string | null } {
  const ids = tripPaddockIds(trip);
  if (ids.length === 0) {
    return { tonnes: null, warning: "Cost per tonne unavailable — yield data missing." };
  }
  if (!records || records.length === 0) {
    return { tonnes: null, warning: "Cost per tonne unavailable — yield data missing." };
  }
  // Pick the most recent record (by archived_at / created_at / year) that
  // contains entries for ALL linked paddocks. If none qualifies, return unavailable.
  const sorted = [...records].sort((a, b) => {
    const ka = (a.archived_at ?? a.created_at ?? (a.year != null ? `${a.year}-12-31` : "")) || "";
    const kb = (b.archived_at ?? b.created_at ?? (b.year != null ? `${b.year}-12-31` : "")) || "";
    return kb.localeCompare(ka);
  });
  for (const rec of sorted) {
    const blocks = Array.isArray(rec.block_results) ? rec.block_results : null;
    if (!blocks || blocks.length === 0) continue;
    const tonnesByPaddock = new Map<string, number>();
    for (const b of blocks) {
      const pid = blockEntryPaddockId(b);
      const t = blockEntryTonnes(b);
      if (pid && t != null) tonnesByPaddock.set(pid, (tonnesByPaddock.get(pid) ?? 0) + t);
    }
    if (tonnesByPaddock.size === 0) continue;
    const allMatch = ids.every((id) => tonnesByPaddock.has(id));
    if (!allMatch) continue;
    let total = 0;
    for (const id of ids) total += tonnesByPaddock.get(id) ?? 0;
    if (total > 0) return { tonnes: total, warning: null };
  }
  return { tonnes: null, warning: "Cost per tonne unavailable — yield data missing." };
}

export function computeTripCost(inp: TripCostInputs): TripCostBreakdown {
  const warnings: string[] = [];
  const ms = activeMs(inp.trip);
  const hours = ms == null ? null : ms / 3_600_000;
  if (hours == null) warnings.push("Trip has no completed start/finish time — active hours unknown.");

  // Operator category resolution.
  let categoryId = inp.trip.operator_category_id ?? null;
  if (!categoryId && inp.trip.operator_user_id) {
    const m = inp.members.find((x) => x.user_id === inp.trip.operator_user_id);
    categoryId = m?.operator_category_id ?? null;
    if (!categoryId) warnings.push("Operator has no default category assigned on the Team page.");
  }
  if (!categoryId) warnings.push("No operator category linked to this trip.");
  const cat = categoryId ? inp.operatorCategories.find((c) => c.id === categoryId) ?? null : null;
  const ratePerHour = cat?.cost_per_hour ?? null;
  if (cat && ratePerHour == null) warnings.push(`Operator category “${cat.name ?? "Unnamed"}” has no cost/hour set.`);

  const labourCost = hours != null && ratePerHour != null ? hours * ratePerHour : null;

  // Fuel
  const lph = inp.tractor?.fuel_usage_l_per_hour ?? null;
  if (!inp.tractor) warnings.push("No tractor linked to this trip — fuel cost cannot be calculated.");
  else if (lph == null) warnings.push("Linked tractor has no fuel usage (L/hr) recorded.");
  const cpl = weightedFuelCostPerLitre(inp.fuelPurchases);
  if (cpl == null) warnings.push("No fuel purchases on file — weighted fuel cost/litre unknown.");
  const litres = hours != null && lph != null ? hours * lph : null;
  const fuelCost = litres != null && cpl != null ? litres * cpl : null;

  // Chemicals — sum across spray_records linked by trip_id.
  let chemCost = 0;
  let chemLines = 0;
  let chemMissing = 0;
  const linked = inp.sprayRecords.filter((r) => r.trip_id === inp.trip.id);
  for (const rec of linked) {
    const r = chemicalCostFromTanks(rec.tanks, inp.savedChemicals ?? []);
    chemCost += r.cost;
    chemLines += r.lines;
    chemMissing += r.missing;
  }
  const chemCostFinal = chemLines === 0 || chemMissing > 0 ? null : chemCost;
  if (chemMissing > 0) {
    warnings.push("Some chemicals are missing a cost per unit.");
  }

  // Seed / inputs — parsed from trip.seeding_details.
  const inputAgg = inputCostFromSeedingDetails(inp.trip.seeding_details, inp.savedInputs ?? []);
  const inputCostFinal = inputAgg.lines === 0 || inputAgg.missing > 0 ? null : inputAgg.cost;
  if (inputAgg.missing > 0) {
    warnings.push("Some seed/input lines are missing a cost per unit.");
  }

  const parts: number[] = [];
  if (labourCost != null) parts.push(labourCost);
  if (fuelCost != null) parts.push(fuelCost);
  if (chemCostFinal != null) parts.push(chemCostFinal);
  if (inputCostFinal != null) parts.push(inputCostFinal);
  const total = parts.length ? parts.reduce((a, b) => a + b, 0) : null;

  // Treated area + cost per ha
  const areaRes = resolveTreatedAreaHa(inp.trip, inp.paddocks ?? []);
  const treatedAreaHa = areaRes.areaHa;
  let areaWarning = areaRes.warning;
  const costPerHa =
    total != null && treatedAreaHa != null && treatedAreaHa > 0 ? total / treatedAreaHa : null;
  if (costPerHa == null && total != null && treatedAreaHa == null && !areaWarning) {
    areaWarning = "Cost per ha unavailable — treated area missing.";
  }
  if (areaWarning) warnings.push(areaWarning);

  // Yield tonnes + cost per tonne
  const yieldRes = resolveTripYieldTonnes(inp.trip, inp.historicalYields ?? []);
  const yieldTonnes = yieldRes.tonnes;
  let yieldWarning = yieldRes.warning;
  const costPerTonne =
    total != null && yieldTonnes != null && yieldTonnes > 0 ? total / yieldTonnes : null;
  if (costPerTonne == null && total != null && yieldTonnes == null && !yieldWarning) {
    yieldWarning = "Cost per tonne unavailable — yield data missing.";
  }
  if (yieldWarning) warnings.push(yieldWarning);

  return {
    activeHours: hours,
    labour: { hours, ratePerHour, cost: labourCost, categoryName: cat?.name ?? null },
    fuel: { hours, litresPerHour: lph, costPerLitre: cpl, litres, cost: fuelCost },
    chemicals: { cost: chemCostFinal, lineCount: chemLines, missingCostLines: chemMissing },
    inputs: { cost: inputCostFinal, lineCount: inputAgg.lines, missingCostLines: inputAgg.missing },
    total,
    treatedAreaHa,
    costPerHa,
    yieldTonnes,
    costPerTonne,
    areaWarning,
    yieldWarning,
    warnings,
  };
}

export function fmtCurrency(n: number | null | undefined, currency = "AUD"): string {
  if (n == null || !isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null || !isFinite(h)) return "—";
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
}

export function fmtHa(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(2)} ha`;
}

export function fmtTonnes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(2)} t`;
}
