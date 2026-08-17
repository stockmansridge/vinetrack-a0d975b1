// Stage 3B — presentation helpers for the guided Spray Job workflow.
// Display only: raw enums never reach the grower, and no maths happens here.
import {
  GEOMETRY_QUALITY_LABEL,
  type GeometryQuality,
  type GeometrySource,
  type SprayBlockGeometry,
} from "@/lib/sprayApplicationGeometry";
import type { ProductRateBasis } from "@/lib/sprayApplicationDomain";
import type { RateValidation, SprayDiagnostic } from "@/lib/sprayCalculation";

/** Friendly geometry provenance. Raw enums stay in diagnostics only. */
export const GEOMETRY_SOURCE_FRIENDLY: Record<GeometrySource, string> = {
  operator_override: "Operator override",
  mapped_rows: "Mapped vineyard rows",
  derived_from_area_and_spacing: "Calculated from area and row spacing",
  unavailable: "Geometry incomplete",
};

export const GEOMETRY_QUALITY_FRIENDLY: Record<GeometryQuality, string> = {
  ...GEOMETRY_QUALITY_LABEL,
  incomplete: "Incomplete",
};

/** Grower-friendly product rate basis labels. */
export const PRODUCT_BASIS_FRIENDLY: Record<ProductRateBasis, string> = {
  whole_block_area: "Whole block area",
  treated_area: "Treated area",
  per_100_litres: "Per 100 L carrier",
  per_100_metres: "Per 100 m row",
};

export const RATE_VALIDATION_FRIENDLY: Record<RateValidation, string> = {
  in_range: "Within known label range",
  below_range: "Below known label range",
  above_range: "Above known label range",
  unable_to_validate: "Rate cannot be validated from current Chemical Intelligence",
};

export const RATE_VALIDATION_TONE: Record<RateValidation, "ok" | "warn" | "muted"> = {
  in_range: "ok",
  below_range: "warn",
  above_range: "warn",
  unable_to_validate: "muted",
};

export const fmtHa = (v: number | null | undefined) =>
  v == null ? "—" : `${(Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha`;

export const fmtLitres = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(v).toLocaleString()} L`;

export const fmtMetres = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(v).toLocaleString()} m`;

export const fmtNum = (v: number | null | undefined, dp = 2) =>
  v == null ? "—" : (Math.round(v * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });

export const fmtQuantity = (v: number | null | undefined, unit: string | null | undefined) =>
  v == null ? "—" : `${fmtNum(v, 2)} ${unit ?? ""}`.trim();

/** One-line geometry summary for a block, e.g. "4.20 ha · 2.5 m rows · 16,800 m". */
export function blockGeometrySummary(block: SprayBlockGeometry): string {
  const bits: string[] = [];
  bits.push(fmtHa(block.grossAreaHa));
  if (block.rowSpacingMetres != null) bits.push(`${fmtNum(block.rowSpacingMetres, 2)} m rows`);
  if (block.canonicalRowLengthMetres != null) bits.push(`${fmtMetres(block.canonicalRowLengthMetres)} of row`);
  return bits.join(" · ");
}

/** Treated proportion of gross area, as a percentage. */
export function treatedProportionPct(gross: number | null, treated: number | null): number | null {
  if (gross == null || treated == null || gross <= 0) return null;
  return (treated / gross) * 100;
}

/* --------------------------------------------------------- diagnostics UI */

export type DiagnosticGroup = "Geometry" | "Carrier" | "Products" | "Chemical information" | "Other";

const GROUP_BY_CODE: Record<string, DiagnosticGroup> = {
  no_blocks_selected: "Geometry",
  missing_gross_area: "Geometry",
  missing_row_spacing: "Geometry",
  missing_row_length: "Geometry",
  missing_treated_area: "Geometry",
  missing_band_width: "Geometry",
  incomplete_block_geometry: "Geometry",
  mixed_row_spacing: "Geometry",
  missing_carrier_basis: "Carrier",
  missing_carrier_rate: "Carrier",
  incomplete_geometry_for_carrier: "Carrier",
  cannot_derive_litres_per_hectare: "Carrier",
  spreader_no_carrier: "Carrier",
  no_carrier_for_tanks: "Carrier",
  missing_tank_capacity: "Carrier",
  missing_rate: "Products",
  missing_rate_basis: "Products",
  no_products: "Products",
  per_100m_needs_row_length: "Products",
  per_100l_needs_carrier: "Products",
  incomplete_geometry_for_product: "Products",
  unlinked_product: "Chemical information",
  rate_above_label: "Chemical information",
  rate_below_label: "Chemical information",
};

export function diagnosticGroup(code: string): DiagnosticGroup {
  return GROUP_BY_CODE[code] ?? "Other";
}

export function groupDiagnostics(diagnostics: SprayDiagnostic[]): {
  group: DiagnosticGroup;
  items: SprayDiagnostic[];
}[] {
  const order: DiagnosticGroup[] = ["Geometry", "Carrier", "Products", "Chemical information", "Other"];
  const map = new Map<DiagnosticGroup, SprayDiagnostic[]>();
  for (const d of diagnostics) {
    const g = diagnosticGroup(d.code);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(d);
  }
  return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
}
