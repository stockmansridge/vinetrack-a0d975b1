// VSP water-rate calculator. Mirrors the iOS implementation.
// Matrix values in L/100m of row.
export const VSP_CANOPY_SIZES = [
  { value: "Small", label: "Small — up to 0.5m × 0.5m" },
  { value: "Medium", label: "Medium — up to 1m × 1m" },
  { value: "Large", label: "Large — Wires Up - 1.5m × 0.5m" },
  { value: "Full", label: "Full — Wires Up - 2m × 0.5m" },
] as const;

export const VSP_DENSITIES = [
  { value: "Low", label: "Low" },
  { value: "High", label: "High" },
] as const;

export const VSP_MATRIX: Record<string, Record<string, number>> = {
  Small: { Low: 10, High: 20 },
  Medium: { Low: 20, High: 40 },
  Large: { Low: 30, High: 45 },
  Full: { Low: 45, High: 75 },
};

export function vspLitresPer100m(size?: string | null, density?: string | null): number | null {
  if (!size || !density) return null;
  return VSP_MATRIX[size]?.[density] ?? null;
}

export function vspLitresPerHa(
  size?: string | null,
  density?: string | null,
  rowSpacingMetres?: number | null,
): number | null {
  const per100 = vspLitresPer100m(size, density);
  if (per100 == null) return null;
  if (!rowSpacingMetres || rowSpacingMetres <= 0) return 0;
  return (per100 * 100) / rowSpacingMetres;
}

export const GROWTH_STAGES: { code: string; label: string }[] = [
  { code: "EL1", label: "EL1 — Winter bud" },
  { code: "EL2", label: "EL2 — Bud scales opening" },
  { code: "EL3", label: "EL3 — Wooly Bud ± green showing" },
  { code: "EL4", label: "EL4 — Budburst; leaf tips visible" },
  { code: "EL7", label: "EL7 — First leaf separated from shoot tip" },
  { code: "EL9", label: "EL9 — 2 to 3 leaves separated; shoots 2-4 cm long" },
  { code: "EL11", label: "EL11 — 4 leaves separated" },
  { code: "EL12", label: "EL12 — 5 leaves separated; shoots about 10 cm long; inflorescence clear" },
  { code: "EL13", label: "EL13 — 6 leaves separated" },
  { code: "EL14", label: "EL14 — 7 leaves separated" },
  { code: "EL15", label: "EL15 — 8 leaves separated, shoot elongating rapidly; single flowers in compact groups" },
  { code: "EL16", label: "EL16 — 10 leaves separated" },
  { code: "EL17", label: "EL17 — 12 leaves separated; inflorescence well developed, single flowers separated" },
  { code: "EL18", label: "EL18 — 14 leaves separate and flower caps still in place, but cap colour fading from green" },
  { code: "EL19", label: "EL19 — About 16 leaves separated; beginning of flowering (first flower caps loosening)" },
  { code: "EL20", label: "EL20 — 10% caps off" },
  { code: "EL21", label: "EL21 — 30% caps off" },
  { code: "EL23", label: "EL23 — 17-20 leaves separated; 50% caps off (= flowering)" },
  { code: "EL25", label: "EL25 — 80% caps off" },
  { code: "EL26", label: "EL26 — Cap-fall complete" },
  { code: "EL27", label: "EL27 — Setting; young berries enlarging (>2 mm diam.), bunch at right angles to stem" },
  { code: "EL29", label: "EL29 — Berries pepper-corn size (4 mm diam.); bunches tending downwards" },
  { code: "EL31", label: "EL31 — Berries pea-size (7 mm diam.) (if bunches are tight)" },
  { code: "EL32", label: "EL32 — Beginning of bunch closure, berries touching (if bunches are tight)" },
  { code: "EL33", label: "EL33 — Berries still hard and green" },
  { code: "EL34", label: "EL34 — Berries begins to soft; Sugar starts increasing" },
  { code: "EL35", label: "EL35 — Berries begin to colour and enlarge" },
  { code: "EL36", label: "EL36 — Berries with intermediate sugar values" },
  { code: "EL37", label: "EL37 — Berries not quite ripe" },
  { code: "EL38", label: "EL38 — Berries harvest-ripe" },
  { code: "EL39", label: "EL39 — Berries over-ripe" },
  { code: "EL41", label: "EL41 — After harvest; cane maturation complete" },
  { code: "EL43", label: "EL43 — Begin of leaf fall" },
  { code: "EL47", label: "EL47 — End of leaf fall" },
];

export const GROWTH_STAGE_LABEL = new Map(GROWTH_STAGES.map((g) => [g.code, g.label]));
