// Rate basis + product type helpers — keep Lovable and iOS in sync.
//
// Two supported rate bases:
//   - "per_hectare"   → applied per hectare of area (e.g. L/ha, g/ha)
//   - "per_100L"      → applied per 100 litres of spray water (e.g. mL/100L)
//
// Two supported product types:
//   - "liquid" → unit is "L" or "mL"
//   - "solid"  → unit is "kg" or "g"
//
// Storage strategy:
//   1. spray_jobs.chemical_lines[*] JSON carries explicit fields
//      `product_type`, `unit`, `rate_basis` (no schema change required).
//   2. The composed `unit` text ("mL/100L", "L/ha", …) is also kept on the
//      line / on saved_chemicals.unit for backward compatibility with iOS
//      readers that still parse the unit string.

export type RateBasis = "per_hectare" | "per_100L";
export type ProductType = "liquid" | "solid";
export type ChemUnit = "L" | "mL" | "kg" | "g";

export const LIQUID_UNITS: ChemUnit[] = ["L", "mL"];
export const SOLID_UNITS: ChemUnit[] = ["kg", "g"];

export const RATE_BASIS_LABEL: Record<RateBasis, string> = {
  per_hectare: "Per hectare",
  per_100L: "Per 100 L",
};

export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  liquid: "Liquid",
  solid: "Solid",
};

/** Strip the basis suffix to get just the chemical unit (L, mL, kg, g). */
export function chemUnitOnly(unit?: string | null): string {
  if (!unit) return "";
  return unit.replace(/\s*\/\s*(ha|100\s*l|100l|100litre)\b/i, "").trim() || unit;
}

/** Infer rate basis from a free-text unit like "mL/100L" or "L/ha". */
export function inferRateBasis(unit?: string | null): RateBasis {
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (u.includes("/100l") || u.includes("per100")) return "per_100L";
  return "per_hectare";
}

/** Normalise free text into a canonical chem unit. */
export function normaliseUnit(unit?: string | null): ChemUnit | "" {
  const cu = chemUnitOnly(unit).trim();
  if (!cu) return "";
  const lc = cu.toLowerCase();
  if (lc === "l" || lc === "litre" || lc === "litres") return "L";
  if (lc === "ml" || lc === "millilitre" || lc === "millilitres") return "mL";
  if (lc === "kg" || lc === "kilogram" || lc === "kilograms") return "kg";
  if (lc === "g" || lc === "gram" || lc === "grams") return "g";
  return "";
}

/** Infer product type from a chem unit or a composed unit string. */
export function inferProductType(unit?: string | null): ProductType {
  const u = normaliseUnit(unit);
  if (u === "kg" || u === "g") return "solid";
  return "liquid";
}

/** Compose a chem unit + basis back into the canonical text form. */
export function composeUnit(chemUnit: string, basis: RateBasis): string {
  const cu = (chemUnit ?? "").trim() || "L";
  return basis === "per_100L" ? `${cu}/100L` : `${cu}/ha`;
}

/** Default unit for a given product type. */
export function defaultUnitFor(type: ProductType): ChemUnit {
  return type === "solid" ? "kg" : "L";
}

/** Available units for a product type. */
export function unitsFor(type: ProductType): ChemUnit[] {
  return type === "solid" ? SOLID_UNITS : LIQUID_UNITS;
}
