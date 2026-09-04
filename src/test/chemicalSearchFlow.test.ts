import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALREADY_IN_STORE_LABEL,
  isSearchEnvelope,
  masterForCandidate,
  parseSearchCandidates,
  requiresCandidateSelection,
  savedChemicalForCandidate,
  searchRequestBody,
  structuredRequestBodyForCandidate,
} from "@/lib/chemicalSearchFlow";
import { parseChemicalLookup } from "@/lib/chemicalLookupResolver";

const src = (p: string) => readFileSync(p, "utf8");

const SEARCH_PAYLOAD = {
  candidates: [
    {
      registered_product_name: "Hortitrol Winter Oil",
      registrant: "Vic Chem",
      registration_number: "50421",
      registration_scheme: "APVMA",
      registration_country: "AU",
      rank_tier: "exact",
      rank_score: 0.98,
      register_order: 1,
    },
    {
      registered_product_name: "Hortitrol Spray Oil",
      registrant: "Vic Chem",
      registration_number: "34567",
      registration_country: "AU",
      rank_tier: "partial",
      rank_score: 0.61,
      register_order: 2,
    },
  ],
  ranking_summary: { ambiguous: true, candidate_count: 2 },
  diagnostics: { correlation_id: "cid-1", parity_fingerprint: "fp-abc" },
};

describe("chemical search flow — server-authoritative discovery", () => {
  it("builds a search request for free-text product discovery", () => {
    const body = searchRequestBody("Hortitrol winter oil", "AU", "cid-1");
    expect(body.action).toBe("search");
    expect(body.query).toBe("Hortitrol winter oil");
    expect(body.country).toBe("AU");
    expect(body.client.correlation_id).toBe("cid-1");
    expect(body.client.platform).toBe("portal");
  });

  it("recognises a search envelope", () => {
    expect(isSearchEnvelope(SEARCH_PAYLOAD)).toBe(true);
    expect(isSearchEnvelope({ match_source: "master" })).toBe(false);
  });

  it("preserves server candidate order exactly", () => {
    const res = parseSearchCandidates(SEARCH_PAYLOAD);
    expect(res.candidates.map((c) => c.registrationNumber)).toEqual(["50421", "34567"]);
    expect(res.candidates.map((c) => c.index)).toEqual([0, 1]);
    expect(res.serverRanked).toBe(true);
    expect(res.summary?.ambiguous).toBe(true);
    expect(res.diagnostics?.correlationId).toBe("cid-1");
    expect(res.diagnostics?.raw.parity_fingerprint).toBe("fp-abc");
  });

  it("keeps ambiguous candidates selectable and never auto-picks the top row", () => {
    const res = parseSearchCandidates(SEARCH_PAYLOAD);
    expect(requiresCandidateSelection(res)).toBe(true);
    const single = parseSearchCandidates({
      candidates: [SEARCH_PAYLOAD.candidates[0]],
      ranking_summary: { ambiguous: true },
    });
    expect(requiresCandidateSelection(single)).toBe(true);
    const unambiguous = parseSearchCandidates({
      candidates: [SEARCH_PAYLOAD.candidates[0]],
      ranking_summary: { ambiguous: false },
    });
    expect(requiresCandidateSelection(unambiguous)).toBe(false);
  });

  it("pins the selected registration for the structured lookup", () => {
    const res = parseSearchCandidates(SEARCH_PAYLOAD);
    const body = structuredRequestBodyForCandidate(res.candidates[1], "AU", "cid-1");
    expect(body.action).toBe("structured");
    expect(body.registration_number).toBe("34567");
    expect(body.exact_registration_number).toBe("34567");
    expect(body.productName).toBe("Hortitrol Spray Oil");
    expect(body.country).toBe("AU");
    // diagnostics correlation survives search → structured
    expect(body.client.correlation_id).toBe("cid-1");
  });

  it("reuses a Master row only for the same exact registration", () => {
    const res = parseSearchCandidates(SEARCH_PAYLOAD);
    const rows = [
      { id: "m1", registration_number: "34567", registered_product_name: "Hortitrol Spray Oil" },
      { id: "m2", registration_number: "99999", registered_product_name: "Hortitrol Winter Oil" },
    ] as any[];
    expect(masterForCandidate(rows, res.candidates[1])?.id).toBe("m1");
    // Name-alike Master must never substitute the selected registration.
    expect(masterForCandidate(rows, res.candidates[0])).toBeNull();
  });

  it("flags saved vineyard chemicals informationally without reordering", () => {
    const res = parseSearchCandidates(SEARCH_PAYLOAD);
    const saved = [
      { id: "s1", name: "Hortitrol Spray Oil", registration_number: "34567" },
      { id: "s2", name: "Something else" },
    ];
    expect(savedChemicalForCandidate(saved, res.candidates[1])?.id).toBe("s1");
    expect(savedChemicalForCandidate(saved, res.candidates[0])).toBeNull();
    // Order is untouched by the saved-store annotation.
    expect(res.candidates.map((c) => c.index)).toEqual([0, 1]);
    expect(ALREADY_IN_STORE_LABEL).toBe("Already in your Chemical Store");
  });

  it("does not loosely substring-match saved chemicals", () => {
    const res = parseSearchCandidates(SEARCH_PAYLOAD);
    expect(savedChemicalForCandidate([{ id: "s3", name: "Hortitrol" }], res.candidates[0])).toBeNull();
  });
});

describe("portal discovery path", () => {
  const file = src("src/components/spray/ChemicalAILookup.tsx");

  it("calls the authoritative search action for discovery", () => {
    expect(file).toContain("searchRequestBody(q, countryCode, cid)");
  });

  it("no longer lets Master pre-empt the server candidate search", () => {
    // Master is only consulted inside selectCandidate, after identity choice.
    const beforeSelect = file.slice(0, file.indexOf("async function selectCandidate"));
    expect(beforeSelect).not.toContain("searchApprovedMasterChemicals(");
    expect(file).not.toContain("matchMasterByIdentity");
  });

  it("does not use the legacy AI candidate path for discovery", () => {
    expect(file).not.toContain("chemical-ai-lookup");
  });
});

describe("multi-rate contract survives structured import", () => {
  it("keeps multiple /100 L and /ha rates unflattened", () => {
    const payload = {
      match_source: "authoritative",
      jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
      field_provenance: { registered_uses: "official_label" },
      product: {
        registered_product_name: "Multi Rate Product",
        registration_country: "AU",
        registered_uses: [
          {
            crop: "Grapevines",
            rates: [
              { basis: "per_100_litres", value: 50, unit: "mL", condition: "low vigour" },
              { basis: "per_100_litres", value: 100, unit: "mL", condition_ambiguous: true },
              { basis: "per_hectare", min: 1, max: 2, unit: "L" },
            ],
          },
        ],
      },
    };
    const result = parseChemicalLookup(payload, "AU");
    const uses = result.draft?.registeredUses ?? [];
    const rates = uses[0]?.rates ?? [];
    expect(rates.length).toBe(3);
    expect(rates.filter((r) => r.basis === "per_100_litres").length).toBe(2);
    expect(rates.some((r) => r.condition === "low vigour")).toBe(true);
    expect(rates.some((r) => r.condition_ambiguous === true)).toBe(true);
  });
});

/* --------------------------------- live camelCase wire format (results[]) */

const LIVE_RESULTS_PAYLOAD = {
  results: [
    {
      name: "SACOA STIFLE DORMANT SPRAY OIL",
      activeIngredient: "Petroleum Oil 859 g/L",
      brand: "AGRION CROP SOLUTIONS PTY LTD",
      primaryUse: "insecticide",
      registration_number: "54000",
    },
  ],
};

describe("live camelCase search wire format", () => {
  it("maps name, brand, activeIngredient and primaryUse", () => {
    const res = parseSearchCandidates(LIVE_RESULTS_PAYLOAD);
    expect(isSearchEnvelope(LIVE_RESULTS_PAYLOAD)).toBe(true);
    const c = res.candidates[0];
    expect(c.productName).toBe("SACOA STIFLE DORMANT SPRAY OIL");
    expect(c.activeIngredientText).toBe("Petroleum Oil 859 g/L");
    expect(c.registrant).toBe("AGRION CROP SOLUTIONS PTY LTD");
    expect(c.category).toBe("insecticide");
    expect(c.registrationNumber).toBe("54000");
  });

  it("keeps snake_case compatibility", () => {
    const res = parseSearchCandidates({
      candidates: [
        {
          registered_product_name: "Legacy Product",
          active_ingredient: "Sulfur 800 g/kg",
          manufacturer: "Legacy Co",
          primary_use: "fungicide",
          registration_number: "12345",
        },
      ],
    });
    const c = res.candidates[0];
    expect(c.activeIngredientText).toBe("Sulfur 800 g/kg");
    expect(c.registrant).toBe("Legacy Co");
    expect(c.category).toBe("fungicide");
  });

  it("does not duplicate the mapping inside the lookup component", () => {
    const file = src("src/components/spray/ChemicalAILookup.tsx");
    expect(file).not.toContain("o.activeIngredient");
    expect(file).not.toContain("primaryUse");
  });
});
