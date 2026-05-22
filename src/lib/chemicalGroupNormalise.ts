// UI-level normalisation for chemical group names.
// Keeps the original display value but provides a canonical key for
// filtering, sorting, search and grouping. Resistance-group codes like
// "Group M1", "Group 3", "DMI" are preserved exactly.

const EXPLICIT_ALIASES: Record<string, string> = {
  oil: "oil",
  oils: "oil",
  "mineral oil": "oil",
  "mineral oils": "oil",
  "horticultural oil": "oil",
  "horticultural oils": "oil",
  "petroleum oil": "oil",
  "petroleum oils": "oil",
  fungicide: "fungicide",
  fungicides: "fungicide",
  herbicide: "herbicide",
  herbicides: "herbicide",
  insecticide: "insecticide",
  insecticides: "insecticide",
  miticide: "miticide",
  miticides: "miticide",
  acaricide: "miticide",
  acaricides: "miticide",
  "bio-stimulant": "biostimulant",
  "bio stimulant": "biostimulant",
  biostimulant: "biostimulant",
  "bio-stimulants": "biostimulant",
  "bio stimulants": "biostimulant",
  biostimulants: "biostimulant",
  nutrient: "nutrient",
  nutrients: "nutrient",
  nutrition: "nutrient",
  fertiliser: "fertiliser",
  fertilisers: "fertiliser",
  fertilizer: "fertiliser",
  fertilizers: "fertiliser",
  wetter: "wetter",
  wetters: "wetter",
  "wetting agent": "wetter",
  "wetting agents": "wetter",
  adjuvant: "wetter",
  adjuvants: "wetter",
  surfactant: "wetter",
  surfactants: "wetter",
};

// Looks like a resistance-group code (e.g. "Group 3", "Group M1", "M01",
// "DMI", "QoI"). Preserve exactly.
function isResistanceGroupCode(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^group\s*[a-z]?\d+[a-z]?$/i.test(v)) return true;
  if (/^[a-z]?\d+[a-z]?$/i.test(v) && v.length <= 4) return true;
  if (/^(dmi|qoi|sdhi|moa|frac|hrac|irac)$/i.test(v)) return true;
  return false;
}

export function normaliseChemicalGroup(group: string | null | undefined): string {
  const raw = (group ?? "").trim();
  if (!raw) return "";
  if (isResistanceGroupCode(raw)) return raw.toLowerCase().replace(/\s+/g, " ");
  const lower = raw.toLowerCase().replace(/\s+/g, " ");
  if (EXPLICIT_ALIASES[lower]) return EXPLICIT_ALIASES[lower];
  // Generic singular/plural fallback for simple cases ending in "s".
  if (lower.length > 3 && lower.endsWith("s")) {
    const singular = lower.slice(0, -1);
    if (EXPLICIT_ALIASES[singular]) return EXPLICIT_ALIASES[singular];
  }
  return lower;
}

/**
 * Returns a display label for a normalised group key by picking the most
 * common original value seen on the existing records. Falls back to a
 * capitalised version of the key.
 */
export function buildGroupOptions(values: Array<string | null | undefined>): Array<{ key: string; label: string }> {
  const counts = new Map<string, Map<string, number>>();
  for (const v of values) {
    const raw = (v ?? "").trim();
    if (!raw) continue;
    const key = normaliseChemicalGroup(raw);
    if (!key) continue;
    if (!counts.has(key)) counts.set(key, new Map());
    const inner = counts.get(key)!;
    inner.set(raw, (inner.get(raw) ?? 0) + 1);
  }
  const out: Array<{ key: string; label: string }> = [];
  for (const [key, inner] of counts) {
    let best = "";
    let bestN = -1;
    for (const [label, n] of inner) {
      if (n > bestN) {
        best = label;
        bestN = n;
      }
    }
    out.push({ key, label: best || key });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
