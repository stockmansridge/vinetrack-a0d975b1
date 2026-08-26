// Gate D4B-P2A — canonical contract + round-trip plumbing.
//
// Boundary asserted here:
//   backend `default_rate_options` = operational identity (server pass-through)
//   local `buildDefaultRateOptions` = legacy/display-only until D4B-P2B
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
  decodeCanonicalDefaultRateOption,
  decodeCanonicalDefaultRateOptions,
  decodePersistedDefaultRates,
  type PersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";
import { parseChemicalLookup } from "@/lib/chemicalLookupResolver";
import {
  draftFromRow,
  encodeChemicalIntelligenceForWrite,
} from "@/lib/chemicalIntelligenceWrite";
import {
  updateSavedChemical,
  createSavedChemical,
  type SavedChemical,
} from "@/lib/savedChemicalsQuery";

import vicol from "./fixtures/d4b-vicol-au.json";

/* ------------------------------------------- 8. Vicol production-shape fixture */

describe("D4B-P2A — canonical default_rate_options (APVMA 33182 shape)", () => {
  const options = decodeCanonicalDefaultRateOptions((vicol as any).default_rate_options);

  it("decodes both /100 L options and no /ha options", () => {
    expect(options).not.toBeNull();
    expect(options!.per_hectare).toEqual([]);
    expect(options!.per_100_litres).toHaveLength(2);
  });

  it("passes the backend option_key through byte-for-byte", () => {
    expect(options!.per_100_litres.map((o) => o.option_key)).toEqual([
      "default_option_v1_42d1761ddc477436ffd40e7b881f0255",
      "default_option_v1_94df25e59456a8a736cdb446e1a7af3e",
    ]);
  });

  it("passes exactly the backend rate_ids through, in server order", () => {
    expect(options!.per_100_litres[0].rate_ids).toEqual([
      "rate_v1_2b559abc7cadaefe20e405674c523811",
      "rate_v1_758843c84a12d817494ccd5acd13720f",
    ]);
    expect(options!.per_100_litres[1].rate_ids).toEqual([
      "rate_v1_347ebfa9ad731449f589ae79458eaa88",
      "rate_v1_805fb1dea8eb5f2bba9740b95d52a773",
    ]);
  });

  it("keeps the wire basis vocabulary and the label unit untouched", () => {
    for (const o of options!.per_100_litres) {
      expect(o.basis).toBe("per_100_litres");
      expect(o.unit).toBe("L");
    }
  });

  it("never invents a `recommended` flag", () => {
    for (const o of options!.per_100_litres) {
      expect("recommended" in (o as any)).toBe(false);
    }
  });

  it("is exposed additively on the lookup result, decoded from the envelope", () => {
    const res = parseChemicalLookup(vicol, "AU");
    expect(res.authoritative).toBe(true);
    expect(res.defaultRateOptions).toEqual(options);
  });

  it("is null when the backend does not send the block", () => {
    const { default_rate_options: _omit, ...older } = vicol as any;
    expect(parseChemicalLookup(older, "AU").defaultRateOptions).toBeNull();
  });

  it("rejects malformed options rather than repairing them", () => {
    // Portal-minted key shape, unprefixed rate id, missing unit.
    expect(decodeCanonicalDefaultRateOption({
      option_key: "per_100_litres|2 L",
      rate_ids: ["rate_v1_a"],
      basis: "per_100_litres",
      unit: "L",
      value: 2,
      min_value: null,
      max_value: null,
    })).toBeNull();
    expect(decodeCanonicalDefaultRateOption({
      option_key: "default_option_v1_x",
      rate_ids: ["r1"],
      basis: "per_100_litres",
      unit: "L",
      value: 2,
      min_value: null,
      max_value: null,
    })).toBeNull();
    expect(decodeCanonicalDefaultRateOption({
      option_key: "default_option_v1_x",
      rate_ids: ["rate_v1_a"],
      basis: "per_100_litres",
      unit: "",
      value: 2,
      min_value: null,
      max_value: null,
    })).toBeNull();
  });
});

/* --------------------------------------------------------------- 9. range test */

describe("D4B-P2A — canonical range option", () => {
  const range = {
    option_key: "default_option_v1_33182_p100l_range",
    rate_ids: ["rate_v1_33182_downy_range"],
    basis: "per_100_litres",
    unit: "mL",
    value: null,
    min_value: 35,
    max_value: 54,
  };

  it("preserves the range exactly with no scalar fallback", () => {
    const decoded = decodeCanonicalDefaultRateOption(range);
    expect(decoded).toEqual({
      option_key: "default_option_v1_33182_p100l_range",
      rate_ids: ["rate_v1_33182_downy_range"],
      basis: "per_100_litres",
      unit: "mL",
      value: null,
      min_value: 35,
      max_value: 54,
    });
  });
});

/* ------------------------------------------------ 10. persisted contract tests */

const selection = (basis: "per_hectare" | "per_100_litres", value: number) => ({
  option_key: `default_option_v1_${basis}_${value}`,
  rate_ids: [`rate_v1_${basis}_${value}`],
  basis,
  unit: "L",
  value,
  min_value: null,
  max_value: null,
  source: "operator" as const,
  selected_at: "2026-08-26T00:00:00.000Z",
  label_version: "APVMA label approval 33182-0623",
});

describe("D4B-P2A — persisted default_rates decoder", () => {
  it("A. decodes a valid version 1 with both slots exactly", () => {
    const raw = {
      version: 1,
      per_hectare: selection("per_hectare", 4),
      per_100_litres: selection("per_100_litres", 2),
    };
    expect(decodePersistedDefaultRates(raw)).toEqual(raw);
  });

  it("B. /100 L only leaves /ha null", () => {
    const out = decodePersistedDefaultRates({
      version: 1,
      per_100_litres: selection("per_100_litres", 2),
    });
    expect(out!.per_hectare).toBeNull();
    expect(out!.per_100_litres).not.toBeNull();
  });

  it("C. /ha only leaves /100 L null", () => {
    const out = decodePersistedDefaultRates({
      version: 1,
      per_hectare: selection("per_hectare", 4),
    });
    expect(out!.per_100_litres).toBeNull();
    expect(out!.per_hectare).not.toBeNull();
  });

  it("D. both null is a valid version-1 object", () => {
    expect(decodePersistedDefaultRates({ version: 1, per_hectare: null, per_100_litres: null }))
      .toEqual({ version: 1, per_hectare: null, per_100_litres: null });
  });

  it("E. invalid root or version decodes to null", () => {
    expect(decodePersistedDefaultRates(null)).toBeNull();
    expect(decodePersistedDefaultRates("x")).toBeNull();
    expect(decodePersistedDefaultRates([])).toBeNull();
    expect(decodePersistedDefaultRates({ per_hectare: selection("per_hectare", 4) })).toBeNull();
    expect(decodePersistedDefaultRates({ version: 2, per_hectare: null })).toBeNull();
  });

  it("F. one malformed slot nulls only that slot", () => {
    const out = decodePersistedDefaultRates({
      version: 1,
      per_hectare: { nonsense: true },
      per_100_litres: selection("per_100_litres", 2),
    });
    expect(out!.per_hectare).toBeNull();
    expect(out!.per_100_litres!.option_key).toBe("default_option_v1_per_100_litres_2");
  });

  it("G. an invalid rate_id nulls the slot", () => {
    const out = decodePersistedDefaultRates({
      version: 1,
      per_100_litres: { ...selection("per_100_litres", 2), rate_ids: ["2 L"] },
    });
    expect(out!.per_100_litres).toBeNull();
  });

  it("H. an invalid option_key nulls the slot", () => {
    const out = decodePersistedDefaultRates({
      version: 1,
      per_100_litres: { ...selection("per_100_litres", 2), option_key: "per_100_litres|2 L" },
    });
    expect(out!.per_100_litres).toBeNull();
  });

  it("I. an invalid source nulls the slot", () => {
    const out = decodePersistedDefaultRates({
      version: 1,
      per_100_litres: { ...selection("per_100_litres", 2), source: "ai" },
    });
    expect(out!.per_100_litres).toBeNull();
  });

  it("never infers a default from rate_per_ha / unit / rates / registered_uses", () => {
    expect(
      decodePersistedDefaultRates({ rate_per_ha: 2, unit: "Litres", rates: [], registered_uses: [] }),
    ).toBeNull();
  });
});

/* ---------------------------------------- 10 (J–O). saved_chemicals plumbing */

describe("D4B-P2A — saved_chemicals.default_rates plumbing", () => {
  it("J. an old SavedChemical row without default_rates is safe", () => {
    const row: SavedChemical = { id: "sc-1", vineyard_id: "v1", name: "Vicol" };
    expect(row.default_rates).toBeUndefined();
    expect(decodePersistedDefaultRates(row.default_rates)).toBeNull();
  });

  it("K. omitted default_rates is absent from the update payload", async () => {
    updates.length = 0;
    await updateSavedChemical("sc-1", { name: "Vicol" });
    expect("default_rates" in updates[0]).toBe(false);
  });

  it("L. explicit null writes null", async () => {
    updates.length = 0;
    await updateSavedChemical("sc-1", { name: "Vicol", default_rates: null });
    expect(updates[0].default_rates).toBeNull();
  });

  it("M. a valid object survives untouched (deep equal)", async () => {
    updates.length = 0;
    const persisted: PersistedDefaultRates = {
      version: 1,
      per_hectare: null,
      per_100_litres: selection("per_100_litres", 2),
    };
    await updateSavedChemical("sc-1", { name: "Vicol", default_rates: persisted });
    expect(updates[0].default_rates).toEqual(persisted);
  });

  it("N. the nested label unit \"L\" is NOT coerced to \"Litres\"", async () => {
    updates.length = 0;
    const persisted: PersistedDefaultRates = {
      version: 1,
      per_hectare: null,
      per_100_litres: selection("per_100_litres", 2),
    };
    await updateSavedChemical("sc-1", { name: "Vicol", unit: "L", default_rates: persisted });
    // The legacy column is still normalised …
    expect(updates[0].unit).toBe("Litres");
    // … but the label rate snapshot is not.
    expect(updates[0].default_rates.per_100_litres.unit).toBe("L");
  });

  it("O. the wire basis stays per_100_litres (never per_100L)", async () => {
    inserts.length = 0;
    const persisted: PersistedDefaultRates = {
      version: 1,
      per_hectare: null,
      per_100_litres: selection("per_100_litres", 2),
    };
    await createSavedChemical("v1", { name: "Vicol", default_rates: persisted });
    expect(inserts[0].default_rates.per_100_litres.basis).toBe("per_100_litres");
    expect(JSON.stringify(inserts[0].default_rates)).not.toContain("per_100L");
  });
});

/* ------------------------------------------------ 11. identity round-trip test */

describe("D4B-P2A — backend identity round-trip", () => {
  it("keeps direction_id / rate_id / text_layer_text through lookup → save → reopen", () => {
    const res = parseChemicalLookup(vicol, "AU");
    const draft = res.draft!;
    expect(draft.registeredUses).toHaveLength(2);
    expect(draft.registeredUses[0].extra?.direction_id).toBe(
      "direction_v1_33182_grapevine_downy",
    );
    expect(draft.registeredUses[0].rates[0].extra?.rate_id).toBe(
      "rate_v1_2b559abc7cadaefe20e405674c523811",
    );
    expect(draft.registeredUses[0].rates[0].extra?.text_layer_text).toBe("2 L/100 L water");

    const encoded = encodeChemicalIntelligenceForWrite(draft);
    const row = { registered_uses: encoded.registered_uses };
    const reopened = draftFromRow(row);

    const ids = reopened.registeredUses.map((u) => u.extra?.direction_id);
    expect(ids).toEqual([
      "direction_v1_33182_grapevine_downy",
      "direction_v1_33182_grapevine_powdery",
    ]);
    const rateIds = reopened.registeredUses.flatMap((u) =>
      u.rates.map((r) => r.extra?.rate_id),
    );
    expect(rateIds).toEqual([
      "rate_v1_2b559abc7cadaefe20e405674c523811",
      "rate_v1_347ebfa9ad731449f589ae79458eaa88",
      "rate_v1_758843c84a12d817494ccd5acd13720f",
      "rate_v1_805fb1dea8eb5f2bba9740b95d52a773",
    ]);
    expect(
      reopened.registeredUses[1].rates[1].extra?.text_layer_text,
    ).toBe("3 L/100 L water (high disease pressure)");
    // Wire identities are never duplicated into a second identity model.
    expect((reopened.registeredUses[0] as any).direction_id).toBeUndefined();
  });
});
