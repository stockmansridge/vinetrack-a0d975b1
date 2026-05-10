// Rate basis helpers — keep Lovable and iOS in sync.
//
// Two supported rate bases for chemical/product application:
//   - "per_hectare"   → rate is applied per hectare of area (e.g. L/ha, g/ha)
//   - "per_100L"      → rate is applied per 100 litres of spray water
//                       (e.g. mL/100L, g/100L)
//
// We store the basis structurally in two places:
//   1. spray_jobs.chemical_lines[*].rate_basis  (JSON, explicit field)
//   2. encoded into the trailing suffix of the `unit` string
//      ("/ha" or "/100L") for backward compatibility with iOS readers
//      that only inspect the unit text.

export type RateBasis = "per_hectare" | "per_100L";

/** Infer rate basis from a free-text unit like "mL/100L" or "L/ha". */
export function inferRateBasis(unit?: string | null): RateBasis {
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (u.includes("/100l") || u.includes("per100")) return "per_100L";
  return "per_hectare";
}

/** Strip the basis suffix to get just the chemical unit (L, mL, kg, g). */
export function chemUnitOnly(unit?: string | null): string {
  if (!unit) return "";
  return unit.replace(/\s*\/\s*(ha|100\s*l|100l|100litre)\b/i, "").trim() || unit;
}

/** Compose a unit + basis back into the canonical text form. */
export function composeUnit(chemUnit: string, basis: RateBasis): string {
  const cu = (chemUnit ?? "").trim() || "L";
  return basis === "per_100L" ? `${cu}/100L` : `${cu}/ha`;
}

export const RATE_BASIS_LABEL: Record<RateBasis, string> = {
  per_hectare: "Per hectare",
  per_100L: "Per 100 L",
};
