// VineTrack activity group reference — table version 1.
//
// The authoritative FRAC / HRAC / IRAC classification for common viticulture
// actives. Used ONLY to:
//   * suggest a group when the operator has not supplied one, and
//   * detect a disagreement between what the operator/AI entered and what the
//     authoritative classification says (sql/194 `verification_conflicts`).
//
// It is never used to silently overwrite an operator's entry.
// Reference name must match the cross-platform DataSource name so portal rows
// are byte-compatible with iOS/Android:
export const ACTIVITY_GROUP_REFERENCE_NAME =
  "VineTrack activity group reference v2 (FRAC/HRAC/IRAC)";
export const ACTIVITY_GROUP_TABLE_VERSION = 2;

export interface ReferenceGroup {
  scheme: "frac" | "hrac" | "irac";
  code: string;
  common_name?: string;
}

const TABLE: Record<string, ReferenceGroup> = {
  // --- Fungicides (FRAC) ---
  tebuconazole: { scheme: "frac", code: "3", common_name: "DMI" },
  myclobutanil: { scheme: "frac", code: "3", common_name: "DMI" },
  penconazole: { scheme: "frac", code: "3", common_name: "DMI" },
  triadimenol: { scheme: "frac", code: "3", common_name: "DMI" },
  difenoconazole: { scheme: "frac", code: "3", common_name: "DMI" },
  metalaxyl: { scheme: "frac", code: "4", common_name: "Phenylamide" },
  "metalaxyl-m": { scheme: "frac", code: "4", common_name: "Phenylamide" },
  boscalid: { scheme: "frac", code: "7", common_name: "SDHI" },
  fluopyram: { scheme: "frac", code: "7", common_name: "SDHI" },
  fluxapyroxad: { scheme: "frac", code: "7", common_name: "SDHI" },
  azoxystrobin: { scheme: "frac", code: "11", common_name: "QoI / Strobilurin" },
  trifloxystrobin: { scheme: "frac", code: "11", common_name: "QoI / Strobilurin" },
  pyraclostrobin: { scheme: "frac", code: "11", common_name: "QoI / Strobilurin" },
  kresoxim: { scheme: "frac", code: "11", common_name: "QoI / Strobilurin" },
  "kresoxim-methyl": { scheme: "frac", code: "11", common_name: "QoI / Strobilurin" },
  fludioxonil: { scheme: "frac", code: "12", common_name: "Phenylpyrrole" },
  iprodione: { scheme: "frac", code: "2", common_name: "Dicarboximide" },
  cyprodinil: { scheme: "frac", code: "9", common_name: "Anilinopyrimidine" },
  pyrimethanil: { scheme: "frac", code: "9", common_name: "Anilinopyrimidine" },
  quinoxyfen: { scheme: "frac", code: "13" },
  metrafenone: { scheme: "frac", code: "U8" },
  "ametoctradin": { scheme: "frac", code: "45" },
  dimethomorph: { scheme: "frac", code: "40", common_name: "CAA" },
  mandipropamid: { scheme: "frac", code: "40", common_name: "CAA" },
  sulphur: { scheme: "frac", code: "M2", common_name: "Inorganic (multi-site)" },
  sulfur: { scheme: "frac", code: "M2", common_name: "Inorganic (multi-site)" },
  copper: { scheme: "frac", code: "M1", common_name: "Inorganic (multi-site)" },
  "copper hydroxide": { scheme: "frac", code: "M1", common_name: "Inorganic (multi-site)" },
  "copper oxychloride": { scheme: "frac", code: "M1", common_name: "Inorganic (multi-site)" },
  mancozeb: { scheme: "frac", code: "M3", common_name: "Dithiocarbamate" },
  captan: { scheme: "frac", code: "M4", common_name: "Phthalimide" },
  chlorothalonil: { scheme: "frac", code: "M5", common_name: "Chloronitrile" },
  "potassium bicarbonate": { scheme: "frac", code: "NC" },

  // --- Herbicides (HRAC) ---
  glyphosate: { scheme: "hrac", code: "9", common_name: "EPSP synthase inhibitor" },
  glufosinate: { scheme: "hrac", code: "10", common_name: "Glutamine synthetase inhibitor" },
  "glufosinate-ammonium": { scheme: "hrac", code: "10" },
  paraquat: { scheme: "hrac", code: "22", common_name: "PSI electron diverter" },
  oxyfluorfen: { scheme: "hrac", code: "14", common_name: "PPO inhibitor" },
  flumioxazin: { scheme: "hrac", code: "14", common_name: "PPO inhibitor" },
  simazine: { scheme: "hrac", code: "5", common_name: "PSII inhibitor" },
  "2,4-d": { scheme: "hrac", code: "4", common_name: "Synthetic auxin" },
  haloxyfop: { scheme: "hrac", code: "1", common_name: "ACCase inhibitor" },
  clethodim: { scheme: "hrac", code: "1", common_name: "ACCase inhibitor" },

  // --- Insecticides / miticides (IRAC) ---
  imidacloprid: { scheme: "irac", code: "4A", common_name: "Neonicotinoid" },
  spinetoram: { scheme: "irac", code: "5", common_name: "Spinosyn" },
  spinosad: { scheme: "irac", code: "5", common_name: "Spinosyn" },
  abamectin: { scheme: "irac", code: "6", common_name: "Avermectin" },
  methoxyfenozide: { scheme: "irac", code: "18" },
  chlorantraniliprole: { scheme: "irac", code: "28", common_name: "Diamide" },
  "bacillus thuringiensis": { scheme: "irac", code: "11A" },
  sulfoxaflor: { scheme: "irac", code: "4C" },
  buprofezin: { scheme: "irac", code: "16" },
};

const key = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ").replace(/[()]/g, "");

/** Authoritative classification for an active, or null when unknown. */
export function lookupActivityGroup(name: string | null | undefined): ReferenceGroup | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const k = key(raw);
  if (TABLE[k]) return TABLE[k];
  // Tolerate salt/ester suffixes, e.g. "Glyphosate (as IPA salt) 540 g/L".
  for (const candidate of Object.keys(TABLE)) {
    if (k.startsWith(`${candidate} `) || k.startsWith(`${candidate}-`)) return TABLE[candidate];
  }
  return null;
}


/* ------------------------------------------------------------ equivalence */
// Table version 2 — shared with the Rork clients.
//
// Historic HRAC letter codes and the older Australian letter codes name the
// SAME mode of action as the current numeric code. A stored legacy value is
// therefore EQUIVALENT, not a conflict. The original value is retained as
// evidence; only the DISPLAY uses the canonical code.
const EQUIVALENCE: Record<string, Record<string, string>> = {
  hrac: {
    // PPO inhibitors: global legacy "E", Australian legacy "G", current "14".
    E: "14",
    G: "14",
    "14": "14",
  },
};

const normCode = (code: string | null | undefined): string =>
  String(code ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, "");

/**
 * Canonical (current) code for a scheme + code pair. Unknown codes are
 * returned unchanged — nothing is invented.
 */
export function canonicalActivityGroupCode(
  scheme: string | null | undefined,
  code: string | null | undefined,
): string {
  const s = String(scheme ?? "").trim().toLowerCase();
  const c = normCode(code);
  return EQUIVALENCE[s]?.[c] ?? c;
}

/** True when two codes in the same scheme name the same mode of action. */
export function activityGroupCodesEquivalent(
  scheme: string | null | undefined,
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = canonicalActivityGroupCode(scheme, a);
  const cb = canonicalActivityGroupCode(scheme, b);
  return !!ca && ca === cb;
}
