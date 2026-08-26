// Gate D4B-P2A.1 — shared D3 contract fidelity.
//
// Rules asserted here:
//   * provenance (`selected_at`, `label_version`) is nullable and tolerant:
//     absent/null/malformed => null, and the selection SURVIVES;
//   * amount shape is exact: SINGLE (value only) or RANGE (min<=max only);
//   * production APVMA 33182 identities pass through byte-for-byte.
import { describe, it, expect } from "vitest";

import {
  decodeCanonicalDefaultRateOption,
  decodeCanonicalDefaultRateOptions,
  decodePersistedDefaultRates,
} from "@/lib/chemicalDefaultRatesContract";

import vicol from "./fixtures/d4b-vicol-au.json";

const OPTION_2L = "default_option_v1_42d1761ddc477436ffd40e7b881f0255";
const RATE_2L_A = "rate_v1_2b559abc7cadaefe20e405674c523811";
const RATE_2L_B = "rate_v1_758843c84a12d817494ccd5acd13720f";
const OPTION_3L = "default_option_v1_94df25e59456a8a736cdb446e1a7af3e";
const RATE_3L_A = "rate_v1_347ebfa9ad731449f589ae79458eaa88";
const RATE_3L_B = "rate_v1_805fb1dea8eb5f2bba9740b95d52a773";

const selection = (patch: Record<string, unknown> = {}) => ({
  option_key: OPTION_2L,
  rate_ids: [RATE_2L_A, RATE_2L_B],
  basis: "per_100_litres",
  unit: "L",
  value: 2,
  min_value: null,
  max_value: null,
  source: "operator",
  selected_at: "2026-08-26T00:00:00.000Z",
  label_version: "APVMA label approval 33182-0623",
  ...patch,
});

const persisted = (patch: Record<string, unknown> = {}) =>
  decodePersistedDefaultRates({
    version: 1,
    per_hectare: null,
    per_100_litres: selection(patch),
  });

const option = (patch: Record<string, unknown> = {}) =>
  decodeCanonicalDefaultRateOption({
    option_key: OPTION_2L,
    rate_ids: [RATE_2L_A],
    basis: "per_100_litres",
    unit: "L",
    value: 2,
    min_value: null,
    max_value: null,
    ...patch,
  });

describe("D4B-P2A.1 — provenance is nullable and tolerant", () => {
  it("A. selected_at: null is a valid persisted selection", () => {
    const out = persisted({ selected_at: null });
    expect(out!.per_100_litres?.option_key).toBe(OPTION_2L);
    expect(out!.per_100_litres?.selected_at).toBeNull();
  });

  it("B. absent selected_at is accepted and becomes null", () => {
    const raw = selection();
    delete (raw as any).selected_at;
    const out = decodePersistedDefaultRates({
      version: 1,
      per_hectare: null,
      per_100_litres: raw,
    });
    expect(out!.per_100_litres?.option_key).toBe(OPTION_2L);
    expect(out!.per_100_litres?.selected_at).toBeNull();
  });

  it("C. label_version: null is valid", () => {
    const out = persisted({ label_version: null });
    expect(out!.per_100_litres?.label_version).toBeNull();
    expect(out!.per_100_litres?.value).toBe(2);
  });

  it("D. malformed selected_at degrades to null without killing the selection", () => {
    const out = persisted({ selected_at: 123 });
    expect(out!.per_100_litres).not.toBeNull();
    expect(out!.per_100_litres?.selected_at).toBeNull();
    expect(out!.per_100_litres?.rate_ids).toEqual([RATE_2L_A, RATE_2L_B]);
  });

  it("E. malformed label_version degrades to null without killing the selection", () => {
    const out = persisted({ label_version: {} });
    expect(out!.per_100_litres).not.toBeNull();
    expect(out!.per_100_litres?.label_version).toBeNull();
  });
});

describe("D4B-P2A.1 — exact D3 amount shape", () => {
  it("F. scalar value combined with min/max is rejected (both decoders)", () => {
    expect(persisted({ value: 2, min_value: 2, max_value: 3 })!.per_100_litres).toBeNull();
    expect(option({ value: 2, min_value: 2, max_value: 3 })).toBeNull();
  });

  it("G. range with only min is rejected", () => {
    expect(persisted({ value: null, min_value: 2, max_value: null })!.per_100_litres).toBeNull();
    expect(option({ value: null, min_value: 2, max_value: null })).toBeNull();
  });

  it("H. range with only max is rejected", () => {
    expect(persisted({ value: null, min_value: null, max_value: 3 })!.per_100_litres).toBeNull();
    expect(option({ value: null, min_value: null, max_value: 3 })).toBeNull();
  });

  it("I. inverted range is rejected", () => {
    expect(persisted({ value: null, min_value: 3, max_value: 2 })!.per_100_litres).toBeNull();
    expect(option({ value: null, min_value: 3, max_value: 2 })).toBeNull();
  });

  it("J. non-finite numbers are rejected", () => {
    expect(persisted({ value: Number.NaN })!.per_100_litres).toBeNull();
    expect(option({ value: Number.POSITIVE_INFINITY })).toBeNull();
    expect(
      option({ value: null, min_value: 2, max_value: Number.NaN }),
    ).toBeNull();
  });

  it("no value and no bounds is rejected", () => {
    expect(persisted({ value: null })!.per_100_litres).toBeNull();
    expect(option({ value: null })).toBeNull();
  });

  it("K. a valid scalar stays exact", () => {
    const out = persisted({ value: 2.25 })!.per_100_litres!;
    expect([out.value, out.min_value, out.max_value]).toEqual([2.25, null, null]);
  });

  it("L. a valid range stays exact", () => {
    const out = persisted({ value: null, min_value: 2, max_value: 3 })!.per_100_litres!;
    expect([out.value, out.min_value, out.max_value]).toEqual([null, 2, 3]);
    const opt = option({ value: null, min_value: 2, max_value: 3 })!;
    expect([opt.value, opt.min_value, opt.max_value]).toEqual([null, 2, 3]);
  });
});

describe("D4B-P2A.1 — production VICOL identities", () => {
  it("M. real APVMA 33182 option keys and rate_ids survive decode byte-for-byte", () => {
    const options = decodeCanonicalDefaultRateOptions((vicol as any).default_rate_options)!;
    expect(options.per_hectare).toEqual([]);
    expect(options.per_100_litres.map((o) => o.option_key)).toEqual([OPTION_2L, OPTION_3L]);
    expect(options.per_100_litres.map((o) => o.rate_ids)).toEqual([
      [RATE_2L_A, RATE_2L_B],
      [RATE_3L_A, RATE_3L_B],
    ]);
  });
});
