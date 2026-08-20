// LD-2 — authoritative PDF-extracted label rates.
//
// Fixtures are verbatim production `chemical-info-lookup` responses (AU).
//
//   Sprayseal 80160          → 30 mL/100 L, WHP "not required when used as directed"
//   Custodia Forte Powdery   → 35–54 mL/100 L (range kept) + 540 mL/ha
//   Custodia Forte Downy     → 54 mL/100 L + 540 mL/ha
//   Custodia Forte Botrytis  → no rate at all
//   Prosaro basis "other"    → reference-only, never a numeric rate
import { describe, it, expect } from "vitest";
import { parseChemicalLookup } from "@/lib/chemicalLookupResolver";
import { selectRates, withholdingDisplay } from "@/lib/chemicalLabelRates";
import SPRAYSEAL from "./fixtures/ld2-sprayseal-au.json";
import CUSTODIA from "./fixtures/ld2-custodia-forte-au.json";
import PROSARO from "./fixtures/ld2-prosaro-au.json";

const useFor = (r: ReturnType<typeof parseChemicalLookup>, target: RegExp) =>
  r.draft!.registeredUses.find((u) => target.test(u.target_raw));

describe("Sprayseal 80160 — per_100_litres", () => {
  const r = parseChemicalLookup(SPRAYSEAL, "AU");

  it("is authoritative and carries the label rate", () => {
    expect(r.authoritative).toBe(true);
    expect(r.fields.ratePer100L?.value).toBe(30);
    expect(r.fields.ratePer100L?.unit).toBe("mL");
    expect(r.fields.ratePer100L?.text).toBe("30 mL/100 L");
    expect(r.fields.ratePer100L?.composedUnit).toBe("mL/100L");
    expect(r.fields.ratePer100L?.autoFillValue).toBe(30);
  });

  it("presents a label-stated WHP 0 as not required", () => {
    expect(r.fields.withholdingDays).toBe(0);
    expect(r.fields.withholdingText).toBe("Not required when used as directed");
  });

  it("preserves the authoritative label reference", () => {
    expect(r.fields.labelReference).toMatch(/^https?:\/\//);
  });
});

describe("Custodia Forte — ranges and hectare rates", () => {
  const r = parseChemicalLookup(CUSTODIA, "AU");

  it("keeps the powdery mildew range as min/max and never collapses it", () => {
    const sel = selectRates(useFor(r, /POWDERY/));
    expect(sel.per100L?.isRange).toBe(true);
    expect(sel.per100L?.min).toBe(35);
    expect(sel.per100L?.max).toBe(54);
    expect(sel.per100L?.value).toBeUndefined();
    expect(sel.per100L?.autoFillValue).toBeUndefined();
    expect(sel.per100L?.text).toBe("35–54 mL/100 L");
    expect(sel.perHectare?.value).toBe(540);
    expect(sel.perHectare?.text).toBe("540 mL/ha");
  });

  it("resolves the downy mildew single rate plus the hectare rate", () => {
    const sel = selectRates(useFor(r, /DOWNY/));
    expect(sel.per100L?.value).toBe(54);
    expect(sel.per100L?.autoFillValue).toBe(54);
    expect(sel.perHectare?.value).toBe(540);
  });

  it("resolves no rate for botrytis", () => {
    const sel = selectRates(useFor(r, /BOTRYTIS/));
    expect(sel.all).toHaveLength(0);
    expect(sel.preferred).toBeUndefined();
    expect(sel.text).toBeUndefined();
  });

  it("keeps the 28 day grape WHP as days", () => {
    expect(r.fields.withholdingDays).toBe(28);
    expect(r.fields.withholdingText).toBe("28 days");
  });
});

describe("Prosaro — basis \"other\" is reference only", () => {
  const r = parseChemicalLookup(PROSARO, "AU");

  it("never turns an \"other\" rate into a numeric field", () => {
    const others = r
      .draft!.registeredUses.flatMap((u) => selectRates(u).referenceOnly)
      .filter((v) => v.basis === "other");
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) {
      expect(o.autoFillValue).toBeUndefined();
      expect(o.composedUnit).toBeUndefined();
      expect(o.value).toBeUndefined();
      expect(o.rawText).toBeTruthy();
    }
    const triticale = selectRates(useFor(r, /STRIPE RUST/));
    expect(triticale.preferred).toBeUndefined();
    expect(triticale.referenceOnly[0]?.text).toContain("150 mL/ha to 300 mL/ha");
  });
});

describe("per-use rate provenance", () => {
  it("drops rates when that use has no rate evidence, even if label_rates is authoritative", () => {
    const payload = {
      match_source: "authoritative",
      jurisdiction: { resolved_country_code: "AU", register_adapter: "apvma" },
      field_provenance: {
        registered_uses: "manufacturer_label",
        label_rates: "manufacturer_label",
      },
      registered_uses: [
        {
          crop: "GRAPEVINE",
          target_raw: "POWDERY MILDEW",
          rates: [{ basis: "per_hectare", value: 500, unit: "mL" }],
          provenance: { rates: null },
        },
      ],
    };
    const r = parseChemicalLookup(payload, "AU");
    expect(r.draft!.registeredUses[0].rates).toHaveLength(0);
    expect(r.fields.ratePerHectare).toBeUndefined();
  });
});

describe("withholding display", () => {
  it("only reads 'not required' when the label says so", () => {
    expect(withholdingDisplay(0, "WITHHOLDING PERIOD - NOT REQUIRED WHEN USED AS DIRECTED")).toBe(
      "Not required when used as directed",
    );
    expect(withholdingDisplay(0, "Do not harvest")).toBe("0 days");
    expect(withholdingDisplay(1)).toBe("1 day");
    expect(withholdingDisplay(null)).toBeUndefined();
  });
});
