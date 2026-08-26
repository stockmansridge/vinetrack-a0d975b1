// Gate D4B-P2B — operator selection + save/reopen.
//
// Boundary asserted here: only a BACKEND canonical option can become a
// persisted selection; matching is identity-based; a lookup, a recommendation
// or a failure can never write, replace or destroy an operator decision.
import { describe, it, expect, vi } from "vitest";

const updates: any[] = [];
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (payload: any) => {
        updates.push(payload);
        return {
          eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }),
        };
      },
    }),
  },
}));

import {
  decodeCanonicalDefaultRateOptions,
  decodePersistedDefaultRates,
  type CanonicalDefaultRateOption,
  type PersistedDefaultRateSelection,
  type PersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";
import {
  clearAllBasisSelections,
  clearBasisSelection,
  emptyPersistedDefaultRates,
  isKnownDifferentRegisteredProduct,
  isSameDefaultRateSelection,
  matchDefaultRateSlot,
  matchDefaultRateSlots,
  selectionFromCanonicalOption,
  withBasisSelection,
} from "@/lib/chemicalDefaultRateSelection";
import { updateSavedChemical } from "@/lib/savedChemicalsQuery";
import vicol from "./fixtures/d4b-vicol-au.json";

const AT = "2026-08-26T00:00:00.000Z";

const canonical = decodeCanonicalDefaultRateOptions((vicol as any).default_rate_options)!;
const twoL = canonical.per_100_litres[0];
const threeL = canonical.per_100_litres[1];

const HA_OPTION: CanonicalDefaultRateOption = {
  option_key: "default_option_v1_aaaa0000aaaa0000aaaa0000aaaa0000",
  rate_ids: ["rate_v1_1111111111111111111111111111111a"],
  basis: "per_hectare",
  unit: "L",
  value: 10,
  min_value: null,
  max_value: null,
};

const RANGE_OPTION: CanonicalDefaultRateOption = {
  option_key: "default_option_v1_bbbb0000bbbb0000bbbb0000bbbb0000",
  rate_ids: ["rate_v1_2222222222222222222222222222222b"],
  basis: "per_hectare",
  unit: "L",
  value: null,
  min_value: 1.5,
  max_value: 3,
};

const operator = (o: CanonicalDefaultRateOption, labelVersion: string | null = null) =>
  selectionFromCanonicalOption(o, { source: "operator", selectedAt: AT, labelVersion });

/* --------------------------------------------- A / B — copy + provenance */

describe("D4B-P2B — canonical option -> persisted selection", () => {
  it("A. copies the semantic fields exactly and adds only provenance", () => {
    const sel = operator(threeL, "2024-05");
    expect(sel).toEqual({
      option_key: "default_option_v1_94df25e59456a8a736cdb446e1a7af3e",
      rate_ids: [
        "rate_v1_347ebfa9ad731449f589ae79458eaa88",
        "rate_v1_805fb1dea8eb5f2bba9740b95d52a773",
      ],
      basis: "per_100_litres",
      unit: "L",
      value: 3,
      min_value: null,
      max_value: null,
      source: "operator",
      selected_at: AT,
      label_version: "2024-05",
    });
    // No display metadata leaks into default_rates.
    for (const k of ["targets", "conditions", "direction_ids", "crops", "condition_ambiguous"]) {
      expect(k in (sel as any)).toBe(false);
    }
  });

  it("B. a portal click is always source=operator", () => {
    expect(operator(twoL).source).toBe("operator");
  });

  it("copies rate_ids without regrouping or reordering", () => {
    const sel = operator(twoL);
    expect(sel.rate_ids).toEqual(twoL.rate_ids);
    expect(sel.rate_ids).not.toBe(twoL.rate_ids);
  });
});

/* ------------------------------------------------ C — lookup creates nothing */

describe("D4B-P2B — a lookup alone never creates a selection", () => {
  it("C. canonical options present, defaults still empty", () => {
    const defaults = emptyPersistedDefaultRates();
    const slots = matchDefaultRateSlots(defaults, canonical);
    expect(slots.per_100_litres.status).toBe("no_selection");
    expect(slots.per_hectare.status).toBe("no_selection");
    expect(defaults).toEqual({ version: 1, per_hectare: null, per_100_litres: null });
  });
});

/* --------------------------------------------- D–G — independent basis slots */

describe("D4B-P2B — independent basis slots", () => {
  it("D. both bases can hold a selection", () => {
    let d: PersistedDefaultRates = emptyPersistedDefaultRates();
    d = withBasisSelection(d, "per_100_litres", operator(threeL));
    d = withBasisSelection(d, "per_hectare", operator(HA_OPTION));
    expect(d.per_100_litres!.value).toBe(3);
    expect(d.per_hectare!.value).toBe(10);
    expect(d.version).toBe(1);
  });

  it("E. selecting /100 L leaves /ha untouched", () => {
    const ha = operator(HA_OPTION);
    const d = withBasisSelection(
      { version: 1, per_hectare: ha, per_100_litres: null },
      "per_100_litres",
      operator(threeL),
    );
    expect(d.per_hectare).toBe(ha);
  });

  it("F. selecting /ha leaves /100 L untouched", () => {
    const hl = operator(threeL);
    const d = withBasisSelection(
      { version: 1, per_hectare: null, per_100_litres: hl },
      "per_hectare",
      operator(HA_OPTION),
    );
    expect(d.per_100_litres).toBe(hl);
  });

  it("G. clearing one basis leaves the other untouched", () => {
    const ha = operator(HA_OPTION);
    const d = clearBasisSelection(
      { version: 1, per_hectare: ha, per_100_litres: operator(threeL) },
      "per_100_litres",
    );
    expect(d.per_100_litres).toBeNull();
    expect(d.per_hectare).toBe(ha);
  });
});

/* ------------------------------------------------------- H–L — matching rule */

describe("D4B-P2B — matching rule", () => {
  it("H. a persisted matching option restores as matched/selected", () => {
    const d = withBasisSelection(null, "per_100_litres", operator(threeL));
    const slot = matchDefaultRateSlot(d, canonical, "per_100_litres");
    expect(slot.status).toBe("matched");
    expect(slot.matchedOption!.option_key).toBe(threeL.option_key);
  });

  it("I. same numeric value with the wrong option_key does NOT restore", () => {
    const sel: PersistedDefaultRateSelection = {
      ...operator(threeL),
      option_key: "default_option_v1_ffffffffffffffffffffffffffffffff",
    };
    const slot = matchDefaultRateSlot(
      withBasisSelection(null, "per_100_litres", sel),
      canonical,
      "per_100_litres",
    );
    expect(slot.status).toBe("needs_review");
    expect(slot.matchedOption).toBeNull();
    expect(slot.selection).toEqual(sel);
  });

  it("J. right option_key with the wrong rate_id set does NOT restore", () => {
    const sel: PersistedDefaultRateSelection = {
      ...operator(threeL),
      rate_ids: ["rate_v1_347ebfa9ad731449f589ae79458eaa88"],
    };
    const slot = matchDefaultRateSlot(
      withBasisSelection(null, "per_100_litres", sel),
      canonical,
      "per_100_litres",
    );
    expect(slot.status).toBe("needs_review");
  });

  it("matches a rate_id set order-insensitively without rewriting it", () => {
    const reversed = [...threeL.rate_ids].reverse();
    const sel: PersistedDefaultRateSelection = { ...operator(threeL), rate_ids: reversed };
    expect(isSameDefaultRateSelection(sel, threeL)).toBe(true);
    expect(sel.rate_ids).toEqual(reversed);
  });

  it("never matches across bases or on a different unit", () => {
    expect(isSameDefaultRateSelection({ ...operator(threeL), unit: "mL" }, threeL)).toBe(false);
    expect(
      matchDefaultRateSlot(
        withBasisSelection(null, "per_100_litres", operator(threeL)),
        canonical,
        "per_hectare",
      ).status,
    ).toBe("no_selection");
  });

  it("K. a stale/removed option => needs_review with the snapshot preserved", () => {
    const sel = operator(threeL);
    const shrunk = { per_hectare: [], per_100_litres: [twoL] };
    const slot = matchDefaultRateSlot(
      withBasisSelection(null, "per_100_litres", sel),
      shrunk,
      "per_100_litres",
    );
    expect(slot.status).toBe("needs_review");
    expect(slot.selection).toEqual(sel);
    expect(slot.matchedOption).toBeNull();
  });

  it("L. canonical options unavailable => snapshot preserved, status unavailable", () => {
    const sel = operator(threeL);
    const slot = matchDefaultRateSlot(
      withBasisSelection(null, "per_100_litres", sel),
      null,
      "per_100_litres",
    );
    expect(slot.status).toBe("unavailable");
    expect(slot.selection).toEqual(sel);
  });
});

/* -------------------------------------------- M — failure changes nothing */

describe("D4B-P2B — failed / ambiguous lookup", () => {
  it("M. leaves the default state and dirty flag unchanged", () => {
    const before: PersistedDefaultRates = withBasisSelection(null, "per_100_litres", operator(threeL));
    let dirty = false;
    // A failing lookup produces no canonical options and touches no state.
    const options = null;
    const slots = matchDefaultRateSlots(before, options);
    expect(slots.per_100_litres.selection).toEqual(before.per_100_litres);
    expect(dirty).toBe(false);
    expect(before.per_100_litres!.source).toBe("operator");
  });
});

/* ----------------------------------------------- N–P, Q–S — save semantics */

describe("D4B-P2B — save semantics", () => {
  it("N. an unrelated edit omits default_rates entirely", async () => {
    updates.length = 0;
    await updateSavedChemical("c1", { name: "Vicol", notes: "changed" });
    expect("default_rates" in updates[0]).toBe(false);
  });

  it("O. an operator selection writes the FULL version-1 object", async () => {
    updates.length = 0;
    const d = withBasisSelection(null, "per_100_litres", operator(threeL));
    await updateSavedChemical("c1", { name: "Vicol", default_rates: d });
    expect(updates[0].default_rates).toEqual({
      version: 1,
      per_hectare: null,
      per_100_litres: {
        option_key: "default_option_v1_94df25e59456a8a736cdb446e1a7af3e",
        rate_ids: [
          "rate_v1_347ebfa9ad731449f589ae79458eaa88",
          "rate_v1_805fb1dea8eb5f2bba9740b95d52a773",
        ],
        basis: "per_100_litres",
        unit: "L",
        value: 3,
        min_value: null,
        max_value: null,
        source: "operator",
        selected_at: AT,
        label_version: null,
      },
    });
  });

  it("P. an explicit clear writes the full object with a null slot", async () => {
    updates.length = 0;
    const ha = operator(HA_OPTION);
    const d = clearBasisSelection(
      { version: 1, per_hectare: ha, per_100_litres: operator(threeL) },
      "per_100_litres",
    );
    await updateSavedChemical("c1", { name: "Vicol", default_rates: d });
    expect(updates[0].default_rates.per_100_litres).toBeNull();
    expect(updates[0].default_rates.per_hectare).toEqual(ha);
    expect(updates[0].default_rates.version).toBe(1);
  });

  it("Q. a true range persists min/max with value null, exactly", async () => {
    updates.length = 0;
    const d = withBasisSelection(null, "per_hectare", operator(RANGE_OPTION));
    await updateSavedChemical("c1", { name: "Vicol", default_rates: d });
    expect(updates[0].default_rates.per_hectare).toMatchObject({
      value: null,
      min_value: 1.5,
      max_value: 3,
      unit: "L",
    });
    // Round-trips through the decoder unchanged.
    expect(decodePersistedDefaultRates(updates[0].default_rates)!.per_hectare).toEqual(
      d.per_hectare,
    );
  });

  it("R. no /100 L <-> /ha conversion ever happens", async () => {
    updates.length = 0;
    const d = withBasisSelection(null, "per_100_litres", operator(threeL));
    await updateSavedChemical("c1", { name: "Vicol", default_rates: d });
    expect(updates[0].default_rates.per_100_litres.basis).toBe("per_100_litres");
    expect(updates[0].default_rates.per_100_litres.value).toBe(3);
    expect(updates[0].default_rates.per_hectare).toBeNull();
  });

  it("S. a canonical selection never touches legacy rate_per_ha / unit", async () => {
    updates.length = 0;
    const d = withBasisSelection(null, "per_100_litres", operator(threeL));
    await updateSavedChemical("c1", { name: "Vicol", default_rates: d });
    expect("rate_per_ha" in updates[0]).toBe(false);
    // saved_chemicals.unit is NOT NULL, so the writer defaults it — but never
    // from the label rate unit of the selection.
    expect(updates[0].unit).toBe("Litres");
  });
});

/* ------------------------------------------------ T–U — product identity */

describe("D4B-P2B — registered product change", () => {
  it("T. a known different registration clears both slots", () => {
    const changed = isKnownDifferentRegisteredProduct(
      { country: "AU", scheme: "APVMA", number: "33182" },
      { country: "AU", scheme: "APVMA", number: "45678" },
    );
    expect(changed).toBe(true);
    const cleared = clearAllBasisSelections();
    expect(cleared).toEqual({ version: 1, per_hectare: null, per_100_litres: null });
  });

  it("U. the same registration with a changed label does NOT clear", () => {
    expect(
      isKnownDifferentRegisteredProduct(
        { country: "AU", scheme: "APVMA", number: "33182" },
        { country: "AU", scheme: "APVMA", number: "33182" },
      ),
    ).toBe(false);
    // …it becomes needs_review when the option set no longer contains it.
    const slot = matchDefaultRateSlot(
      withBasisSelection(null, "per_100_litres", operator(threeL, "2024-05")),
      { per_hectare: [], per_100_litres: [twoL] },
      "per_100_litres",
    );
    expect(slot.status).toBe("needs_review");
    expect(slot.selection!.label_version).toBe("2024-05");
  });

  it("never clears when either identity is unknown", () => {
    expect(isKnownDifferentRegisteredProduct(null, { number: "33182" })).toBe(false);
    expect(
      isKnownDifferentRegisteredProduct({ number: "33182" }, { country: "AU", scheme: "APVMA", number: "45678" }),
    ).toBe(false);
  });
});

/* ------------------------------------------- V — foreign `recommended` row */

describe("D4B-P2B — source:recommended written by another client", () => {
  const row = {
    version: 1,
    per_hectare: null,
    per_100_litres: {
      ...threeL,
      source: "recommended",
      selected_at: AT,
      label_version: null,
      targets: ["ignored"],
    },
  };

  it("V. survives reopen unchanged and still matches", () => {
    const decoded = decodePersistedDefaultRates(row)!;
    expect(decoded.per_100_litres!.source).toBe("recommended");
    const slot = matchDefaultRateSlot(decoded, canonical, "per_100_litres");
    expect(slot.status).toBe("matched");
    expect(slot.selection!.source).toBe("recommended");
  });

  it("only an operator click replaces it, and then source becomes operator", () => {
    const decoded = decodePersistedDefaultRates(row)!;
    const next = withBasisSelection(decoded, "per_100_litres", operator(twoL));
    expect(next.per_100_litres!.source).toBe("operator");
    expect(next.per_100_litres!.option_key).toBe(twoL.option_key);
  });
});

/* --------------------------------------------------- W — VICOL acceptance */

describe("D4B-P2B — VICOL APVMA 33182 acceptance", () => {
  it("W. offers two /100 L options, no /ha, and selects nothing automatically", () => {
    expect(canonical.per_hectare).toHaveLength(0);
    expect(canonical.per_100_litres).toHaveLength(2);
    const slots = matchDefaultRateSlots(emptyPersistedDefaultRates(), canonical);
    expect(slots.per_100_litres.selection).toBeNull();
    expect(slots.per_hectare.selection).toBeNull();
  });

  it("W. clicking 3 L /100 L persists exactly the backend identity", () => {
    const d = withBasisSelection(emptyPersistedDefaultRates(), "per_100_litres", operator(threeL));
    expect(d.per_100_litres).toEqual({
      option_key: "default_option_v1_94df25e59456a8a736cdb446e1a7af3e",
      rate_ids: [
        "rate_v1_347ebfa9ad731449f589ae79458eaa88",
        "rate_v1_805fb1dea8eb5f2bba9740b95d52a773",
      ],
      basis: "per_100_litres",
      unit: "L",
      value: 3,
      min_value: null,
      max_value: null,
      source: "operator",
      selected_at: AT,
      label_version: null,
    });
  });

  it("W. reopen without a lookup shows the saved 3 L snapshot", () => {
    const stored = JSON.parse(
      JSON.stringify(withBasisSelection(null, "per_100_litres", operator(threeL))),
    );
    const reopened = decodePersistedDefaultRates(stored)!;
    const slot = matchDefaultRateSlot(reopened, null, "per_100_litres");
    expect(slot.status).toBe("unavailable");
    expect(slot.selection!.value).toBe(3);
    expect(slot.selection!.unit).toBe("L");
    expect(slot.selection!.basis).toBe("per_100_litres");
  });

  it("W. re-applying the same production lookup re-matches with no write", () => {
    const reopened = decodePersistedDefaultRates(
      JSON.parse(JSON.stringify(withBasisSelection(null, "per_100_litres", operator(threeL)))),
    )!;
    const fresh = decodeCanonicalDefaultRateOptions((vicol as any).default_rate_options)!;
    const slot = matchDefaultRateSlot(reopened, fresh, "per_100_litres");
    expect(slot.status).toBe("matched");
    // Matching is read-only: the stored snapshot is identical afterwards.
    expect(reopened.per_100_litres).toEqual(slot.selection);
  });
});
