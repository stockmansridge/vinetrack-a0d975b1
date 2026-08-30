// Release closeout parity: raw product category, canonical default-rate
// authority, and the spray handoff prefill rule.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  matchProductCategoryKey,
  productCategoryLabel,
  displayProductCategory,
} from "@/lib/chemicalProductCategory";
import {
  defaultRateDisplayText,
  defaultRateSortValue,
  soleConfirmedDefault,
  confirmedDefaultRates,
  RATE_CONFIRMATION_REQUIRED_LABEL,
} from "@/lib/chemicalDefaultRateHandoff";
import { ALLOWED_FIELDS_FOR_TEST } from "@/lib/savedChemicalsQuery";

const selection = (over: Record<string, unknown> = {}) => ({
  option_key: "default_option_v1_x",
  rate_ids: ["rate_v1_a"],
  basis: "per_hectare",
  unit: "L",
  value: 2,
  min_value: null,
  max_value: null,
  source: "operator",
  selected_at: null,
  label_version: null,
  ...over,
});

describe("raw product category", () => {
  it("stores raw keys and projects display labels", () => {
    expect(matchProductCategoryKey("Fungicide")).toBe("fungicide");
    expect(matchProductCategoryKey("fungicide")).toBe("fungicide");
    expect(productCategoryLabel("fungicide")).toBe("Fungicide");
    expect(matchProductCategoryKey("not a category")).toBeNull();
  });

  it("prefers the raw key over the legacy display projection", () => {
    expect(
      displayProductCategory({ product_category: "insecticide", use: "Fungicide" }),
    ).toBe("Insecticide");
    // Legacy row with no raw key still renders its stored wording.
    expect(displayProductCategory({ product_category: null, use: "Fungicide" })).toBe(
      "Fungicide",
    );
  });

  it("is persisted by the saved-chemical write path", () => {
    expect(ALLOWED_FIELDS_FOR_TEST).toContain("product_category");
  });
});

describe("default_rates is the authority for display and handoff", () => {
  it("shows confirmed defaults and never a legacy rate_per_ha", () => {
    const row = { default_rates: { version: 1, per_hectare: selection(), per_100_litres: null } };
    expect(defaultRateDisplayText(row)).toContain("2");
    expect(defaultRateSortValue(row)).toBe(2);
  });

  it("asks for confirmation when nothing is confirmed", () => {
    expect(defaultRateDisplayText({ default_rates: null })).toBe(
      RATE_CONFIRMATION_REQUIRED_LABEL,
    );
    expect(defaultRateSortValue({ default_rates: null })).toBeNull();
  });

  it("only prefills when exactly one basis is confirmed", () => {
    const one = confirmedDefaultRates({
      default_rates: { version: 1, per_hectare: selection(), per_100_litres: null },
    });
    expect(soleConfirmedDefault(one)).not.toBeNull();
    const both = confirmedDefaultRates({
      default_rates: {
        version: 1,
        per_hectare: selection(),
        per_100_litres: selection({ basis: "per_100_litres", unit: "g", value: 150 }),
      },
    });
    expect(soleConfirmedDefault(both)).toBeNull();
  });
});

describe("obsolete direct-save lookup path", () => {
  it("is removed from the repository", () => {
    expect(existsSync("src/components/spray/ChemicalPicker.tsx")).toBe(false);
    expect(readFileSync("src/pages/setup/SprayJobsPage.tsx", "utf8")).not.toContain(
      "ChemicalPicker",
    );
  });
});
