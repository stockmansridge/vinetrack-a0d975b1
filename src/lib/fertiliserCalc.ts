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
    else if (mode === "perVine") productRequired = rate * vineCount;
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

  const totalAreaHa = round3(rows.reduce((s, r) => s + r.areaHa, 0));
  const totalVines = rows.reduce((s, r) => s + r.vineCount, 0);
  const totalProductRequired = round3(rows.reduce((s, r) => s + r.productRequired, 0));

  // pack_count: total_product / pack_size. Only when pack_size > 0.
  const packSize = isNum(input.packSize) && input.packSize! > 0 ? input.packSize! : null;
  const packCount = packSize ? round3(totalProductRequired / packSize) : null;

  // estimated_product_cost: pack_count * price_per_pack. Requires both.
  const pricePerPack =
    isNum(input.pricePerPack) && input.pricePerPack! >= 0 ? input.pricePerPack! : null;
  const estimatedProductCost =
    packCount != null && pricePerPack != null ? round2(packCount * pricePerPack) : null;

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
