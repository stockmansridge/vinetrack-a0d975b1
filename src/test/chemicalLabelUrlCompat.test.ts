// Chemical lookup — deployed backend URL key compatibility.
//
// Manufacturer product page, manufacturer label and regulator label stay three
// distinct concepts. The APVMA URL is never promoted to a manufacturer label.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseChemicalLookup } from "@/lib/chemicalLookupResolver";

const base = (extra: Record<string, unknown>) => ({
  match_source: "authoritative",
  jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
  field_provenance: {
    product_name: "official_register",
    registrant: "official_register",
    registration_number: "official_register",
    label_reference: "official_register",
  },
  product: {
    registered_product_name: "Vicol",
    registrant: "Victorian Chemical Company Pty Ltd",
    registration_country: "AU",
    registration_scheme: "apvma",
    registration_number: "33182",
    label_reference: "https://portal.apvma.gov.au/pubcris?p_=33182",
    ...extra,
  },
});

describe("registration-nested URL keys", () => {
  const r = parseChemicalLookup(
    base({
      registration: {
        manufacturer_label_url: "https://vicchem.com/vicol-label.pdf",
        manufacturer_product_url: "https://vicchem.com/vicol",
        regulator_label_url: "https://portal.apvma.gov.au/pubcris?p_=33182",
      },
    }),
    "AU",
  );

  it("decodes all three links", () => {
    expect(r.fields.manufacturerLabelUrl).toBe("https://vicchem.com/vicol-label.pdf");
    expect(r.fields.manufacturerProductUrl).toBe("https://vicchem.com/vicol");
    expect(r.fields.regulatorLabelUrl).toBe("https://portal.apvma.gov.au/pubcris?p_=33182");
  });
});

describe("label_urls block keys", () => {
  const r = parseChemicalLookup(
    base({
      label_urls: {
        manufacturer_label_url: "https://vicchem.com/label.pdf",
        product_url: "https://vicchem.com/product",
        regulator_label_url: "https://portal.apvma.gov.au/pubcris?p_=33182",
      },
    }),
    "AU",
  );

  it("decodes all three links", () => {
    expect(r.fields.manufacturerLabelUrl).toBe("https://vicchem.com/label.pdf");
    expect(r.fields.manufacturerProductUrl).toBe("https://vicchem.com/product");
    expect(r.fields.regulatorLabelUrl).toBe("https://portal.apvma.gov.au/pubcris?p_=33182");
  });
});

describe("legacy aliases", () => {
  it("still decodes the older label_urls alias names", () => {
    const r = parseChemicalLookup(
      base({
        label_urls: {
          manufacturer: "https://vicchem.com/old-label.pdf",
          manufacturer_product: "https://vicchem.com/old-product",
          regulator: "https://portal.apvma.gov.au/pubcris?p_=33182",
        },
      }),
      "AU",
    );
    expect(r.fields.manufacturerLabelUrl).toBe("https://vicchem.com/old-label.pdf");
    expect(r.fields.manufacturerProductUrl).toBe("https://vicchem.com/old-product");
    expect(r.fields.regulatorLabelUrl).toBe("https://portal.apvma.gov.au/pubcris?p_=33182");
  });

  it("still decodes the flat product_url alias", () => {
    const r = parseChemicalLookup(base({ product_url: "https://vicchem.com/flat" }), "AU");
    expect(r.fields.manufacturerProductUrl).toBe("https://vicchem.com/flat");
  });
});

describe("no APVMA substitution", () => {
  it("leaves the manufacturer label unresolved when only the regulator link exists", () => {
    const r = parseChemicalLookup(base({}), "AU");
    expect(r.fields.regulatorLabelUrl).toBe("https://portal.apvma.gov.au/pubcris?p_=33182");
    expect(r.fields.manufacturerLabelUrl).toBeUndefined();
    expect(r.fields.manufacturerProductUrl).toBeUndefined();
  });
});

describe("chemical editor collapsible defaults", () => {
  const src = readFileSync("src/components/chemicals/ChemicalEditorSheet.tsx", "utf8");

  it("opens Purchase & pricing by default", () => {
    const idx = src.indexOf("Purchase &amp; pricing");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(0, idx).lastIndexOf("<Collapsible defaultOpen>")).toBeGreaterThan(
      src.slice(0, idx).lastIndexOf("<Collapsible>"),
    );
  });

  it("keeps Advanced / verification details collapsed by default", () => {
    const idx = src.indexOf("Advanced / verification details");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(0, idx).lastIndexOf("<Collapsible>")).toBeGreaterThan(
      src.slice(0, idx).lastIndexOf("<Collapsible defaultOpen>"),
    );
  });
});
