// Gate D4B-P2B.1 — canonical-option lifetime + product-ownership regression.
//
// Boundary asserted here: canonical options live only for the authoritative
// lookup that supplied them; invalidation never touches persisted defaults;
// only a PROVEN registered-product change clears them.
import { describe, it, expect } from "vitest";
import {
  applyAuthoritativeChemistry,
  applyReplacedChemistry,
  applyUnsuccessfulLookup,
  clearDefaultRate,
  hydrateDefaultRateLifecycle,
  invalidateCanonicalOptions,
  newDefaultRateLifecycle,
  selectDefaultRate,
  type DefaultRateLifecycleState,
} from "@/lib/chemicalDefaultRateLifecycle";
import { decodeCanonicalDefaultRateOptions } from "@/lib/chemicalDefaultRatesContract";
import { matchDefaultRateSlot } from "@/lib/chemicalDefaultRateSelection";
import vicol from "./fixtures/d4b-vicol-au.json";

const AT = "2026-08-26T00:00:00.000Z";
const A_OPTIONS = decodeCanonicalDefaultRateOptions((vicol as any).default_rate_options)!;
const A_THREE_L = A_OPTIONS.per_100_litres[1];
const A = { country: "AU", scheme: "APVMA", number: "33182" };
const B = { country: "AU", scheme: "APVMA", number: "45678" };

/** Product B canonical options — a different product with its own rate_v1 ids. */
const B_OPTIONS = {
  per_hectare: [
    {
      option_key: "default_option_v1_bbbb0000bbbb0000bbbb0000bbbb0000",
      rate_ids: ["rate_v1_b000000000000000000000000000000b"],
      basis: "per_hectare" as const,
      unit: "L",
      value: 5,
      min_value: null,
      max_value: null,
    },
  ],
  per_100_litres: [],
};

/** New chemical → authoritative lookup of product A → operator picks 3 L. */
function newWithASelected(): DefaultRateLifecycleState {
  const afterLookup = applyAuthoritativeChemistry(newDefaultRateLifecycle(), {
    productIdentity: A,
    options: A_OPTIONS,
    labelVersion: "APVMA label approval 33182-0623",
  });
  return selectDefaultRate(afterLookup, A_THREE_L, "per_100_litres", AT);
}

/* --------------------------------------------- A–D — product ownership */

describe("P2B.1 — registered-product ownership", () => {
  it("A. NEW chemical: authoritative product B clears product A's default", () => {
    const withA = newWithASelected();
    expect(withA.defaultRates.per_100_litres!.option_key).toBe(A_THREE_L.option_key);

    const withB = applyAuthoritativeChemistry(withA, {
      productIdentity: B,
      options: B_OPTIONS,
      labelVersion: null,
    });
    expect(withB.defaultRates).toEqual({
      version: 1,
      per_hectare: null,
      per_100_litres: null,
    });
    expect(withB.dirty).toBe(true);
    expect(withB.productChangedNotice).toBe(true);
    // B's options are available; no A option or default survives.
    expect(withB.canonicalOptions).toBe(B_OPTIONS);
    expect(withB.productIdentity).toEqual(B);
    expect(JSON.stringify(withB)).not.toContain(A_THREE_L.option_key);
  });

  it("B. EXISTING chemical: product B still clears the stored default", () => {
    const stored = hydrateDefaultRateLifecycle({
      storedDefaultRates: newWithASelected().defaultRates,
      productIdentity: A,
      labelVersion: null,
    });
    expect(stored.defaultRates.per_100_litres).not.toBeNull();
    expect(stored.dirty).toBe(false);

    const withB = applyAuthoritativeChemistry(stored, {
      productIdentity: B,
      options: B_OPTIONS,
      labelVersion: null,
    });
    expect(withB.defaultRates.per_100_litres).toBeNull();
    expect(withB.defaultRates.per_hectare).toBeNull();
    expect(withB.dirty).toBe(true);
  });

  it("C. same registration with a NEW label revision does NOT clear", () => {
    const withA = newWithASelected();
    const revised = applyAuthoritativeChemistry(withA, {
      productIdentity: { ...A },
      options: { per_hectare: [], per_100_litres: [A_OPTIONS.per_100_litres[0]] },
      labelVersion: "APVMA label approval 33182-0725",
    });
    expect(revised.defaultRates.per_100_litres!.option_key).toBe(A_THREE_L.option_key);
    expect(revised.productChangedNotice).toBe(false);
    // Removed from the revised label => needs_review, snapshot preserved.
    expect(matchDefaultRateSlot(revised.defaultRates, revised.canonicalOptions, "per_100_litres").status).toBe(
      "needs_review",
    );
  });

  it("D. an incomplete old or new identity never clears", () => {
    const partialNew = applyAuthoritativeChemistry(newWithASelected(), {
      productIdentity: { country: null, scheme: null, number: "45678" },
      options: null,
      labelVersion: null,
    });
    expect(partialNew.defaultRates.per_100_litres).not.toBeNull();
    expect(partialNew.dirty).toBe(true); // still dirty from the operator click only
    expect(partialNew.productChangedNotice).toBe(false);

    const unknownOld = applyAuthoritativeChemistry(
      { ...newWithASelected(), productIdentity: null },
      { productIdentity: B, options: B_OPTIONS, labelVersion: null },
    );
    expect(unknownOld.defaultRates.per_100_litres).not.toBeNull();
    expect(unknownOld.productChangedNotice).toBe(false);
  });
});

/* ------------------------------------ E–F — authoritative null option block */

describe("P2B.1 — authoritative result with no canonical block", () => {
  const stored = hydrateDefaultRateLifecycle({
    storedDefaultRates: newWithASelected().defaultRates,
    productIdentity: A,
    labelVersion: null,
  });
  const withOptions = applyAuthoritativeChemistry(stored, {
    productIdentity: A,
    options: A_OPTIONS,
    labelVersion: null,
  });
  const noBlock = applyAuthoritativeChemistry(withOptions, {
    productIdentity: A,
    options: null,
    labelVersion: null,
  });

  it("E. drops the previous options instead of leaving them visible", () => {
    expect(withOptions.canonicalOptions).toBe(A_OPTIONS);
    expect(noBlock.canonicalOptions).toBeNull();
  });

  it("F. persisted snapshot survives, dirty unchanged, slot becomes unavailable", () => {
    expect(noBlock.defaultRates).toEqual(stored.defaultRates);
    expect(noBlock.dirty).toBe(false);
    const slot = matchDefaultRateSlot(noBlock.defaultRates, noBlock.canonicalOptions, "per_100_litres");
    expect(slot.status).toBe("unavailable");
    expect(slot.selection!.value).toBe(3);
  });
});

/* ---------------------------------- G–J, L — invalidation-only boundaries */

describe("P2B.1 — invalidation never touches persisted defaults", () => {
  const withA = newWithASelected();

  it("G/H. a manual registration-number or registered-use edit only invalidates", () => {
    const invalidated = invalidateCanonicalOptions(withA);
    expect(invalidated.canonicalOptions).toBeNull();
    expect(invalidated.defaultRates).toEqual(withA.defaultRates);
    expect(invalidated.dirty).toBe(withA.dirty);
    expect(invalidated.productIdentity).toEqual(withA.productIdentity);
  });

  it("I. an accepted Master update invalidates old options and preserves defaults", () => {
    const accepted = applyReplacedChemistry(withA, { productIdentity: { ...A } });
    expect(accepted.canonicalOptions).toBeNull();
    expect(accepted.defaultRates).toEqual(withA.defaultRates);
    expect(accepted.dirty).toBe(withA.dirty);
    expect(accepted.productChangedNotice).toBe(false);
  });

  it("J. a Master product switch clears defaults only when provably different", () => {
    const provable = applyReplacedChemistry(withA, { productIdentity: B });
    expect(provable.defaultRates.per_100_litres).toBeNull();
    expect(provable.dirty).toBe(true);
    expect(provable.productChangedNotice).toBe(true);
    expect(provable.canonicalOptions).toBeNull();

    const unprovable = applyReplacedChemistry(withA, { productIdentity: null });
    expect(unprovable.defaultRates).toEqual(withA.defaultRates);
    expect(unprovable.productChangedNotice).toBe(false);
    expect(unprovable.productIdentity).toEqual(A);
  });

  it("L. no old option remains selectable once chemistry was replaced", () => {
    for (const next of [
      invalidateCanonicalOptions(withA),
      applyReplacedChemistry(withA, { productIdentity: { ...A } }),
      applyAuthoritativeChemistry(withA, { productIdentity: A, options: null, labelVersion: null }),
    ]) {
      expect(next.canonicalOptions).toBeNull();
      expect(matchDefaultRateSlot(next.defaultRates, next.canonicalOptions, "per_100_litres").matchedOption).toBeNull();
    }
  });
});

/* -------------------------------------------------- K — failure behaviour */

describe("P2B.1 — unsuccessful search attempt", () => {
  it("K. leaves defaults, dirty and current options untouched", () => {
    const withA = newWithASelected();
    const after = applyUnsuccessfulLookup(withA);
    expect(after).toEqual(withA);
    expect(after.canonicalOptions).toBe(A_OPTIONS);
    expect(after.defaultRates.per_100_litres!.source).toBe("operator");
    expect(after.dirty).toBe(true);

    // …and on a clean reopened row nothing becomes dirty.
    const stored = hydrateDefaultRateLifecycle({
      storedDefaultRates: withA.defaultRates,
      productIdentity: A,
      labelVersion: null,
    });
    expect(applyUnsuccessfulLookup(stored)).toEqual(stored);
    expect(applyUnsuccessfulLookup(stored).dirty).toBe(false);
  });
});

/* --------------------------------------- selection / clear pass-through */

describe("P2B.1 — operator transitions keep P2B semantics", () => {
  it("a click stamps operator provenance and the current label version", () => {
    const s = newWithASelected();
    expect(s.defaultRates.per_100_litres).toMatchObject({
      source: "operator",
      selected_at: AT,
      label_version: "APVMA label approval 33182-0623",
      value: 3,
      basis: "per_100_litres",
    });
    expect(s.defaultRates.per_hectare).toBeNull();
  });

  it("clearing one basis dirties and preserves the other", () => {
    const both = selectDefaultRate(
      applyAuthoritativeChemistry(newWithASelected(), {
        productIdentity: A,
        options: { ...A_OPTIONS, per_hectare: B_OPTIONS.per_hectare },
        labelVersion: null,
      }),
      B_OPTIONS.per_hectare[0],
      "per_hectare",
      AT,
    );
    const cleared = clearDefaultRate(both, "per_hectare");
    expect(cleared.defaultRates.per_hectare).toBeNull();
    expect(cleared.defaultRates.per_100_litres!.value).toBe(3);
    expect(cleared.dirty).toBe(true);
  });
});
