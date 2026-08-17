import { describe, it, expect } from "vitest";
import {
  toChemicalIntelligence,
  activityGroupSummary,
  groupDisplay,
  formatLabelRate,
  formatActivityGroup,
  isLegacyOnly,
} from "@/lib/chemicalIntelligence";

const base = { id: "c1", vineyard_id: "v1", name: "Product A" };

describe("SQL 194 chemical intelligence adapter", () => {
  it("maps a verified single-active FRAC product", () => {
    const chem = toChemicalIntelligence({
      ...base,
      verification_status: "verified",
      verified_at: "2026-01-05T00:00:00Z",
      activity_group_scheme: "FRAC",
      active_ingredients: [{ name: "Tebuconazole", concentration: 430, unit: "g/L", activity_group: "3" }],
    });
    expect(chem.verification.status).toBe("verified");
    expect(chem.actives).toHaveLength(1);
    expect(chem.actives[0].group).toEqual({ scheme: "FRAC", code: "3" });
    expect(activityGroupSummary(chem)).toBe("FRAC 3");
    expect(chem.structured).toBe(true);
  });

  it("maps a verified multi-active mixture and keeps per-active relationships", () => {
    const chem = toChemicalIntelligence({
      ...base,
      verification_status: "verified",
      active_ingredients: [
        { name: "Tebuconazole", concentration: 100, unit: "g/L", activity_group: "FRAC 3" },
        { name: "Azoxystrobin", concentration: 200, unit: "g/L", activity_group: "FRAC 11" },
      ],
    });
    expect(activityGroupSummary(chem)).toBe("FRAC 3 + 11");
    expect(chem.actives.map((a) => a.name)).toEqual(["Tebuconazole", "Azoxystrobin"]);
    expect(chem.actives.map((a) => a.group?.code)).toEqual(["3", "11"]);
  });

  it("supports partially verified, needs match, conflict and unverified", () => {
    const status = (v: unknown) => toChemicalIntelligence({ ...base, verification_status: v }).verification.status;
    expect(status("partially_verified")).toBe("partially_verified");
    expect(status("needs_match")).toBe("needs_match");
    expect(status("conflict")).toBe("conflict");
    expect(status("unverified")).toBe("unverified");
    expect(status(null)).toBe("unverified");
    expect(status("something-else")).toBe("unverified");
  });

  it("carries conflict and unresolved evidence without fabricating it", () => {
    const chem = toChemicalIntelligence({
      ...base,
      verification_status: "conflict",
      verification_conflicts: ["registration_number"],
      verification_unresolved_fields: ["whp"],
      verification_sources: [{ label: "APVMA", url: "https://portal.apvma.gov.au/x" }],
    });
    expect(chem.verification.conflicts).toEqual(["registration_number"]);
    expect(chem.verification.unresolvedFields).toEqual(["whp"]);
    expect(chem.verification.sources[0]).toMatchObject({ label: "APVMA" });

    const bare = toChemicalIntelligence(base);
    expect(bare.verification.sources).toEqual([]);
    expect(bare.verification.conflicts).toEqual([]);
  });

  it("supports HRAC, IRAC and Not Applicable schemes", () => {
    const hrac = toChemicalIntelligence({
      ...base,
      active_ingredients: [{ name: "Glyphosate", activity_group: "HRAC 9" }],
    });
    expect(activityGroupSummary(hrac)).toBe("HRAC 9");

    const irac = toChemicalIntelligence({
      ...base,
      activity_group_scheme: "IRAC",
      activity_groups: ["4A"],
    });
    expect(activityGroupSummary(irac)).toBe("IRAC 4A");

    const na = toChemicalIntelligence({
      ...base,
      activity_group_scheme: "NA",
      active_ingredients: [{ name: "Wetting agent", activity_group: "not_applicable" }],
    });
    expect(activityGroupSummary(na)).toBe("Not applicable");
    expect(formatActivityGroup({ scheme: "NA", code: null })).toBe("Not applicable");
  });

  it("reads structured label rates, ranges, registered uses, WHP and re-entry", () => {
    const chem = toChemicalIntelligence({
      ...base,
      label_rate_bases: ["per_hectare"],
      registered_uses: [
        {
          crop: "Wine grapes",
          target: "Powdery mildew",
          rate: { min: 0.2, max: 0.4, unit: "L/ha", basis: "per_hectare" },
          withholding_period: "30 days",
          re_entry_period: "24 hours",
        },
        { crop: "Wine grapes", target: "Botrytis", rate: { rate: 1.0, unit: "L/ha" } },
      ],
    });
    expect(chem.labelRateBases).toEqual(["per_hectare"]);
    expect(chem.registeredUses).toHaveLength(2);
    expect(formatLabelRate(chem.registeredUses[0].rate)).toBe("0.2–0.4 L/ha · per_hectare");
    expect(formatLabelRate(chem.registeredUses[1].rate)).toBe("1 L/ha");
    expect(chem.registeredUses[0].withholdingPeriod).toBe("30 days");
    expect(chem.registeredUses[0].reEntryPeriod).toBe("24 hours");
  });

  it("keeps commercial fields", () => {
    const chem = toChemicalIntelligence({
      ...base,
      unit: "Litres",
      rate_per_ha: 1.5,
      notes: "Store cool",
      purchase: { costPerBaseUnit: 42.5, currency: "AUD" },
    });
    expect(chem.commercial).toMatchObject({
      unit: "Litres",
      preferredRatePerHa: 1.5,
      costPerUnit: 42.5,
      currency: "AUD",
      notes: "Store cool",
    });
  });

  it("treats a legacy-only row as unverified with no structured groups", () => {
    const chem = toChemicalIntelligence({
      ...base,
      active_ingredient: "Tebuconazole + Azoxystrobin",
      chemical_group: "3 + 11",
      mode_of_action: "Systemic",
    });
    expect(isLegacyOnly(chem)).toBe(true);
    expect(chem.actives).toEqual([]);
    expect(chem.activityGroups).toEqual([]);
    // legacy "3 + 11" must NEVER become structured activity groups
    expect(activityGroupSummary(chem)).toBeNull();
    expect(groupDisplay(chem)).toEqual({ text: "3 + 11", legacy: true });
    expect(chem.verification.status).toBe("unverified");
  });

  it("tolerates missing optional fields", () => {
    const chem = toChemicalIntelligence({ id: "c2" });
    expect(chem.name).toBeNull();
    expect(chem.actives).toEqual([]);
    expect(chem.registeredUses).toEqual([]);
    expect(chem.product.registrationNumber).toBeNull();
    expect(chem.structured).toBe(false);
  });

  it("prefers structured groups over the legacy scalar", () => {
    const chem = toChemicalIntelligence({
      ...base,
      chemical_group: "legacy junk",
      active_ingredients: [{ name: "Azoxystrobin", activity_group: "FRAC 11" }],
    });
    expect(groupDisplay(chem)).toEqual({ text: "FRAC 11", legacy: false });
  });

  it("does not let AI confidence or a live URL override verification status", () => {
    const chem = toChemicalIntelligence({
      ...base,
      confidence: "high",
      country_confirmed: true,
      label_url: "https://example.com/label.pdf",
      verification_status: "needs_match",
    });
    expect(chem.verification.status).toBe("needs_match");
    expect((chem as any).confidence).toBeUndefined();
  });

  it("maps product registration identity", () => {
    const chem = toChemicalIntelligence({
      ...base,
      registration_country: "AU",
      registration_scheme: "APVMA",
      registration_number: "12345",
      registrant: "Acme Crop Science",
      manufacturer: "Acme",
      registered_product_name: "Product A 430SC",
    });
    expect(chem.product).toMatchObject({
      country: "AU",
      registrationScheme: "APVMA",
      registrationNumber: "12345",
      registrant: "Acme Crop Science",
      registeredProductName: "Product A 430SC",
    });
  });
});
