// Chemical Search V2 — vineyard Chemical Store / Add Chemical (portal parity
// with the iOS/Android V2 workflow).
//
// Boundaries this module keeps explicit:
//   * `master_chemicals.viticulture_rates` = REGISTERED master information.
//     Read-only here. Adding a chemical to a vineyard never writes Master.
//   * `saved_chemicals.default_rates`      = the VINEYARD operational
//     selection. The Spray Calculator consumes only this.
//   * Master search is database-first: one deterministic RPC, no AI, no web
//     search. When it returns no Review-ready result the staged
//     `web_lookup_v2` fallback runs AUTOMATICALLY (see
//     `@/lib/chemicalStagedLookup`) — there is no operator "search online"
//     button, exactly as on iOS/Android.
//   * `resistance_classification_state` is backend-owned. It is carried through
//     Master RPC → Review → Saved Chemical verbatim, never derived from groups.
//   * Nothing here converts between /ha and /100 L, collapses a range, or
//     picks between genuinely different registered options.
//
// V2 is a controlled rollout: the same gate as mobile (feature flag
// `chemical_search_v2` AND a signed-in System Admin).

import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import { useFeatureFlag } from "@/lib/systemAdmin";
import {
  parseMasterViticultureRates,
  isPersistableMasterRate,
  masterRateSummary,
  bindMasterRateDirections,
  type MasterRateBasis,
  type MasterViticultureRate,
} from "@/lib/masterCuration";
import { decodeCanonicalDefaultRateOptions } from "@/lib/chemicalDefaultRatesContract";
import { selectionFromCanonicalOption } from "@/lib/chemicalDefaultRateSelection";
import type {
  CanonicalDefaultRateOptions,
  CanonicalRateBasis,
  PersistedDefaultRateSelection,
  PersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";
import {
  manualRateSelection,
  type ManualRateDraft,
} from "@/lib/chemicalManualRate";
import {
  normaliseResistanceClassificationState,
  type ResistanceClassificationState,
} from "@/lib/chemicalIntelligence";
import type { SavedChemical, SavedChemicalInput } from "@/lib/savedChemicalsQuery";
import {
  draftFromRow,
  encodeChemicalIntelligenceForWrite,
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";

/* ------------------------------------------------------------------- gate */

export const CHEMICAL_SEARCH_V2_FLAG = "chemical_search_v2";

/** Pure gate — the feature flag alone routes V1 vs V2 (production cutover). */
export const chemicalSearchV2Enabled = (flagEnabled: boolean): boolean =>
  flagEnabled === true;

/** React gate. When the flag is off, the existing V1 workflow is unchanged. */
export function useChemicalSearchV2(): boolean {
  return chemicalSearchV2Enabled(useFeatureFlag(CHEMICAL_SEARCH_V2_FLAG));
}

/* ------------------------------------------------------------ master search */

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/** Compact active-ingredient summary from whatever shape the row carries. */
export function activeIngredientSummary(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).ingredients)
      ? (raw as any).ingredients
      : [];
  const parts: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      if (entry.trim()) parts.push(entry.trim());
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const name = str(o.name ?? o.ingredient ?? o.active_ingredient);
    if (!name) continue;
    const conc = str(o.concentration ?? o.strength ?? o.value);
    const unit = str(o.concentration_unit ?? o.unit);
    parts.push(conc ? `${name} ${conc}${unit ? ` ${unit}` : ""}`.trim() : name);
  }
  return parts.join(" + ");
}

export interface MasterSearchHit {
  id: string;
  productName: string;
  registrant: string;
  registrationNumber: string;
  registrationScheme: string;
  registrationCountry: string;
  activeIngredients: string;
  category: string;
  formType: string;
  labelReference: string;
  labelVersion: string | null;
  catalogueVersion: number | null;
  rates: MasterViticultureRate[];
  /**
   * Backend canonical `default_rate_options` when the Master response carries
   * them; null otherwise. Never synthesised by the Portal.
   */
  defaultRateOptions: CanonicalDefaultRateOptions | null;
  /**
   * Compact search-card indicator only, e.g. "Vineyard rates available: /ha
   * and /100 L · 137 entries". Individual rates are never listed at search
   * level; they appear after selection + structured hydration.
   */
  rateSummary: string;
  /** Master `review_status` verbatim-normalised; null when the RPC omits it. */
  reviewStatus: string | null;
  /** Structured activity groups as the RPC returned them, e.g. "HRAC 10". */
  activityGroupText: string;
  /**
   * SQL 256 `resistance_classification_state`, verbatim from the RPC. NEVER
   * inferred from an empty activity-group array: no state means "not stated",
   * which is not the same fact as "not applicable".
   */
  resistanceState: ResistanceClassificationState | null;
  /**
   * Structured SQL 194 intelligence exactly as the Master RPC returned it,
   * retained for persistence. Display strings above are presentation only.
   */
  structured: MasterStructuredFields;
  /** Canonical Chemical Intelligence draft built via `draftFromRow`. */
  draft: ChemicalIntelligenceDraft;
}

export interface MasterStructuredFields {
  active_ingredients: unknown[];
  activity_groups: string[];
  activity_group_scheme: string | null;
  resistance_classification_state: ResistanceClassificationState | null;
  registration_country: string | null;
  registration_scheme: string | null;
  registration_number: string | null;
  registrant: string | null;
  registered_product_name: string | null;
  label_reference: string | null;
  label_version: string | null;
  verification_status: string | null;
  verification_sources: unknown[];
  verification_conflicts: unknown[];
  verification_unresolved_fields: unknown[];
  verified_at: string | null;
  registered_uses: unknown[];
  label_rate_bases: string[];
}

const arrOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strOrNull = (v: unknown): string | null => str(v) || null;

/**
 * Master actives may carry their group as a bare code ("3") with the scheme
 * held at row level. Qualify it with the row's scheme so the canonical decoder
 * keeps it. A single-active product whose active has no group inherits the
 * row's single structured group; multi-active rows are never paired by guess.
 */
export function qualifyMasterActives(
  actives: unknown[],
  rowGroups: string[],
  rowScheme: string | null,
): unknown[] {
  const scheme = rowScheme ? rowScheme.toLowerCase() : null;
  const out = actives.map((a) => {
    if (typeof a === "string") return { name: a };
    if (!a || typeof a !== "object") return a;
    const o = { ...(a as Record<string, unknown>) };
    const g = o.activity_group ?? o.activityGroup;
    if (typeof g === "string" || typeof g === "number") {
      const raw = String(g).trim();
      const m = raw.match(/^(FRAC|HRAC|IRAC)\s*(.+)$/i);
      o.activity_group = m
        ? { scheme: m[1].toLowerCase(), code: m[2].trim() }
        : scheme
          ? { scheme, code: raw }
          : undefined;
      delete o.activityGroup;
    }
    return o;
  });
  if (
    out.length === 1 &&
    out[0] &&
    typeof out[0] === "object" &&
    !(out[0] as any).activity_group &&
    rowGroups.length === 1 &&
    scheme
  ) {
    (out[0] as any).activity_group = { scheme, code: rowGroups[0] };
  }
  return out;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Tolerant normalisation of one RPC row. The RPC may return the master columns
 * flat or nested (`master` / `row` / `chemical`); an entry without an id or a
 * name is dropped rather than guessed at.
 */
export function normaliseMasterSearchHit(raw: unknown): MasterSearchHit | null {
  if (!raw || typeof raw !== "object") return null;
  const top = raw as Record<string, unknown>;
  const nested =
    (top.master && typeof top.master === "object" ? (top.master as Record<string, unknown>) : null) ??
    (top.row && typeof top.row === "object" ? (top.row as Record<string, unknown>) : null) ??
    (top.chemical && typeof top.chemical === "object" ? (top.chemical as Record<string, unknown>) : null);
  const o: Record<string, unknown> = nested ? { ...nested, ...top } : top;

  const id = str(o.id ?? o.master_chemical_id ?? o.master_id);
  const productName = str(o.registered_product_name ?? o.product_name ?? o.name);
  if (!id || !productName) return null;

  const rates = bindMasterRateDirections(
    parseMasterViticultureRates(o.viticulture_rates).filter(isPersistableMasterRate),
    o.registered_uses,
  );
  const defaultRateOptions = decodeCanonicalDefaultRateOptions(o.default_rate_options);
  const groupCodes = (Array.isArray(o.activity_groups) ? o.activity_groups : [])
    .map(str)
    .filter(Boolean);
  const scheme = str(o.activity_group_scheme).toUpperCase();

  const resistanceState = normaliseResistanceClassificationState(
    o.resistance_classification_state ?? o.resistanceClassificationState,
  );
  const structured: MasterStructuredFields = {
    active_ingredients: qualifyMasterActives(
      arrOf(o.active_ingredients),
      groupCodes,
      strOrNull(o.activity_group_scheme),
    ),
    activity_groups: groupCodes,
    activity_group_scheme: strOrNull(o.activity_group_scheme),
    resistance_classification_state: resistanceState,
    registration_country: strOrNull(o.registration_country),
    registration_scheme: strOrNull(o.registration_scheme),
    registration_number: strOrNull(o.registration_number ?? o.apvma_number),
    registrant: strOrNull(o.registrant ?? o.manufacturer),
    registered_product_name: strOrNull(o.registered_product_name ?? o.product_name ?? o.name),
    label_reference: strOrNull(o.label_reference),
    label_version: strOrNull(o.label_version),
    verification_status: strOrNull(o.verification_status),
    verification_sources: arrOf(o.verification_sources),
    verification_conflicts: arrOf(o.verification_conflicts),
    verification_unresolved_fields: arrOf(o.verification_unresolved_fields),
    verified_at: strOrNull(o.verified_at),
    registered_uses: arrOf(o.registered_uses),
    label_rate_bases: arrOf(o.label_rate_bases).map(str).filter(Boolean),
  };
  const draft = draftFromRow(structured as unknown as Record<string, unknown>);

  return {
    id,
    productName,
    registrant: str(o.registrant ?? o.manufacturer),
    registrationNumber: str(o.registration_number ?? o.apvma_number),
    registrationScheme: str(o.registration_scheme),
    registrationCountry: str(o.registration_country),
    activeIngredients: activeIngredientSummary(o.active_ingredients ?? o.active_ingredient),
    category: str(o.product_category ?? o.category),
    formType: str(o.form_type ?? o.product_form),
    labelReference: str(o.label_reference),
    labelVersion: str(o.label_version) || null,
    catalogueVersion: numOrNull(o.catalogue_version),
    rates,
    defaultRateOptions,
    rateSummary: compactRateIndicator(rates),
    reviewStatus: strOrNull(o.review_status ?? o.catalogue_status)?.toLowerCase() ?? null,
    activityGroupText: groupCodes.length
      ? groupCodes.map((c) => (scheme ? `${scheme} ${c}` : c)).join(" + ")
      : "",
    resistanceState,
    structured,
    draft,
  };
}

/** One-line vineyard-rate indicator for a search card — never the rate list. */
export function compactRateIndicator(rates: MasterViticultureRate[]): string {
  if (!rates.length) return "";
  const bases: string[] = [];
  if (rates.some((r) => r.basis === "per_hectare")) bases.push("/ha");
  if (rates.some((r) => r.basis === "per_100_litres")) bases.push("/100 L");
  const n = rates.length;
  const count = `${n} registered vineyard rate ${n === 1 ? "entry" : "entries"}`;
  return bases.length ? `Vineyard rates available: ${bases.join(" and ")} · ${count}` : count;
}

/**
 * Customer visibility of Master search hits. Ordinary users only see approved
 * products (or hits whose status the RPC does not state — the RPC owns that
 * filter). System admins also see candidates, which the UI labels Candidate.
 */
export function visibleMasterHits(hits: MasterSearchHit[], isSystemAdmin: boolean): MasterSearchHit[] {
  if (isSystemAdmin) return hits;
  return hits.filter((h) => h.reviewStatus == null || h.reviewStatus === "approved");
}

export const isCandidateHit = (h: MasterSearchHit): boolean =>
  h.reviewStatus != null && h.reviewStatus !== "approved";

export const MASTER_SEARCH_RPC = "search_master_chemicals_v2";

/**
 * Database-first Master search. One deterministic RPC call — no AI, no web
 * search, nothing speculative fired while the operator types.
 */
export async function searchMasterChemicalsV2(
  query: string,
  opts: { limit?: number; country?: string | null } = {},
): Promise<MasterSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Live signature is search_master_chemicals_v2(p_query, p_limit) — the RPC
  // has no country parameter, so `opts.country` is intentionally not sent.
  const args: Record<string, unknown> = { p_query: q, p_limit: opts.limit ?? 25 };
  const { data, error } = await (iosSupabase as any).rpc(MASTER_SEARCH_RPC, args);
  if (error) throw error;
  const rows: unknown[] = Array.isArray(data) ? data : data ? [data] : [];
  return rows
    .map(normaliseMasterSearchHit)
    .filter((h): h is MasterSearchHit => !!h);
}

/* ------------------------------ master rates → operational default rates */

/**
 * A Master registered rate expressed as a vineyard operational selection.
 *
 * Master rates carry no backend-minted `default_option_v1_*` / `rate_v1_*`
 * identity, so the selection is written with an EMPTY option identity and
 * `entry_method: "manual"` — the only representable honest shape. Single/range,
 * amounts, unit and basis are preserved exactly; nothing is converted.
 */
export function selectionFromMasterRate(
  rate: MasterViticultureRate,
  meta?: { selected_at?: string | null; label_version?: string | null },
  options?: CanonicalDefaultRateOptions | null,
): PersistedDefaultRateSelection | null {
  if (!isPersistableMasterRate(rate)) return null;
  if (!rate.unit) return null;
  const canonical = canonicalOptionForMasterRate(rate, options);
  if (canonical) {
    return selectionFromCanonicalOption(canonical, {
      source: "operator",
      selectedAt: meta?.selected_at ?? null,
      labelVersion: meta?.label_version ?? null,
    });
  }
  return {
    option_key: "",
    rate_ids: [],
    basis: rate.basis as CanonicalRateBasis,
    unit: rate.unit,
    value: rate.kind === "single" ? rate.value : null,
    min_value: rate.kind === "range" ? rate.min_value : null,
    max_value: rate.kind === "range" ? rate.max_value : null,
    source: "operator",
    entry_method: "manual",
    selected_at: meta?.selected_at ?? null,
    label_version: meta?.label_version ?? null,
  };
}

/**
 * The ONE backend canonical option that cites this rate's persisted identity
 * with an identical basis, unit and amount. Zero or several → null (the
 * selection stays an honest manual entry; nothing is minted or guessed).
 */
export function canonicalOptionForMasterRate(
  rate: MasterViticultureRate,
  options?: CanonicalDefaultRateOptions | null,
) {
  if (!options || !rate.source_id) return null;
  const list = options[rate.basis as CanonicalRateBasis] ?? [];
  const hits = list.filter(
    (o) =>
      o.rate_ids.includes(rate.source_id as string) &&
      o.unit === rate.unit &&
      o.value === (rate.kind === "single" ? rate.value : null) &&
      o.min_value === (rate.kind === "range" ? rate.min_value : null) &&
      o.max_value === (rate.kind === "range" ? rate.max_value : null),
  );
  return hits.length === 1 ? hits[0] : null;
}

export interface MasterDefaultRateInit {
  /** Automatically initialised selections, per basis, independently. */
  selections: Record<CanonicalRateBasis, PersistedDefaultRateSelection | null>;
  /** Genuinely different registered options the operator must choose between. */
  ambiguous: Record<CanonicalRateBasis, MasterViticultureRate[]>;
}

const BASES: CanonicalRateBasis[] = ["per_hectare", "per_100_litres"];

const rateFingerprint = (r: MasterViticultureRate): string =>
  [r.basis, r.kind, r.unit, r.value, r.min_value, r.max_value].join("|");

/**
 * V2-only automatic initialisation. For EACH basis independently: exactly one
 * usable registered option becomes the vineyard default; several genuinely
 * different options stay unselected and are offered for choice.
 */
export function initialiseDefaultRatesFromMaster(
  rates: MasterViticultureRate[],
  meta?: { selected_at?: string | null; label_version?: string | null },
  options?: CanonicalDefaultRateOptions | null,
): MasterDefaultRateInit {
  const selections = { per_hectare: null, per_100_litres: null } as MasterDefaultRateInit["selections"];
  const ambiguous = { per_hectare: [], per_100_litres: [] } as MasterDefaultRateInit["ambiguous"];

  for (const basis of BASES) {
    const usable = rates.filter(
      (r) => (r.basis as CanonicalRateBasis) === basis && isPersistableMasterRate(r),
    );
    if (usable.length === 0) continue;
    const distinct = new Set(usable.map(rateFingerprint));
    if (usable.length === 1 || distinct.size === 1) {
      selections[basis] = selectionFromMasterRate(usable[0], meta, options);
    } else {
      ambiguous[basis] = usable;
    }
  }
  return { selections, ambiguous };
}

export function persistedDefaultRates(
  selections: Partial<Record<CanonicalRateBasis, PersistedDefaultRateSelection | null>>,
): PersistedDefaultRates {
  return {
    version: 1,
    per_hectare: selections.per_hectare ?? null,
    per_100_litres: selections.per_100_litres ?? null,
  };
}

export const hasAnyDefaultRate = (rates: PersistedDefaultRates | null | undefined): boolean =>
  !!rates && (!!rates.per_hectare || !!rates.per_100_litres);

/* --------------------------------------------------------- duplicate check */

export const normaliseChemicalName = (v: unknown): string =>
  String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export type DuplicateReason = "master" | "registration" | "name";

export interface DuplicateMatch {
  chemical: SavedChemical;
  reason: DuplicateReason;
}

/**
 * Master id first, then registration identity, then an EXACT normalised name.
 * No fuzzy matching — a near miss must never block the operator.
 */
export function findVineyardDuplicate(
  library: readonly SavedChemical[],
  ident: { masterChemicalId?: string | null; registrationNumber?: string | null; name?: string | null },
): DuplicateMatch | null {
  const masterId = str(ident.masterChemicalId);
  if (masterId) {
    const hit = library.find((c) => str(c.master_chemical_id) === masterId);
    if (hit) return { chemical: hit, reason: "master" };
  }
  const reg = str(ident.registrationNumber).toLowerCase();
  if (reg) {
    const hit = library.find((c) => str(c.registration_number).toLowerCase() === reg);
    if (hit) return { chemical: hit, reason: "registration" };
  }
  const name = normaliseChemicalName(ident.name);
  if (name) {
    const hit = library.find(
      (c) =>
        normaliseChemicalName(c.name) === name ||
        normaliseChemicalName(c.registered_product_name) === name,
    );
    if (hit) return { chemical: hit, reason: "name" };
  }
  return null;
}

export const DUPLICATE_MESSAGE: Record<DuplicateReason, string> = {
  master: "This chemical is already in your Chemical Store.",
  registration: "A chemical with this registration number is already in your Chemical Store.",
  name: "A chemical with this name is already in your Chemical Store.",
};

/* ------------------------------------------------------------ save payloads */

/** Optional detail fields shared by both V2 paths. None of them block Save. */
export interface V2OptionalDetails {
  manufacturer?: string;
  registrationNumber?: string;
  productCategory?: string;
  productForm?: string;
  activeIngredient?: string;
  activityGroup?: string;
  labelUrl?: string;
  productUrl?: string;
  notes?: string;
  costPerUnit?: string;
  inventoryQuantity?: string;
  inventoryUnit?: string;
}

const optionalText = (v: string | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t === "" ? undefined : t;
};

const optionalNumber = (v: string | undefined): number | undefined => {
  const t = (v ?? "").trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** The legacy per-hectare scalar only when there genuinely is one. */
function legacyScalar(rates: PersistedDefaultRates): { rate_per_ha: number | null; unit?: string } {
  const perHa = rates.per_hectare;
  if (perHa && perHa.value != null) return { rate_per_ha: perHa.value, unit: perHa.unit };
  const anyUnit = perHa?.unit ?? rates.per_100_litres?.unit;
  return { rate_per_ha: null, unit: anyUnit };
}

function applyOptional(out: SavedChemicalInput, details: V2OptionalDetails) {
  const manufacturer = optionalText(details.manufacturer);
  if (manufacturer) out.manufacturer = manufacturer;
  const category = optionalText(details.productCategory);
  if (category) out.product_category = category;
  const form = optionalText(details.productForm);
  if (form) out.product_form = form;
  const ai = optionalText(details.activeIngredient);
  if (ai) out.active_ingredient = ai;
  const group = optionalText(details.activityGroup);
  if (group) out.chemical_group = group;
  const labelUrl = optionalText(details.labelUrl);
  if (labelUrl) out.label_url = labelUrl;
  const productUrl = optionalText(details.productUrl);
  if (productUrl) out.product_url = productUrl;
  const notes = optionalText(details.notes);
  if (notes) out.notes = notes;
  const inventoryQuantity = optionalNumber(details.inventoryQuantity);
  if (inventoryQuantity != null) out.inventory_quantity = inventoryQuantity;
  const inventoryUnit = optionalText(details.inventoryUnit);
  if (inventoryUnit) out.inventory_unit = inventoryUnit;
  const cost = optionalNumber(details.costPerUnit);
  if (cost != null) {
    out.purchase = { costPerUnit: cost, currency: "AUD", unit: out.unit ?? null };
  }
}

/** Vineyard record created from a Master Catalogue product. */
export function buildMasterSavedChemicalInput(
  hit: MasterSearchHit,
  rates: PersistedDefaultRates,
  details: V2OptionalDetails = {},
): SavedChemicalInput {
  const legacy = legacyScalar(rates);
  // Canonical SQL 194 encoder — same semantics as the staged online path.
  // Tolerates hits built without a draft (older callers/tests).
  const intelligence = encodeChemicalIntelligenceForWrite(
    hit.draft ?? (hit.structured ? draftFromRow(hit.structured as any) : null),
  );
  const out: SavedChemicalInput = {
    name: hit.productName,
    manufacturer: hit.registrant || undefined,
    active_ingredient: hit.activeIngredients || undefined,
    product_category: hit.category || undefined,
    label_url: /^https?:\/\//i.test(hit.labelReference) ? hit.labelReference : undefined,
    rate_per_ha: legacy.rate_per_ha,
    unit: legacy.unit,
    default_rates: rates,
    master_chemical_id: hit.id,
    master_source_revision: hit.catalogueVersion ?? undefined,
    // Master's own structured state, carried through verbatim. Never derived
    // from the activity group list.
    resistance_classification_state: hit.resistanceState,
    intelligence: Object.keys(intelligence).length ? intelligence : undefined,
  };
  applyOptional(out, details);
  return out;
}

/**
 * Hand-entered vineyard chemical. Phase 0 minimum operational contract: a name
 * and a valid operational default rate. No registered_use is fabricated and no
 * Master Chemical is created.
 */
export function buildManualSavedChemicalInput(
  name: string,
  draft: ManualRateDraft,
  details: V2OptionalDetails = {},
): SavedChemicalInput | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // The label-check tick is informational in V2 manual entry and never gates.
  const selection = manualRateSelection(draft, { selected_at: new Date().toISOString() }, {
    requireConfirmation: false,
  });
  if (!selection) return null;
  const rates = persistedDefaultRates({ [selection.basis]: selection });
  const legacy = legacyScalar(rates);
  const out: SavedChemicalInput = {
    name: trimmed,
    rate_per_ha: legacy.rate_per_ha,
    unit: legacy.unit,
    default_rates: rates,
    // Hand entry carries no structured resistance evidence. It is UNRESOLVED —
    // a typed group letter in the optional fields never makes it applicable and
    // an absent group never becomes "not applicable".
    resistance_classification_state: "unresolved",
  };
  applyOptional(out, details);
  return out;
}

/* ---------------------------------------------------- staged online fallback */
//
// The explicit "Search label online" operator action is GONE. The staged
// `web_lookup_v2` fallback runs automatically once the Master search has not
// produced a Review-ready result; its contract lives in
// `@/lib/chemicalStagedLookup`.

/** Display helper — "2.4–3.2 L/ha" for a persisted selection. */
export function selectionSummary(selection: PersistedDefaultRateSelection): string {
  const suffix = selection.basis === "per_hectare" ? "/ha" : "/100 L";
  const body =
    selection.value != null
      ? String(selection.value)
      : `${selection.min_value}–${selection.max_value}`;
  return `${body} ${selection.unit}${suffix}`;
}

export const masterRateBasisOf = (r: MasterViticultureRate): MasterRateBasis => r.basis;

/* ------------------------------ selected-result structured hydration */

/**
 * Hydrates ONE selected Master result through the existing
 * `chemical-info-lookup` structured action (Rork contract 7e80e5d9) to obtain
 * the backend canonical `default_rate_options`. Search itself never carries
 * them. Fires only on selection, never while typing.
 *
 * Fail-closed: any failure, identity mismatch, unresolved response or missing
 * options returns no options — the Portal never mints or reconstructs an
 * option/rate/direction identity; rates then save as honest manual entries.
 */
export type MasterHydrationResult =
  | { status: "hydrated"; options: CanonicalDefaultRateOptions }
  | { status: "unavailable" | "identity_mismatch" | "unresolved" | "no_options"; options: null };

export const MASTER_HYDRATION_FAILED_TEXT =
  "Catalogue rate details could not be fully loaded. A rate you choose will be saved as a manual rate without its catalogue reference.";

const COUNTRY_NAME: Record<string, string> = { AU: "Australia", NZ: "New Zealand" };
const normCountry = (v: unknown): string => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const up = s.toUpperCase();
  if (COUNTRY_NAME[up]) return up;
  const hit = Object.entries(COUNTRY_NAME).find(([, n]) => n.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : up;
};
const normReg = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface MasterHydrationOptions {
  /**
   * System Admin exact-ID candidate preview. Sent ONLY for a candidate hit
   * selected by a System Admin; the backend re-checks admin status itself and
   * must keep ordinary structured serving approved-only. Read-only.
   */
  adminCandidatePreview?: boolean;
}

export function masterHydrationRequestBody(
  hit: MasterSearchHit,
  correlationId?: string,
  opts: MasterHydrationOptions = {},
) {
  const code = normCountry(hit.registrationCountry);
  const country = COUNTRY_NAME[code] ?? hit.registrationCountry;
  const preview = opts.adminCandidatePreview === true && isCandidateHit(hit);
  return {
    ...(preview ? { admin_candidate_preview: true } : {}),
    action: "structured" as const,
    country,
    productName: hit.productName,
    registrationNumber: hit.registrationNumber,
    registrationScheme: hit.registrationScheme,
    master_chemical_id: hit.id,
    client: { platform: "portal", correlation_id: correlationId ?? `portal-${Date.now().toString(36)}` },
  };
}

/** Pure: validate a structured response against the selected Master identity. */
export function parseMasterHydration(hit: MasterSearchHit, payload: unknown): MasterHydrationResult {
  const top = (payload && typeof payload === "object" ? payload : null) as Record<string, any> | null;
  if (!top) return { status: "unavailable", options: null };
  const inner =
    [top.master, top.product, top.result, top.chemical].find((x) => x && typeof x === "object") ?? {};
  const o: Record<string, any> = { ...inner, ...top };
  const state = String(o.status ?? o.resolution ?? o.resolution_state ?? "").toLowerCase();
  const masterId = str(o.master_chemical_id ?? inner.master_chemical_id ?? inner.id);
  if (state === "unresolved" || !masterId) return { status: "unresolved", options: null };
  if (masterId !== hit.id) return { status: "identity_mismatch", options: null };
  const reg = o.registration_number ?? o.registrationNumber;
  if (normReg(reg) !== normReg(hit.registrationNumber) || !normReg(reg)) {
    return { status: "identity_mismatch", options: null };
  }
  const country = o.registration_country ?? o.country;
  if (country != null && hit.registrationCountry && normCountry(country) !== normCountry(hit.registrationCountry)) {
    return { status: "identity_mismatch", options: null };
  }
  const key = str(o.registration_identity_key);
  const expectedKey = `${normCountry(hit.registrationCountry)}:${hit.registrationScheme.toLowerCase()}:${hit.registrationNumber}`;
  if (key && hit.registrationScheme && key.toLowerCase() !== expectedKey.toLowerCase()) {
    return { status: "identity_mismatch", options: null };
  }
  const decoded = decodeCanonicalDefaultRateOptions(o.default_rate_options);
  if (!decoded) return { status: "no_options", options: null };
  // Condition-ambiguous options are never used to label a rate canonically.
  const options: CanonicalDefaultRateOptions = {
    per_hectare: decoded.per_hectare.filter((x) => x.condition_ambiguous !== true),
    per_100_litres: decoded.per_100_litres.filter((x) => x.condition_ambiguous !== true),
  };
  return { status: "hydrated", options };
}

export async function hydrateMasterSelection(
  hit: MasterSearchHit,
  invoke: (body: unknown) => Promise<{ data: unknown; error: unknown }> = (body) =>
    (iosSupabase as any).functions.invoke("chemical-info-lookup", { body }),
  opts: MasterHydrationOptions = {},
): Promise<MasterHydrationResult> {
  if (!hit.registrationNumber || !hit.registrationCountry) return { status: "unavailable", options: null };
  try {
    const { data, error } = await invoke(masterHydrationRequestBody(hit, undefined, opts));
    if (error) return { status: "unavailable", options: null };
    return parseMasterHydration(hit, data);
  } catch {
    return { status: "unavailable", options: null };
  }
}
