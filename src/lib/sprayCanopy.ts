// Canopy → dilute/runoff spray-volume model.
//
// ONE table for the whole portal. The constants below are the AWRI-derived
// dilute (to run-off) water volumes the iOS Spray Calculator uses, expressed in
// litres per 100 metres of row. Low density selects the low end of the AWRI
// range, high density the high end. Nothing here is approximated, interpolated
// or re-derived from a published L/ha figure.
//
// This module holds NO application logic: it converts a canopy answer into a
// recommended dilute volume, and converts that recommendation to the block's
// real row spacing. The spray calculation engine
// (`src/lib/sprayCalculation.ts`) remains the single authority for totals,
// concentration factors and product quantities.

export type CanopyType = "vsp" | "sprawl";
export type CanopySize = "small" | "medium" | "large" | "full";
export type CanopyDensity = "low" | "high";

export const CANOPY_TYPES: CanopyType[] = ["vsp", "sprawl"];
export const CANOPY_SIZES: CanopySize[] = ["small", "medium", "large", "full"];
export const CANOPY_DENSITIES: CanopyDensity[] = ["low", "high"];

export const CANOPY_TYPE_LABEL: Record<CanopyType, string> = {
  vsp: "VSP (vertical shoot positioned)",
  sprawl: "Sprawl",
};

export const CANOPY_SIZE_LABEL: Record<CanopySize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  full: "Full",
};

export const CANOPY_DENSITY_LABEL: Record<CanopyDensity, string> = {
  low: "Low",
  high: "High",
};

/** Canopy dimension guidance, matching the iOS/AWRI category descriptions. */
export const CANOPY_SIZE_DESCRIPTION: Record<CanopyType, Record<CanopySize, string>> = {
  vsp: {
    small: "Up to 0.5 m high × 0.5 m wide",
    medium: "Up to 1 m high × 1 m wide",
    large: "Wires up — about 1.5 m high × 0.5 m wide",
    full: "Wires up — about 2 m high × 0.5 m wide",
  },
  sprawl: {
    small: "Up to 0.5 m high × 0.5 m wide",
    medium: "Up to 1 m high × 1 m wide",
    large: "Sprawling canopy, about 1.5 m high × 1 m wide",
    full: "Full sprawl, about 2 m high × 1.5 m wide",
  },
};

/**
 * AWRI dilute (to run-off) ranges, L/100 m of row.
 *
 *   VSP     small 10–20 · medium 20–40 · large 30–45 · full 45–75
 *   Sprawl  small 10–20 · medium 20–40 · large 45–60 · full 60–90
 */
export const CANOPY_DILUTE_RANGE_L_PER_100M: Record<
  CanopyType,
  Record<CanopySize, { low: number; high: number }>
> = {
  vsp: {
    small: { low: 10, high: 20 },
    medium: { low: 20, high: 40 },
    large: { low: 30, high: 45 },
    full: { low: 45, high: 75 },
  },
  sprawl: {
    small: { low: 10, high: 20 },
    medium: { low: 20, high: 40 },
    large: { low: 45, high: 60 },
    full: { low: 60, high: 90 },
  },
};

const isType = (v: unknown): v is CanopyType => CANOPY_TYPES.includes(v as CanopyType);
const isSize = (v: unknown): v is CanopySize => CANOPY_SIZES.includes(v as CanopySize);
const isDensity = (v: unknown): v is CanopyDensity =>
  CANOPY_DENSITIES.includes(v as CanopyDensity);

export function normaliseCanopyType(value: unknown): CanopyType | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("vsp") || raw.includes("vertical")) return "vsp";
  if (raw.startsWith("sprawl")) return "sprawl";
  return null;
}

export function normaliseCanopySize(value: unknown): CanopySize | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return isSize(raw) ? raw : null;
}

export function normaliseCanopyDensity(value: unknown): CanopyDensity | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return isDensity(raw) ? raw : null;
}

/** The AWRI range for a canopy type + size, or `null` when unanswered. */
export function canopyDiluteRange(
  type: CanopyType | null | undefined,
  size: CanopySize | null | undefined,
): { low: number; high: number } | null {
  if (!isType(type) || !isSize(size)) return null;
  return CANOPY_DILUTE_RANGE_L_PER_100M[type][size];
}

/**
 * Recommended dilute/run-off volume in L/100 m of row.
 * Low density → low end of the AWRI range. High density → high end.
 */
export function recommendedDiluteLitresPer100m(
  type: CanopyType | null | undefined,
  size: CanopySize | null | undefined,
  density: CanopyDensity | null | undefined,
): number | null {
  const range = canopyDiluteRange(type, size);
  if (!range || !isDensity(density)) return null;
  return density === "low" ? range.low : range.high;
}

/**
 * Convert any L/100 m of row into L/ha for a real row spacing:
 *
 *   L/ha = L/100 m × 100 ÷ row spacing (m)
 *
 * The vineyard's own row spacing is always used — published AWRI L/ha figures
 * assume 3 m rows and are reference values only.
 */
export function litresPerHectareFromPer100m(
  litresPer100m: number | null | undefined,
  rowSpacingMetres: number | null | undefined,
): number | null {
  const v = Number(litresPer100m);
  const s = Number(rowSpacingMetres);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(s) || s <= 0) return null;
  return (v * 100) / s;
}

/** Inverse of the above: L/100 m implied by an L/ha figure at a row spacing. */
export function litresPer100mFromPerHectare(
  litresPerHectare: number | null | undefined,
  rowSpacingMetres: number | null | undefined,
): number | null {
  const v = Number(litresPerHectare);
  const s = Number(rowSpacingMetres);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(s) || s <= 0) return null;
  return (v * s) / 100;
}

/** Recommended dilute volume expressed in L/ha for this block's row spacing. */
export function recommendedDiluteLitresPerHectare(
  type: CanopyType | null | undefined,
  size: CanopySize | null | undefined,
  density: CanopyDensity | null | undefined,
  rowSpacingMetres: number | null | undefined,
): number | null {
  return litresPerHectareFromPer100m(
    recommendedDiluteLitresPer100m(type, size, density),
    rowSpacingMetres,
  );
}
