// Stage 3C — Resistance Rules Engine: ruleset domain model.
//
// Direct port of the authoritative Rork implementation
// (`ios/VineTrack/App/Resistance/ResistanceRuleset.swift`, mirrored by
// `ResistanceRuleset.kt` on Android). Nothing in this file contains a published
// number — the numbers live in `resistanceRulesets.ts`, so a 2027 CropLife
// revision arrives as DATA, not as an engine rewrite.
//
// Every structural decision here is deliberate and must stay identical across
// the three platforms: a rotation that is compliant on the phone and exceeded
// in the portal destroys trust in both.

/* --------------------------------------------------- jurisdiction / crop */

export type ResistanceJurisdiction = "AU" | "NZ" | "unknown";

export const JURISDICTION_LABEL: Record<ResistanceJurisdiction, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  unknown: "Unknown",
};

/**
 * Resolved from the VINEYARD's stored country, never the browser locale — an
 * Australian operator can legitimately manage a New Zealand vineyard, and the
 * Australian maximum-use rules must not follow the browser across the Tasman.
 */
export function jurisdictionFromCountryCode(code: string | null | undefined): ResistanceJurisdiction {
  const trimmed = (code ?? "").trim().toUpperCase();
  if (!trimmed) return "unknown";
  if (["AU", "AUS", "AUSTRALIA"].includes(trimmed)) return "AU";
  if (["NZ", "NZL", "NEW ZEALAND", "AOTEAROA"].includes(trimmed)) return "NZ";
  return "unknown";
}

export type ResistanceCrop = "grape";

export type ResistanceDisease = "powdery_mildew" | "downy_mildew";
export const RESISTANCE_DISEASES: ResistanceDisease[] = ["powdery_mildew", "downy_mildew"];

export const DISEASE_LABEL: Record<ResistanceDisease, string> = {
  powdery_mildew: "Powdery Mildew",
  downy_mildew: "Downy Mildew",
};

/**
 * Disease attribution comes from what the operator declared the spray was FOR
 * (`spray_records.targets`, sql/193) — never from the chemistry in the tank.
 */
export function diseaseFromSprayTargetRaw(raw: string | null | undefined): ResistanceDisease | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  return trimmed === "powdery_mildew" || trimmed === "downy_mildew" ? trimmed : null;
}

/* ------------------------------------------------------------ group codes */

/**
 * FRAC renumbered several legacy "U" codes. CropLife still prints the legacy
 * code alongside the number ("Group 50 (U8)") so both must resolve to one key,
 * or a rotation can look compliant purely because two spellings never met.
 */
const GROUP_ALIASES: Record<string, string> = { U8: "50" };

/**
 * Codes from a NON-fungicide scheme are namespaced, never folded into the
 * fungicide numbering. HRAC Group 9 (glyphosate) and FRAC Group 9 are
 * different chemistry that happen to share a numeral; letting a herbicide
 * consume a fungicide's seasonal allowance — or break a consecutive run — is a
 * wrong answer in both directions.
 */
export const SCHEME_PREFIXED = ["HRAC", "IRAC"] as const;

export function normaliseGroupCode(raw: string | null | undefined): string | null {
  let text = (raw ?? "").trim().toUpperCase();
  if (!text) return null;
  let scheme: string | null = null;
  for (const prefix of ["FRAC", "GROUP", ...SCHEME_PREFIXED]) {
    if (text.startsWith(prefix)) {
      if ((SCHEME_PREFIXED as readonly string[]).includes(prefix)) scheme = prefix;
      text = text.slice(prefix.length).trim();
      break;
    }
  }
  text = text.replace(/^[:\-\s]+|[:\s]+$/g, "").trim();
  const open = text.indexOf("(");
  if (open >= 0) text = text.slice(0, open).trim();
  // Labels spell the same code several ways: "M 3", "M03", "M 03". Collapse
  // internal spacing and leading zeros so they are one group, not three.
  text = text.replace(/\s+/g, "");
  const parts = /^([A-Z]*)0*(\d+)$/.exec(text);
  if (parts) text = `${parts[1]}${parts[2]}`;
  if (!text) return null;
  if (scheme) return `${scheme}:${text}`;
  return GROUP_ALIASES[text] ?? text;
}

/** True when a code belongs to a scheme the fungicide strategies do not cover. */
export const isNonFungicideCode = (code: string): boolean =>
  (SCHEME_PREFIXED as readonly string[]).some((s) => code.startsWith(`${s}:`));


/** Numeric groups ascending, then alphanumeric codes ("U6") after them. */
export function groupCodeIsOrderedBefore(lhs: string, rhs: string): boolean {
  const l = /^\d+$/.test(lhs) ? Number(lhs) : null;
  const r = /^\d+$/.test(rhs) ? Number(rhs) : null;
  if (l != null && r != null) return l < r;
  if (l != null) return true;
  if (r != null) return false;
  return lhs < rhs;
}

const sortCodes = (codes: string[]): string[] =>
  [...codes].sort((a, b) => (groupCodeIsOrderedBefore(a, b) ? -1 : a === b ? 0 : 1));

/**
 * The set of activity groups carried by ONE product. A co-formulated product
 * with two actives has a signature of two codes: CropLife restricts Group 5+3
 * differently from Group 5 and Group 3, so the engine must know not just which
 * groups were applied but which arrived in the same product.
 */
export interface ResistanceGroupSignature {
  codes: string[];
}

export const signatureKey = (sig: ResistanceGroupSignature): string => sig.codes.join("+");
export const isCoformulation = (sig: ResistanceGroupSignature): boolean => sig.codes.length > 1;

export function groupSignature(...raw: (string | null | undefined)[]): ResistanceGroupSignature {
  return groupSignatureOf(raw);
}

export function groupSignatureOf(raw: (string | null | undefined)[]): ResistanceGroupSignature {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    const code = normaliseGroupCode(value);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return { codes: sortCodes(result) };
}

export const EMPTY_SIGNATURE: ResistanceGroupSignature = { codes: [] };

/* -------------------------------------------------------------- selectors */

export type ResistanceGroupSelector =
  | { kind: "containsGroup"; code: string }
  | { kind: "coformulation"; signature: ResistanceGroupSignature }
  | { kind: "anyCoformulation"; signatures: ResistanceGroupSignature[] }
  | { kind: "anyGroup"; codes: string[] };

export const containsGroup = (code: string): ResistanceGroupSelector => ({
  kind: "containsGroup",
  code,
});
export const coformulation = (signature: ResistanceGroupSignature): ResistanceGroupSelector => ({
  kind: "coformulation",
  signature,
});
export const anyCoformulation = (
  signatures: ResistanceGroupSignature[],
): ResistanceGroupSelector => ({ kind: "anyCoformulation", signatures });
export const anyGroup = (codes: string[]): ResistanceGroupSelector => ({ kind: "anyGroup", codes });

export function selectorDescribedGroups(selector: ResistanceGroupSelector): string[] {
  switch (selector.kind) {
    case "containsGroup":
      return [selector.code];
    case "coformulation":
      return selector.signature.codes;
    case "anyCoformulation": {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const sig of selector.signatures) {
        for (const code of sig.codes) {
          if (seen.has(code)) continue;
          seen.add(code);
          result.push(code);
        }
      }
      return sortCodes(result);
    }
    case "anyGroup":
      return selector.codes;
  }
}

export function selectorFingerprint(selector: ResistanceGroupSelector): string {
  switch (selector.kind) {
    case "containsGroup":
      return `contains:${selector.code}`;
    case "coformulation":
      return `coformulation:${signatureKey(selector.signature)}`;
    case "anyCoformulation":
      return (
        "anyCoformulation:" +
        selector.signatures.map(signatureKey).sort().join(",")
      );
    case "anyGroup":
      return "anyGroup:" + [...selector.codes].sort().join(",");
  }
}

/* ------------------------------------------------------------ rule kinds */

export type ResistanceRuleKind =
  | { kind: "maxConsecutiveApplications"; limit: number }
  | { kind: "noConsecutiveApplications" }
  | { kind: "maxApplicationsPerSeason"; limit: number }
  | { kind: "maxApplicationsPerCrop"; limit: number }
  | { kind: "maxFractionOfDiseaseSprays"; numerator: number; denominator: number }
  | { kind: "maxOneInEveryNSprays"; window: number }
  | { kind: "minInterveningDifferentGroupApplications"; count: number }
  | { kind: "mixtureRequired" }
  | { kind: "mixtureRequiredWhenConsecutive" }
  | { kind: "maxSoloApplicationsPerSeason"; limit: number }
  | { kind: "notLastSprayOfSeason" }
  | { kind: "maxFromTotalSprayCountTable"; columnKey: string }
  | { kind: "preventativeApplicationGuidance" };

export function ruleKindFingerprint(kind: ResistanceRuleKind): string {
  switch (kind.kind) {
    case "maxConsecutiveApplications":
      return `maxConsecutive:${kind.limit}`;
    case "noConsecutiveApplications":
      return "noConsecutive";
    case "maxApplicationsPerSeason":
      return `maxPerSeason:${kind.limit}`;
    case "maxApplicationsPerCrop":
      return `maxPerCrop:${kind.limit}`;
    case "maxFractionOfDiseaseSprays":
      return `maxFraction:${kind.numerator}/${kind.denominator}`;
    case "maxOneInEveryNSprays":
      return `oneInEvery:${kind.window}`;
    case "minInterveningDifferentGroupApplications":
      return `minIntervening:${kind.count}`;
    case "mixtureRequired":
      return "mixtureRequired";
    case "mixtureRequiredWhenConsecutive":
      return "mixtureRequiredWhenConsecutive";
    case "maxSoloApplicationsPerSeason":
      return `maxSoloPerSeason:${kind.limit}`;
    case "notLastSprayOfSeason":
      return "notLastSprayOfSeason";
    case "maxFromTotalSprayCountTable":
      return `maxFromTable:${kind.columnKey}`;
    case "preventativeApplicationGuidance":
      return "preventativeGuidance";
  }
}

/* ----------------------------------------------------------------- rules */

export interface ResistanceRule {
  /** Stable across rewording — it ends up in stored plans and warnings. */
  id: string;
  selector: ResistanceGroupSelector;
  kind: ResistanceRuleKind;
  /** Which published clause this came from, e.g. "Guideline 4". */
  sourceReference: string;
  /** The published sentence, verbatim, so a warning can always be justified. */
  sourceText: string;
  /** Whether the sequence continues across the season boundary. */
  crossSeason: boolean;
}

export function makeRule(input: Omit<ResistanceRule, "crossSeason"> & { crossSeason?: boolean }): ResistanceRule {
  return { crossSeason: false, ...input };
}

export const ruleFingerprint = (rule: ResistanceRule): string =>
  `${rule.id}|${selectorFingerprint(rule.selector)}|${ruleKindFingerprint(rule.kind)}|crossSeason=${rule.crossSeason}|${rule.sourceReference}`;

/* ------------------------------------------------------- max-use table */

export interface ResistanceMaxUseColumn {
  key: string;
  displayName: string;
  selector: ResistanceGroupSelector;
}

export interface ResistanceMaxUseRow {
  totalSprays: number;
  /** The open-ended final row (CropLife's `9+`). */
  isOrMore: boolean;
  maxByColumn: Record<string, number>;
}

export interface ResistanceMaxUseTable {
  id: string;
  rowKeyLabel: string;
  columns: ResistanceMaxUseColumn[];
  rows: ResistanceMaxUseRow[];
  sourceReference: string;
  notes: string[];
}

export const maxUseColumn = (
  table: ResistanceMaxUseTable,
  key: string,
): ResistanceMaxUseColumn | null => table.columns.find((c) => c.key === key) ?? null;

/** The ceiling for `columnKey` at `totalSprays`; null when the table is silent. */
export function maxUseFor(
  table: ResistanceMaxUseTable,
  columnKey: string,
  totalSprays: number,
): number | null {
  if (totalSprays <= 0) return null;
  const exact = table.rows.find((r) => !r.isOrMore && r.totalSprays === totalSprays);
  if (exact) return exact.maxByColumn[columnKey] ?? null;
  const openEnded = table.rows.find((r) => r.isOrMore);
  if (openEnded && totalSprays >= openEnded.totalSprays) {
    return openEnded.maxByColumn[columnKey] ?? null;
  }
  const smallest = table.rows.reduce<ResistanceMaxUseRow | null>(
    (acc, r) => (acc == null || r.totalSprays < acc.totalSprays ? r : acc),
    null,
  );
  if (smallest && totalSprays < smallest.totalSprays) return smallest.maxByColumn[columnKey] ?? null;
  return null;
}

export function maxUseTableFingerprint(table: ResistanceMaxUseTable): string {
  let text = `${table.id}|${table.rowKeyLabel}|`;
  for (const column of [...table.columns].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    text += `${column.key}=${selectorFingerprint(column.selector)};`;
  }
  text += "|";
  for (const row of [...table.rows].sort((a, b) => a.totalSprays - b.totalSprays)) {
    text += `${row.totalSprays}${row.isOrMore ? "+" : ""}:`;
    for (const key of Object.keys(row.maxByColumn).sort()) {
      text += `${key}=${row.maxByColumn[key]},`;
    }
    text += ";";
  }
  return text;
}

/* --------------------------------------------------------------- ruleset */

export interface ResistanceGroupListing {
  displayName: string;
  signature: ResistanceGroupSignature;
  modeOfActionName: string;
}

export interface ResistanceRuleset {
  id: string;
  jurisdiction: ResistanceJurisdiction;
  crop: ResistanceCrop;
  disease: ResistanceDisease;
  strategyName: string;
  sourceOrganisation: string;
  sourceReference: string;
  /** ISO date the published advice is valid as at, e.g. "2026-07-22". */
  validFrom: string;
  validFromEpochMs: number;
  rulesetVersion: string;
  rules: ResistanceRule[];
  groups: ResistanceGroupListing[];
  maxUseTable: ResistanceMaxUseTable | null;
  supersededBy: string | null;
  supersedes: string | null;
  sourceNotes: string[];
}

export const isSuperseded = (ruleset: ResistanceRuleset): boolean => ruleset.supersededBy != null;

/**
 * 64-bit FNV-1a over UTF-16 code units, lower-case hex — identical arithmetic
 * to the Swift and Kotlin implementations so the three encodings of the same
 * strategy can be asserted equal.
 */
export function fnv1a64Hex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Order-independent digest of every rule, threshold and table cell. */
export function rulesetFingerprint(ruleset: ResistanceRuleset): string {
  let canonical = "";
  canonical += ruleset.id + "\n";
  canonical += ruleset.jurisdiction + "\n";
  canonical += ruleset.crop + "\n";
  canonical += ruleset.disease + "\n";
  canonical += ruleset.strategyName + "\n";
  canonical += ruleset.sourceOrganisation + "\n";
  canonical += ruleset.validFrom + "\n";
  canonical += ruleset.rulesetVersion + "\n";
  canonical += (ruleset.supersededBy ?? "-") + "\n";
  canonical += (ruleset.supersedes ?? "-") + "\n";
  for (const entry of ruleset.groups
    .map((g) => `${g.displayName}=${signatureKey(g.signature)}`)
    .sort()) {
    canonical += entry + "\n";
  }
  for (const entry of ruleset.rules.map(ruleFingerprint).sort()) {
    canonical += entry + "\n";
  }
  canonical += (ruleset.maxUseTable ? maxUseTableFingerprint(ruleset.maxUseTable) : "-") + "\n";
  return fnv1a64Hex(canonical);
}

/* -------------------------------------------------------------- registry */

export interface ResistanceRulesetRegistry {
  rulesets: ResistanceRuleset[];
}

/** The current (non-superseded) ruleset for this jurisdiction/crop/disease. */
export function currentRuleset(
  registry: ResistanceRulesetRegistry,
  jurisdiction: ResistanceJurisdiction,
  crop: ResistanceCrop,
  disease: ResistanceDisease,
): ResistanceRuleset | null {
  return registry.rulesets
    .filter(
      (r) =>
        r.jurisdiction === jurisdiction &&
        r.crop === crop &&
        r.disease === disease &&
        !isSuperseded(r),
    )
    .reduce<ResistanceRuleset | null>(
      (best, r) => (best == null || best.validFromEpochMs <= r.validFromEpochMs ? r : best),
      null,
    );
}

/** The ruleset in force at `atEpochMs`, for explaining a historical spray. */
export function rulesetInForce(
  registry: ResistanceRulesetRegistry,
  jurisdiction: ResistanceJurisdiction,
  crop: ResistanceCrop,
  disease: ResistanceDisease,
  atEpochMs: number,
): ResistanceRuleset | null {
  return registry.rulesets
    .filter(
      (r) =>
        r.jurisdiction === jurisdiction &&
        r.crop === crop &&
        r.disease === disease &&
        r.validFromEpochMs <= atEpochMs,
    )
    .reduce<ResistanceRuleset | null>(
      (best, r) => (best == null || best.validFromEpochMs <= r.validFromEpochMs ? r : best),
      null,
    );
}

export const rulesetById = (
  registry: ResistanceRulesetRegistry,
  id: string,
): ResistanceRuleset | null => registry.rulesets.find((r) => r.id === id) ?? null;
