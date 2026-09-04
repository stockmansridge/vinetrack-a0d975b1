// Authoritative chemical DISCOVERY flow.
//
// Product discovery now goes through the shared VineTrack
// `chemical-info-lookup` function with `action: "search"`. The server owns
// candidate ranking; the portal:
//
//   * renders candidates in EXACT server order,
//   * never re-sorts, fuzzy-matches or substitutes a registration,
//   * never promotes a Master record or a saved vineyard chemical,
//   * pins the SELECTED registration through the structured lookup.
//
// The Master catalogue and the vineyard's saved chemicals are reused only for
// the *same exact identity* the user selected (registration number first).

import {
  buildSearchLookupBody,
  buildStructuredLookupBody,
} from "@/lib/chemicalLookupRequest";
import {
  parseServerRankedCandidates,
  type LookupDiagnostics,
  type RankingSummary,
  type ServerRankingMetadata,
} from "@/lib/chemicalLookupDiagnostics";
import type { MasterChemicalRow } from "@/lib/masterChemicals";

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? undefined : s;
};

/** Registration numbers compare on alphanumerics only. */
export const normaliseRegistrationNumber = (v: unknown): string =>
  String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");


/* ---------------------------------------------------------- candidates */

export interface SearchCandidate {
  /** Zero-based position in the server-supplied order. Never recomputed. */
  index: number;
  productName?: string;
  registrant?: string;
  registrationNumber?: string;
  registrationScheme?: string;
  registrationCountry?: string;
  identityKey?: string;
  activeIngredientText?: string;
  /**
   * Product category / primary use EXACTLY as returned by the server. The
   * portal never infers or derives a category client-side.
   */
  category?: string;
  labelReference?: string;
  ranking: ServerRankingMetadata;
  serverRanked: boolean;
  raw: Record<string, unknown>;
}


export interface ChemicalSearchResponse {
  candidates: SearchCandidate[];
  /** True when the server supplied ranking metadata on any row. */
  serverRanked: boolean;
  summary: RankingSummary | null;
  diagnostics: LookupDiagnostics | null;
}

/** True when the payload speaks the search contract (candidate array present). */
export function isSearchEnvelope(payload: unknown): boolean {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  return ["candidates", "results", "matches", "products"].some((k) => Array.isArray(root[k]));
}

export function parseSearchCandidates(payload: unknown): ChemicalSearchResponse {
  const ranked = parseServerRankedCandidates<Record<string, unknown>>(payload);
  const candidates = ranked.candidates.map((c) => {
    const o = (c.raw && typeof c.raw === "object" ? c.raw : {}) as Record<string, any>;
    return {
      index: c.index,
      productName:
        str(o.registered_product_name) ?? str(o.product_name) ?? str(o.productName) ?? str(o.name),
      // The live wire format is camelCase (`brand`, `activeIngredient`,
      // `primaryUse`); older payloads are snake_case. Both are normalised here
      // — this function is the single search normalisation boundary.
      registrant:
        str(o.registrant) ?? str(o.brand) ?? str(o.manufacturer) ?? str(o.company),
      registrationNumber: str(o.registration_number) ?? str(o.registrationNumber),
      registrationScheme: str(o.registration_scheme) ?? str(o.registrationScheme),
      registrationCountry:
        str(o.registration_country) ?? str(o.registrationCountry) ?? str(o.country),
      identityKey: str(o.registration_identity_key) ?? str(o.identity_key),
      activeIngredientText:
        str(o.activeIngredient) ??
        str(o.active_ingredient) ??
        str(o.active_ingredients_text) ??
        str(o.actives),
      category:
        str(o.product_category) ??
        str(o.category) ??
        str(o.productCategory) ??
        str(o.primaryUse) ??
        str(o.primary_use),
      labelReference: str(o.label_reference) ?? str(o.label_url),

      ranking: c.ranking,
      serverRanked: c.serverRanked,
      raw: o,
    } satisfies SearchCandidate;
  });
  return {
    candidates,
    serverRanked: ranked.serverRanked,
    summary: ranked.summary,
    diagnostics: ranked.diagnostics,
  };
}

/* ------------------------------------------------------------- requests */

export function searchRequestBody(query: string, country: string, correlationId: string) {
  return buildSearchLookupBody(query, country, { correlationId });
}

/**
 * Structured lookup for a SELECTED candidate. The registration the user chose
 * is pinned — the free-text query is never used to re-resolve identity.
 */
export function structuredRequestBodyForCandidate(
  candidate: SearchCandidate,
  country: string,
  correlationId: string,
) {
  const extra: Record<string, unknown> = { correlationId };
  if (candidate.registrationNumber) {
    extra.registration_number = candidate.registrationNumber;
    extra.exact_registration_number = candidate.registrationNumber;
  }
  if (candidate.registrationScheme) extra.registration_scheme = candidate.registrationScheme;
  if (candidate.registrationCountry) {
    extra.registration_country = candidate.registrationCountry;
  }
  if (candidate.identityKey) extra.registration_identity_key = candidate.identityKey;
  return buildStructuredLookupBody(candidate.productName ?? "", country, extra);
}

/* ------------------------------------------------- identity-scoped reuse */

/**
 * A Master row may be reused ONLY when it is the same registration the user
 * selected. A name-only local match must never substitute a registration.
 */
export function masterForCandidate(
  rows: MasterChemicalRow[],
  candidate: SearchCandidate,
): MasterChemicalRow | null {
  const reg = normaliseRegistrationNumber(candidate.registrationNumber);
  if (!reg) return null;
  const hits = rows.filter((r) => normaliseRegistrationNumber(r.registration_number) === reg);
  return hits.length === 1 ? hits[0] : null;
}

export interface SavedChemicalIdentity {
  id: string;
  name?: string | null;
  active_ingredient?: string | null;
  registration_number?: string | null;
}

/**
 * Informational only: is this exact candidate already in the vineyard store?
 *
 * IDENTITY RULE: registration number ONLY. Both sides must carry a
 * registration number and they must normalise to the same value. A name-only
 * saved chemical is never presented as proof that a registered candidate is
 * the same product (an unresolved saved record such as "Hortitrol Winter Oil"
 * with a null registration number must not badge a registered candidate).
 * Never used for ranking, ordering or auto-selection.
 */
export function savedChemicalForCandidate(
  saved: SavedChemicalIdentity[],
  candidate: SearchCandidate,
): SavedChemicalIdentity | null {
  const reg = normaliseRegistrationNumber(candidate.registrationNumber);
  if (!reg) return null;
  const byReg = saved.filter((s) => normaliseRegistrationNumber(s.registration_number) === reg);
  return byReg.length ? byReg[0] : null;
}


export const ALREADY_IN_STORE_LABEL = "Already in your Chemical Store";

/**
 * Does the server consider the search ambiguous? Absent summary ⇒ the portal
 * requires selection anyway (it never auto-picks the first candidate).
 */
export function requiresCandidateSelection(res: ChemicalSearchResponse): boolean {
  if (res.candidates.length === 0) return false;
  if (res.candidates.length > 1) return true;
  // Exactly one candidate: only streamline when the server explicitly says the
  // result may be taken without confirmation.
  const s = res.summary;
  if (!s) return true;
  if (s.autoSelectAllowed === true) return false;
  if (s.autoSelectAllowed === false) return true;
  return s.ambiguous !== false;
}

