// UI-level normalisation for manufacturer names.
// Keeps the saved display value but provides a canonical key so that
// "Nufarm", "Nufarm Australia", "Nufarm Pty Ltd" and "Nufarm Australia
// Limited" all collapse to the same group for filter/sort/search.

const SUFFIX_WORDS = [
  "pty", "ltd", "limited", "ltda", "inc", "incorporated",
  "llc", "llp", "plc", "gmbh", "ag", "sa", "nv", "bv", "kg",
  "corp", "corporation", "company", "co",
  "australia", "australasia", "nz", "newzealand", "asia", "pacific",
  "international", "intl", "global", "holdings", "group",
];

const SUFFIX_RE = new RegExp(
  `\\b(?:${SUFFIX_WORDS.join("|")})\\b`,
  "gi",
);

export function normaliseManufacturerName(value: string | null | undefined): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  let s = raw.toLowerCase();
  // Strip common corporate/region suffix words.
  s = s.replace(SUFFIX_RE, " ");
  // Collapse non-alphanumerics to single spaces.
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/\s+/g, " ");
  return s;
}

/**
 * Returns one entry per normalised manufacturer key, with the most common
 * original spelling as the label. Sorted alphabetically by label.
 */
export function buildManufacturerOptions(
  values: Array<string | null | undefined>,
): Array<{ key: string; label: string }> {
  const counts = new Map<string, Map<string, number>>();
  for (const v of values) {
    const raw = String(v ?? "").trim().replace(/\s+/g, " ");
    if (!raw) continue;
    const key = normaliseManufacturerName(raw);
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
      if (n > bestN) { best = label; bestN = n; }
    }
    out.push({ key, label: best || key });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  return out;
}
