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

/**
 * Reference canopy artwork, mirroring the iOS Spray Calculator: the image
 * changes with BOTH the canopy type and the canopy size.
 */
export const CANOPY_IMAGE: Record<CanopyType, Record<CanopySize, string>> = {
  vsp: {
    small: "/canopy/vsp-small.png",
    medium: "/canopy/vsp-medium.png",
    large: "/canopy/vsp-large.png",
    full: "/canopy/vsp-full.png",
  },
  sprawl: {
    small: "/canopy/sprawl-small.png",
    medium: "/canopy/sprawl-medium.png",
    large: "/canopy/sprawl-large.png",
    full: "/canopy/sprawl-full.png",
  },
};

export function canopyImage(
  type: CanopyType | null | undefined,
  size: CanopySize | null | undefined,
): string | null {
  if (!isType(type) || !isSize(size)) return null;
  return CANOPY_IMAGE[type][size];
}

/**
 * Help copy shared with iOS. Kept here so every surface explains the same
 * decision in the same words.
 */
export const SPRAY_HELP = {
  basis: {
    title: "Spray volume basis",
    body:
      "How you know your sprayer's water output.\n\n" +
      "L/ha — the sprayer is calibrated by area.\n" +
      "L/100 m of row — the sprayer is calibrated per 100 metres of row (the vineyard row-length workflow).\n" +
      "Manual — you already know the total water for this spray, for example a knapsack or a spot spray.",
  },
  canopyType: {
    title: "Canopy type",
    body:
      "The trellis form the vines are grown on.\n\n" +
      "VSP — shoots are positioned vertically between catch wires, giving a narrow upright canopy wall.\n" +
      "Sprawl — shoots are left to sprawl outwards, giving a wider, less structured canopy.\n\n" +
      "A sprawl canopy presents more leaf area at the larger sizes, so it needs more water to reach run-off.",
  },
  canopySize: {
    title: "Canopy size",
    body:
      "Roughly how big the canopy is right now, measured as height × width.\n\n" +
      "Small — up to about 0.5 m high.\n" +
      "Medium — up to about 1 m high.\n" +
      "Large — about 1.5 m high.\n" +
      "Full — a fully grown canopy, about 2 m high.\n\n" +
      "Pick the size that matches what you are about to spray, not what the block will look like later in the season.",
  },
  canopyDensity: {
    title: "Canopy density",
    body:
      "How much leaf there is within the canopy.\n\n" +
      "Low — you can see through the canopy; light gets to the fruit zone.\n" +
      "High — thick, closed canopy with little light penetration.\n\n" +
      "Density chooses where in the AWRI range the recommendation sits: low uses the low end, high uses the high end.",
  },
  recommendation: {
    title: "Recommended dilute (spray to run-off) volume",
    body:
      "The AWRI dilute volume for this canopy — the water needed to wet the canopy to the point of run-off, expressed in litres per 100 metres of row.\n\n" +
      "It is a reference, not an instruction. Most sprayers apply less water than this and concentrate the mix instead.\n\n" +
      "The per-hectare equivalent depends on your row spacing:\n" +
      "L/ha = L/100 m × 100 ÷ row spacing (m).",
  },
  concentrationFactor: {
    title: "Concentration factor",
    body:
      "How concentrated the spray mix is compared with a dilute (run-off) spray.\n\n" +
      "CF = dilute reference ÷ actual applied volume, never below 1.00.\n\n" +
      "Per-100 L label rates are multiplied by the concentration factor so the vines still receive the labelled dose per hectare. Rates written per hectare or per 100 m are already area-based and are never multiplied.",
  },
} as const;

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
