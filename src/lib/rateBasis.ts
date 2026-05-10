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

/**
 * Render a unit string in display form for the UI ("L/ha", "mL/100L", etc.)
 * regardless of whether the stored value uses iOS raw enums ("Litres/ha")
 * or the short internal form. Falls back to the original string for unknowns.
 */
export function displayUnitText(unit?: string | null): string {
  if (!unit) return "";
  const cu = normaliseUnit(unit);
  if (!cu) return unit;
  const basis = inferRateBasis(unit);
  return composeUnit(cu, basis);
}

/** Default unit for a given product type. */
export function defaultUnitFor(type: ProductType): ChemUnit {
  return type === "solid" ? "kg" : "L";
}

/** Available units for a product type. */
export function unitsFor(type: ProductType): ChemUnit[] {
  return type === "solid" ? SOLID_UNITS : LIQUID_UNITS;
}

// ---------------------------------------------------------------------------
// iOS compatibility helpers
//
// iOS still reads legacy fields on each spray-line / saved chemical:
//   - `unit` as the raw enum string ("Litres" | "mL" | "Kg" | "g")
//   - `ratePerHa` numeric  (set when basis = per hectare)
//   - `ratePer100L` numeric (set when basis = per 100 litres)
//   - `rate_basis` enum: "per_hectare" | "per_100_litres"
//
// We keep "L/ha", "mL/100L" etc. for internal display, but normalise to the
// iOS shape at every write boundary (createSprayJob / updateSprayJob and
// saved-chemical writes that share the same JSON with iOS).
// ---------------------------------------------------------------------------

/** Map an internal ChemUnit ("L" / "mL" / "kg" / "g") to the iOS raw value. */
export const IOS_UNIT_MAP: Record<ChemUnit, "Litres" | "mL" | "Kg" | "g"> = {
  L: "Litres",
  mL: "mL",
  kg: "Kg",
  g: "g",
};

/** iOS-compatible rate-basis code expected on shared backend payloads. */
export type IOSRateBasis = "per_hectare" | "per_100_litres";

export function iosBasisCode(basis: RateBasis | IOSRateBasis | string | null | undefined): IOSRateBasis {
  if (!basis) return "per_hectare";
  if (basis === "per_100L" || basis === "per_100_litres") return "per_100_litres";
  return "per_hectare";
}

/** Resolve the iOS raw `unit` string from any free-text / composed unit. */
export function iosUnitFromAny(unit?: string | null, productType?: ProductType | null): "Litres" | "mL" | "Kg" | "g" {
  // Direct iOS value passthrough.
  const trimmed = (unit ?? "").trim();
  if (trimmed === "Litres" || trimmed === "Kg") return trimmed;
  const u = normaliseUnit(unit);
  if (u) return IOS_UNIT_MAP[u];
  return IOS_UNIT_MAP[defaultUnitFor(productType ?? "liquid")];
}

/** Compose a unit string using iOS raw values (e.g. "Litres/ha", "mL/100L"). */
export function composeIosUnit(chemUnit: string, basis: RateBasis | IOSRateBasis): string {
  const cu = (chemUnit ?? "").trim() || "Litres";
  return iosBasisCode(basis) === "per_100_litres" ? `${cu}/100L` : `${cu}/ha`;
}

export interface IOSChemicalLineCompat {
  unit: string;                 // iOS raw enum ("Litres" / "mL" / "Kg" / "g")
  rate_basis: IOSRateBasis;     // "per_hectare" | "per_100_litres"
  ratePerHa: number | null;
  ratePer100L: number | null;
}

/**
 * Build the iOS-compatible legacy fields for a chemical line. Accepts any
 * mix of internal/legacy inputs and returns what iOS expects on the shared
 * `chemical_lines` / `tanks` JSON.
 */
export function toIOSChemicalLineCompat(input: {
  unit?: string | null;
  product_type?: ProductType | null;
  rate_basis?: RateBasis | IOSRateBasis | string | null;
  rate?: number | null;
  ratePerHa?: number | null;
  ratePer100L?: number | null;
}): IOSChemicalLineCompat {
  const productType = input.product_type ?? inferProductType(input.unit);
  const basisInternal: RateBasis = input.rate_basis === "per_100L" || input.rate_basis === "per_100_litres"
    ? "per_100L"
    : input.rate_basis === "per_hectare"
    ? "per_hectare"
    : inferRateBasis(input.unit);
  const iosBasis = iosBasisCode(basisInternal);
  const iosUnit = iosUnitFromAny(input.unit, productType);

  const rate = input.rate != null && Number.isFinite(input.rate) ? Number(input.rate) : null;
  let ratePerHa = input.ratePerHa ?? null;
  let ratePer100L = input.ratePer100L ?? null;

  if (iosBasis === "per_hectare") {
    if (rate != null) ratePerHa = rate;
    ratePer100L = null;
  } else {
    if (rate != null) ratePer100L = rate;
    ratePerHa = null;
  }

  return {
    unit: iosUnit,
    rate_basis: iosBasis,
    ratePerHa,
    ratePer100L,
  };
}

