/** Density uses the existing planting's allocated physical hectares, never
 * the whole mixed-variety block or an average of individual densities. */
export function yieldTonnesPerHa(tonnes: number | null, areaHa: number | null): number | null {
  if (tonnes == null || !Number.isFinite(tonnes) || areaHa == null || !Number.isFinite(areaHa) || areaHa <= 0) return null;
  return tonnes / areaHa;
}

/** Partial totals remain visible, but density requires complete yield/area
 * coverage so missing figures cannot silently dilute the variety's yield. */
export function varietyTonnesPerHa(lines: { tonnes: number | null; areaHa: number | null }[]): number | null {
  if (!lines.length || lines.some((line) => yieldTonnesPerHa(line.tonnes, line.areaHa) == null)) return null;
  return yieldTonnesPerHa(
    lines.reduce((sum, line) => sum + (line.tonnes ?? 0), 0),
    lines.reduce((sum, line) => sum + (line.areaHa ?? 0), 0),
  );
}