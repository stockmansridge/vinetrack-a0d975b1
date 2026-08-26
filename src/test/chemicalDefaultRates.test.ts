// Default rate selection — grapevine-only, basis-separated, conservative.
import { describe, it, expect } from "vitest";
import {
  buildDefaultRateOptions,
  jurisdictionsInText,
  normaliseJurisdiction,
  NO_PER_HECTARE_MESSAGE,
} from "@/lib/chemicalDefaultRates";
import { normalGrapevineUses } from "@/lib/chemicalGrapevineUses";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";

const use = (u: Record<string, unknown>): WriteRegisteredUse =>
  ({ crop: "Grapevines", rates: [], ...u }) as unknown as WriteRegisteredUse;

// Vicol-style label: two conditional /100 L rates for grapevines.
const VICOL = [
  use({
    target_raw: "European Red Mite",
    rates: [
      { basis: "per_100_litres", unit: "L", value: 3, condition: "NSW, Vic, SA" },
      { basis: "per_100_litres", unit: "L", value: 2, condition: "Tas" },
    ],
  }),
  use({
    target_raw: "Scale",
    rates: [{ basis: "per_100_litres", unit: "L", value: 3, condition: "NSW, Vic, Qld, SA, WA" }],
  }),
  use({ crop: "Peach", target_raw: "Scale", rates: [{ basis: "per_100_litres", unit: "L", value: 1 }] }),
];

describe("jurisdiction parsing", () => {
  it("recognises state names and codes", () => {
    expect(normaliseJurisdiction("new south wales")).toBe("NSW");
    expect(normaliseJurisdiction("nsw")).toBe("NSW");
    expect(normaliseJurisdiction("Riverina")).toBeUndefined();
    expect(jurisdictionsInText("NSW, Vic, SA")).toEqual(["NSW", "VIC", "SA"]);
  });
});

describe("default rate options", () => {
  it("uses grapevine rows only and keeps distinct rates apart", () => {
    const o = buildDefaultRateOptions(VICOL);
    expect(o.per100L.options.map((x) => x.text)).toEqual(["3 L/100 L", "2 L/100 L"]);
    expect(o.per100L.options[0].contexts).toHaveLength(2);
    expect(o.perHectare.options).toHaveLength(0);
    expect(o.perHectare.emptyMessage).toBe(NO_PER_HECTARE_MESSAGE);
  });

  it("recommends the single rate registered for the vineyard state", () => {
    const o = buildDefaultRateOptions(VICOL, { jurisdiction: "NSW" });
    expect(o.per100L.recommendedId).toBe("per_100L|3 L/100 L");
    expect(o.per100L.recommendationReason).toBe("jurisdiction");
    expect(o.per100L.requiresChoice).toBe(false);
  });

  it("requires a choice when several rates apply and never merges them", () => {
    const o = buildDefaultRateOptions(VICOL);
    expect(o.per100L.recommendedId).toBeUndefined();
    expect(o.per100L.requiresChoice).toBe(true);
    expect(o.per100L.options.some((x) => x.text.includes("–"))).toBe(false);
  });

  it("recommends the only registered grapevine rate", () => {
    const o = buildDefaultRateOptions([
      use({ target_raw: "Powdery mildew", rates: [{ basis: "per_hectare", unit: "L", value: 1.5 }] }),
    ]);
    expect(o.perHectare.recommendedId).toBe("per_hectare|1.5 L/ha");
    expect(o.perHectare.recommendationReason).toBe("only_registered_rate");
  });

  it("never recommends a rate registered only for other states", () => {
    const o = buildDefaultRateOptions(
      [use({ target_raw: "Mite", rates: [{ basis: "per_100_litres", unit: "L", value: 2, condition: "Tas only" }] })],
      { jurisdiction: "NSW" },
    );
    expect(o.per100L.recommendedId).toBeUndefined();
    expect(o.per100L.requiresChoice).toBe(true);
  });

  it("keeps a label range as one option with no auto value", () => {
    const o = buildDefaultRateOptions([
      use({
        target_raw: "Botrytis",
        rates: [{ basis: "range_per_100_litres", unit: "mL", min_value: 100, max_value: 200 }],
      }),
    ]);
    expect(o.per100L.options).toHaveLength(1);
    expect(o.per100L.options[0].isRange).toBe(true);
    expect(o.per100L.options[0].value).toBeUndefined();
  });
});

describe("normal grapevine projection", () => {
  it("suppresses a rate-less duplicate of a rated target", () => {
    const rows = normalGrapevineUses([
      use({ target_raw: "Powdery mildew", rates: [{ basis: "per_hectare", unit: "L", value: 1 }] }),
      use({ target_raw: "Powdery Mildew" }),
      use({ target_raw: "Downy mildew" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.target_raw)).toEqual(["Powdery mildew", "Downy mildew"]);
  });

  it("prefers the manufacturer label row over the regulator row", () => {
    const rows = normalGrapevineUses([
      use({
        target_raw: "Scale",
        rates: [{ basis: "per_100_litres", unit: "L", value: 2 }],
        extra: { source: "official_register" },
      }),
      use({
        target_raw: "Scale",
        rates: [{ basis: "per_100_litres", unit: "L", value: 3 }],
        extra: { source: "manufacturer_label" },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rates[0].value).toBe(3);
  });
});
