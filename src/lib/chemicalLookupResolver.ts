// Chemical Lookup — upgraded `chemical-info-lookup` resolver contract.
//
// The production resolver now returns a single envelope containing:
//
//   match_source      "master" | "authoritative" | "ai_candidate" | "unresolved"
//                     (plus "ambiguous", which is treated as unresolved)
//   jurisdiction      the ONLY source of the lookup country + its status
//   field_provenance  per-field evidence kind for everything it returned
//   ai_suggestion     unverified assistance, for human reading only
//
// Two rules govern this module:
//
//  1. Canonical form fields are populated ONLY from the main structured
//     response, and only for fields whose provenance is authoritative.
//     `ai_suggestion` is NEVER auto-filled into a canonical field — not the
//     product name, not chemistry, not a rate, not a WHP, not a REI.
//  2. Nothing is invented. An unresolved rate / WHP / REI stays blank and is
//     recorded as unresolved so the operator can see it was not answered.
//
// Nothing here writes to the database.

import {
  emptyDraft,
  normaliseConcentrationUnit,
  normaliseCountry,
  normaliseGroupCode,
  normaliseLabelRateBasis,
  normaliseRegistrationScheme,
  normaliseWriteScheme,
  legacyActiveIngredientProjection,
  legacyChemicalGroupProjection,
  type ChemicalIntelligenceDraft,
  type DataSourceKind,
  type WriteActiveIngredient,
  type WriteConflict,
  type WriteDataSource,
  type WriteLabelRate,
  type WriteRegisteredUse,
  type WriteVerificationStatus,
} from "@/lib/chemicalIntelligenceWrite";
import {
  selectRates,
  withholdingDisplay,
  type LookupRateView,
} from "@/lib/chemicalLabelRates";
import { matchCategory, type ProductCategory } from "@/lib/chemicalCategories";
import { vineyardCountryCode, countryLabel } from "@/lib/chemicalJurisdiction";
import {
  normaliseMatchSource,
  parseMasterLookupEnvelope,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";

/* ------------------------------------------------------------ match source */

export type LookupMatchSource =
  | "master"
  | "authoritative"
  | "ai_candidate"
  | "ambiguous"
  | "unresolved";

/** Match sources that may populate canonical fields. */
export const AUTHORITATIVE_MATCH_SOURCES: LookupMatchSource[] = ["master", "authoritative"];

export function normaliseLookupMatchSource(value: unknown): LookupMatchSource {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "master") return "master";
  if (
    s === "authoritative" ||
    s === "authoritative_candidate" ||
    s === "official" ||
    s === "official_register" ||
    s === "register_match"
  )
    return "authoritative";
  if (s === "ai_candidate" || s === "ai" || s === "candidate" || s === "ai_suggestion")
    return "ai_candidate";
  if (s === "ambiguous" || s === "multiple" || s === "multiple_matches") return "ambiguous";
  return "unresolved";
}


export const isAuthoritativeMatch = (m: LookupMatchSource): boolean =>
  AUTHORITATIVE_MATCH_SOURCES.includes(m);

/* ------------------------------------------------------------- provenance */

/** Evidence kind attached to one returned field. */
export type FieldProvenanceKind =
  | "official_register"
  | "official_label"
  | "authoritative_classification"
  | "ai_interpretation"
  | "ai_suggestion"
  | "unknown";

const PROVENANCE_ALIASES: Record<string, FieldProvenanceKind> = {
  official_register: "official_register",
  register: "official_register",
  apvma: "official_register",
  pubcris: "official_register",
  regulator: "official_register",
  official_label: "official_label",
  manufacturer_label: "official_label",
  label: "official_label",
  sds: "official_label",
  authoritative_classification: "authoritative_classification",
  frac: "authoritative_classification",
  hrac: "authoritative_classification",
  irac: "authoritative_classification",
  classification: "authoritative_classification",
  ai_interpretation: "ai_interpretation",
  ai: "ai_interpretation",
  inferred: "ai_interpretation",
  ai_suggestion: "ai_suggestion",
  suggestion: "ai_suggestion",
};

export function normaliseFieldProvenance(value: unknown): FieldProvenanceKind {
  const raw =
    value && typeof value === "object"
      ? ((value as any).source ?? (value as any).kind ?? (value as any).provenance)
      : value;
  const s = String(raw ?? "").trim().toLowerCase();
  return PROVENANCE_ALIASES[s] ?? "unknown";
}

/** Only register / label / official-classification evidence may fill a field. */
export const isAuthoritativeProvenance = (k: FieldProvenanceKind): boolean =>
  k === "official_register" || k === "official_label" || k === "authoritative_classification";

/** Data-source kind used when recording the field in SQL 194 structures. */
export const provenanceSourceKind = (k: FieldProvenanceKind): DataSourceKind =>
  k === "official_register"
    ? "official_register"
    : k === "official_label"
      ? "manufacturer_label"
      : k === "authoritative_classification"
        ? "authoritative_classification"
        : "ai_interpretation";

export type FieldProvenanceMap = Record<string, FieldProvenanceKind>;

export function parseFieldProvenance(value: unknown): {
  present: boolean;
  map: FieldProvenanceMap;
} {
  if (!value || typeof value !== "object") return { present: false, map: {} };
  const map: FieldProvenanceMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    map[k.trim().toLowerCase()] = normaliseFieldProvenance(v);
  }
  return { present: Object.keys(map).length > 0, map };
}

/* ----------------------------------------------------------- jurisdiction */

export type LookupJurisdictionStatus = "resolved" | "unknown" | "mismatch";

export interface LookupJurisdiction {
  /** ISO-2 country the resolver answered for. Single source of truth. */
  country: string | null;
  status: LookupJurisdictionStatus;
  /** The vineyard country the lookup was requested for. */
  vineyardCountry: string | null;
  scheme?: string;
  message: string | null;
}

/**
 * Jurisdiction comes from the resolver's `jurisdiction` block only. It is the
 * single source for the lookup country AND its status: the form can no longer
 * claim "registration country unknown" while the lookup header shows AU.
 */
export function parseLookupJurisdiction(
  payload: any,
  vineyardCountry?: string | null,
): LookupJurisdiction {
  const vin = vineyardCountryCode(vineyardCountry);
  const block =
    payload && typeof payload === "object"
      ? (payload.jurisdiction ?? payload.jurisdiction_context ?? null)
      : null;
  const raw =
    block && typeof block === "object"
      ? (block.resolved_country_code ??
        block.country_code ??
        block.resolved_country_name ??
        block.country ??
        block.iso2 ??
        block.requested_country ??
        null)
      : block;
  const country = vineyardCountryCode(raw);
  const scheme =
    block && typeof block === "object"
      ? (String(
          block.registration_scheme ?? block.register_adapter ?? block.scheme ?? "",
        )
          .trim()
          .toLowerCase() || undefined)
      : undefined;


  if (!country) {
    return {
      country: null,
      status: "unknown",
      vineyardCountry: vin,
      scheme,
      message: "The lookup did not confirm a registration jurisdiction.",
    };
  }
  if (vin && country !== vin) {
    return {
      country,
      status: "mismatch",
      vineyardCountry: vin,
      scheme,
      message: `Resolved against ${countryLabel(country)} — current vineyard is ${countryLabel(vin)}.`,
    };
  }
  return { country, status: "resolved", vineyardCountry: vin, scheme, message: null };
}

/* ------------------------------------------------------ verification state */

export type LookupVerificationStatus =
  | "verified"
  | "partially_verified"
  | "conflict"
  | "unverified";

export const LOOKUP_VERIFICATION_LABEL: Record<LookupVerificationStatus, string> = {
  verified: "Verified",
  partially_verified: "Partially verified",
  conflict: "Conflicting evidence",
  unverified: "Unverified",
};

export const LOOKUP_VERIFICATION_TONE: Record<LookupVerificationStatus, string> = {
  verified: "success",
  partially_verified: "warning",
  conflict: "danger",
  unverified: "neutral",
};

export function normaliseLookupVerification(value: unknown): LookupVerificationStatus | undefined {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "verified") return "verified";
  if (s === "partially_verified" || s === "partial") return "partially_verified";
  if (s === "conflict" || s === "conflicting") return "conflict";
  if (s === "unverified" || s === "needs_match") return "unverified";
  return undefined;
}

/* -------------------------------------------------------------- ai advice */

export interface AiSuggestionView {
  /** Always rendered as "Unverified AI suggestion — for reference only". */
  productName?: string;
  activeIngredient?: string;
  category?: string;
  chemicalGroup?: string;
  registrant?: string;
  rateText?: string;
  withholdingText?: string;
  reEntryText?: string;
  target?: string;
  notes?: string;
}

const s = (v: unknown): string | undefined => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return t === "" ? undefined : t;
};
const num = (v: unknown): number | undefined => {
  if (v === "" || v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function parseAiSuggestion(payload: any): AiSuggestionView | null {
  const raw =
    payload && typeof payload === "object"
      ? (payload.ai_suggestion ?? payload.aiSuggestion ?? null)
      : null;
  if (!raw || typeof raw !== "object") return null;
  const rate =
    s(raw.rate_text) ??
    (num(raw.rate_per_unit) != null
      ? `${num(raw.rate_per_unit)} ${s(raw.rate_unit) ?? ""}`.trim()
      : undefined);
  const view: AiSuggestionView = {
    productName: s(raw.product_name ?? raw.name),
    activeIngredient: s(raw.active_ingredient ?? raw.actives),
    category: s(raw.category),
    chemicalGroup: s(raw.chemical_group ?? raw.activity_group),
    registrant: s(raw.registrant ?? raw.manufacturer),
    rateText: rate,
    withholdingText:
      s(raw.withholding_period_text) ??
      (num(raw.withholding_period_days) != null
        ? `${num(raw.withholding_period_days)} days`
        : undefined),
    reEntryText:
      s(raw.re_entry_period_text) ??
      (num(raw.re_entry_period_hours) != null
        ? `${num(raw.re_entry_period_hours)} hours`
        : undefined),
    target: s(raw.target),
    notes: s(raw.notes ?? raw.safety_note),
  };
  return Object.values(view).some(Boolean) ? view : null;
}

/* ---------------------------------------------------------------- product */

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** The main structured product block — never `ai_suggestion`. */
function productBlock(payload: any): Record<string, any> {
  if (!payload || typeof payload !== "object") return {};
  const nested =
    payload.product ?? payload.resolved ?? payload.chemical ?? payload.master ?? null;
  const base: Record<string, any> =
    nested && typeof nested === "object"
      ? { ...(payload as Record<string, any>), ...(nested as Record<string, any>) }
      : { ...(payload as Record<string, any>) };

  // Production envelope keeps registration identity in a nested block. Flatten
  // it so the canonical readers below see the same keys either way.
  const reg = base.registration;
  if (reg && typeof reg === "object") {
    base.registration_number = base.registration_number ?? reg.registration_number ?? reg.number;
    base.registrant = base.registrant ?? reg.registrant;
    base.registration_scheme = base.registration_scheme ?? reg.scheme ?? reg.registration_scheme;
    base.registration_country =
      base.registration_country ?? reg.country_code ?? reg.country;
    base.registered_product_name =
      base.registered_product_name ?? reg.registered_product_name;
    base.label_reference = base.label_reference ?? reg.label_reference;
    base.label_version = base.label_version ?? reg.label_version;
  }

  // Verification lives in its own block on the production envelope.
  const ver = base.verification;
  if (ver && typeof ver === "object") {
    base.verification_status = base.verification_status ?? ver.status;
    base.verification_sources = base.verification_sources ?? ver.sources;
    base.verification_conflicts = base.verification_conflicts ?? ver.conflicts;
    base.verification_unresolved_fields =
      base.verification_unresolved_fields ?? ver.unresolved_fields;
  }
  return base;
}

/**
 * Provenance keys differ slightly between the documented contract and the
 * deployed envelope (`registration` covers the whole identity block,
 * `product_category` is the category). Alias them so gating still applies.
 */
function withProvenanceAliases(map: FieldProvenanceMap): FieldProvenanceMap {
  const out: FieldProvenanceMap = { ...map };
  const alias = (target: string, from: string) => {
    if (out[target] == null && out[from] != null) out[target] = out[from];
  };
  alias("registration_number", "registration");
  alias("registrant", "registration");
  alias("registration_country", "registration");
  alias("category", "product_category");
  return out;
}


/* --------------------------------------------------------------- result */

export interface CanonicalChemicalFields {
  name?: string;
  category?: ProductCategory;
  registrant?: string;
  registrationCountry?: string;
  registrationScheme?: string;
  registrationNumber?: string;
  /** Legacy projections kept for mobile compatibility. */
  activeIngredientText?: string;
  chemicalGroupText?: string;
  labelReference?: string;
  labelVersion?: string;
  /** Only when the label actually stated it. */
  withholdingDays?: number;
  /** LD-2 presentation: "Not required when used as directed" for a stated 0. */
  withholdingText?: string;
  reEntryHours?: number;
  restrictions?: string;
  target?: string;
  /** LD-2 authoritative label rates for the primary (grape) use. */
  rates?: LookupRateView[];
  ratePer100L?: LookupRateView;
  ratePerHectare?: LookupRateView;
  /** Reference-only rows (basis "other") — display, never applied. */
  rateReferenceOnly?: LookupRateView[];
  /** Combined display text for the usable rates. */
  rateText?: string;
}


export interface ChemicalLookupResult {
  matchSource: LookupMatchSource;
  /** True when canonical fields may be populated at all. */
  authoritative: boolean;
  verificationStatus: LookupVerificationStatus;
  jurisdiction: LookupJurisdiction;
  /** Populated only from authoritative, provenance-backed response fields. */
  fields: CanonicalChemicalFields;
  /** SQL 194 structured intelligence for the authoritative result. */
  draft: ChemicalIntelligenceDraft | null;
  provenance: FieldProvenanceMap;
  /** Display only. Never auto-filled anywhere. */
  aiSuggestion: AiSuggestionView | null;
  /** Fields the resolver returned but could not evidence. */
  unresolvedFields: string[];
  conflicts: WriteConflict[];
  /** Operator guidance for unresolved / ambiguous results. */
  guidance: string | null;
  /** Inlined Master row when `match_source = master`. */
  master: MasterChemicalRow | null;
}

const UNRESOLVED_GUIDANCE =
  "No registered label could be resolved for this product in this jurisdiction. Authoritative fields have been left blank — enter the product manually from its label, or try the exact registered product name or registration number.";

const AMBIGUOUS_GUIDANCE =
  "More than one registered product matched this name. Authoritative fields have been left blank — search again using the exact registered product name or registration number.";

const AI_ONLY_GUIDANCE =
  "No authoritative registration was resolved. The AI suggestion below is unverified and has not been applied to any field.";

/* ---------------------------------------------------------- field readers */

interface FieldGate {
  present: boolean;
  map: FieldProvenanceMap;
  fallback: boolean;
}

/** Provenance-respecting read: returns the value only when evidenced. */
function gated<T>(gate: FieldGate, key: string, value: T | undefined): T | undefined {
  if (value == null) return undefined;
  const kind = gate.map[key];
  if (kind == null) return gate.present ? (gate.fallback ? value : undefined) : value;
  return isAuthoritativeProvenance(kind) ? value : undefined;
}

function provenanceKindFor(gate: FieldGate, key: string, fallback: DataSourceKind): DataSourceKind {
  const kind = gate.map[key];
  return kind ? provenanceSourceKind(kind) : fallback;
}

function decodeActives(raw: any[], gate: FieldGate): WriteActiveIngredient[] {
  const out: WriteActiveIngredient[] = [];
  raw.forEach((a, i) => {
    if (!a || typeof a !== "object") return;
    const name = s(a.name ?? a.active_ingredient);
    if (!name) return;
    const identityKey = `active_ingredients.${i}`;
    const identity = provenanceKindFor(
      gate,
      gate.map[identityKey] ? identityKey : "active_ingredients",
      "official_register",
    );
    if (identity === "ai_interpretation" && (gate.present || gate.map["active_ingredients"])) {
      // Chemistry the resolver could not evidence is not canonical chemistry.
      return;
    }
    const groupRaw = a.activity_group ?? a.group ?? null;
    const code = normaliseGroupCode(
      groupRaw && typeof groupRaw === "object" ? groupRaw.code : groupRaw,
    );
    const scheme = normaliseWriteScheme(
      (groupRaw && typeof groupRaw === "object" ? groupRaw.scheme : a.activity_group_scheme) ??
        a.group_scheme,
    );
    const groupKey = `activity_groups.${i}`;
    const groupSource = provenanceKindFor(
      gate,
      gate.map[groupKey] ? groupKey : "activity_groups",
      "authoritative_classification",
    );
    out.push({
      name,
      concentration: num(a.concentration),
      concentration_unit: normaliseConcentrationUnit(a.concentration_unit ?? a.unit),
      activity_group: code ? { scheme, code } : undefined,
      group_source: code ? groupSource : undefined,
      identity_source: identity,
    });
  });
  return out;
}

function decodeRates(raw: any): WriteLabelRate[] {
  return asArray(raw)
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const unit = s(r.unit) ?? "";
      const value = num(r.value ?? r.rate_per_unit);
      const min = num(r.min_value ?? r.rate_min);
      const max = num(r.max_value ?? r.rate_max);
      const rawText = s(r.raw_text);
      const basis = normaliseLabelRateBasis(r.basis ?? r.rate_basis);
      // A row with no number is only kept when the label stated something we
      // can show as reference text (basis "other"). It never fills a field.
      if (value == null && min == null && max == null && !rawText) return null;
      if ((value == null && min == null && max == null) || !unit) {
        return {
          label: s(r.label) ?? "",
          basis: "other",
          unit,
          raw_text: rawText,
        } as WriteLabelRate;
      }
      return {
        label: s(r.label) ?? "",
        basis,
        unit,
        value,
        min_value: min,
        max_value: max,
        raw_text: rawText,
      } as WriteLabelRate;
    })
    .filter((r): r is WriteLabelRate => !!r);
}

/**
 * Per-use provenance gate. LD-2 attaches evidence per registered use
 * (`use.provenance.rates`, `.withholding_period`, …). That is authoritative
 * for THAT use — a top-level `field_provenance.label_rates` must never be
 * assumed to cover a use that stated no rate evidence of its own.
 */
function useFieldAllowed(gate: FieldGate, use: any, key: string, topKey: string): boolean {
  const prov = use?.provenance;
  if (prov && typeof prov === "object" && key in prov) {
    return isAuthoritativeProvenance(normaliseFieldProvenance((prov as any)[key]));
  }
  const top = gate.map[topKey];
  if (top != null) return isAuthoritativeProvenance(top);
  // No per-use and no top-level evidence key: the use itself was already
  // gated through `registered_uses`.
  return true;
}

function decodeUses(raw: any[], gate: FieldGate): WriteRegisteredUse[] {
  return raw
    .map((u) => {
      if (!u || typeof u !== "object") return null;
      const crop = s(u.crop) ?? "";
      const target = s(u.target_raw ?? u.target) ?? "";
      if (!crop && !target) return null;
      const rates = useFieldAllowed(gate, u, "rates", "label_rates")
        ? decodeRates(u.rates)
        : [];
      const whp = useFieldAllowed(gate, u, "withholding_period", "withholding_periods")
        ? num(u.withholding_period_days)
        : undefined;
      const rei = useFieldAllowed(gate, u, "re_entry", "re_entry")
        ? num(u.re_entry_period_hours)
        : undefined;
      const restrictions = useFieldAllowed(gate, u, "restrictions", "restrictions")
        ? s(u.restrictions)
        : undefined;
      // LD-2 per-use provenance is preserved verbatim, explicit nulls
      // included — a null means "unresolved" and must never be dropped.
      const provenance =
        u.provenance && typeof u.provenance === "object" && !Array.isArray(u.provenance)
          ? ({ ...u.provenance } as Record<string, unknown>)
          : undefined;
      return {
        crop,
        target_raw: target,
        rates,
        // Never inferred from free text here: the resolver is the authority.
        withholding_period_days: whp,
        re_entry_period_hours: rei,
        restrictions,
        provenance,
      } as WriteRegisteredUse;
    })
    .filter((u): u is WriteRegisteredUse => !!u);
}


function decodeConflicts(raw: any[]): WriteConflict[] {
  return raw
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const field = s(c.field);
      if (!field) return null;
      return {
        field,
        active_ingredient_name: s(c.active_ingredient_name),
        extracted_value: s(c.extracted_value) ?? "",
        authoritative_value: s(c.authoritative_value) ?? "",
        extracted_source: (s(c.extracted_source) as DataSourceKind) ?? "ai_interpretation",
        authoritative_source:
          (s(c.authoritative_source) as DataSourceKind) ?? "official_register",
      } as WriteConflict;
    })
    .filter((c): c is WriteConflict => !!c);
}

const GRAPE = /(grape|vine)/i;

/** The grape use, else the first use — used for the legacy WHP/REI fields. */
export function primaryUse(uses: WriteRegisteredUse[]): WriteRegisteredUse | undefined {
  return uses.find((u) => GRAPE.test(u.crop)) ?? uses[0];
}

/* ---------------------------------------------------------------- parser */

/**
 * Parse the upgraded resolver envelope. This is the ONLY place the portal
 * decides what a lookup is allowed to populate.
 */
/**
 * Does this payload actually speak the upgraded resolver contract? A legacy
 * AI-shaped body (bare `activeIngredient` / `candidates`, no match_source,
 * jurisdiction or field_provenance) must NOT be presented as a structured
 * resolver answer — it has no provenance, so nothing in it may be trusted.
 */
export function isStructuredLookupEnvelope(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const r = payload as Record<string, unknown>;
  if (typeof r.error === "string" && r.error) return false;
  return (
    r.match_source != null ||
    r.matchSource != null ||
    r.jurisdiction != null ||
    r.jurisdiction_context != null ||
    r.field_provenance != null ||
    r.fieldProvenance != null
  );
}

export function parseChemicalLookup(

  payload: unknown,
  vineyardCountry?: string | null,
): ChemicalLookupResult {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const matchSource = normaliseLookupMatchSource(root.match_source ?? root.matchSource);
  const jurisdiction = parseLookupJurisdiction(root, vineyardCountry);
  const aiSuggestion = parseAiSuggestion(root);
  const parsedProvenance = parseFieldProvenance(root.field_provenance ?? root.fieldProvenance);
  const present = parsedProvenance.present;
  const map = withProvenanceAliases(parsedProvenance.map);

  const envelope = parseMasterLookupEnvelope(root);
  const master =
    normaliseMatchSource(root.match_source ?? root.matchSource) === "master"
      ? (envelope.master ?? null)
      : null;

  const authoritative = isAuthoritativeMatch(matchSource) && jurisdiction.status !== "unknown";

  if (!authoritative) {
    return {
      matchSource,
      authoritative: false,
      verificationStatus: "unverified",
      jurisdiction,
      fields: {},
      draft: null,
      provenance: map,
      aiSuggestion,
      unresolvedFields: [],
      conflicts: [],
      guidance:
        matchSource === "ambiguous"
          ? AMBIGUOUS_GUIDANCE
          : matchSource === "ai_candidate"
            ? AI_ONLY_GUIDANCE
            : UNRESOLVED_GUIDANCE,
      master: null,
    };
  }

  const p = productBlock(root);
  // A Master hit carries provenance implicitly; without an explicit map we
  // trust the main structured block (never `ai_suggestion`).
  const gate: FieldGate = { present, map, fallback: matchSource === "master" };

  const actives = decodeActives(
    asArray(p.active_ingredients ?? p.actives),
    gate,
  );
  const uses = gated(gate, "registered_uses", decodeUses(asArray(p.registered_uses), gate)) ?? [];
  const conflicts = decodeConflicts(asArray(p.verification_conflicts ?? root.conflicts));

  const unresolved = new Set<string>(
    asArray(p.verification_unresolved_fields ?? root.unresolved_fields)
      .map((v) => s(v))
      .filter((v): v is string => !!v),
  );
  // Anything the resolver returned without authoritative provenance is
  // recorded as unresolved rather than silently dropped.
  for (const [key, kind] of Object.entries(map)) {
    if (!isAuthoritativeProvenance(kind)) unresolved.add(key);
  }

  const use = primaryUse(uses);
  const rateSelection = selectRates(use);
  if (use && !use.rates.length) unresolved.add("registered_uses.rates");
  if (use && use.withholding_period_days == null) unresolved.add("withholding_period_days");
  if (use && use.re_entry_period_hours == null) unresolved.add("re_entry_period_hours");

  const country =
    jurisdiction.country ?? normaliseCountry(p.registration_country) ?? undefined;
  const scheme =
    normaliseRegistrationScheme(p.registration_scheme ?? jurisdiction.scheme) ?? undefined;
  const registrationNumber = gated(gate, "registration_number", s(p.registration_number));
  const registrant = gated(gate, "registrant", s(p.registrant ?? p.manufacturer));
  const productName = gated(
    gate,
    "product_name",
    s(p.registered_product_name ?? p.product_name ?? p.name),
  );
  const labelReference = gated(
    gate,
    "label_reference",
    s(p.label_reference ?? p.label_url),
  );
  const labelVersion = gated(gate, "label_version", s(p.label_version));
  const categoryRaw = gated(gate, "category", s(p.category ?? p.product_category ?? p.use));

  const draft: ChemicalIntelligenceDraft = {
    ...emptyDraft(),
    actives,
    registeredUses: uses,
    conflicts,
    unresolvedFields: Array.from(unresolved),
    registration: {
      country,
      scheme,
      number: registrationNumber,
      registrant,
      registered_product_name: productName,
      label_reference: labelReference,
      label_version: labelVersion,
    },
    sources: lookupSources(p, matchSource, labelReference),
    claimedStatus: "unverified",
  };

  const verificationStatus =
    conflicts.length > 0
      ? "conflict"
      : (normaliseLookupVerification(p.verification_status) ??
        (actives.length && registrationNumber && uses.length
          ? "verified"
          : actives.length || registrationNumber
            ? "partially_verified"
            : "unverified"));

  draft.claimedStatus = verificationStatus as WriteVerificationStatus;

  const fields: CanonicalChemicalFields = {
    name: productName,
    category: (matchCategory(categoryRaw) ?? undefined) as ProductCategory | undefined,
    registrant,
    registrationCountry: country,
    registrationScheme: scheme,
    registrationNumber,
    activeIngredientText: actives.length ? legacyActiveIngredientProjection(actives) : undefined,
    chemicalGroupText: actives.length ? legacyChemicalGroupProjection(actives) : undefined,
    labelReference,
    labelVersion,
    withholdingDays: use?.withholding_period_days,
    withholdingText: withholdingDisplay(
      use?.withholding_period_days,
      [use?.restrictions, ...(use?.rates ?? []).map((r) => r.raw_text)]
        .filter(Boolean)
        .join("\n"),
    ),
    reEntryHours: use?.re_entry_period_hours,
    restrictions: use?.restrictions,
    target: use?.target_raw || undefined,
    rates: rateSelection.all.length ? rateSelection.all : undefined,
    ratePer100L: rateSelection.per100L,
    ratePerHectare: rateSelection.perHectare,
    rateReferenceOnly: rateSelection.referenceOnly.length
      ? rateSelection.referenceOnly
      : undefined,
    rateText: rateSelection.text,
  };

  return {
    matchSource,
    authoritative: true,
    verificationStatus,
    jurisdiction,
    fields,
    draft,
    provenance: map,
    aiSuggestion,
    unresolvedFields: Array.from(unresolved),
    conflicts,
    guidance: null,
    master,
  };
}

function lookupSources(
  p: Record<string, any>,
  matchSource: LookupMatchSource,
  labelReference?: string,
): WriteDataSource[] {
  const now = new Date().toISOString();
  const out: WriteDataSource[] = asArray(p.verification_sources)
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const name = s(v.name);
      if (!name) return null;
      return {
        kind: (s(v.kind) as DataSourceKind) ?? "official_register",
        name,
        reference: s(v.reference),
        retrieved_at: s(v.retrieved_at) ?? now,
      } as WriteDataSource;
    })
    .filter((v): v is WriteDataSource => !!v);
  if (!out.length) {
    out.push({
      kind: "official_register",
      name: matchSource === "master" ? "VineTrack Master Catalogue" : "Official register",
      reference: labelReference,
      retrieved_at: now,
    });
  }
  return out;
}

/** Header text for the lookup panel — jurisdiction is the only source. */
export function lookupJurisdictionHeadline(j: LookupJurisdiction): string {
  if (j.country) return `Chemical lookup — ${countryLabel(j.country)} labels`;
  if (j.vineyardCountry) return `Chemical lookup — ${countryLabel(j.vineyardCountry)} labels`;
  return "Chemical lookup — vineyard country not set";
}
