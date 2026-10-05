// Chemical Purchase / Inventory is the single purchasing and pricing authority.
// Edit Chemical describes the product only; it never writes purchase data.

/** Legacy Saved Chemical purchase/pricing keys an ordinary product edit must never send. */
export const LEGACY_PURCHASE_KEYS = [
  "purchase", "pack_size", "price_per_pack", "pack_unit",
] as const;

/**
 * Remove legacy purchase/pricing keys from a Saved Chemical write so an update
 * leaves the existing stored values untouched (omitted, never nulled).
 */
export function omitLegacyPurchaseFields<T extends Record<string, any>>(payload: T): T {
  const out: Record<string, any> = { ...payload };
  for (const k of LEGACY_PURCHASE_KEYS) delete out[k];
  return out as T;
}

export interface ContainerSuggestion { size: number | null; unit: string | null }

/**
 * New-purchase container default: latest real purchase container first, then
 * the legacy Saved Chemical pack size/unit as a backwards-compatible fallback.
 * Returns nulls when neither exists (the caller applies its normal default).
 */
export function suggestPurchaseContainer(
  latest: { containerSize: number | null; containerUnit: string | null } | null | undefined,
  legacy: { pack_size?: unknown; pack_unit?: unknown } | null | undefined,
): ContainerSuggestion {
  if (latest && latest.containerSize != null && latest.containerSize > 0 && latest.containerUnit) {
    return { size: latest.containerSize, unit: latest.containerUnit };
  }
  const s = Number(legacy?.pack_size);
  if (legacy?.pack_size != null && Number.isFinite(s) && s > 0) {
    return { size: s, unit: typeof legacy?.pack_unit === "string" ? legacy.pack_unit : null };
  }
  return { size: null, unit: null };
}
