// SQL 194 Chemical Intelligence — portal WRITE model (Stage 2B).
//
// Canonical contract: docs/chemical-intelligence-json-contract.md
// The portal must write byte-compatible JSON with iOS/Android:
//   * snake_case keys inside every JSONB value
//   * absent optionals are OMITTED, never written as null
//   * numbers stay JSON numbers, timestamps ISO-8601 UTC
//   * derived columns (activity_groups, activity_group_scheme,
//     label_rate_bases, legacy projections) are recomputed on every write
//   * the RESOLVED verification status is persisted, never the claimed one
//
// This module is the ONLY place that builds sql/194 payloads. Components must
// not hand-build column objects.

import {
  ACTIVITY_GROUP_REFERENCE_NAME,
  ACTIVITY_GROUP_TABLE_VERSION,
  lookupActivityGroup,
} from "@/lib/activityGroupReference";

export const INTELLIGENCE_SCHEMA_VERSION = 1;
export { ACTIVITY_GROUP_TABLE_VERSION, ACTIVITY_GROUP_REFERENCE_NAME };

/* ----------------------------------------------------------- vocabularies */

export type DataSourceKind =
  | "official_register"
  | "manufacturer_label"
  | "authoritative_classification"
  | "viticulture_reference"
  | "ai_interpretation"
  | "manual_entry"
  | "legacy_record";

export const DATA_SOURCE_KINDS: DataSourceKind[] = [
  "official_register",
  "manufacturer_label",
  "authoritative_classification",
  "viticulture_reference",
  "ai_interpretation",
  "manual_entry",
  "legacy_record",
];

export const DATA_SOURCE_KIND_LABEL: Record<DataSourceKind, string> = {
  official_register: "Official register",
  manufacturer_label: "Manufacturer label",
  authoritative_classification: "Authoritative classification",
  viticulture_reference: "Viticulture reference",
  ai_interpretation: "AI interpretation",
  manual_entry: "Manual entry",
  legacy_record: "Legacy record",
};

/** Only these kinds can underwrite a promotion (contract §5.3). */
export const AUTHORITATIVE_SOURCE_KINDS: DataSourceKind[] = [
  "official_register",
  "manufacturer_label",
  "authoritative_classification",
];

export const isAuthoritativeSource = (kind: DataSourceKind | undefined | null): boolean =>
  !!kind && AUTHORITATIVE_SOURCE_KINDS.includes(kind);

export const isSelfReportedSource = (kind: DataSourceKind | undefined | null): boolean =>
  kind === "manual_entry" || kind === "legacy_record";

export type WriteScheme = "frac" | "hrac" | "irac" | "not_applicable";
export const WRITE_SCHEMES: WriteScheme[] = ["frac", "hrac", "irac", "not_applicable"];
export const WRITE_SCHEME_LABEL: Record<WriteScheme, string> = {
  frac: "FRAC",
  hrac: "HRAC",
  irac: "IRAC",
  not_applicable: "Not applicable",
};

export type RegistrationScheme = "apvma" | "acvm" | "nz_epa" | "other";
export const REGISTRATION_SCHEMES: RegistrationScheme[] = ["apvma", "acvm", "nz_epa", "other"];
export const REGISTRATION_SCHEME_LABEL: Record<RegistrationScheme, string> = {
  apvma: "APVMA (AU)",
  acvm: "ACVM (NZ)",
  nz_epa: "NZ EPA",
  other: "Other",
};

export type ConcentrationUnit = "g/L" | "g/kg" | "% w/w" | "% w/v" | "CFU/g";
export const CONCENTRATION_UNITS: ConcentrationUnit[] = [
  "g/L",
  "g/kg",
  "% w/w",
  "% w/v",
  "CFU/g",
];

export type LabelRateBasis =
  | "per_100_litres"
  | "per_hectare"
  | "range_per_100_litres"
  | "range_per_hectare"
  | "other";

export const LABEL_RATE_BASES: LabelRateBasis[] = [
  "per_hectare",
  "per_100_litres",
  "range_per_hectare",
  "range_per_100_litres",
  "other",
];

export const LABEL_RATE_BASIS_LABEL: Record<LabelRateBasis, string> = {
  per_hectare: "Per hectare",
  per_100_litres: "Per 100 L",
  range_per_hectare: "Range per hectare",
  range_per_100_litres: "Range per 100 L",
  other: "Other",
};

export const isRangeBasis = (basis: LabelRateBasis): boolean =>
  basis === "range_per_hectare" || basis === "range_per_100_litres";

export type SprayTarget =
  | "powdery_mildew"
  | "downy_mildew"
  | "botrytis"
  | "weeds"
  | "nutrition_biostimulant"
  | "other";

export type WriteVerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "needs_match"
  | "conflict";

/* ---------------------------------------------------------- wire objects */

export interface WriteActivityGroup {
  scheme: WriteScheme;
  code: string;
  common_name?: string;
}

/**
 * P4 cross-platform parity: every wire object carries an `extra` bag holding
 * keys the portal does not model. Decode captures them, encode writes them
 * back verbatim, so a Saved Chemical authored by iOS/Android never loses
 * fields just because this client is older than the writer.
 */
export type WireExtras = Record<string, unknown>;

export interface WriteActiveIngredient {
  name: string;
  concentration?: number;
  concentration_unit?: ConcentrationUnit;
  activity_group?: WriteActivityGroup;
  group_source?: DataSourceKind;
  identity_source?: DataSourceKind;
  extra?: WireExtras;
}

export interface WriteDataSource {
  kind: DataSourceKind;
  name: string;
  reference?: string;
  retrieved_at?: string;
  /** Original `kind` string when it is outside the known vocabulary. */
  raw_kind?: string;
  extra?: WireExtras;
}

export interface WriteConflict {
  field: string;
  active_ingredient_name?: string;
  extracted_value: string;
  authoritative_value: string;
  extracted_source: DataSourceKind;
  authoritative_source: DataSourceKind;
}

export interface WriteLabelRate {
  label: string;
  basis: LabelRateBasis;
  value?: number;
  min_value?: number;
  max_value?: number;
  unit: string;
  raw_text?: string;
  extra?: WireExtras;
}

export interface WriteRegisteredUse {
  crop: string;
  target_raw: string;
  target?: SprayTarget;
  rates: WriteLabelRate[];
  withholding_period_days?: number;
  re_entry_period_hours?: number;
  restrictions?: string;
  /**
   * LD-2 per-use provenance (`{ claim, rates, withholding_period, ... }`).
   * Preserved verbatim, including explicit nulls — a null here means
   * "unresolved" and must never be dropped or invented.
   */
  provenance?: Record<string, unknown>;
  extra?: WireExtras;
}


export interface WriteRegistration {
  country?: string;
  scheme?: RegistrationScheme;
  number?: string;
  registrant?: string;
  registered_product_name?: string;
  label_reference?: string;
  label_version?: string;
}

/**
 * The portal's editable Chemical Intelligence draft. The encoder flattens this
 * into sql/194 columns; the app-internal nested shape is never persisted.
 */
export interface ChemicalIntelligenceDraft {
  actives: WriteActiveIngredient[];
  registration: WriteRegistration;
  sources: WriteDataSource[];
  conflicts: WriteConflict[];
  unresolvedFields: string[];
  registeredUses: WriteRegisteredUse[];
  /** What the record currently claims. Never trusted — always re-resolved. */
  claimedStatus: WriteVerificationStatus;
  verifiedAt?: string | null;
}

export const emptyDraft = (): ChemicalIntelligenceDraft => ({
  actives: [],
  registration: {},
  sources: [],
  conflicts: [],
  unresolvedFields: [],
  registeredUses: [],
  claimedStatus: "unverified",
  verifiedAt: null,
});

/* ------------------------------------------------------------ normalisers */

const trimOrUndef = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? undefined : s;
};

import { resolveVineyardCountry } from "@/lib/vineyardCountries";

const finiteOrUndef = (v: unknown): number | undefined => {
  if (v === "" || v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const intOrUndef = (v: unknown): number | undefined => {
  const n = finiteOrUndef(v);
  return n == null ? undefined : Math.round(n);
};

/**
 * ISO-2 uppercase country, per the shared Rork jurisdiction contract.
 * Aliases (UK → GB, USA → US, …) are resolved before the bare two-letter path
 * so "UK" never survives as a pseudo ISO code.
 */
export function normaliseCountry(value: unknown): string | undefined {
  // The supported set is the shared VineTrack vineyard-country contract
  // (25 countries, identical on iOS/Android). Anything outside it — including
  // an unrecognised two-letter string — is unresolved, never guessed.
  return resolveVineyardCountry(value);
}


export function normaliseWriteScheme(value: unknown): WriteScheme {
  const s = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "frac") return "frac";
  if (s === "hrac") return "hrac";
  if (s === "irac") return "irac";
  return "not_applicable";
}

export function normaliseRegistrationScheme(value: unknown): RegistrationScheme | undefined {
  const s = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return undefined;
  if (s === "apvma") return "apvma";
  if (s === "acvm") return "acvm";
  if (s === "nz_epa" || s === "epa") return "nz_epa";
  return "other";
}

export function normaliseLabelRateBasis(value: unknown): LabelRateBasis {
  const s = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (LABEL_RATE_BASES as string[]).includes(s) ? (s as LabelRateBasis) : "other";
}

export function normaliseDataSourceKind(value: unknown): DataSourceKind {
  const s = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  // Defensive read rule: unknown kind degrades to ai_interpretation, never authoritative.
  return (DATA_SOURCE_KINDS as string[]).includes(s) ? (s as DataSourceKind) : "ai_interpretation";
}

export function normaliseConcentrationUnit(value: unknown): ConcentrationUnit | undefined {
  const raw = trimOrUndef(value);
  if (!raw) return undefined;
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  const map: Record<string, ConcentrationUnit> = {
    "g/l": "g/L",
    "gl": "g/L",
    "g/kg": "g/kg",
    "%w/w": "% w/w",
    "%w/v": "% w/v",
    "cfu/g": "CFU/g",
  };
  return map[compact];
}

/**
 * Canonical group-code normalisation (contract §4.2): uppercase, strip
 * GROUP/FRAC/HRAC/IRAC/MOA/CODE prefixes, drop a trailing parenthetical,
 * remove internal spaces.
 */
export function normaliseGroupCode(value: unknown): string {
  let s = String(value ?? "").trim();
  if (!s) return "";
  s = s.replace(/\(.*\)\s*$/, "").trim();
  s = s.replace(/^(group|frac|hrac|irac|moa|code)\b[\s:.-]*/i, "").trim();
  return s.toUpperCase().replace(/\s+/g, "");
}

/** A group only counts for resistance when it has a real scheme and a code. */
export const isResistanceRelevant = (g: WriteActivityGroup | undefined): boolean =>
  !!g && g.scheme !== "not_applicable" && !!g.code;

/* -------------------------------------------------------- canonical order */

function compareCode(a: string, b: string): number {
  const na = a.match(/^(\d+)(.*)$/);
  const nb = b.match(/^(\d+)(.*)$/);
  if (na && nb) {
    const diff = Number(na[1]) - Number(nb[1]);
    return diff !== 0 ? diff : na[2].localeCompare(nb[2]);
  }
  if (na) return -1; // numeric codes sort before letter-leading ones (3, 11, M5)
  if (nb) return 1;
  return a.localeCompare(b);
}

const SCHEME_ORDER: WriteScheme[] = ["frac", "hrac", "irac", "not_applicable"];

/**
 * Derived `activity_groups[]` — de-duplicated by scheme:code, canonically
 * sorted, resistance-relevant only. Entry order must not affect the result.
 */
export function canonicalActivityGroups(actives: WriteActiveIngredient[]): WriteActivityGroup[] {
  const seen = new Map<string, WriteActivityGroup>();
  for (const a of actives) {
    const g = a.activity_group;
    if (!isResistanceRelevant(g)) continue;
    const key = `${g!.scheme}:${g!.code}`;
    if (!seen.has(key)) seen.set(key, g!);
  }
  return Array.from(seen.values()).sort((x, y) => {
    const s = SCHEME_ORDER.indexOf(x.scheme) - SCHEME_ORDER.indexOf(y.scheme);
    return s !== 0 ? s : compareCode(x.code, y.code);
  });
}

export const canonicalGroupCodes = (actives: WriteActiveIngredient[]): string[] =>
  canonicalActivityGroups(actives).map((g) => g.code);

/* ------------------------------------------------------ legacy projections */

/** Mirrors iOS `%.4g` / Android `formatChemicalNumber`. */
export function formatChemicalNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  const s = n.toPrecision(4);
  return String(Number(s));
}

export function legacyActiveIngredientProjection(actives: WriteActiveIngredient[]): string {
  return actives
    .map((a) => {
      const parts = [a.name.trim()];
      if (a.concentration != null) {
        parts.push(
          `${formatChemicalNumber(a.concentration)}${a.concentration_unit ? ` ${a.concentration_unit}` : ""}`,
        );
      }
      return parts.filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" + ");
}

export const legacyChemicalGroupProjection = (actives: WriteActiveIngredient[]): string =>
  canonicalGroupCodes(actives).join(" + ");

/* --------------------------------------------------------- label rate bases */

export function deriveLabelRateBases(uses: WriteRegisteredUse[]): LabelRateBasis[] {
  const out: LabelRateBasis[] = [];
  for (const u of uses) {
    for (const r of u.rates ?? []) {
      if (!out.includes(r.basis)) out.push(r.basis); // first-seen order
    }
  }
  return out;
}

/* ----------------------------------------------------- conflict detection */

/**
 * Compare each active's entered group with the authoritative classification.
 * Never replaces the operator's value — it records the disagreement so the
 * resolver can force `conflict` (contract §4.4 / §15).
 */
export function detectActivityGroupConflicts(
  actives: WriteActiveIngredient[],
): WriteConflict[] {
  const conflicts: WriteConflict[] = [];
  for (const a of actives) {
    const g = a.activity_group;
    if (!isResistanceRelevant(g)) continue;
    const ref = lookupActivityGroup(a.name);
    if (!ref) continue;
    if (ref.scheme === g!.scheme && normaliseGroupCode(ref.code) === g!.code) continue;
    conflicts.push({
      field: "activity_group",
      active_ingredient_name: a.name,
      extracted_value: g!.code,
      authoritative_value: normaliseGroupCode(ref.code),
      extracted_source: a.group_source ?? "manual_entry",
      authoritative_source: "authoritative_classification",
    });
  }
  return conflicts;
}

/** Non-group conflicts survive; stale activity_group conflicts are recomputed. */
export function reconcileConflicts(draft: ChemicalIntelligenceDraft): WriteConflict[] {
  const others = draft.conflicts.filter((c) => c.field !== "activity_group");
  return [...others, ...detectActivityGroupConflicts(draft.actives)];
}

/* ---------------------------------------------------- verification resolver */

const hasRegistrationIdentity = (r: WriteRegistration): boolean =>
  !!(r.country && r.scheme && r.number);

/**
 * Contract §6.3 — persist the RESOLVED status. Confidence may be lowered on
 * write but never raised. AI confidence plays no part here.
 */
export function resolveVerificationStatus(draft: ChemicalIntelligenceDraft): WriteVerificationStatus {
  if (draft.conflicts.length > 0) return "conflict";

  const authoritativeSources = draft.sources.filter((s) => isAuthoritativeSource(s.kind));
  const authoritativeIdentity = draft.actives.some((a) => isAuthoritativeSource(a.identity_source));
  const authoritativeGroups =
    draft.actives.length > 0 &&
    draft.actives.every(
      (a) => isResistanceRelevant(a.activity_group) && isAuthoritativeSource(a.group_source),
    );

  const evidencedRegistration =
    hasRegistrationIdentity(draft.registration) &&
    (draft.sources.some((s) => !isSelfReportedSource(s.kind)) || authoritativeIdentity);

  if (
    draft.claimedStatus === "verified" &&
    authoritativeGroups &&
    evidencedRegistration &&
    authoritativeSources.length > 0 &&
    draft.unresolvedFields.length === 0
  ) {
    return "verified";
  }

  const anyAuthoritativeEvidence =
    authoritativeSources.length > 0 ||
    authoritativeIdentity ||
    draft.actives.some((a) => isAuthoritativeSource(a.group_source));

  if (anyAuthoritativeEvidence) return "partially_verified";
  if (draft.claimedStatus === "needs_match") return "needs_match";
  return "unverified";
}

/* ------------------------------------------------------------- has content */

export function hasStructuredIntelligence(draft: ChemicalIntelligenceDraft | null | undefined): boolean {
  if (!draft) return false;
  return (
    draft.actives.length > 0 ||
    draft.registeredUses.length > 0 ||
    hasRegistrationIdentity(draft.registration) ||
    !!draft.registration.registered_product_name ||
    !!draft.registration.number
  );
}

/* ----------------------------------------------------------------- encoder */

const clean = <T extends Record<string, unknown>>(obj: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out as T;
};

/** Deep structural copy that preserves explicit nulls (provenance semantics). */
const copyJson = <T>(v: T): T =>
  v == null || typeof v !== "object" ? v : (JSON.parse(JSON.stringify(v)) as T);

/** Keys of `o` that the portal does not model, captured verbatim. */
function extrasOf(o: Record<string, unknown>, known: string[]): WireExtras | undefined {
  const out: WireExtras = {};
  for (const [k, v] of Object.entries(o)) {
    if (known.includes(k)) continue;
    out[k] = copyJson(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Unknown extras are written first so modelled keys always win. */
const withExtras = (
  base: Record<string, unknown>,
  extra: WireExtras | undefined,
): Record<string, unknown> => (extra ? { ...copyJson(extra), ...base } : base);

function encodeActive(a: WriteActiveIngredient): Record<string, unknown> {
  const group = a.activity_group;
  return withExtras(
    clean({
      name: a.name.trim(),
      concentration: finiteOrUndef(a.concentration),
      concentration_unit: a.concentration_unit,
      activity_group: group
        ? clean({
            scheme: group.scheme,
            code: group.code,
            common_name: trimOrUndef(group.common_name),
          })
        : undefined,
      group_source: group ? a.group_source : undefined,
      identity_source: a.identity_source,
    }),
    a.extra,
  );
}

function encodeRate(r: WriteLabelRate): Record<string, unknown> {
  const base: Record<string, unknown> = {
    label: r.label ?? "",
    basis: r.basis,
    unit: r.unit ?? "",
  };
  // Ranges are never collapsed to an endpoint, and a single value is never
  // synthesised from a range. Whatever the writer stored round-trips as-is.
  const min = finiteOrUndef(r.min_value);
  const max = finiteOrUndef(r.max_value);
  if (min != null) base.min_value = min;
  if (max != null) base.max_value = max;
  const v = finiteOrUndef(r.value);
  if (v != null) base.value = v;
  // `basis: "other"` stays reference-only: its raw text is preserved and no
  // numeric value is invented for it.
  const raw = trimOrUndef(r.raw_text);
  if (raw) base.raw_text = raw;
  return withExtras(base, r.extra);
}

function encodeUse(u: WriteRegisteredUse): Record<string, unknown> {
  const out: Record<string, unknown> = {
    crop: (u.crop ?? "").trim(),
    target_raw: (u.target_raw ?? "").trim(),
    rates: (u.rates ?? []).map(encodeRate),
  };
  if (u.target) out.target = u.target;
  const whp = intOrUndef(u.withholding_period_days);
  if (whp != null) out.withholding_period_days = whp;
  const rei = intOrUndef(u.re_entry_period_hours);
  if (rei != null) out.re_entry_period_hours = rei;
  const restrictions = trimOrUndef(u.restrictions);
  if (restrictions) out.restrictions = restrictions;
  // Per-use provenance is evidence: copied verbatim, nulls included.
  if (u.provenance && typeof u.provenance === "object") {
    out.provenance = copyJson(u.provenance);
  }
  return withExtras(out, u.extra);
}

const encodeSource = (s: WriteDataSource): Record<string, unknown> =>
  withExtras(
    clean({
      // An unrecognised kind is preserved on the wire (it is still treated as
      // non-authoritative by every trust decision in this module).
      kind: trimOrUndef(s.raw_kind) ?? s.kind,
      name: (s.name ?? "").trim(),
      reference: trimOrUndef(s.reference),
      retrieved_at: trimOrUndef(s.retrieved_at),
    }),
    s.extra,
  );


export interface EncodedChemicalIntelligence {
  active_ingredients?: unknown[];
  activity_groups?: string[];
  activity_group_scheme?: WriteScheme;
  registration_country?: string;
  registration_scheme?: RegistrationScheme;
  registration_number?: string;
  registrant?: string;
  registered_product_name?: string;
  label_reference?: string;
  label_version?: string;
  verification_status?: WriteVerificationStatus;
  verification_sources?: unknown[];
  verification_conflicts?: unknown[];
  verification_unresolved_fields?: string[];
  verified_at?: string | null;
  registered_uses?: unknown[];
  label_rate_bases?: string[];
  activity_group_table_version?: number;
  intelligence_schema_version?: number;
  /** Derived legacy display projections (never inputs). */
  active_ingredient?: string;
  chemical_group?: string;
}

/**
 * THE canonical sql/194 encoder. Returns `{}` when there is nothing structured
 * to write, so an intelligence-unaware commercial edit can never blank a
 * previously verified record (contract §6.5).
 */
export function encodeChemicalIntelligenceForWrite(
  input: ChemicalIntelligenceDraft | null | undefined,
): EncodedChemicalIntelligence {
  if (!hasStructuredIntelligence(input)) return {};
  const draft: ChemicalIntelligenceDraft = {
    ...input!,
    actives: input!.actives.map((a) => ({ ...a, name: a.name.trim() })).filter((a) => a.name),
  };
  draft.conflicts = reconcileConflicts(draft);

  const status = resolveVerificationStatus(draft);
  const groups = canonicalActivityGroups(draft.actives);
  const reg = draft.registration;

  const encoded: EncodedChemicalIntelligence = {
    active_ingredients: draft.actives.map(encodeActive),
    activity_groups: groups.map((g) => g.code),
    verification_status: status,
    verification_sources: draft.sources.map(encodeSource),
    verification_conflicts: draft.conflicts.map((c) =>
      clean({
        field: c.field,
        active_ingredient_name: trimOrUndef(c.active_ingredient_name),
        extracted_value: c.extracted_value,
        authoritative_value: c.authoritative_value,
        extracted_source: c.extracted_source,
        authoritative_source: c.authoritative_source,
      }),
    ),
    verification_unresolved_fields: draft.unresolvedFields.slice(),
    registered_uses: draft.registeredUses.map(encodeUse),
    label_rate_bases: deriveLabelRateBases(draft.registeredUses),
    activity_group_table_version: ACTIVITY_GROUP_TABLE_VERSION,
    intelligence_schema_version: INTELLIGENCE_SCHEMA_VERSION,
    active_ingredient: legacyActiveIngredientProjection(draft.actives),
    chemical_group: legacyChemicalGroupProjection(draft.actives),
  };

  if (groups.length) encoded.activity_group_scheme = groups[0].scheme;
  const country = normaliseCountry(reg.country);
  if (country) encoded.registration_country = country;
  if (reg.scheme) encoded.registration_scheme = reg.scheme;
  const number = trimOrUndef(reg.number);
  if (number) encoded.registration_number = number;
  const registrant = trimOrUndef(reg.registrant);
  if (registrant) encoded.registrant = registrant;
  const productName = trimOrUndef(reg.registered_product_name);
  if (productName) encoded.registered_product_name = productName;
  const labelRef = trimOrUndef(reg.label_reference);
  if (labelRef) encoded.label_reference = labelRef;
  const labelVersion = trimOrUndef(reg.label_version);
  if (labelVersion) encoded.label_version = labelVersion;

  // verified_at is a timestamptz column (not JSON). Only stamp it when the
  // resolved status actually reflects verification work.
  if (status === "verified" || status === "partially_verified") {
    encoded.verified_at = trimOrUndef(draft.verifiedAt) ?? new Date().toISOString();
  }

  return encoded;
}

/** `"{COUNTRY}:{scheme|unknown}:{NUMBER}"`, e.g. "AU:apvma:62764". */
export function registrationIdentityKey(reg: WriteRegistration): string | null {
  const country = normaliseCountry(reg.country);
  const number = trimOrUndef(reg.number);
  if (!country || !number) return null;
  return `${country}:${reg.scheme ?? "unknown"}:${number.toUpperCase()}`;
}

/* ----------------------------------------------------------- rehydration */

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

function decodeGroup(value: unknown): WriteActivityGroup | undefined {
  const o = rec(value);
  const code = normaliseGroupCode(o.code ?? o.group ?? o.group_code);
  const scheme = normaliseWriteScheme(o.scheme);
  if (!code) return scheme === "not_applicable" && o.scheme ? { scheme, code: "" } : undefined;
  return clean({
    scheme,
    code,
    common_name: trimOrUndef(o.common_name ?? o.commonName),
  }) as WriteActivityGroup;
}

function decodeActive(value: unknown): WriteActiveIngredient | null {
  const o = rec(value);
  const name = trimOrUndef(o.name ?? o.active_ingredient);
  if (!name) return null;
  return clean({
    name,
    concentration: finiteOrUndef(o.concentration),
    concentration_unit: normaliseConcentrationUnit(o.concentration_unit ?? o.unit),
    activity_group: decodeGroup(o.activity_group ?? o.activityGroup),
    group_source: o.group_source ? normaliseDataSourceKind(o.group_source) : undefined,
    identity_source: o.identity_source ? normaliseDataSourceKind(o.identity_source) : undefined,
  }) as WriteActiveIngredient;
}

function decodeRate(value: unknown): WriteLabelRate {
  const o = rec(value);
  const basis = normaliseLabelRateBasis(o.basis);
  return clean({
    label: typeof o.label === "string" ? o.label : "",
    basis,
    value: finiteOrUndef(o.value),
    min_value: finiteOrUndef(o.min_value),
    max_value: finiteOrUndef(o.max_value),
    unit: trimOrUndef(o.unit) ?? "",
    raw_text: trimOrUndef(o.raw_text),
  }) as WriteLabelRate;
}

const TARGET_KEYWORDS: Array<[RegExp, SprayTarget]> = [
  [/powdery/i, "powdery_mildew"],
  [/downy/i, "downy_mildew"],
  [/botrytis|bunch rot/i, "botrytis"],
  [/weed|grass/i, "weeds"],
];

/** Conservative mapping — only when clean, otherwise leave unset (§4.5). */
export function deriveSprayTarget(targetRaw: string | null | undefined): SprayTarget | undefined {
  const raw = (targetRaw ?? "").trim();
  if (!raw) return undefined;
  for (const [re, target] of TARGET_KEYWORDS) if (re.test(raw)) return target;
  return undefined;
}

function decodeUse(value: unknown): WriteRegisteredUse | null {
  const o = rec(value);
  const crop = trimOrUndef(o.crop) ?? "";
  const targetRaw = trimOrUndef(o.target_raw ?? o.target) ?? "";
  const rates = asArray(o.rates).map(decodeRate);
  if (!crop && !targetRaw && rates.length === 0) return null;
  const target =
    typeof o.target === "string" && o.target.includes("_")
      ? (o.target as SprayTarget)
      : deriveSprayTarget(targetRaw);
  return clean({
    crop,
    target_raw: targetRaw,
    target,
    rates,
    withholding_period_days: intOrUndef(o.withholding_period_days),
    re_entry_period_hours: intOrUndef(o.re_entry_period_hours),
    restrictions: trimOrUndef(o.restrictions),
  }) as WriteRegisteredUse;
}

function decodeSource(value: unknown): WriteDataSource | null {
  const o = rec(value);
  const name = trimOrUndef(o.name ?? o.label);
  if (!name && !o.kind) return null;
  return clean({
    kind: normaliseDataSourceKind(o.kind),
    name: name ?? "",
    reference: trimOrUndef(o.reference ?? o.url),
    retrieved_at: trimOrUndef(o.retrieved_at ?? o.retrievedAt),
  }) as WriteDataSource;
}

function decodeConflict(value: unknown): WriteConflict | null {
  const o = rec(value);
  const field = trimOrUndef(o.field);
  if (!field) return null;
  return clean({
    field,
    active_ingredient_name: trimOrUndef(o.active_ingredient_name),
    extracted_value: trimOrUndef(o.extracted_value) ?? "",
    authoritative_value: trimOrUndef(o.authoritative_value) ?? "",
    extracted_source: normaliseDataSourceKind(o.extracted_source),
    authoritative_source: normaliseDataSourceKind(o.authoritative_source),
  }) as WriteConflict;
}

const STATUSES: WriteVerificationStatus[] = [
  "verified",
  "partially_verified",
  "unverified",
  "needs_match",
  "conflict",
];

/**
 * Fully rehydrate a live `saved_chemicals` row into the editable draft so an
 * edit never rebuilds structured data from legacy scalar projections (§21).
 */
export function draftFromRow(row: Record<string, any> | null | undefined): ChemicalIntelligenceDraft {
  const draft = emptyDraft();
  if (!row) return draft;

  draft.actives = asArray(row.active_ingredients)
    .map(decodeActive)
    .filter((a): a is WriteActiveIngredient => !!a);
  draft.registeredUses = asArray(row.registered_uses)
    .map(decodeUse)
    .filter((u): u is WriteRegisteredUse => !!u);
  draft.sources = asArray(row.verification_sources)
    .map(decodeSource)
    .filter((s): s is WriteDataSource => !!s);
  draft.conflicts = asArray(row.verification_conflicts)
    .map(decodeConflict)
    .filter((c): c is WriteConflict => !!c);
  draft.unresolvedFields = asArray(row.verification_unresolved_fields)
    .map((v) => trimOrUndef(v))
    .filter((v): v is string => !!v);
  draft.registration = clean({
    country: normaliseCountry(row.registration_country),
    scheme: normaliseRegistrationScheme(row.registration_scheme),
    number: trimOrUndef(row.registration_number),
    registrant: trimOrUndef(row.registrant),
    registered_product_name: trimOrUndef(row.registered_product_name),
    label_reference: trimOrUndef(row.label_reference),
    label_version: trimOrUndef(row.label_version),
  });

  const raw = String(row.verification_status ?? "").trim().toLowerCase();
  draft.claimedStatus = (STATUSES as string[]).includes(raw)
    ? (raw as WriteVerificationStatus)
    : hasStructuredIntelligence(draft)
      ? "unverified"
      : "needs_match";
  draft.verifiedAt = trimOrUndef(row.verified_at) ?? null;
  return draft;
}

/* --------------------------------------------------- edit trust re-resolve */

const criticalFingerprint = (d: ChemicalIntelligenceDraft) =>
  JSON.stringify({
    actives: d.actives.map((a) => [
      a.name.trim().toLowerCase(),
      a.concentration ?? null,
      a.concentration_unit ?? null,
      a.activity_group?.scheme ?? null,
      a.activity_group?.code ?? null,
    ]),
    registration: [
      normaliseCountry(d.registration.country) ?? null,
      d.registration.scheme ?? null,
      d.registration.number ?? null,
      d.registration.registered_product_name ?? null,
      d.registration.registrant ?? null,
    ],
    uses: d.registeredUses.map((u) => [
      u.crop,
      u.target_raw,
      u.withholding_period_days ?? null,
      u.re_entry_period_hours ?? null,
      (u.rates ?? []).map((r) => [r.basis, r.value ?? null, r.min_value ?? null, r.max_value ?? null, r.unit]),
    ]),
  });

/** True when identity/resistance-critical data changed between two drafts. */
export const criticalFieldsChanged = (
  before: ChemicalIntelligenceDraft,
  after: ChemicalIntelligenceDraft,
): boolean => criticalFingerprint(before) !== criticalFingerprint(after);

/**
 * Contract §22/§24 — a manual edit to a critical value invalidates the
 * evidence that certified the old value. Commercial-only edits leave the
 * chemistry (and therefore its verification) untouched.
 */
export function reconcileEditedDraft(
  before: ChemicalIntelligenceDraft,
  after: ChemicalIntelligenceDraft,
): ChemicalIntelligenceDraft {
  if (!criticalFieldsChanged(before, after)) return after;

  const beforeByName = new Map(before.actives.map((a) => [a.name.trim().toLowerCase(), a]));
  const actives = after.actives.map((a) => {
    const prior = beforeByName.get(a.name.trim().toLowerCase());
    const unchanged =
      prior &&
      (prior.concentration ?? null) === (a.concentration ?? null) &&
      (prior.concentration_unit ?? null) === (a.concentration_unit ?? null) &&
      (prior.activity_group?.scheme ?? null) === (a.activity_group?.scheme ?? null) &&
      (prior.activity_group?.code ?? null) === (a.activity_group?.code ?? null);
    if (unchanged) return a;
    return {
      ...a,
      group_source: a.activity_group ? "manual_entry" : undefined,
      identity_source: "manual_entry",
    } as WriteActiveIngredient;
  });

  // Evidence belongs to the value: authoritative citations can no longer
  // certify a hand-altered record.
  const sources = after.sources.filter((s) => !isAuthoritativeSource(s.kind));

  return {
    ...after,
    actives,
    sources,
    claimedStatus: after.claimedStatus === "verified" ? "unverified" : after.claimedStatus,
    verifiedAt: null,
  };
}

/* --------------------------------------------------- assisted entry helpers */

/**
 * Concentration units understood when splitting free-text actives. The pattern
 * is used as an alternation inside larger regexes — `g/L` and `CFU/g` contain a
 * slash, which is exactly why `/` is NOT a separator character.
 */
const CONC_UNIT_PATTERN = "g\\s*\\/\\s*L|g\\s*\\/\\s*kg|%\\s*w\\s*\\/\\s*w|%\\s*w\\s*\\/\\s*v|CFU\\s*\\/\\s*g";

/**
 * Separators that can join multiple actives in label / AI free text:
 * `+`, `;`, `,`, `&`, `·`, or the word "and". `/` is deliberately excluded so
 * concentration units (g/L, g/kg, CFU/g, % w/w) are never split.
 */
const ACTIVE_SEPARATOR = /\s*(?:[+;,&·]|\band\b)\s*/i;

const DIGIT_COMMA = "\u0000"; // placeholder protecting "1,000 g/L"

/** Split free text into candidate active-ingredient fragments. */
export function splitActiveIngredientText(text: string | null | undefined): string[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  return raw
    .replace(/(\d)\s*,\s*(\d{3}\b)/g, `$1${DIGIT_COMMA}$2`)
    .split(ACTIVE_SEPARATOR)
    .map((p) => p.split(DIGIT_COMMA).join(",").trim().replace(/^[,;+&·\s]+|[,;+&·\s]+$/g, ""))
    .filter(Boolean);
}

const numOrUndef = (v: string | undefined): number | undefined =>
  v == null ? undefined : finiteOrUndef(v.replace(/,/g, ""));

/**
 * Best-effort split of a legacy / AI free-text active ingredient string into
 * structured actives, e.g. "Tebuconazole 100 g/L + Azoxystrobin 200 g/L" or
 * "Azoxystrobin 120 g/L, Tebuconazole 200 g/L".
 * Nothing is invented: unparsed text becomes the active's name only.
 * The caller decides the provenance — this never claims authority.
 */
export function parseLegacyActiveIngredient(
  text: string | null | undefined,
  identitySource: DataSourceKind = "manual_entry",
): WriteActiveIngredient[] {
  const trailing = new RegExp(`^(.*?)[\\s,]+([\\d.,]+)\\s*(${CONC_UNIT_PATTERN})\\s*$`, "i");
  const leading = new RegExp(`^([\\d.,]+)\\s*(${CONC_UNIT_PATTERN})\\s+(.*)$`, "i");
  const out: WriteActiveIngredient[] = [];
  const seen = new Set<string>();

  for (const part of splitActiveIngredientText(text)) {
    const t = part.match(trailing);
    const l = t ? null : part.match(leading);
    const name = (t ? t[1] : l ? l[3] : part).replace(/[,\s]+$/, "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      clean({
        name,
        concentration: t ? numOrUndef(t[2]) : l ? numOrUndef(l[1]) : undefined,
        concentration_unit: normaliseConcentrationUnit(t ? t[3] : l ? l[2] : undefined),
        identity_source: identitySource,
      }) as WriteActiveIngredient,
    );
  }
  return out;
}


/**
 * Suggest the authoritative activity group for an active. Used to pre-fill the
 * editor — the operator can always override, and an override that disagrees
 * with the reference becomes a recorded conflict rather than a silent change.
 */
export function suggestActivityGroup(name: string): WriteActivityGroup | undefined {
  const ref = lookupActivityGroup(name);
  if (!ref) return undefined;
  return clean({
    scheme: ref.scheme,
    code: normaliseGroupCode(ref.code),
    common_name: ref.common_name,
  }) as WriteActivityGroup;
}

/** The citation for the built-in FRAC/HRAC/IRAC reference table. */
export const activityGroupReferenceSource = (): WriteDataSource => ({
  kind: "authoritative_classification",
  name: ACTIVITY_GROUP_REFERENCE_NAME,
  retrieved_at: new Date().toISOString(),
});

/** Add a source, de-duplicated on kind + name. */
export function withSource(
  sources: WriteDataSource[],
  source: WriteDataSource,
): WriteDataSource[] {
  const exists = sources.some((s) => s.kind === source.kind && s.name.trim() === source.name.trim());
  return exists ? sources : [...sources, source];
}
