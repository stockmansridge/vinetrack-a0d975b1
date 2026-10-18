// Target Nutrient (Preview) — pure math + shared types. No I/O, no React.
//
// Contract: docs/target-nutrient-contract.md (v0.2, live schema audited
// 18 Oct 2026; clarified by ChatGPT — product_nutrient_analysis columns and
// the 14 new fertiliser_records fields incl. product_density_source /
// product_density_reference; nutrient_contract_version = 1).
//
// PREVIEW ONLY: nothing in this module persists. The Portal must not save
// nutrientTarget records or product nutrient analyses until cross-platform
// testing passes (contract §6). Persisted nutrientTarget records remain
// read-only via the unsupported-mode guard in fertiliserCalc.ts.

import { isNum, round3, type FertiliserForm } from "@/lib/fertiliserCalc";

export const NUTRIENT_CONTRACT_VERSION = "1";

/** Canonical nutrient keys (contract §3). "other:<slug>" for custom. */
export const NUTRIENT_KEYS = [
  "N", "P", "K", "Ca", "Mg", "S",
  "Fe", "Mn", "Zn", "Cu", "B", "Mo", "Cl", "Si", "Co",
] as const;

export const NUTRIENT_DISPLAY: Record<string, string> = {
  N: "Nitrogen", P: "Phosphorus", K: "Potassium", Ca: "Calcium",
  Mg: "Magnesium", S: "Sulfur", Fe: "Iron", Mn: "Manganese",
  Zn: "Zinc", Cu: "Copper", B: "Boron", Mo: "Molybdenum",
  Cl: "Chlorine", Si: "Silicon", Co: "Cobalt",
};

export type AnalysisBasis = "elemental" | "oxide";
export type ConcentrationBasis = "w/w" | "w/v";
export type TargetRateUnit = "g/vine" | "kg/ha";

/** One declared nutrient in a product's analysis (local preview model). */
export interface NutrientAnalysisEntry {
  nutrientKey: string; // canonical key or "other:<slug>"
  displayName: string;
  percent: number;
  analysisBasis: AnalysisBasis;
  concentrationBasis: ConcentrationBasis;
  /** "product_analysis" = declared on the label; "manual" = grower estimate. */
  sourceKind: "product_analysis" | "manual";
  sourceReference?: string | null;
  isPrimary?: boolean;
}

export interface TargetNutrientInput {
  form: FertiliserForm;
  targetRateUnit: TargetRateUnit;
  /** Grower's target: g nutrient/vine or kg nutrient/ha. */
  targetRate: number;
  /** Percentage actually used (product-derived or manual). */
  nutrientPercent: number;
  nutrientPercentSource: "product_analysis" | "manual";
  analysisBasis: AnalysisBasis;
  concentrationBasis: ConcentrationBasis;
  /** kg/L — required only for w/w liquids converted to volume. */
  densityKgPerL?: number | null;
  /** Selected blocks OR manual totals (same fallback as the calculator). */
  totalAreaHa: number;
  totalVines: number;
  /** Full declared analysis for the "also applied" display. */
  otherNutrients?: NutrientAnalysisEntry[];
}

export interface OtherNutrientApplied {
  nutrientKey: string;
  displayName: string;
  analysisBasis: AnalysisBasis;
  /** kg (or L-equivalent kg) applied across the selection; null = unavailable. */
  totalKg: number | null;
  perVineG: number | null;
  perHaKg: number | null;
  /** Why the figure is unavailable, when it is. */
  note?: string;
}

export interface TargetNutrientResult {
  /** Product rate per vine (g or mL) when targetRateUnit is g/vine. */
  productPerVine: number | null;
  productPerVineUnit: "g/vine" | "mL/vine" | null;
  /** Product rate per hectare (kg or L) when targetRateUnit is kg/ha. */
  productPerHa: number | null;
  productPerHaUnit: "kg/ha" | "L/ha" | null;
  /** Total product required across the selection, in product base unit. */
  totalProductRequired: number;
  productUnit: "kg" | "L";
  /** Total target nutrient delivered (kg). */
  totalNutrientKg: number;
  others: OtherNutrientApplied[];
  /** Human-readable blockers (e.g. missing density). Empty = calculable. */
  issues: string[];
}

const isPos = (v: unknown): v is number => isNum(v) && (v as number) > 0;

/**
 * Compute a Target Nutrient calculation. Pure and deterministic.
 *
 * Core identity: product_required = target_nutrient / (percent / 100).
 * - Solids and w/w: percent is mass/mass → product mass.
 * - w/v liquids: percent is g per 100 mL → product volume directly,
 *   no density needed (16% w/v = 16 g/100 mL; 2 g target → 12.5 mL).
 * - w/w liquids: percent gives product MASS; converting to volume needs
 *   density (kg/L). Without it the volume figures are blocked with a reason.
 * - Oxide-labelled percentages are used as declared, never silently treated
 *   as elemental; the basis label travels with every displayed figure.
 */
export function computeTargetNutrient(input: TargetNutrientInput): TargetNutrientResult {
  const issues: string[] = [];
  const pct = input.nutrientPercent;
  const target = input.targetRate;
  const isLiquid = input.form === "liquid";
  const isWV = input.concentrationBasis === "w/v";
  const density = isPos(input.densityKgPerL) ? input.densityKgPerL! : null;

  if (!isPos(pct) || pct > 100) issues.push("Enter a nutrient percentage between 0 and 100.");
  if (!isPos(target)) issues.push("Enter a target nutrient quantity greater than zero.");

  const perVine = input.targetRateUnit === "g/vine";
  const vines = Math.max(0, Math.round(input.totalVines));
  const areaHa = Math.max(0, input.totalAreaHa);

  // Total target nutrient in kg.
  const totalNutrientKg = perVine ? (target * vines) / 1000 : target * areaHa;

  // Product required. w/v → volume (L); otherwise → mass (kg).
  const fraction = isPos(pct) ? pct / 100 : 0;
  const totalProductMassKg = fraction > 0 ? totalNutrientKg / fraction : 0;
  const needsDensity = isLiquid && !isWV;
  if (needsDensity && density == null) {
    issues.push(
      "This liquid's concentration is declared weight/weight, so converting the required mass into a product volume needs a verified density (kg/L). Enter the density to see litres.",
    );
  }

  const productUnit: "kg" | "L" = isLiquid && (isWV || density != null) ? "L" : "kg";
  const totalProductRequired =
    productUnit === "L"
      ? isWV
        ? totalProductMassKg // w/v: percent = g/100 mL, so "kg of nutrient / fraction" is numerically litres
        : totalProductMassKg / density!
      : totalProductMassKg;

  // Per-unit rates.
  let productPerVine: number | null = null;
  let productPerVineUnit: "g/vine" | "mL/vine" | null = null;
  let productPerHa: number | null = null;
  let productPerHaUnit: "kg/ha" | "L/ha" | null = null;
  if (fraction > 0) {
    if (perVine) {
      const massG = target / fraction; // g product per vine
      if (isLiquid && isWV) {
        productPerVine = massG; // numerically mL (g/100mL basis)
        productPerVineUnit = "mL/vine";
      } else if (isLiquid && density != null) {
        productPerVine = massG / density;
        productPerVineUnit = "mL/vine";
      } else if (isLiquid) {
        productPerVine = null; // blocked by missing density
        productPerVineUnit = null;
      } else {
        productPerVine = massG;
        productPerVineUnit = "g/vine";
      }
    } else {
      const massKg = target / fraction; // kg product per ha
      if (isLiquid && isWV) {
        productPerHa = massKg;
        productPerHaUnit = "L/ha";
      } else if (isLiquid && density != null) {
        productPerHa = massKg / density;
        productPerHaUnit = "L/ha";
      } else if (isLiquid) {
        productPerHa = null;
        productPerHaUnit = null;
      } else {
        productPerHa = massKg;
        productPerHaUnit = "kg/ha";
      }
    }
  }

  // Other declared nutrients also applied (informational only).
  const others: OtherNutrientApplied[] = (input.otherNutrients ?? []).map((n) => {
    const base: OtherNutrientApplied = {
      nutrientKey: n.nutrientKey,
      displayName: n.displayName,
      analysisBasis: n.analysisBasis,
      totalKg: null,
      perVineG: null,
      perHaKg: null,
    };
    if (!isPos(n.percent) || n.percent > 100) {
      return { ...base, note: "No usable declared percentage." };
    }
    const f = n.percent / 100;
    if (n.concentrationBasis === "w/v") {
      // Mass per product volume — needs the product volume in L.
      if (productUnit !== "L") {
        return { ...base, note: "Needs product volume — enter density to calculate." };
      }
      const kg = totalProductRequired * f; // L × (g/100mL) ≡ kg numerically
      return {
        ...base,
        totalKg: round3(kg),
        perVineG: vines > 0 ? round3((kg * 1000) / vines) : null,
        perHaKg: areaHa > 0 ? round3(kg / areaHa) : null,
      };
    }
    // w/w: mass fraction of product mass.
    const kg = totalProductMassKg * f;
    return {
      ...base,
      totalKg: round3(kg),
      perVineG: vines > 0 ? round3((kg * 1000) / vines) : null,
      perHaKg: areaHa > 0 ? round3(kg / areaHa) : null,
    };
  });

  return {
    productPerVine: productPerVine == null ? null : round3(productPerVine),
    productPerVineUnit,
    productPerHa: productPerHa == null ? null : round3(productPerHa),
    productPerHaUnit,
    totalProductRequired: round3(totalProductRequired),
    productUnit,
    totalNutrientKg: round3(totalNutrientKg),
    others,
    issues,
  };
}

/** Snapshot shape persisted on nutrientTarget records (contract §4). */
export interface ProductAnalysisSnapshot {
  schema_version: 1;
  nutrients: Array<{
    nutrient_key: string;
    display_name: string;
    declared_as: string;
    percent: number;
    analysis_basis: AnalysisBasis;
    concentration_basis: ConcentrationBasis;
    source_kind: string;
    source_reference: string | null;
    is_primary: boolean;
  }>;
}

/** Build the snapshot object exactly as a saved record must carry it. */
export function buildProductAnalysisSnapshot(
  entries: NutrientAnalysisEntry[],
): ProductAnalysisSnapshot {
  return {
    schema_version: 1,
    nutrients: entries.map((e) => ({
      nutrient_key: e.nutrientKey,
      display_name: e.displayName,
      declared_as: `${e.percent}% ${e.analysisBasis === "oxide" ? "oxide" : "elemental"} ${e.concentrationBasis}`,
      percent: e.percent,
      analysis_basis: e.analysisBasis,
      concentration_basis: e.concentrationBasis,
      source_kind: e.sourceKind,
      source_reference: e.sourceReference ?? null,
      is_primary: !!e.isPrimary,
    })),
  };
}

/** Seed local analysis entries from a saved product's legacy N/P/K fields. */
export function seedAnalysisFromLegacyProduct(p: {
  nitrogen_percent: number | null;
  phosphorus_percent: number | null;
  potassium_percent: number | null;
  analysis_basis: string;
  product_form?: string;
}): NutrientAnalysisEntry[] {
  const basis: AnalysisBasis = p.analysis_basis === "oxide" ? "oxide" : "elemental";
  const out: NutrientAnalysisEntry[] = [];
  const push = (key: string, pct: number | null) => {
    if (isPos(pct)) {
      out.push({
        nutrientKey: key,
        displayName: NUTRIENT_DISPLAY[key] ?? key,
        percent: pct!,
        analysisBasis: basis,
        concentrationBasis: "w/w",
        sourceKind: "product_analysis",
        isPrimary: out.length === 0,
      });
    }
  };
  push("N", p.nitrogen_percent);
  push("P", p.phosphorus_percent);
  push("K", p.potassium_percent);
  return out;
}
