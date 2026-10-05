// Pure math for the Fertiliser Calculator. No I/O, no React.
//
// Contracts (live iOS Supabase schema, SQL 110 + SQL 111):
//   fertiliser_records.calculation_mode ∈ {perHectare, perVine, nutrientTarget, fertigation}
//   fertiliser_records.form               ∈ {solid, liquid}
//   fertiliser_records.application_rate_unit is free text (e.g. "kg/ha", "g/vine", "L/ha", "mL/vine")
//   fertiliser_records.product_unit is the base product unit (e.g. "kg", "L")
//
// This module implements only the perHectare and perVine modes for the current
// portal release. It also derives pack_count from pack_size and total product,
// and reconciles multi-block allocations so the parent record totals match
// the sum of the allocation rows exactly.

export type FertiliserForm = "solid" | "liquid";
export type FertiliserCalculationMode = "perHectare" | "perVine";
export type FertiliserRecordStatus = "draft" | "planned" | "completed" | "cancelled";

/** Per-block input the calculator works with. */
export interface AllocationInput {
  paddockId: string;
  paddockName: string;
  /** Hectares for this block. Fallback 0 keeps math safe. */
  areaHa: number;
  /** Estimated vine count for this block. Fallback 0. */
  vineCount: number;
}

/** Rounded rate + total math for a single allocation row. */
export interface AllocationResult {
  paddockId: string;
  paddockName: string;
  areaHa: number;
  vineCount: number;
  /** Application rate used for this row (usually the shared parent rate). */
  applicationRate: number;
  /** Total product required for this row in the parent's product_unit. */
  productRequired: number;
  /** Allocated cost — proportional share of the parent's estimated product cost. */
  allocatedCost: number | null;
}

/** Result of a full calculation across every selected block. */
export interface CalculationResult {
  allocations: AllocationResult[];
  totalAreaHa: number;
  totalVines: number;
  totalProductRequired: number;
  packCount: number | null;
  estimatedProductCost: number | null;
  totalJobCost: number | null;
}

export interface CalculationInput {
  mode: FertiliserCalculationMode;
  /** Application rate value in the unit implied by `mode`. */
  applicationRate: number;
  /** Optional pack size in product_unit — enables pack_count calc. */
  packSize?: number | null;
  /** Optional price per pack — enables estimated_product_cost calc. */
  pricePerPack?: number | null;
  /** Optional labour cost (currency) — added to total_job_cost. */
  labourCost?: number | null;
  /** Optional machinery cost (currency) — added to total_job_cost. */
  machineryCost?: number | null;
  allocations: AllocationInput[];
  /**
   * Used only when `allocations` is empty: manually entered treated area /
   * vine count so a calculation works without selecting blocks (iOS parity).
   */
  manual?: { areaHa?: number | null; vineCount?: number | null } | null;
  /**
   * Authoritative product cost (e.g. SQL 264 seasonal purchase price for a
   * saved product). When provided (number or null) it replaces the
   * pack × price-per-pack estimate; null means "unavailable".
   */
  productCostOverride?: number | null;
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Round to 3dp — enough precision for product quantities in kg / L. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Round to 2dp — currency. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute per-block product requirements + parent totals for a given
 * calculation mode. Pure and deterministic — every derived total is the sum
 * of the allocation rows so reconciliation is trivial.
 */
export function computeCalculation(input: CalculationInput): CalculationResult {
  const mode = input.mode;
  const rate = isNum(input.applicationRate) ? input.applicationRate : 0;

  // Per-row product required.
  const rows = input.allocations.map<AllocationResult>((a) => {
    const areaHa = Math.max(0, isNum(a.areaHa) ? a.areaHa : 0);
    const vineCount = Math.max(0, isNum(a.vineCount) ? Math.round(a.vineCount) : 0);
    let productRequired = 0;
    if (mode === "perHectare") productRequired = rate * areaHa;
    // g/vine or mL/vine × vines ÷ 1000 → kg or L (iOS parity).
    else if (mode === "perVine") productRequired = (rate * vineCount) / 1000;
    return {
      paddockId: a.paddockId,
      paddockName: a.paddockName,
      areaHa: round3(areaHa),
      vineCount,
      applicationRate: rate,
      productRequired: round3(productRequired),
      allocatedCost: null, // filled in after totals are known
    };
  });

  let totalAreaHa = round3(rows.reduce((s, r) => s + r.areaHa, 0));
  let totalVines = rows.reduce((s, r) => s + r.vineCount, 0);
  let totalProductRequired = round3(rows.reduce((s, r) => s + r.productRequired, 0));
  if (rows.length === 0 && input.manual) {
    totalAreaHa = round3(Math.max(0, isNum(input.manual.areaHa) ? input.manual.areaHa! : 0));
    totalVines = Math.max(0, isNum(input.manual.vineCount) ? Math.round(input.manual.vineCount!) : 0);
    totalProductRequired = round3(
      mode === "perHectare" ? rate * totalAreaHa : (rate * totalVines) / 1000,
    );
  }

  // pack_count: total_product / pack_size. Only when pack_size > 0.
  const packSize = isNum(input.packSize) && input.packSize! > 0 ? input.packSize! : null;
  const packCount = packSize ? round3(totalProductRequired / packSize) : null;

  // estimated_product_cost: pack_count * price_per_pack. Requires both.
  const pricePerPack =
    isNum(input.pricePerPack) && input.pricePerPack! >= 0 ? input.pricePerPack! : null;
  const estimatedProductCost =
    input.productCostOverride !== undefined
      ? input.productCostOverride == null
        ? null
        : round2(input.productCostOverride)
      : packCount != null && pricePerPack != null
        ? round2(packCount * pricePerPack)
        : null;

  // Distribute product cost across blocks proportional to product required.
  // Falls back to area, then to equal shares, so tiny/zero-vine blocks still
  // reconcile to the parent total.
  if (estimatedProductCost != null && rows.length > 0) {
    const weights = rows.map((r) => r.productRequired);
    const wSum = weights.reduce((s, w) => s + w, 0);
    if (wSum > 0) {
      let running = 0;
      rows.forEach((r, i) => {
        const isLast = i === rows.length - 1;
        r.allocatedCost = isLast
          ? round2(estimatedProductCost - running)
          : round2((weights[i] / wSum) * estimatedProductCost);
        if (!isLast) running = round2(running + (r.allocatedCost ?? 0));
      });
    } else {
      // Equal split fallback.
      const share = round2(estimatedProductCost / rows.length);
      let running = 0;
      rows.forEach((r, i) => {
        const isLast = i === rows.length - 1;
        r.allocatedCost = isLast ? round2(estimatedProductCost - running) : share;
        if (!isLast) running = round2(running + share);
      });
    }
  }

  const labour = isNum(input.labourCost) ? input.labourCost! : 0;
  const machinery = isNum(input.machineryCost) ? input.machineryCost! : 0;
  const productCostForJob = estimatedProductCost ?? 0;
  const anyCost =
    estimatedProductCost != null || labour > 0 || machinery > 0
      ? round2(productCostForJob + labour + machinery)
      : null;

  return {
    allocations: rows,
    totalAreaHa,
    totalVines,
    totalProductRequired,
    packCount,
    estimatedProductCost,
    totalJobCost: anyCost,
  };
}

/** Pack breakdown: full packs, partial pack and packs to open (iOS parity). */
export interface PackBreakdown {
  packsRequired: number;
  fullPacks: number;
  partialPack: number;
  partialPercent: number;
  packsToOpen: number;
}

export function packBreakdown(totalRequired: number, packSize: number | null | undefined): PackBreakdown | null {
  if (!isNum(packSize) || packSize! <= 0 || !isNum(totalRequired) || totalRequired < 0) return null;
  // Round first so float noise (2.4000000001) never opens an extra pack.
  const packsRequired = round3(totalRequired / packSize!);
  const fullPacks = Math.floor(packsRequired);
  const partialPack = round3(packsRequired - fullPacks);
  return {
    packsRequired,
    fullPacks,
    partialPack,
    partialPercent: Math.round(partialPack * 100),
    packsToOpen: Math.ceil(packsRequired),
  };
}

export function costPerHectare(totalJobCost: number | null, areaHa: number): number | null {
  return totalJobCost != null && areaHa > 0 ? round2(totalJobCost / areaHa) : null;
}

export function costPerVine(totalJobCost: number | null, vines: number): number | null {
  return totalJobCost != null && vines > 0 ? Math.round((totalJobCost / vines) * 10000) / 10000 : null;
}

const UNIT_BASE: Record<string, { dim: "mass" | "volume"; factor: number }> = {
  kg: { dim: "mass", factor: 1000 }, g: { dim: "mass", factor: 1 },
  l: { dim: "volume", factor: 1000 }, ml: { dim: "volume", factor: 1 },
  litre: { dim: "volume", factor: 1000 }, litres: { dim: "volume", factor: 1000 },
};

/** Convert a quantity between kg/g or L/mL. Null when dimensions differ/unknown. */
export function convertQuantity(value: number, from: string | null | undefined, to: string | null | undefined): number | null {
  const f = UNIT_BASE[String(from ?? "").trim().toLowerCase()];
  const t = UNIT_BASE[String(to ?? "").trim().toLowerCase()];
  if (!f || !t || f.dim !== t.dim || !isNum(value)) return null;
  return (value * f.factor) / t.factor;
}

export interface InventoryComparison {
  /** Available stock expressed in the product unit (kg or L). */
  available: number;
  required: number;
  after: number;
  shortage: boolean;
  unit: string;
}

/** Compare Chemical Inventory stock with product required, converting units. */
export function compareInventory(
  availableQty: number | null | undefined,
  availableUnit: string | null | undefined,
  required: number,
  productUnit: string,
): InventoryComparison | null {
  if (!isNum(availableQty)) return null;
  const available = convertQuantity(availableQty!, availableUnit, productUnit);
  if (available == null) return null;
  const after = round3(available - required);
  return { available: round3(available), required: round3(required), after, shortage: after < 0, unit: productUnit };
}

/**
 * Saved-product cost from a SQL 264 season price row. Null unless the basis
 * is a usable weighted average in the same physical dimension.
 */
export function seasonProductCost(
  row: { pricing_basis: string; weighted_cost_per_base_unit: number | null; base_unit: string | null } | null | undefined,
  totalRequired: number,
  productUnit: string,
): number | null {
  if (!row || row.pricing_basis !== "season_weighted_purchase_average") return null;
  if (!isNum(row.weighted_cost_per_base_unit)) return null;
  const qty = convertQuantity(totalRequired, productUnit, row.base_unit);
  if (qty == null) return null;
  return round2(qty * row.weighted_cost_per_base_unit!);
}

/** Default rate unit for the mode + form combination. */
export function defaultRateUnit(
  mode: FertiliserCalculationMode,
  form: FertiliserForm,
): string {
  if (mode === "perHectare") return form === "liquid" ? "L/ha" : "kg/ha";
  return form === "liquid" ? "mL/vine" : "g/vine";
}

/** Default product base unit for the form. */
export function defaultProductUnit(form: FertiliserForm): string {
  return form === "liquid" ? "L" : "kg";
}

/** Human label for a status. Kept UI-adjacent so it can be reused. */
export const STATUS_LABEL: Record<FertiliserRecordStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ALL_STATUSES: FertiliserRecordStatus[] = [
  "draft",
  "planned",
  "completed",
  "cancelled",
];

/** SQL 111 product category keys. Empty string = uncategorised. */
export const PRODUCT_CATEGORY_KEYS = [
  "fungicide",
  "insecticide",
  "herbicide",
  "adjuvant",
  "growthRegulator",
  "foliarNutrient",
  "granularFertiliser",
  "liquidFertiliser",
  "fertigation",
  "compost",
  "manure",
  "biofertiliser",
  "compostTea",
  "seaweed",
  "fishHydrolysate",
  "humicFulvic",
  "soilAmendment",
  "other",
] as const;

export type ProductCategoryKey = (typeof PRODUCT_CATEGORY_KEYS)[number] | "";

/** Categories treated as fertiliser/nutrient products for the default filter. */
export const FERTILISER_CATEGORY_KEYS: ProductCategoryKey[] = [
  "foliarNutrient",
  "granularFertiliser",
  "liquidFertiliser",
  "fertigation",
  "compost",
  "manure",
  "biofertiliser",
  "compostTea",
  "seaweed",
  "fishHydrolysate",
  "humicFulvic",
  "soilAmendment",
];

export const PRODUCT_CATEGORY_LABEL: Record<ProductCategoryKey, string> = {
  "": "Uncategorised",
  fungicide: "Fungicide",
  insecticide: "Insecticide",
  herbicide: "Herbicide",
  adjuvant: "Adjuvant",
  growthRegulator: "Growth regulator",
  foliarNutrient: "Foliar nutrient",
  granularFertiliser: "Granular fertiliser",
  liquidFertiliser: "Liquid fertiliser",
  fertigation: "Fertigation",
  compost: "Compost",
  manure: "Manure",
  biofertiliser: "Bio-fertiliser",
  compostTea: "Compost tea",
  seaweed: "Seaweed",
  fishHydrolysate: "Fish hydrolysate",
  humicFulvic: "Humic / fulvic",
  soilAmendment: "Soil amendment",
  other: "Other",
};

/** iOS parity: only explicit fertiliser/nutrition categories; null is NOT fertiliser. */
export function isFertiliserProduct(p: { product_category?: string | null }): boolean {
  return !!p.product_category && FERTILISER_CATEGORY_KEYS.includes(p.product_category as ProductCategoryKey);
}
