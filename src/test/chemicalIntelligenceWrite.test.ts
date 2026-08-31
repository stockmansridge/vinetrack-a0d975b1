import { describe, it, expect } from "vitest";
import {
  canonicalActivityGroups,
  canonicalGroupCodes,
  criticalFieldsChanged,
  deriveLabelRateBases,
  detectActivityGroupConflicts,
  draftFromRow,
  emptyDraft,
  encodeChemicalIntelligenceForWrite,
  formatChemicalNumber,
  hasStructuredIntelligence,
  legacyActiveIngredientProjection,
  legacyChemicalGroupProjection,
  normaliseCountry,
  normaliseGroupCode,
  parseLegacyActiveIngredient,
  reconcileEditedDraft,
  registrationIdentityKey,
  resolveVerificationStatus,
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";

const officialSource = { kind: "official_register" as const, name: "APVMA PUBCRIS" };

function verifiedDraft(): ChemicalIntelligenceDraft {
  return {
    ...emptyDraft(),
    actives: [
      {
        name: "Azoxystrobin",
        concentration: 250,
        concentration_unit: "g/L",
        activity_group: { scheme: "frac", code: "11" },
        group_source: "authoritative_classification",
        identity_source: "official_register",
      },
    ],
    registration: {
      country: "AU",
      scheme: "apvma",
      number: "62764",
      registrant: "Acme Crop Science",
      registered_product_name: "Amistar 250 SC",
    },
    sources: [officialSource],
    claimedStatus: "verified",
  };
}

describe("sql/194 canonical shape", () => {
  it("omits absent optionals instead of writing null", () => {
    const out = encodeChemicalIntelligenceForWrite({
      ...emptyDraft(),
      actives: [{ name: "Sulphur" }],
    });
    const active = (out.active_ingredients as any[])[0];
    expect(active).toEqual({ name: "Sulphur" });
    expect("concentration" in active).toBe(false);
    expect("activity_group" in active).toBe(false);
    expect(JSON.stringify(out)).not.toContain("null");
  });

  it("writes snake_case keys and stamps versions", () => {
    const out = encodeChemicalIntelligenceForWrite(verifiedDraft());
    expect(out.intelligence_schema_version).toBe(1);
    expect(out.activity_group_table_version).toBe(2);
    expect(out.registration_scheme).toBe("apvma");
    expect(out.registered_product_name).toBe("Amistar 250 SC");
    const keys = Object.keys((out.active_ingredients as any[])[0]);
    expect(keys.every((k) => k === k.toLowerCase())).toBe(true);
  });

  it("returns {} when there is nothing structured, so commercial edits never blank chemistry", () => {
    expect(encodeChemicalIntelligenceForWrite(emptyDraft())).toEqual({});
    expect(encodeChemicalIntelligenceForWrite(null)).toEqual({});
    expect(hasStructuredIntelligence(emptyDraft())).toBe(false);
  });

  it("normalises country codes and builds the registration identity key", () => {
    expect(normaliseCountry("australia")).toBe("AU");
    expect(normaliseCountry("nz")).toBe("NZ");
    expect(
      registrationIdentityKey({ country: "Australia", scheme: "apvma", number: "62764" }),
    ).toBe("AU:apvma:62764");
    expect(registrationIdentityKey({ country: "AU" })).toBeNull();
  });
});

describe("activity groups", () => {
  it("normalises noisy group codes", () => {
    expect(normaliseGroupCode("Group 3")).toBe("3");
    expect(normaliseGroupCode("FRAC 11 (QoI)")).toBe("11");
    expect(normaliseGroupCode(" m 1 ")).toBe("M1");
  });

  it("derives de-duplicated, canonically ordered groups regardless of entry order", () => {
    const a = canonicalGroupCodes([
      { name: "X", activity_group: { scheme: "frac", code: "11" } },
      { name: "Y", activity_group: { scheme: "frac", code: "3" } },
      { name: "Z", activity_group: { scheme: "frac", code: "M5" } },
      { name: "W", activity_group: { scheme: "frac", code: "3" } },
    ]);
    const b = canonicalGroupCodes([
      { name: "Z", activity_group: { scheme: "frac", code: "M5" } },
      { name: "W", activity_group: { scheme: "frac", code: "3" } },
      { name: "X", activity_group: { scheme: "frac", code: "11" } },
    ]);
    expect(a).toEqual(["3", "11", "M5"]);
    expect(b).toEqual(["3", "11", "M5"]);
  });

  it("excludes not_applicable actives from resistance groups", () => {
    const groups = canonicalActivityGroups([
      { name: "Wetter", activity_group: { scheme: "not_applicable", code: "" } },
      { name: "Tebuconazole", activity_group: { scheme: "frac", code: "3" } },
    ]);
    expect(groups).toEqual([{ scheme: "frac", code: "3" }]);
  });

  it("keeps scheme mixing honest by writing the first canonical scheme", () => {
    const out = encodeChemicalIntelligenceForWrite({
      ...emptyDraft(),
      actives: [
        { name: "Glyphosate", activity_group: { scheme: "hrac", code: "9" }, group_source: "manual_entry" },
      ],
    });
    expect(out.activity_group_scheme).toBe("hrac");
  });
});

describe("legacy projections", () => {
  it("derives active_ingredient and chemical_group from structured data", () => {
    const actives = [
      { name: "Tebuconazole", concentration: 100, concentration_unit: "g/L" as const, activity_group: { scheme: "frac" as const, code: "3" } },
      { name: "Azoxystrobin", concentration: 200, concentration_unit: "g/L" as const, activity_group: { scheme: "frac" as const, code: "11" } },
    ];
    expect(legacyActiveIngredientProjection(actives)).toBe("Tebuconazole 100 g/L + Azoxystrobin 200 g/L");
    expect(legacyChemicalGroupProjection(actives)).toBe("3 + 11");
  });

  it("formats numbers the way the mobile apps do", () => {
    expect(formatChemicalNumber(250)).toBe("250");
    expect(formatChemicalNumber(2.5)).toBe("2.5");
    expect(formatChemicalNumber(1 / 3)).toBe("0.3333");
  });

  it("overwrites stale legacy text on every structured write", () => {
    const out = encodeChemicalIntelligenceForWrite({
      ...emptyDraft(),
      actives: [{ name: "Sulphur", activity_group: { scheme: "frac", code: "M2" }, group_source: "manual_entry" }],
    });
    expect(out.active_ingredient).toBe("Sulphur");
    expect(out.chemical_group).toBe("M2");
  });
});

describe("verification honesty", () => {
  it("promotes to verified only with authoritative evidence for every claim", () => {
    expect(resolveVerificationStatus(verifiedDraft())).toBe("verified");
  });

  it("downgrades a verified claim when the group is only self-reported", () => {
    const d = verifiedDraft();
    d.actives[0].group_source = "manual_entry";
    expect(resolveVerificationStatus(d)).toBe("partially_verified");
  });

  it("downgrades when registration identity is missing", () => {
    const d = verifiedDraft();
    d.registration = { registered_product_name: "Amistar" };
    expect(resolveVerificationStatus(d)).toBe("partially_verified");
  });

  it("downgrades when fields remain unresolved", () => {
    const d = verifiedDraft();
    d.unresolvedFields = ["withholding_period_days"];
    expect(resolveVerificationStatus(d)).toBe("partially_verified");
  });

  it("never lets a manual-entry-only record claim verified", () => {
    const d = verifiedDraft();
    d.sources = [{ kind: "manual_entry", name: "Operator" }];
    d.actives[0].group_source = "manual_entry";
    d.actives[0].identity_source = "manual_entry";
    expect(resolveVerificationStatus(d)).toBe("unverified");
  });

  it("keeps needs_match for never-matched records", () => {
    expect(resolveVerificationStatus({ ...emptyDraft(), claimedStatus: "needs_match" })).toBe("needs_match");
  });

  it("forces conflict whenever a disagreement is recorded", () => {
    const d = verifiedDraft();
    d.conflicts = [
      {
        field: "activity_group",
        extracted_value: "3",
        authoritative_value: "11",
        extracted_source: "ai_interpretation",
        authoritative_source: "authoritative_classification",
      },
    ];
    expect(resolveVerificationStatus(d)).toBe("conflict");
  });

  it("persists the resolved status, not the claimed one", () => {
    const d = verifiedDraft();
    d.actives[0].group_source = "ai_interpretation";
    const out = encodeChemicalIntelligenceForWrite(d);
    expect(out.verification_status).toBe("partially_verified");
  });

  it("only stamps verified_at when verification actually happened", () => {
    const unverified = encodeChemicalIntelligenceForWrite({
      ...emptyDraft(),
      actives: [{ name: "Sulphur", identity_source: "manual_entry" }],
    });
    expect(unverified.verification_status).toBe("unverified");
    expect(unverified.verified_at).toBeUndefined();
    expect(encodeChemicalIntelligenceForWrite(verifiedDraft()).verified_at).toBeTruthy();
  });
});

describe("conflict detection against the reference table", () => {
  it("records rather than overwrites a disagreeing group", () => {
    const conflicts = detectActivityGroupConflicts([
      { name: "Azoxystrobin", activity_group: { scheme: "frac", code: "3" }, group_source: "ai_interpretation" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      field: "activity_group",
      active_ingredient_name: "Azoxystrobin",
      extracted_value: "3",
      authoritative_value: "11",
      authoritative_source: "authoritative_classification",
    });
    const out = encodeChemicalIntelligenceForWrite({
      ...emptyDraft(),
      actives: [
        { name: "Azoxystrobin", activity_group: { scheme: "frac", code: "3" }, group_source: "ai_interpretation" },
      ],
    });
    // operator/AI value is preserved verbatim; the conflict is what changes
    expect((out.active_ingredients as any[])[0].activity_group.code).toBe("3");
    expect(out.verification_status).toBe("conflict");
  });

  it("stays silent when the entered group agrees with the reference", () => {
    expect(
      detectActivityGroupConflicts([
        { name: "Tebuconazole", activity_group: { scheme: "frac", code: "3" } },
      ]),
    ).toEqual([]);
  });
});

describe("registered uses and label rates", () => {
  it("writes single values and ranges under the right keys, preserving basis order", () => {
    const out = encodeChemicalIntelligenceForWrite({
      ...emptyDraft(),
      actives: [{ name: "Azoxystrobin" }],
      registeredUses: [
        {
          crop: "Grapevines",
          target_raw: "Powdery mildew",
          target: "powdery_mildew",
          rates: [
            { label: "Standard", basis: "per_hectare", value: 0.8, unit: "L/ha" },
            { label: "Dilute", basis: "range_per_100_litres", min_value: 20, max_value: 40, unit: "mL/100L" },
          ],
          withholding_period_days: 30,
          re_entry_period_hours: 24,
        },
      ],
    });
    const use = (out.registered_uses as any[])[0];
    expect(use.rates[0]).toEqual({ label: "Standard", basis: "per_hectare", unit: "L/ha", value: 0.8 });
    expect(use.rates[1]).toEqual({
      label: "Dilute", basis: "range_per_100_litres", unit: "mL/100L", min_value: 20, max_value: 40,
    });
    expect(use.withholding_period_days).toBe(30);
    expect(out.label_rate_bases).toEqual(["per_hectare", "range_per_100_litres"]);
  });

  it("derives label_rate_bases without duplicates", () => {
    expect(
      deriveLabelRateBases([
        { crop: "a", target_raw: "t", rates: [{ label: "", basis: "per_hectare", unit: "L/ha" }] },
        { crop: "b", target_raw: "t", rates: [{ label: "", basis: "per_hectare", unit: "L/ha" }] },
      ]),
    ).toEqual(["per_hectare"]);
  });
});

describe("round trip with the Stage 2A read adapter", () => {
  it("re-reads a written row into the same chemistry", () => {
    const row = encodeChemicalIntelligenceForWrite(verifiedDraft());
    const read = toChemicalIntelligence({ id: "c1", vineyard_id: "v1", name: "Amistar", ...row });
    expect(read.verification.status).toBe("verified");
    expect(read.actives.map((a) => a.name)).toEqual(["Azoxystrobin"]);
    expect(read.actives[0].group?.code).toBe("11");
    expect(read.product.registrationNumber).toBe("62764");

    const back = draftFromRow(row as any);
    expect(back.actives[0]).toMatchObject({ name: "Azoxystrobin", concentration: 250 });
    expect(back.registration).toMatchObject({ country: "AU", scheme: "apvma", number: "62764" });
    expect(back.claimedStatus).toBe("verified");
    expect(encodeChemicalIntelligenceForWrite(back)).toEqual(row);
  });

  it("rehydrates structured data instead of re-parsing legacy text", () => {
    const draft = draftFromRow({
      active_ingredient: "Tebuconazole + Azoxystrobin",
      chemical_group: "3 + 11",
      active_ingredients: [{ name: "Tebuconazole", activity_group: { scheme: "frac", code: "3" } }],
      verification_status: "partially_verified",
    });
    expect(draft.actives).toHaveLength(1);
    expect(draft.actives[0].name).toBe("Tebuconazole");
  });

  it("treats a legacy-only row as needing a match", () => {
    const draft = draftFromRow({ active_ingredient: "Tebuconazole", chemical_group: "3" });
    expect(draft.actives).toEqual([]);
    expect(draft.claimedStatus).toBe("needs_match");
  });

  it("degrades an unknown source kind instead of trusting it", () => {
    const draft = draftFromRow({
      active_ingredients: [{ name: "X", identity_source: "totally_new_kind" }],
      verification_sources: [{ kind: "totally_new_kind", name: "Mystery" }],
      verification_status: "verified",
    });
    expect(draft.sources[0].kind).toBe("ai_interpretation");
    expect(resolveVerificationStatus(draft)).toBe("unverified");
  });
});

describe("edit trust re-resolution", () => {
  it("invalidates verification when a critical value is hand-edited", () => {
    const before = verifiedDraft();
    const after: ChemicalIntelligenceDraft = {
      ...before,
      actives: [{ ...before.actives[0], activity_group: { scheme: "frac", code: "7" } }],
    };
    expect(criticalFieldsChanged(before, after)).toBe(true);
    const reconciled = reconcileEditedDraft(before, after);
    expect(reconciled.actives[0].group_source).toBe("manual_entry");
    expect(reconciled.sources.some((s) => s.kind === "official_register")).toBe(false);
    expect(resolveVerificationStatus(reconciled)).not.toBe("verified");
  });

  it("leaves chemistry and verification untouched for commercial-only edits", () => {
    const before = verifiedDraft();
    const after = { ...before };
    expect(criticalFieldsChanged(before, after)).toBe(false);
    const out = encodeChemicalIntelligenceForWrite(reconcileEditedDraft(before, after));
    expect(out.verification_status).toBe("verified");
  });
});

describe("assisted entry parsing", () => {
  it("splits free-text actives without inventing data", () => {
    const parsed = parseLegacyActiveIngredient("Tebuconazole 100 g/L + Azoxystrobin 200 g/L", "ai_interpretation");
    expect(parsed).toEqual([
      { name: "Tebuconazole", concentration: 100, concentration_unit: "g/L", identity_source: "ai_interpretation" },
      { name: "Azoxystrobin", concentration: 200, concentration_unit: "g/L", identity_source: "ai_interpretation" },
    ]);
    expect(parseLegacyActiveIngredient("")).toEqual([]);
    expect(parseLegacyActiveIngredient("Mystery brew")).toEqual([
      { name: "Mystery brew", identity_source: "manual_entry" },
    ]);
  });
});
