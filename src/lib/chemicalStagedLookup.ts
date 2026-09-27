// Chemical Search V2 — staged online lookup (`chemical-info-lookup`
// `web_lookup_v2`), the production contract iOS/Android already use.
//
// Boundaries this module keeps explicit:
//   * This is NOT a second lookup system. It calls the existing deployed
//     `chemical-info-lookup` function with `action: "web_lookup_v2"` only.
//     No discover_label, no APVMA call from the browser, no portal-only
//     edge function, no legacy structured lookup body.
//   * Stage A of the response identifies agricultural products (`candidates`).
//     Stage B enriches ONE chosen identity against its manufacturer label
//     (`selectedName`) — never a repeated loose search, never a substitution.
//   * `resistance_classification_state` is taken from the backend verbatim.
//     It is never inferred from an empty activity-group array.
//   * Structured intelligence is encoded by the canonical sql/194 encoder.
//     Nothing here hand-builds those columns, and nothing is invented.

import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import {
  draftFromRow,
  encodeChemicalIntelligenceForWrite,
  normaliseLabelRateBasis,
  type ChemicalIntelligenceDraft,
  type EncodedChemicalIntelligence,
} from "@/lib/chemicalIntelligenceWrite";
import {
  normaliseResistanceClassificationState,
  type ResistanceClassificationState,
} from "@/lib/chemicalIntelligence";
import type {
  CanonicalRateBasis,
  PersistedDefaultRateSelection,
  PersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";
import type { SavedChemicalInput } from "@/lib/savedChemicalsQuery";

export const STAGED_LOOKUP_FUNCTION = "chemical-info-lookup";
export const STAGED_LOOKUP_ACTION = "web_lookup_v2";

/* ------------------------------------------------------------- operator text */

/** Shown while the staged lookup runs. Never described as an APVMA search. */
export const STAGED_LOADING_TEXT = "Finding manufacturer product and reading its label…";
/** Shown above the identified products returned by stage A. */
export const STAGED_CANDIDATES_TEXT =
  "Choose the identified agricultural product to complete its manufacturer details.";
/** The identity was resolved but its manufacturer label could not be read. */
export const STAGED_ENRICHMENT_FAILED_TEXT =
  "Product identified, but manufacturer label details could not be completed. Try again or enter details manually.";
/** The lookup itself could not be reached / returned nothing usable. */
export const STAGED_UNAVAILABLE_TEXT =
  "Product lookup is unavailable. Try again or enter details manually.";

/* --------------------------------------------------------------- primitives */

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const httpOrEmpty = (v: unknown): string => {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s : "";
};

/* -------------------------------------------------------------- candidates */

export interface StagedCandidate {
  name: string;
  registrant: string;
  activeIngredient: string;
  category: string;
  registrationNumber: string;
  /** Backend state, verbatim. Never derived from the group list. */
  resistanceState: ResistanceClassificationState | null;
}

export function normaliseStagedCandidate(raw: unknown): StagedCandidate | null {
  const o = rec(raw);
  const name = str(o.name ?? o.product_name ?? o.productName);
  if (!name) return null;
  return {
    name,
    registrant: str(o.brand ?? o.registrant ?? o.manufacturer),
    activeIngredient: str(o.activeIngredient ?? o.active_ingredient),
    category: str(o.product_category ?? o.category),
    registrationNumber: str(o.registration_number ?? o.registrationNumber),
    resistanceState: normaliseResistanceClassificationState(
      o.resistance_classification_state ?? o.resistanceClassificationState,
    ),
  };
}

/* ------------------------------------------------------------------ detail */

export interface StagedRateOption {
  id: string;
  basis: CanonicalRateBasis;
  unit: string;
  value: number | null;
  minValue: number | null;
  maxValue: number | null;
  /** The label's own wording for this rate, verbatim. */
  label: string;
  condition: string;
  rawText: string;
  crop: string;
  targetRaw: string;
}

/** A rate the label states in a basis the operational default cannot use. */
export interface StagedReferenceRate {
  summary: string;
  crop: string;
  targetRaw: string;
}

export interface StagedRegisteredUse {
  crop: string;
  targetRaw: string;
  rates: string[];
  withholdingDays: number | null;
  reEntryHours: number | null;
  restrictions: string;
}

export interface StagedDetail {
  productName: string;
  registrant: string;
  registrationNumber: string;
  registrationCountry: string;
  registrationScheme: string;
  category: string;
  physicalForm: string;
  activeIngredientText: string;
  activityGroupText: string;
  /** Backend state, verbatim. */
  resistanceState: ResistanceClassificationState | null;
  /** Manufacturer's own label PDF. NEVER presented as a regulator label. */
  manufacturerLabelUrl: string;
  /** Regulator (e.g. APVMA) label, only when the backend resolved one. */
  regulatorLabelUrl: string;
  /** Marketing / product page. Never a label. */
  productUrl: string;
  registeredForGrapevine: boolean;
  registeredUses: StagedRegisteredUse[];
  rateOptions: StagedRateOption[];
  referenceRates: StagedReferenceRate[];
  verificationStatus: string;
  /** Canonical sql/194 draft for the Saved Chemical write path. */
  draft: ChemicalIntelligenceDraft;
}

const PER_HECTARE = new Set(["per_hectare", "range_per_hectare"]);
const PER_100L = new Set(["per_100_litres", "range_per_100_litres"]);

/** Composite label unit ("L/ha") is presented bare against its own basis. */
function bareUnit(unit: string, basis: CanonicalRateBasis): string {
  const u = str(unit);
  if (!u) return "";
  const lower = u.toLowerCase();
  if (basis === "per_hectare" && lower.endsWith("/ha")) return u.slice(0, -3);
  if (basis === "per_100_litres" && /\/100\s*l$/i.test(lower)) return u.replace(/\/100\s*l$/i, "");
  return u;
}

function activeIngredientText(actives: unknown[]): string {
  const parts: string[] = [];
  for (const a of actives) {
    const o = rec(a);
    const name = str(o.name ?? o.active_ingredient);
    if (!name) continue;
    const conc = numOrNull(o.concentration);
    const unit = str(o.concentration_unit ?? o.unit);
    parts.push(conc != null ? `${name} ${conc}${unit ? ` ${unit}` : ""}` : name);
  }
  return parts.join(" + ");
}

function rateSummaryText(o: Record<string, unknown>): string {
  const unit = str(o.unit);
  const value = numOrNull(o.value);
  const min = numOrNull(o.min_value);
  const max = numOrNull(o.max_value);
  const body =
    value != null ? String(value) : min != null && max != null ? `${min}–${max}` : "";
  const label = str(o.label);
  const text = [body, unit].filter(Boolean).join(" ");
  return [text || str(o.raw_text), label].filter(Boolean).join(" — ");
}

/**
 * The `detail` block of a `web_lookup_v2` response. Registered rate ranges are
 * preserved exactly; nothing is converted between /ha and /100 L, and no rate
 * is chosen for the operator.
 */
export function normaliseStagedDetail(raw: unknown): StagedDetail | null {
  const d = rec(raw);
  const productName = str(d.product_name ?? d.productName);
  if (!productName) return null;

  const registration = rec(d.registration);
  const labelUrls = rec(d.label_urls);
  const verification = rec(d.verification);
  const actives = arr(d.active_ingredients);
  const uses = arr(d.grapevine_uses).length ? arr(d.grapevine_uses) : arr(d.registered_uses);

  const rateOptions: StagedRateOption[] = [];
  const referenceRates: StagedReferenceRate[] = [];
  const registeredUses: StagedRegisteredUse[] = [];

  uses.forEach((useRaw, ui) => {
    const u = rec(useRaw);
    const crop = str(u.crop);
    const targetRaw = str(u.target_raw ?? u.target);
    const rateTexts: string[] = [];
    arr(u.rates).forEach((rateRaw, ri) => {
      const r = rec(rateRaw);
      const wire = String(normaliseLabelRateBasis(r.basis));
      const summary = rateSummaryText(r);
      if (summary) rateTexts.push(summary);
      const basis: CanonicalRateBasis | null = PER_HECTARE.has(wire)
        ? "per_hectare"
        : PER_100L.has(wire)
          ? "per_100_litres"
          : null;
      const value = numOrNull(r.value);
      const min = numOrNull(r.min_value);
      const max = numOrNull(r.max_value);
      if (!basis || (value == null && (min == null || max == null))) {
        if (summary) referenceRates.push({ summary, crop, targetRaw });
        return;
      }
      const unit = bareUnit(str(r.unit), basis);
      if (!unit) {
        if (summary) referenceRates.push({ summary, crop, targetRaw });
        return;
      }
      rateOptions.push({
        id: `staged-${ui}-${ri}`,
        basis,
        unit,
        value,
        minValue: value == null ? min : null,
        maxValue: value == null ? max : null,
        label: str(r.label),
        condition: str(r.condition),
        rawText: str(r.raw_text),
        crop,
        targetRaw,
      });
    });
    registeredUses.push({
      crop,
      targetRaw,
      rates: rateTexts,
      withholdingDays: numOrNull(u.withholding_period_days),
      reEntryHours: numOrNull(u.re_entry_period_hours),
      restrictions: str(u.restrictions),
    });
  });

  const manufacturerLabelUrl = httpOrEmpty(
    labelUrls.manufacturer_label_url ?? registration.manufacturer_label_url,
  );
  const regulatorLabelUrl = httpOrEmpty(
    labelUrls.regulator_label_url ?? registration.regulator_label_url,
  );

  const draft = draftFromRow({
    active_ingredients: actives,
    registered_uses: uses,
    verification_sources: verification.sources,
    verification_conflicts: verification.conflicts,
    verification_unresolved_fields: verification.unresolved_fields,
    verification_status: verification.status,
    verified_at: verification.verified_at,
    registration_country: registration.country_code ?? registration.country,
    registration_scheme: registration.scheme,
    registration_number: registration.registration_number,
    registrant: registration.registrant,
    registered_product_name: registration.registered_product_name ?? productName,
    // The label reference is the manufacturer's own label here. It is NEVER
    // promoted to a regulator label.
    label_reference: registration.label_reference ?? manufacturerLabelUrl,
    label_version: registration.label_version,
  });

  const groupCodes = arr(d.activity_groups).map(str).filter(Boolean);
  const scheme = str(d.activity_group_scheme).toUpperCase();

  return {
    productName,
    registrant: str(registration.registrant ?? d.registrant ?? d.manufacturer),
    registrationNumber: str(registration.registration_number ?? d.registration_number),
    registrationCountry: str(registration.country_code ?? registration.country),
    registrationScheme: str(registration.scheme),
    category: str(d.product_category ?? d.category),
    physicalForm: str(d.form_type),
    activeIngredientText: activeIngredientText(actives),
    activityGroupText: groupCodes.length
      ? groupCodes.map((c) => (scheme ? `${scheme} ${c}` : c)).join(" + ")
      : "",
    resistanceState: normaliseResistanceClassificationState(
      d.resistance_classification_state ?? d.resistanceClassificationState,
    ),
    manufacturerLabelUrl,
    regulatorLabelUrl,
    productUrl: httpOrEmpty(d.product_url ?? registration.manufacturer_product_url),
    registeredForGrapevine: d.registered_for_grapevine === true,
    registeredUses,
    rateOptions,
    referenceRates,
    verificationStatus: str(verification.status),
    draft,
  };
}

/* ---------------------------------------------------------------- response */

export interface StagedLookupResult {
  detail: StagedDetail | null;
  candidates: StagedCandidate[];
  /** Envelope-level state, used when a candidate carries none of its own. */
  resistanceState: ResistanceClassificationState | null;
}

export function parseStagedLookup(data: unknown): StagedLookupResult {
  const root = rec(data);
  const candidates = arr(root.candidates)
    .map(normaliseStagedCandidate)
    .filter((c): c is StagedCandidate => !!c);
  const envelopeState = normaliseResistanceClassificationState(
    root.resistance_classification_state ?? root.resistanceClassificationState,
  );
  const detail = normaliseStagedDetail(root.detail);
  return {
    detail: detail ? { ...detail, resistanceState: detail.resistanceState ?? envelopeState } : null,
    candidates,
    resistanceState: envelopeState,
  };
}

export interface StagedLookupRequest {
  query: string;
  country?: string | null;
  /** Stage B: enrich this exact identified product, not a fresh loose search. */
  selectedName?: string | null;
}

export function buildStagedLookupBody(req: StagedLookupRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    action: STAGED_LOOKUP_ACTION,
    query: req.query.trim(),
  };
  const country = str(req.country);
  if (country) body.country = country;
  const selected = str(req.selectedName);
  if (selected) body.selectedName = selected;
  return body;
}

/**
 * The automatic staged fallback. Called by the portal itself once the Master
 * search has not produced a Review-ready result — the operator never presses a
 * separate "search online" button.
 */
export async function stagedChemicalLookup(
  req: StagedLookupRequest,
): Promise<StagedLookupResult> {
  const { data, error } = await (iosSupabase as any).functions.invoke(STAGED_LOOKUP_FUNCTION, {
    body: buildStagedLookupBody(req),
  });
  if (error) throw error;
  return parseStagedLookup(data);
}

/* ------------------------------------------------- staged default rate init */

export interface StagedDefaultRateInit {
  selections: Record<CanonicalRateBasis, PersistedDefaultRateSelection | null>;
  /** Genuinely different registered options the operator must choose between. */
  ambiguous: Record<CanonicalRateBasis, StagedRateOption[]>;
}

const BASES: CanonicalRateBasis[] = ["per_hectare", "per_100_litres"];

const fingerprint = (o: StagedRateOption): string =>
  [o.basis, o.unit, o.value, o.minValue, o.maxValue].join("|");

/**
 * The staged rate is a REGISTERED label rate, expressed as the vineyard's
 * operational selection. There is no backend-minted option identity for it, so
 * it is written with an empty option identity and `entry_method: "manual"` —
 * exactly as the Master path does. Range/single, amounts and unit are kept.
 */
export function selectionFromStagedRate(
  option: StagedRateOption,
  meta?: { selected_at?: string | null; label_version?: string | null },
): PersistedDefaultRateSelection | null {
  if (!option.unit) return null;
  if (option.value == null && (option.minValue == null || option.maxValue == null)) return null;
  return {
    option_key: "",
    rate_ids: [],
    basis: option.basis,
    unit: option.unit,
    value: option.value,
    min_value: option.value == null ? option.minValue : null,
    max_value: option.value == null ? option.maxValue : null,
    source: "operator",
    entry_method: "manual",
    selected_at: meta?.selected_at ?? null,
    label_version: meta?.label_version ?? null,
  };
}

export function initialiseDefaultRatesFromStaged(
  options: StagedRateOption[],
  meta?: { selected_at?: string | null; label_version?: string | null },
): StagedDefaultRateInit {
  const selections = { per_hectare: null, per_100_litres: null } as StagedDefaultRateInit["selections"];
  const ambiguous = { per_hectare: [], per_100_litres: [] } as StagedDefaultRateInit["ambiguous"];
  for (const basis of BASES) {
    const usable = options.filter((o) => o.basis === basis);
    if (!usable.length) continue;
    const distinct = new Set(usable.map(fingerprint));
    if (usable.length === 1 || distinct.size === 1) {
      selections[basis] = selectionFromStagedRate(usable[0], meta);
    } else {
      ambiguous[basis] = usable;
    }
  }
  return { selections, ambiguous };
}

export function stagedRateSummary(option: StagedRateOption): string {
  const suffix = option.basis === "per_hectare" ? "/ha" : "/100 L";
  const body =
    option.value != null ? String(option.value) : `${option.minValue}–${option.maxValue}`;
  return `${body} ${option.unit}${suffix}`;
}

/* ------------------------------------------------------------ save payload */

/**
 * Vineyard record created from a staged online lookup. Structured intelligence
 * goes through the canonical encoder; the backend resistance state is persisted
 * verbatim into the existing sql/210 column.
 */
export function buildStagedSavedChemicalInput(
  detail: StagedDetail,
  rates: PersistedDefaultRates,
  extras: { costPerUnit?: number | null; notes?: string | null } = {},
): SavedChemicalInput {
  const intelligence: EncodedChemicalIntelligence = encodeChemicalIntelligenceForWrite(detail.draft);
  const perHa = rates.per_hectare;
  const unit = perHa?.unit ?? rates.per_100_litres?.unit;
  const out: SavedChemicalInput = {
    name: detail.productName,
    manufacturer: detail.registrant || undefined,
    active_ingredient: detail.activeIngredientText || undefined,
    product_category: detail.category || undefined,
    product_form: detail.physicalForm || undefined,
    // Label vs product page stay separate concepts: the manufacturer label is
    // the label link, the regulator label wins when the backend resolved one,
    // and the marketing page is never stored as a label.
    label_url: detail.regulatorLabelUrl || detail.manufacturerLabelUrl || undefined,
    product_url: detail.productUrl || undefined,
    rate_per_ha: perHa && perHa.value != null ? perHa.value : null,
    unit,
    default_rates: rates,
    resistance_classification_state: detail.resistanceState,
    intelligence: Object.keys(intelligence).length ? intelligence : undefined,
  };
  if (extras.notes) out.notes = extras.notes;
  if (extras.costPerUnit != null && Number.isFinite(extras.costPerUnit)) {
    out.purchase = { costPerUnit: extras.costPerUnit, currency: "AUD", unit: unit ?? null };
  }
  return out;
}
