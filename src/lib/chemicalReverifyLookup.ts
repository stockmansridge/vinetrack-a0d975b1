// P5 — Saved Chemical re-verification against the AUTHORITATIVE resolver.
//
// Re-verify re-resolves the SAME product identity through the shared VineTrack
// `chemical-info-lookup` resolver (the same route Add Chemical uses), then
// merges only authoritative, provenance-backed evidence into the stored draft.
//
// Nothing here writes to the database and nothing here can weaken a stored
// record: an unresolved, ambiguous, foreign or AI-only answer leaves the Saved
// Chemical exactly as it was. Historical spray snapshots are never touched —
// they store their own point-in-time copy.
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import { buildStructuredLookupBody } from "@/lib/chemicalLookupRequest";
import {
  isStructuredLookupEnvelope,
  parseChemicalLookup,
  type ChemicalLookupResult,
} from "@/lib/chemicalLookupResolver";
import {
  type ChemicalIntelligenceDraft,
  normaliseCountry,
  resolveVerificationStatus,
} from "@/lib/chemicalIntelligenceWrite";
import {
  jurisdictionMismatchMessage,
  jurisdictionSuitability,
  jurisdictionVerifyPrompt,
} from "@/lib/chemicalJurisdiction";
import {
  classifyChangeState,
  diffChemicalDrafts,
  mergeAuthoritativeDraft,
  productNameTokens,
  resolveReverifyIdentity,
  type ReverifyIdentity,
  type ReverifyResult,
} from "@/lib/chemicalReverify";

/** Raised when the resolver itself could not be reached or did not answer. */
export class ReverifySourceUnavailable extends Error {}

export type ReverifyResolver = (
  identity: ReverifyIdentity,
  vineyardCountry: string,
) => Promise<ChemicalLookupResult>;

/** Default resolver call — shared VineTrack `chemical-info-lookup`. */
export const authoritativeReverifyResolver: ReverifyResolver = async (
  identity,
  vineyardCountry,
) => {
  const { data, error } = await iosSupabase.functions.invoke("chemical-info-lookup", {
    body: buildStructuredLookupBody(identity.query, vineyardCountry, {
      registration_number: identity.registrationNumber ?? null,
      registration_scheme: identity.registrationScheme ?? null,
      reverify: true,
    }),
  });
  if (error || !isStructuredLookupEnvelope(data)) {
    throw new ReverifySourceUnavailable(
      error?.message ?? "The chemical lookup service did not return an authoritative answer.",
    );
  }
  return parseChemicalLookup(data, vineyardCountry);
};

const sameToken = (a: string | null | undefined, b: string | null | undefined) => {
  const x = productNameTokens(a);
  const y = productNameTokens(b);
  return !!x.length && !!y.length && x.join(" ") === y.join(" ");
};

/**
 * Does the resolved record describe the SAME registered product as the stored
 * Saved Chemical? A stored registration number is decisive — the portal never
 * re-keys a Saved Chemical onto another registration.
 */
export function resolvedMatchesStored(
  identity: ReverifyIdentity,
  resolved: ChemicalIntelligenceDraft,
): boolean {
  const storedNumber = (identity.registrationNumber ?? "").trim();
  const gotNumber = (resolved.registration.number ?? "").trim();
  if (storedNumber && gotNumber) return storedNumber === gotNumber;
  if (storedNumber && !gotNumber) return false;
  return sameToken(
    identity.productName ?? identity.query,
    resolved.registration.registered_product_name ?? identity.productName,
  );
}

/** Turn one authoritative resolver answer into a user-facing re-verify result. */
export function reverifyFromLookupResult(args: {
  draft: ChemicalIntelligenceDraft;
  identity: ReverifyIdentity;
  result: ChemicalLookupResult;
  vineyardCountry: string;
}): ReverifyResult {
  const { draft, identity, result, vineyardCountry } = args;

  // --- unresolved / ambiguous / AI-only ------------------------------------
  if (!result.authoritative || !result.draft) {
    const ambiguous = result.matchSource === "ambiguous";
    return {
      outcome: "needs_review",
      state: "unresolved",
      title: ambiguous ? "More than one registration matched" : "Product not resolved",
      detail:
        (result.guidance ??
          "No registered label could be resolved for this product.") +
        " Nothing was changed — the existing Saved Chemical is unchanged.",
      identity,
      diff: [],
    };
  }

  // --- jurisdiction is authoritative ---------------------------------------
  const resolvedCountry =
    normaliseCountry(result.draft.registration.country) ??
    normaliseCountry(result.jurisdiction.country);
  const jurisdiction = jurisdictionSuitability(resolvedCountry, vineyardCountry);
  if (jurisdiction === "mismatch") {
    return {
      outcome: "needs_review",
      state: "unresolved",
      title: "Not registered for this vineyard's country",
      detail: `${jurisdictionMismatchMessage(resolvedCountry, vineyardCountry)}. ${jurisdictionVerifyPrompt(
        vineyardCountry,
      )} Nothing was changed.`,
      identity,
      diff: [],
      jurisdiction,
    };
  }

  // --- identity guard ------------------------------------------------------
  if (!resolvedMatchesStored(identity, result.draft)) {
    return {
      outcome: "needs_review",
      state: "unresolved",
      title: "Resolved record does not match this chemical",
      detail: `The resolver returned a different registered product to ${identity.description}. Nothing was changed.`,
      identity,
      diff: [],
      jurisdiction,
    };
  }

  const proposed = mergeAuthoritativeDraft(draft, result.draft);
  const diff = diffChemicalDrafts(draft, proposed);

  if (proposed.conflicts.length > 0) {
    return {
      outcome: "needs_review",
      state: "conflict",
      title: "Evidence conflict",
      detail:
        "The refreshed authoritative evidence conflicts with the stored record. Review each difference before accepting.",
      identity,
      proposed,
      diff,
      jurisdiction,
    };
  }

  if (!diff.length) {
    const refreshed: ChemicalIntelligenceDraft = { ...proposed };
    const status = resolveVerificationStatus(refreshed);
    refreshed.verifiedAt =
      status === "verified" || status === "partially_verified"
        ? new Date().toISOString()
        : (refreshed.verifiedAt ?? null);
    return {
      outcome: "current",
      state: "no_change",
      title: "No material change",
      detail: `The current label for ${identity.description} matches the stored record. Evidence timestamps refreshed.`,
      identity,
      proposed: refreshed,
      diff: [],
      jurisdiction,
    };
  }

  const state = classifyChangeState(diff);
  return {
    outcome: "updated",
    state,
    title:
      state === "new_authoritative"
        ? "New authoritative data available"
        : "Authoritative data updated",
    detail: `The current label for ${identity.description} differs from the stored record. Review before accepting — nothing has been changed yet.`,
    identity,
    proposed,
    diff,
    jurisdiction,
  };
}

/**
 * Full re-verify run against the authoritative resolver. Any transport or
 * contract failure resolves to "Source unavailable" with the stored record
 * intact.
 */
export async function reverifySavedChemical(args: {
  draft: ChemicalIntelligenceDraft;
  productName?: string | null;
  /** The current vineyard's ISO-2 country — the only jurisdiction authority. */
  vineyardCountry: string;
  resolver?: ReverifyResolver;
}): Promise<ReverifyResult> {
  const { draft, productName, vineyardCountry } = args;
  const resolver = args.resolver ?? authoritativeReverifyResolver;
  const identity = resolveReverifyIdentity(draft, productName, vineyardCountry);
  if (!identity) {
    return {
      outcome: "failed",
      state: "unresolved",
      title: "Could not re-verify",
      detail: "No product identity to look up. Add a product name or registration number first.",
      diff: [],
    };
  }

  let result: ChemicalLookupResult;
  try {
    result = await resolver(identity, vineyardCountry);
  } catch (e: any) {
    return {
      outcome: "failed",
      state: "unavailable",
      title: "Source unavailable",
      detail: `${e?.message ?? String(e)} The existing Saved Chemical is unchanged.`,
      identity,
      diff: [],
    };
  }

  return reverifyFromLookupResult({ draft, identity, result, vineyardCountry });
}
