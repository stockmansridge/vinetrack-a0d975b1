// Chemical Search V2 — vineyard Chemical Store / Add Chemical (portal parity
// with the iOS/Android V2 workflow).
//
// Boundaries this module keeps explicit:
//   * `master_chemicals.viticulture_rates` = REGISTERED master information.
//     Read-only here. Adding a chemical to a vineyard never writes Master.
//   * `saved_chemicals.default_rates`      = the VINEYARD operational
//     selection. The Spray Calculator consumes only this.
//   * Master search is database-first: one deterministic RPC, no AI, no web
//     search. The online label lookup is an EXPLICIT operator action.
//   * Nothing here converts between /ha and /100 L, collapses a range, or
//     picks between genuinely different registered options.
//
// V2 is a controlled rollout: the same gate as mobile (feature flag
// `chemical_search_v2` AND a signed-in System Admin).

import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import { useFeatureFlag, useIsSystemAdmin } from "@/lib/systemAdmin";
import {
  parseMasterViticultureRates,
  isPersistableMasterRate,
  masterRateSummary,
  type MasterRateBasis,
  type MasterViticultureRate,
} from "@/lib/masterCuration";
import type {
  CanonicalRateBasis,
  PersistedDefaultRateSelection,
  PersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";
import {
  manualRateSelection,
  type ManualRateDraft,
} from "@/lib/chemicalManualRate";
import { buildStructuredLookupBody } from "@/lib/chemicalLookupRequest";
import type { SavedChemical, SavedChemicalInput } from "@/lib/savedChemicalsQuery";

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
  /** Display only — "2.4–3.2 L/ha · 240–320 mL/100 L". */
  rateSummary: string;
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

  const rates = parseMasterViticultureRates(o.viticulture_rates).filter(isPersistableMasterRate);

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
    rateSummary: rates.map(masterRateSummary).join(" · "),
  };
}

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
  const args: Record<string, unknown> = { p_query: q, p_limit: opts.limit ?? 25 };
  if (opts.country) args.p_country = opts.country;
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
): PersistedDefaultRateSelection | null {
  if (!isPersistableMasterRate(rate)) return null;
  if (!rate.unit) return null;
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
      selections[basis] = selectionFromMasterRate(usable[0], meta);
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
  };
  applyOptional(out, details);
  return out;
}

/* ------------------------------------------------- explicit online fallback */

export const ONLINE_FALLBACK_LABEL = "Can't find it? Search label online";

export interface OnlineLookupResult {
  productName: string;
  registrant: string;
  registrationNumber: string;
  category: string;
  activeIngredients: string;
  labelUrl: string;
  productUrl: string;
}

/**
 * The existing production `chemical-info-lookup` edge function, invoked ONLY
 * from an explicit operator action. Its result still goes through a Review
 * screen, and the operational default is always the operator's choice.
 */
export async function lookupChemicalLabelOnline(
  productName: string,
  countryCode: string,
): Promise<OnlineLookupResult | null> {
  const { data, error } = await (iosSupabase as any).functions.invoke("chemical-info-lookup", {
    body: buildStructuredLookupBody(productName.trim(), countryCode),
  });
  if (error) throw error;
  return normaliseOnlineLookup(data, productName);
}

export function normaliseOnlineLookup(data: unknown, fallbackName: string): OnlineLookupResult | null {
  if (!data || typeof data !== "object") return null;
  const top = data as Record<string, unknown>;
  const inner =
    (top.chemical && typeof top.chemical === "object" ? (top.chemical as Record<string, unknown>) : null) ??
    (top.product && typeof top.product === "object" ? (top.product as Record<string, unknown>) : null) ??
    (top.result && typeof top.result === "object" ? (top.result as Record<string, unknown>) : null);
  const o: Record<string, unknown> = inner ? { ...inner, ...top } : top;
  const name = str(o.registered_product_name ?? o.productName ?? o.product_name ?? o.name) || fallbackName.trim();
  if (!name) return null;
  const labelUrl = str(o.label_reference ?? o.labelUrl ?? o.label_url);
  const productUrl = str(o.product_url ?? o.productUrl);
  return {
    productName: name,
    registrant: str(o.registrant ?? o.manufacturer),
    registrationNumber: str(o.registration_number ?? o.registrationNumber),
    category: str(o.product_category ?? o.category),
    activeIngredients: activeIngredientSummary(o.active_ingredients ?? o.active_ingredient),
    labelUrl: /^https?:\/\//i.test(labelUrl) ? labelUrl : "",
    productUrl: /^https?:\/\//i.test(productUrl) ? productUrl : "",
  };
}

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
