// Standard product categories for vineyard chemicals/products.
// Stored on saved_chemicals.use to keep schema unchanged.
export const PRODUCT_CATEGORIES = [
  "Fungicide",
  "Herbicide",
  "Insecticide",
  "Fertiliser",
  "Bio-stimulant",
  "Wetting agent / adjuvant",
  "Other",
] as const;

export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

// Match an existing free-text "use" value to a known category, case-insensitively.
export function matchCategory(value?: string | null): ProductCategory | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  for (const c of PRODUCT_CATEGORIES) {
    if (c.toLowerCase() === v) return c;
  }
  // Loose contains-match for legacy entries like "fungicide (DMI)".
  for (const c of PRODUCT_CATEGORIES) {
    if (v.includes(c.toLowerCase().split(" ")[0])) return c;
  }
  return null;
}

// --- Restrictions composition (WHP days, REI hours, free notes) ---
// Schema has a single `restrictions` text column. We round-trip a small
// structured prefix so users can edit WHP/REI as separate inputs without a
// migration.
//   "WHP: 14 days. REI: 12 hours. <free text>"
export interface ParsedRestrictions {
  whpDays: string;
  reiHours: string;
  rest: string;
}

export function parseRestrictions(raw?: string | null): ParsedRestrictions {
  const out: ParsedRestrictions = { whpDays: "", reiHours: "", rest: "" };
  if (!raw) return out;
  let text = String(raw);
  const whp = text.match(/WHP:\s*(\d+(?:\.\d+)?)\s*day(?:s)?\.?\s*/i);
  if (whp) {
    out.whpDays = whp[1];
    text = text.replace(whp[0], "");
  }
  const rei = text.match(/REI:\s*(\d+(?:\.\d+)?)\s*hour(?:s)?\.?\s*/i);
  if (rei) {
    out.reiHours = rei[1];
    text = text.replace(rei[0], "");
  }
  out.rest = text.trim();
  return out;
}

export function composeRestrictions(p: ParsedRestrictions): string {
  const parts: string[] = [];
  if (p.whpDays.trim()) parts.push(`WHP: ${p.whpDays.trim()} days.`);
  if (p.reiHours.trim()) parts.push(`REI: ${p.reiHours.trim()} hours.`);
  const rest = p.rest.trim();
  if (rest) parts.push(rest);
  return parts.join(" ");
}
