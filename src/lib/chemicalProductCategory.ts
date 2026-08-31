// Shared product category vocabulary (release contract, parity with iOS/Android).
//
// `saved_chemicals.product_category` stores the RAW shared key
// ("fungicide", "growthRegulator", …). `saved_chemicals.use` keeps the human
// label as a compatibility PROJECTION only — never the authority.

export const PRODUCT_CATEGORIES = [
  { value: "fungicide", label: "Fungicide" },
  { value: "insecticide", label: "Insecticide" },
  { value: "herbicide", label: "Herbicide" },
  { value: "adjuvant", label: "Adjuvant" },
  { value: "growthRegulator", label: "Growth regulator" },
  { value: "foliarNutrient", label: "Foliar nutrient" },
  { value: "granularFertiliser", label: "Granular fertiliser" },
  { value: "liquidFertiliser", label: "Liquid fertiliser" },
  { value: "fertigation", label: "Fertigation product" },
  { value: "compost", label: "Compost" },
  { value: "manure", label: "Manure" },
  { value: "biofertiliser", label: "Biofertiliser" },
  { value: "compostTea", label: "Compost tea" },
  { value: "seaweed", label: "Seaweed" },
  { value: "fishHydrolysate", label: "Fish hydrolysate" },
  { value: "humicFulvic", label: "Humic / fulvic product" },
  { value: "soilAmendment", label: "Soil amendment" },
  { value: "other", label: "Other" },
] as const;

export type ProductCategoryKey = (typeof PRODUCT_CATEGORIES)[number]["value"];

/** Display label for a raw shared key, or null when unknown. */
export function productCategoryLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return PRODUCT_CATEGORIES.find((c) => c.value === key)?.label ?? null;
}

/**
 * Legacy free-text labels that a pre-release Portal/mobile row may hold in
 * `use`. Only exact (case-insensitive) wording is mapped — a near-word is
 * never guessed into a category.
 */
const LEGACY_LABEL_TO_KEY: Record<string, ProductCategoryKey> = {
  "fungicide": "fungicide",
  "insecticide": "insecticide",
  "herbicide": "herbicide",
  "adjuvant": "adjuvant",
  "wetting agent / adjuvant": "adjuvant",
  "growth regulator": "growthRegulator",
  "foliar nutrient": "foliarNutrient",
  "granular fertiliser": "granularFertiliser",
  "liquid fertiliser": "liquidFertiliser",
  "fertigation product": "fertigation",
  "compost": "compost",
  "manure": "manure",
  "biofertiliser": "biofertiliser",
  "compost tea": "compostTea",
  "seaweed": "seaweed",
  "fish hydrolysate": "fishHydrolysate",
  "humic / fulvic product": "humicFulvic",
  "soil amendment": "soilAmendment",
  "other": "other",
};

/**
 * Resolve a raw shared key OR a legacy display label into the shared key.
 * Unrecognised text returns null so the legacy value can still be displayed
 * verbatim until the operator deliberately saves a category.
 */
export function matchProductCategoryKey(
  value: string | null | undefined,
): ProductCategoryKey | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const exactKey = PRODUCT_CATEGORIES.find((c) => c.value === raw);
  if (exactKey) return exactKey.value;
  return LEGACY_LABEL_TO_KEY[raw.toLowerCase()] ?? null;
}

/**
 * What a customer sees: the shared category label when the raw key is known,
 * otherwise the legacy `use` text verbatim (never a guessed category).
 */
export function displayProductCategory(row: {
  product_category?: string | null;
  use?: string | null;
}): string | null {
  const key = matchProductCategoryKey(row.product_category);
  if (key) return productCategoryLabel(key);
  const legacyKey = matchProductCategoryKey(row.use);
  if (legacyKey) return productCategoryLabel(legacyKey);
  const legacy = String(row.use ?? "").trim();
  return legacy || null;
}
