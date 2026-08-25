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
      match_source: "registered",
      jurisdiction: { country: "AU", status: "resolved" },
      field_provenance: { registered_uses: "label" },
      registered_uses: [
        {
          crop: "Grapevine",
          rates: [
            { basis: "per_100_litres", value: 50, unit: "mL", condition: "low vigour" },
            { basis: "per_100_litres", value: 100, unit: "mL", condition_ambiguous: true },
            { basis: "per_hectare", min: 1, max: 2, unit: "L" },
          ],
        },
      ],
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
