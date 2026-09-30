// Weedmaster (AU:apvma:53576) revision-2 stored rate contract.
// Fictionalised numbers except the shape; no production data is written.
import { describe, it, expect } from "vitest";
import { masterRateCoverage, parseMasterViticultureRates } from "@/lib/masterCuration";
import { normaliseMasterSearchHit } from "@/lib/chemicalSearchV2";

const RATES = {
  per_hectare: [
    { rate_id: "r-ha-1", min: 2, max: 6, unit: "L", target: "Annual weeds", method: "boom" },
    { rate_id: "r-ha-phalaris", min: 4.5, max: 9, unit: "L", target: "Phalaris", method: "boom" },
    { rate_id: "r-ha-x", min: 1, max: 2, unit: "L", status: "excluded", method: "aerial" },
  ],
  per_100_litres: [
    { rate_id: "r-100-1", value: 1, unit: "L", target: "Spot spray", method: "handgun" },
    { rate_id: "r-100-x", value: 2, unit: "L", supported: false, method: "wiper" },
  ],
};

const ROW = {
  id: "03dfb9e8-6592-4746-a3bc-295890d32cd1",
  registered_product_name: "Weedmaster",
  registration_identity_key: "AU:apvma:53576",
  catalogue_version: 2,
  review_status: "candidate",
  verification_status: "partially_verified",
  viticulture_rates: RATES,
  verification_sources: [{ kind: "manufacturer_label", url: "https://example.com/weedmaster.pdf" }],
  verification_unresolved_fields: ["registered_uses.restrictions"],
};

describe("stored per_hectare / per_100_litres collections", () => {
  it("reads both bases and keeps ranges, identities and associations", () => {
    const rates = parseMasterViticultureRates(RATES);
    expect(rates.map((r) => r.source_id)).toEqual(["r-ha-1", "r-ha-phalaris", "r-100-1"]);
    const phalaris = rates.find((r) => r.source_id === "r-ha-phalaris")!;
    expect(phalaris).toMatchObject({ basis: "per_hectare", kind: "range", min_value: 4.5, max_value: 9, unit: "L", target: "Phalaris", method: "boom" });
    expect(rates.find((r) => r.source_id === "r-100-1")).toMatchObject({ basis: "per_100_litres", kind: "single", value: 1 });
  });

  it("excluded / unsupported directions never become options", () => {
    const ids = parseMasterViticultureRates(RATES).map((r) => r.source_id);
    expect(ids).not.toContain("r-ha-x");
    expect(ids).not.toContain("r-100-x");
  });

  it("the review drawer sees coverage for both bases", () => {
    expect(masterRateCoverage(ROW as any)).toEqual({ perHectare: true, per100Litres: true, any: true });
  });

  it("the customer search reader reaches both bases and keeps evidence and warnings", () => {
    const hit = normaliseMasterSearchHit(ROW)!;
    expect(new Set(hit.rates.map((r) => r.basis))).toEqual(new Set(["per_hectare", "per_100_litres"]));
    expect(hit.rates).toHaveLength(3);
    expect(hit.structured.verification_sources).toHaveLength(1);
    expect(hit.structured.verification_unresolved_fields).toEqual(["registered_uses.restrictions"]);
  });

  it("older shapes still read", () => {
    expect(parseMasterViticultureRates([{ basis: "per_hectare", value: 1, unit: "L" }])).toHaveLength(1);
    expect(parseMasterViticultureRates({ rates: [{ basis: "per 100 L", value: 1, unit: "mL" }] })).toHaveLength(1);
  });
});
