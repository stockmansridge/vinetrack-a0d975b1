// VineTrack vineyard-country contract (shared with Rork iOS/Android).
//
// The vineyard country picker offers a fixed set of 25 countries. Every
// platform normalises those to the same ISO-2 code, so a chemical looked up on
// iOS and the same chemical looked up in the portal resolve to one
// jurisdiction. This module is the single source of truth for the portal; do
// NOT maintain ad-hoc country lists elsewhere.
//
// Rules:
//  - A stored ISO-2 code from the supported set resolves unchanged.
//  - A supported display name resolves to its ISO-2 code.
//  - Contract-approved aliases (UK → GB, USA → US, Aotearoa → NZ, …) resolve.
//  - Anything else is UNRESOLVED. Never truncate an unknown string to two
//    letters — "Somewhere" must not become "SO".

export interface VineyardCountry {
  /** ISO-3166-1 alpha-2, uppercase. */
  code: string;
  /** Display name exactly as shown in the vineyard country picker. */
  name: string;
}

/** The 25 countries available in the VineTrack vineyard country picker. */
export const VINEYARD_COUNTRIES: VineyardCountry[] = [
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexico" },
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "FR", name: "France" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
  { code: "PT", name: "Portugal" },
  { code: "DE", name: "Germany" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "RO", name: "Romania" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "SI", name: "Slovenia" },
  { code: "GE", name: "Georgia" },
  { code: "ZA", name: "South Africa" },
  { code: "CL", name: "Chile" },
  { code: "AR", name: "Argentina" },
  { code: "UY", name: "Uruguay" },
];

/** ISO-2 → display name. */
export const VINEYARD_COUNTRY_NAME: Record<string, string> = Object.fromEntries(
  VINEYARD_COUNTRIES.map((c) => [c.code, c.name]),
);

/** Contract-approved aliases (lower-cased) → ISO-2. */
export const VINEYARD_COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  britain: "GB",
  "united kingdom of great britain and northern ireland": "GB",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  america: "US",
  "united states of america": "US",
  aus: "AU",
  aussie: "AU",
  commonwealth_of_australia: "AU",
  "commonwealth of australia": "AU",
  nzl: "NZ",
  aotearoa: "NZ",
  "aotearoa new zealand": "NZ",
  "republic of ireland": "IE",
  eire: "IE",
  deutschland: "DE",
  espana: "ES",
  "españa": "ES",
  italia: "IT",
  osterreich: "AT",
  "österreich": "AT",
  suisse: "CH",
  schweiz: "CH",
  hellas: "GR",
  magyarorszag: "HU",
  magyarország: "HU",
  romania: "RO",
  hrvatska: "HR",
  slovenija: "SI",
  sakartvelo: "GE",
  rsa: "ZA",
  "south africa (rsa)": "ZA",
  "republic of south africa": "ZA",
  "republica de chile": "CL",
  "argentine republic": "AR",
  "oriental republic of uruguay": "UY",
  "mexico (united mexican states)": "MX",
  "méxico": "MX",
};

const NAME_INDEX: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const c of VINEYARD_COUNTRIES) {
    out[c.name.toLowerCase()] = c.code;
    out[c.code.toLowerCase()] = c.code;
  }
  return out;
})();

const SUPPORTED_CODES = new Set(VINEYARD_COUNTRIES.map((c) => c.code));

/** True when the ISO-2 code is one of the supported vineyard countries. */
export function isSupportedVineyardCountry(code: unknown): boolean {
  return typeof code === "string" && SUPPORTED_CODES.has(code.trim().toUpperCase());
}

/**
 * Resolve any supported form (ISO-2, display name, approved alias) to ISO-2.
 * Returns undefined for genuinely unsupported values — never a guess.
 */
export function resolveVineyardCountry(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase().replace(/\s+/g, " ");
  return NAME_INDEX[lower] ?? VINEYARD_COUNTRY_ALIASES[lower] ?? undefined;
}
