/**
 * Default Vintage selection for report surfaces.
 *
 * Mirrors useVintageFilter's default: a report opens on the vineyard's
 * current Vintage when that Vintage has records; otherwise "All". Returns
 * null for "All vintages" / no default.
 */
export function defaultSeasonOption(
  options: number[],
  currentVintage: number | null | undefined,
): number | null {
  if (!options.length) return null;
  return currentVintage != null && options.includes(currentVintage) ? currentVintage : null;
}
