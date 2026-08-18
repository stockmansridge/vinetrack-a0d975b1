// Custodia® Fungicide (AU) regression fixture.
//
// Traces Lookup → Apply → Re-verify → ChemicalIntelligenceDraft → SQL 194
// encoder and pins the behaviours that were previously wrong:
//   * two actives must survive comma-separated lookup text
//   * label-derived data (rates / WHP / re-entry) may not be promoted from an
//     AI summary when no authoritative label was resolved
//   * "Custodia" must never be matched against "Custodia Forte"
import { describe, it, expect } from "vitest";
import {
  emptyDraft,
  parseLegacyActiveIngredient,
  splitActiveIngredientText,
  canonicalGroupCodes,
  suggestActivityGroup,
  encodeChemicalIntelligenceForWrite,
  draftFromRow,
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";
import {
  reverifyChemical,
  resolveReverifyIdentity,
  candidateMatchesIdentity,
  parseWithholdingDays,
  parseReEntryHours,
  splitRegisteredTargets,
  type ReverifyCandidate,
} from "@/lib/chemicalReverify";

/** What the lookup service returns for the AU Custodia product. */
const CUSTODIA_ACTIVE_TEXT = "Azoxystrobin 120 g/L, Tebuconazole 200 g/L";

/** Seed the draft exactly the way "Apply this product" does. */
function appliedDraft(activeText = CUSTODIA_ACTIVE_TEXT): ChemicalIntelligenceDraft {
  const actives = parseLegacyActiveIngredient(activeText, "ai_interpretation").map((a) => {
    const group = suggestActivityGroup(a.name);
    return group
      ? { ...a, activity_group: group, group_source: "authoritative_classification" as const }
      : a;
  });
  return {
    ...emptyDraft(),
    actives,
    sources: [{ kind: "ai_interpretation", name: "VineTrack AI chemical lookup" }],
    unresolvedFields: ["registration_number", "label_reference"],
    claimedStatus: "unverified",
  };
}

const authoritativeCustodia: ReverifyCandidate = {
  product_name: "Custodia Fungicide",
  registered_product_name: "Custodia Fungicide",
  registration_number: "62764",
  registration_scheme: "APVMA",
  registrant: "ADAMA Australia",
  country: "Australia",
  label_reference: "https://portal.apvma.gov.au/labels/62764",
  active_ingredient: CUSTODIA_ACTIVE_TEXT,
  registered_uses: [
    {
      crop: "Grapevines",
      target: "Powdery mildew",
      rate_per_unit: 0.8,
      rate_unit: "L/ha",
      rate_basis: "per_hectare",
      withholding_period_text: "four weeks",
      re_entry_period_text: "until the spray deposit has dried",
    },
    {
      crop: "Grapevines",
      target: "Downy mildew",
      rate_per_unit: 1,
      rate_unit: "L/ha",
      rate_basis: "per_hectare",
      withholding_period_text: "four weeks",
    },
  ],
};

describe("active ingredient parsing — multiple actives", () => {
  it("splits comma separated actives without splitting g/L", () => {
    expect(splitActiveIngredientText(CUSTODIA_ACTIVE_TEXT)).toEqual([
      "Azoxystrobin 120 g/L",
      "Tebuconazole 200 g/L",
    ]);
    const parsed = parseLegacyActiveIngredient(CUSTODIA_ACTIVE_TEXT, "ai_interpretation");
    expect(parsed).toHaveLength(2);
    expect(parsed.map((a) => a.name)).toEqual(["Azoxystrobin", "Tebuconazole"]);
    expect(parsed.every((a) => a.concentration_unit === "g/L")).toBe(true);
  });

  it("supports +, ;, &, 'and' and bare comma-separated names", () => {
    expect(parseLegacyActiveIngredient("Azoxystrobin, Tebuconazole").map((a) => a.name)).toEqual([
      "Azoxystrobin",
      "Tebuconazole",
    ]);
    for (const text of [
      "Azoxystrobin 120 g/L + Tebuconazole 200 g/L",
      "Azoxystrobin 120 g/L; Tebuconazole 200 g/L",
      "Azoxystrobin 120 g/L & Tebuconazole 200 g/L",
      "Azoxystrobin 120 g/L and Tebuconazole 200 g/L",
      "120 g/L Azoxystrobin, 200 g/L Tebuconazole",
    ]) {
      const parsed = parseLegacyActiveIngredient(text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].concentration).toBe(120);
      expect(parsed[1].concentration).toBe(200);
      expect(parsed.every((a) => a.concentration_unit === "g/L")).toBe(true);
    }
  });

  it("never merges actives into one name and keeps thousands separators intact", () => {
    const parsed = parseLegacyActiveIngredient(CUSTODIA_ACTIVE_TEXT);
    expect(parsed.some((a) => /,/.test(a.name))).toBe(false);
    const big = parseLegacyActiveIngredient("Copper hydroxide 1,000 g/kg");
    expect(big).toHaveLength(1);
    expect(big[0].concentration).toBe(1000);
    expect(big[0].concentration_unit).toBe("g/kg");
  });
});

describe("Custodia structured payload", () => {
  it("produces exactly two independent actives with correct groups", () => {
    const draft = appliedDraft();
    expect(draft.actives).toHaveLength(2);
    const teb = draft.actives.find((a) => a.name === "Tebuconazole")!;
    const azo = draft.actives.find((a) => a.name === "Azoxystrobin")!;
    expect(teb.concentration).toBe(200);
    expect(teb.concentration_unit).toBe("g/L");
    expect(teb.activity_group).toMatchObject({ scheme: "frac", code: "3" });
    expect(azo.concentration).toBe(120);
    expect(azo.concentration_unit).toBe("g/L");
    expect(azo.activity_group).toMatchObject({ scheme: "frac", code: "11" });
    expect(canonicalGroupCodes(draft.actives)).toEqual(["3", "11"]);
  });

  it("does not promote AI rate / WHP / REI to registered data before a label match", () => {
    const draft = appliedDraft();
    expect(draft.registeredUses).toEqual([]);
    expect(draft.registration.number).toBeUndefined();
    expect(draft.registration.label_reference).toBeUndefined();
    expect(draft.unresolvedFields).toEqual(
      expect.arrayContaining(["registration_number", "label_reference"]),
    );
    expect(draft.sources.every((s) => s.kind === "ai_interpretation")).toBe(true);
    expect(encodeChemicalIntelligenceForWrite(draft).verification_status).not.toBe("verified");
  });

  it("keeps AI use data out of the record when the lookup found no label", async () => {
    const r = await reverifyChemical({
      draft: appliedDraft(),
      productName: "Custodia Fungicide",
      country: "Australia",
      lookup: async () => [
        {
          product_name: "Custodia Fungicide",
          active_ingredient: CUSTODIA_ACTIVE_TEXT,
          target: "Powdery mildew, Downy mildew, Botrytis",
          rate_per_unit: 300,
          rate_unit: "L/ha",
          withholding_period_days: 14,
          re_entry_period_hours: 24,
        },
      ],
    });
    expect(r.proposed?.registeredUses ?? []).toEqual([]);
    expect(r.proposed?.unresolvedFields).toEqual(
      expect.arrayContaining(["registered_uses", "label_reference"]),
    );
    expect(JSON.stringify(r.proposed ?? {})).not.toContain("300");
  });
});

describe("Custodia re-verify against the authoritative label", () => {
  it("populates APVMA identity, label reference and independent uses", async () => {
    const r = await reverifyChemical({
      draft: appliedDraft(),
      productName: "Custodia Fungicide",
      country: "Australia",
      lookup: async () => [authoritativeCustodia],
    });
    const p = r.proposed!;
    expect(p.actives).toHaveLength(2);
    expect(canonicalGroupCodes(p.actives)).toEqual(["3", "11"]);
    expect(p.registration.scheme).toBe("apvma");
    expect(p.registration.country).toBe("AU");
    expect(p.registration.number).toBe("62764");
    expect(p.registration.registrant).toBe("ADAMA Australia");
    expect(p.registration.label_reference).toBe("https://portal.apvma.gov.au/labels/62764");

    const powdery = p.registeredUses.find((u) => /powdery/i.test(u.target_raw))!;
    const downy = p.registeredUses.find((u) => /downy/i.test(u.target_raw))!;
    expect(powdery).toBeTruthy();
    expect(downy).toBeTruthy();
    expect(powdery.rates[0].value).toBe(0.8);
    expect(downy.rates[0].value).toBe(1);
    expect(powdery.rates[0].unit).toBe("L/ha");
    // Four weeks is 28 days, never 14.
    expect(powdery.withholding_period_days).toBe(28);
    expect(downy.withholding_period_days).toBe(28);
    // "until the spray deposit has dried" is not a duration.
    expect(powdery.re_entry_period_hours).toBeUndefined();
    expect(p.unresolvedFields).toContain("registered_uses.re_entry_period_hours");
    // No unit conversion may invent a 300 L/ha rate.
    expect(p.registeredUses.some((u) => u.rates.some((rt) => rt.value === 300))).toBe(false);
  });

  it("splits a composite target row into independent uses without copying the rate", async () => {
    const r = await reverifyChemical({
      draft: appliedDraft(),
      productName: "Custodia Fungicide",
      country: "Australia",
      lookup: async () => [
        {
          ...authoritativeCustodia,
          registered_uses: [
            {
              crop: "Grapevines",
              target: "Powdery mildew, Downy mildew, Botrytis",
              rate_per_unit: 0.8,
              rate_unit: "L/ha",
            },
          ],
        },
      ],
    });
    const uses = r.proposed!.registeredUses;
    expect(uses).toHaveLength(3);
    expect(uses.map((u) => u.target_raw)).toEqual([
      "Powdery mildew",
      "Downy mildew",
      "Botrytis",
    ]);
    expect(uses.every((u) => u.rates.length === 0)).toBe(true);
    expect(r.proposed!.unresolvedFields).toContain("registered_uses.rates");
  });

  it("never confuses Custodia with Custodia Forte", async () => {
    const id = resolveReverifyIdentity(appliedDraft(), "Custodia Fungicide")!;
    expect(candidateMatchesIdentity(id, { product_name: "Custodia Forte" })).toBe(false);
    expect(candidateMatchesIdentity(id, { product_name: "Custodia® Fungicide" })).toBe(true);

    const r = await reverifyChemical({
      draft: appliedDraft(),
      productName: "Custodia Fungicide",
      lookup: async () => [
        {
          product_name: "Custodia Forte",
          registration_number: "89999",
          active_ingredient: "Azoxystrobin 120 g/L, Tebuconazole 200 g/L, Difenoconazole 50 g/L",
          label_reference: "https://example.invalid/forte",
        },
      ],
    });
    expect(r.outcome).toBe("needs_review");
    expect(r.proposed).toBeUndefined();
  });

  it("retains the two independent actives across save and reopen", async () => {
    const r = await reverifyChemical({
      draft: appliedDraft(),
      productName: "Custodia Fungicide",
      country: "Australia",
      lookup: async () => [authoritativeCustodia],
    });
    const encoded = encodeChemicalIntelligenceForWrite(r.proposed!);
    expect(encoded.active_ingredients).toHaveLength(2);
    expect(encoded.activity_groups).toHaveLength(2);
    const reopened = draftFromRow(encoded as Record<string, unknown>);
    expect(reopened.actives.map((a) => [a.name, a.concentration, a.concentration_unit])).toEqual([
      ["Azoxystrobin", 120, "g/L"],
      ["Tebuconazole", 200, "g/L"],
    ]);
    expect(canonicalGroupCodes(reopened.actives)).toEqual(["3", "11"]);
    expect(reopened.registration.scheme).toBe("apvma");
    expect(reopened.registration.number).toBe("62764");
    expect(reopened.registration.label_reference).toBeTruthy();
  });
});

describe("label period parsing", () => {
  it("reads durations honestly and refuses to invent them", () => {
    expect(parseWithholdingDays("four weeks")).toBe(28);
    expect(parseWithholdingDays("14 days")).toBe(14);
    expect(parseWithholdingDays("Not required when used as directed")).toBeUndefined();
    expect(parseReEntryHours("24 hours")).toBe(24);
    expect(parseReEntryHours("until the spray deposit has dried")).toBeUndefined();
    expect(splitRegisteredTargets("Powdery mildew, Downy mildew and Botrytis")).toEqual([
      "Powdery mildew",
      "Downy mildew",
      "Botrytis",
    ]);
  });
});
