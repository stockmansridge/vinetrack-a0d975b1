// P4 — Saved Chemical cross-platform parity.
//
// A Saved Chemical authored by iOS/Android must survive a Portal open → save
// with no material loss: identity, actives, activity groups, verification,
// registered uses (with per-use provenance), rate ranges, reference-only
// rates, WHP/REI/restrictions and the Master Catalogue linkage.
import { describe, it, expect, vi } from "vitest";

const updates: any[] = [];
const inserts: any[] = [];
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (payload: any) => {
        updates.push(payload);
        return {
          eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }),
        };
      },
      insert: (payload: any) => {
        inserts.push(payload);
        return { select: () => ({ single: async () => ({ data: payload, error: null }) }) };
      },
    }),
  },
}));

import {
  draftFromRow,
  encodeChemicalIntelligenceForWrite,
} from "@/lib/chemicalIntelligenceWrite";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { updateSavedChemical } from "@/lib/savedChemicalsQuery";

import sprayseal from "./fixtures/ld2-sprayseal-au.json";
import custodiaForte from "./fixtures/ld2-custodia-forte-au.json";
import prosaro from "./fixtures/ld2-prosaro-au.json";

/** A canonical `saved_chemicals` row as mobile would have written it. */
function rowFromFixture(f: any, extra: Record<string, any> = {}) {
  return {
    id: "sc-1",
    vineyard_id: "v1",
    name: f.product_name,
    unit: "Litres",
    active_ingredients: f.active_ingredients,
    activity_groups: f.activity_groups,
    activity_group_scheme: f.activity_group_scheme,
    registration_country: f.registration?.country_code,
    registration_scheme: f.registration?.scheme,
    registration_number: f.registration?.registration_number,
    registrant: f.registration?.registrant,
    registered_product_name: f.registration?.registered_product_name,
    label_reference: f.registration?.label_reference,
    label_version: f.registration?.label_version,
    verification_status: f.verification?.status,
    verification_sources: f.verification?.sources,
    verification_conflicts: f.verification?.conflicts,
    verification_unresolved_fields: f.verification?.unresolved_fields,
    registered_uses: f.registered_uses,
    label_rate_bases: f.label_rate_bases,
    intelligence_schema_version: f.schema_version,
    ...extra,
  };
}

const roundTrip = (row: Record<string, any>) =>
  encodeChemicalIntelligenceForWrite(draftFromRow(row));

describe("Saved Chemical round trip — Sprayseal 80160", () => {
  const row = rowFromFixture(sprayseal);
  const out = roundTrip(row) as any;

  it("keeps product/registration identity", () => {
    expect(out.registration_country).toBe("AU");
    expect(out.registration_scheme).toBe("apvma");
    expect(out.registration_number).toBe("80160");
    expect(out.registered_product_name).toBe("Sprayseal Pruning Wound Treatment");
    expect(out.label_version).toBe(sprayseal.registration.label_version);
  });

  it("keeps the active ingredient and its FRAC group", () => {
    const a = (out.active_ingredients as any[])[0];
    expect(a.name).toBe("Tebuconazole");
    expect(a.concentration).toBe(430);
    expect(a.concentration_unit).toBe("g/L");
    expect(a.activity_group).toMatchObject({ scheme: "frac", code: "3" });
    expect(out.activity_groups).toEqual(["3"]);
  });

  it("keeps the 30 mL/100 L label rate and per-use provenance", () => {
    const use = (out.registered_uses as any[])[0];
    expect(use.rates[0]).toMatchObject({
      basis: "per_100_litres",
      value: 30,
      unit: "mL",
      raw_text: "Mix 30 mL of SpraySeal per 100 litres of water",
    });
    expect(use.provenance).toEqual((sprayseal.registered_uses as any[])[0].provenance);
    expect(use.restrictions).toBe((sprayseal.registered_uses as any[])[0].restrictions);
    expect(use.withholding_period_days).toBe(0);
  });

  it("never upgrades evidence beyond what the record carries", () => {
    expect(["verified", "partially_verified"]).toContain(out.verification_status);
    expect(out.verification_unresolved_fields).toEqual(
      sprayseal.verification.unresolved_fields,
    );
  });
});

describe("Saved Chemical round trip — Custodia Forte 91636", () => {
  const row = rowFromFixture(custodiaForte);
  const out = roundTrip(row) as any;
  const powdery = (out.registered_uses as any[]).find((u) => /POWDERY/i.test(u.target_raw));

  it("preserves a rate range without collapsing it to an endpoint", () => {
    const range = powdery.rates.find((r: any) => r.basis === "range_per_100_litres");
    expect(range.min_value).toBe(35);
    expect(range.max_value).toBe(54);
    expect(range.value).toBeUndefined();
  });

  it("preserves the hectare rate alongside the range", () => {
    const perHa = powdery.rates.find((r: any) => r.basis === "per_hectare");
    expect(perHa.value).toBe(540);
    expect(perHa.unit).toBe("mL");
  });

  it("preserves WHP 28 days and restrictions text", () => {
    expect(powdery.withholding_period_days).toBe(28);
    expect(powdery.restrictions).toContain("DO NOT HARVEST");
  });

  it("keeps every registered use and the label rate bases", () => {
    expect((out.registered_uses as any[]).length).toBe(
      (custodiaForte.registered_uses as any[]).length,
    );
    expect(out.label_rate_bases).toContain("range_per_100_litres");
    expect(out.label_rate_bases).toContain("per_hectare");
  });
});

describe("Saved Chemical round trip — Prosaro 63243 reference-only rates", () => {
  const row = rowFromFixture(prosaro);
  const out = roundTrip(row) as any;
  const use = (out.registered_uses as any[])[0];

  it("keeps basis:other as reference text and invents no number", () => {
    const other = use.rates.find((r: any) => r.basis === "other");
    expect(other.raw_text).toContain("150 mL/ha");
    expect(other.value).toBeUndefined();
    expect(other.min_value).toBeUndefined();
    expect(other.max_value).toBeUndefined();
  });

  it("does not promote a reference-only rate into an applicable rate on read", () => {
    const chem = toChemicalIntelligence({ ...row, ...out });
    const first = chem.registeredUses[0];
    expect(first.rates.length).toBeGreaterThan(0);
    const referenceOnly = first.rates.find((r) => r.basis === "other");
    expect(referenceOnly?.referenceOnly).toBe(true);
    expect(first.rate).toBeNull();
  });
});

describe("Saved Chemical round trip — unresolved stays unresolved", () => {
  it("Custodia 320SC style record with no label data invents nothing", () => {
    const row = {
      id: "sc-2",
      name: "Custodia 320SC Fungicide",
      registration_country: "AU",
      registration_scheme: "apvma",
      registration_number: "67116",
      verification_status: "needs_match",
      verification_unresolved_fields: [
        "rates:GRAPEVINE",
        "withholding_period:GRAPEVINE",
        "re_entry_period_hours",
      ],
      registered_uses: [],
      active_ingredients: [],
    };
    const out = roundTrip(row) as any;
    expect(out.registered_uses).toEqual([]);
    expect(out.label_rate_bases).toEqual([]);
    expect(out.verification_status).not.toBe("verified");
    expect(out.verification_unresolved_fields).toEqual(
      row.verification_unresolved_fields,
    );
  });

  it("Ridomil Gold style ambiguous record keeps unresolved uses unresolved", () => {
    const row = {
      id: "sc-3",
      name: "Ridomil Gold",
      registration_country: "AU",
      registered_uses: [
        {
          crop: "GRAPEVINE",
          target_raw: "DOWNY MILDEW",
          rates: [],
          provenance: { claim: "unresolved", rates: null, withholding_period: null },
        },
      ],
    };
    const out = roundTrip(row) as any;
    const use = (out.registered_uses as any[])[0];
    expect(use.rates).toEqual([]);
    expect(use.withholding_period_days).toBeUndefined();
    expect(use.re_entry_period_hours).toBeUndefined();
    expect(use.provenance).toEqual(row.registered_uses[0].provenance);
  });
});

describe("Saved Chemical parity — unknown fields and legacy records", () => {
  it("preserves keys this build does not model", () => {
    const row = {
      id: "sc-4",
      registration_number: "12345",
      registration_country: "AU",
      active_ingredients: [
        { name: "Sulfur", concentration: 800, concentration_unit: "g/kg", future_flag: true },
      ],
      registered_uses: [
        {
          crop: "GRAPEVINE",
          target_raw: "POWDERY MILDEW",
          rates: [{ label: "", basis: "per_hectare", value: 2, unit: "kg", future_note: "x" }],
          future_block: { a: 1 },
        },
      ],
      verification_sources: [
        { kind: "future_register", name: "Some new register", reference: "https://x.test" },
      ],
    };
    const out = roundTrip(row) as any;
    expect((out.active_ingredients as any[])[0].future_flag).toBe(true);
    expect((out.registered_uses as any[])[0].future_block).toEqual({ a: 1 });
    expect((out.registered_uses as any[])[0].rates[0].future_note).toBe("x");
    // An unknown provenance kind is written back verbatim, not rewritten.
    expect((out.verification_sources as any[])[0].kind).toBe("future_register");
  });

  it("a legacy record without structured fields writes nothing structured", () => {
    const out = roundTrip({
      id: "sc-5",
      name: "Old Copper",
      active_ingredient: "Copper hydroxide 500 g/kg",
      chemical_group: "M1",
    });
    expect(out).toEqual({});
  });

  it("does not blank intelligence when a commercial-only edit is saved", async () => {
    updates.length = 0;
    await updateSavedChemical("sc-1", {
      name: "Sprayseal Pruning Wound Treatment",
      rate_per_ha: 1,
      intelligence: encodeChemicalIntelligenceForWrite(null),
      master_chemical_id: "m-1",
      master_source_revision: 4,
    });
    const payload = updates[0];
    expect(payload.registered_uses).toBeUndefined();
    expect(payload.active_ingredients).toBeUndefined();
    expect(payload.verification_status).toBeUndefined();
    // Master linkage survives an ordinary edit.
    expect(payload.master_chemical_id).toBe("m-1");
    expect(payload.master_source_revision).toBe(4);
  });
});
