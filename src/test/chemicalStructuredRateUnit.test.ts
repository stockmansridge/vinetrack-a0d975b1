// Structured rate unit/basis contract — the Spray.Seed 250 production defect.
//
// unit carries the NUMERATOR only; the denominator lives in the basis.
import { describe, it, expect } from "vitest";
import {
  RATE_UNIT_MESSAGE,
  canonicalRateUnit,
  hasCompositeUnit,
  normaliseStructuredRateUnit,
  structuredRateProblems,
  validateStructuredRate,
} from "@/lib/chemicalRateUnitContract";
import {
  encodeChemicalIntelligenceForWrite,
  decodeChemicalIntelligenceRow,
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";

const draftWith = (rate: Record<string, unknown>): ChemicalIntelligenceDraft =>
  ({
    actives: [{ name: "Paraquat", identity_source: "manufacturer_label" }],
    registration: {},
    sources: [],
    conflicts: [],
    unresolvedFields: [],
    registeredUses: [{ crop: "Grapevines", target_raw: "Weeds", rates: [rate] }],
  } as unknown as ChemicalIntelligenceDraft);

describe("canonical rate units", () => {
  it("accepts only L, mL, kg, g", () => {
    expect(canonicalRateUnit("mL")).toBe("mL");
    expect(canonicalRateUnit("ml")).toBe("mL");
    expect(canonicalRateUnit("L/ha")).toBeNull();
    expect(hasCompositeUnit("mL/100 L")).toBe(true);
    expect(hasCompositeUnit("mL")).toBe(false);
  });
});

describe("valid structured rates round-trip unchanged", () => {
  it("keeps a 240–320 mL/100 L range as a range", () => {
    const encoded = encodeChemicalIntelligenceForWrite(
      draftWith({
        label: "",
        basis: "range_per_100_litres",
        unit: "mL",
        min_value: 240,
        max_value: 320,
      }),
    );
    expect((encoded.registered_uses as any[])[0]).toMatchObject({
      crop: "Grapevines",
      rates: [{ basis: "range_per_100_litres", unit: "mL", min_value: 240, max_value: 320 }],
    });
    expect((encoded.registered_uses as any[])[0].rates[0].value).toBeUndefined();
  });

  it("keeps a 2.4–3.2 L/ha area range", () => {
    const rate = (
      encodeChemicalIntelligenceForWrite(
        draftWith({
          label: "",
          basis: "range_per_hectare",
          unit: "L",
          min_value: 2.4,
          max_value: 3.2,
        }),
      ).registered_uses as any[]
    )[0].rates[0];
    expect(rate).toMatchObject({ unit: "L", min_value: 2.4, max_value: 3.2 });
  });

  it("keeps a single 240 mL/100 L rate scalar-only", () => {
    const rate = (
      encodeChemicalIntelligenceForWrite(
        draftWith({ label: "", basis: "per_100_litres", unit: "mL", value: 240 }),
      ).registered_uses as any[]
    )[0].rates[0];
    expect(rate).toMatchObject({ basis: "per_100_litres", unit: "mL", value: 240 });
    expect(rate.min_value).toBeUndefined();
    expect(rate.max_value).toBeUndefined();
  });
});

describe("the malformed shapes can no longer be persisted", () => {
  it("rejects a composite unit", () => {
    expect(() =>
      encodeChemicalIntelligenceForWrite(
        draftWith({ label: "", basis: "per_hectare", unit: "L/ha", value: 2.4 }),
      ),
    ).toThrow(RATE_UNIT_MESSAGE);
  });

  it("rejects the exact Spray.Seed 250 record", () => {
    expect(() =>
      encodeChemicalIntelligenceForWrite(
        draftWith({ label: "", basis: "per_100_litres", unit: "L/ha", value: 240 }),
      ),
    ).toThrow(RATE_UNIT_MESSAGE);
  });

  it("rejects mixed single/range shapes and non-positive amounts", () => {
    expect(
      validateStructuredRate({ basis: "range_per_100_litres", unit: "mL", min_value: 240 }).ok,
    ).toBe(false);
    expect(
      validateStructuredRate({
        basis: "range_per_100_litres",
        unit: "mL",
        min_value: 320,
        max_value: 240,
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredRate({
        basis: "per_100_litres",
        unit: "mL",
        value: 240,
        min_value: 200,
      }).ok,
    ).toBe(false);
    expect(validateStructuredRate({ basis: "per_hectare", unit: "L", value: 0 }).ok).toBe(false);
    expect(structuredRateProblems([{ rates: [{ basis: "per_hectare", unit: "L/ha", value: 1 }] }]))
      .toHaveLength(1);
  });
});

describe("legacy composite units when editing", () => {
  it("normalises only when the denominator agrees with the basis", () => {
    expect(normaliseStructuredRateUnit("L/ha", "per_hectare")).toEqual({
      status: "normalised",
      unit: "L",
    });
    expect(normaliseStructuredRateUnit("mL/100 L", "per_100_litres")).toEqual({
      status: "normalised",
      unit: "mL",
    });
    expect(normaliseStructuredRateUnit("mL", "range_per_100_litres")).toEqual({
      status: "ok",
      unit: "mL",
    });
  });

  it("flags a contradiction for review and never auto-corrects it", () => {
    expect(normaliseStructuredRateUnit("L/ha", "per_100_litres")).toEqual({
      status: "needs_review",
      unit: "L/ha",
    });
    const decoded = decodeChemicalIntelligenceRow({
      registered_uses: [
        {
          crop: "Grapevines",
          target_raw: "Weeds",
          rates: [{ basis: "per_100_litres", unit: "L/ha", value: 240 }],
        },
      ],
    } as any);
    expect(decoded.registeredUses[0].rates[0].unit).toBe("L/ha");
    expect(() => encodeChemicalIntelligenceForWrite(decoded)).toThrow(RATE_UNIT_MESSAGE);
  });

  it("presents an unambiguous legacy rate bare on load", () => {
    const decoded = decodeChemicalIntelligenceRow({
      registered_uses: [
        {
          crop: "Grapevines",
          target_raw: "Weeds",
          rates: [{ basis: "per_hectare", unit: "L/ha", value: 2.4 }],
        },
      ],
    } as any);
    expect(decoded.registeredUses[0].rates[0].unit).toBe("L");
  });
});
