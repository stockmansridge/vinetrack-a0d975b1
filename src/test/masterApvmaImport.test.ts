// Master Catalogue — APVMA import identity + evidence contract.
//
// Regression anchor: Custodia 320 SC (APVMA 66541) must never resolve to
// Custodia Forte (APVMA 91636).
import { describe, it, expect } from "vitest";
import {
  buildApvmaLookupBody,
  importResultMessage,
  importedRowMatchesQuery,
  parseApvmaQuery,
} from "@/lib/masterChemicalImport";
import {
  masterEvidenceFields,
  masterEvidenceSummary,
  evidenceLevelForSource,
} from "@/lib/masterEvidence";
import type { MasterChemicalRow } from "@/lib/masterChemicals";

const CUSTODIA: MasterChemicalRow = {
  id: "m-custodia",
  registration_country: "AU",
  registration_scheme: "apvma",
  registration_number: "66541",
  registration_identity_key: "AU:apvma:66541",
  registered_product_name: "Custodia 320 SC",
  registrant: "Adama Australia Pty Ltd",
  review_status: "candidate",
  verification_status: "verified",
  label_reference: "https://portal.apvma.gov.au/pubcris?p_=66541",
  active_ingredients: [
    {
      name: "Tebuconazole",
      concentration: 120,
      concentration_unit: "g/L",
      activity_group: { scheme: "frac", code: "3" },
      group_source: "authoritative_classification",
      identity_source: "official_register",
    },
    {
      name: "Azoxystrobin",
      concentration: 200,
      concentration_unit: "g/L",
      activity_group: { scheme: "frac", code: "11" },
      group_source: "authoritative_classification",
      identity_source: "official_register",
    },
  ],
  registered_uses: [
    {
      crop: "Grapevines",
      target_raw: "Powdery mildew",
      rates: [{ label: "40 mL/100 L", basis: "per_100l", value: 40, unit: "mL" }],
      withholding_period_days: 30,
      re_entry_period_hours: 24,
    },
  ],
  verification_sources: [
    { kind: "official_register", name: "APVMA PUBCRIS", reference: "https://portal.apvma.gov.au/pubcris" },
    { kind: "ai_interpretation", name: "Label interpretation" },
  ],
  verification_conflicts: [],
  verification_unresolved_fields: [],
  catalogue_version: 2,
};

const FORTE: MasterChemicalRow = {
  ...CUSTODIA,
  id: "m-forte",
  registration_number: "91636",
  registration_identity_key: "AU:apvma:91636",
  registered_product_name: "Custodia Forte",
};

describe("APVMA query parsing", () => {
  it("recognises bare and prefixed registration numbers", () => {
    expect(parseApvmaQuery("66541")?.kind).toBe("registration_number");
    expect(parseApvmaQuery("APVMA 66541")?.registrationNumber).toBe("66541");
    expect(parseApvmaQuery("Reg No. 66541")?.identityKey).toBe("AU:apvma:66541");
  });

  it("treats product text as a name query", () => {
    const q = parseApvmaQuery("Custodia 320 SC");
    expect(q?.kind).toBe("product_name");
    expect(q?.productName).toBe("Custodia 320 SC");
  });

  it("returns null for empty input", () => {
    expect(parseApvmaQuery("   ")).toBeNull();
  });
});

describe("APVMA request body", () => {
  it("never asks the backend to approve", () => {
    const body = buildApvmaLookupBody(parseApvmaQuery("66541")!);
    expect(body.mode).toBe("master_import");
    expect(body.target_review_status).toBe("candidate");
    expect(body.country).toBe("AU");
    expect(body.registration_scheme).toBe("apvma");
  });

  it("carries the master id on refresh", () => {
    const body = buildApvmaLookupBody(parseApvmaQuery("66541")!, {
      mode: "refresh",
      masterChemicalId: "m-custodia",
    });
    expect(body.mode).toBe("master_refresh");
    expect(body.master_chemical_id).toBe("m-custodia");
  });
});

describe("identity protection", () => {
  it("accepts the requested registration number", () => {
    expect(importedRowMatchesQuery(parseApvmaQuery("66541")!, CUSTODIA)).toBe(true);
  });

  it("rejects Custodia Forte for a Custodia registration number", () => {
    expect(importedRowMatchesQuery(parseApvmaQuery("66541")!, FORTE)).toBe(false);
  });

  it("rejects Custodia Forte for a Custodia name query", () => {
    const q = parseApvmaQuery("Custodia 320 SC")!;
    expect(importedRowMatchesQuery(q, CUSTODIA)).toBe(true);
    expect(importedRowMatchesQuery(q, FORTE)).toBe(false);
  });

  it("rejects a foreign-country row", () => {
    expect(
      importedRowMatchesQuery(parseApvmaQuery("66541")!, {
        ...CUSTODIA,
        registration_country: "NZ",
      }),
    ).toBe(false);
  });

  it("explains a mismatch without importing", () => {
    const msg = importResultMessage(
      "identity_mismatch",
      parseApvmaQuery("66541")!,
      null,
      "Custodia Forte",
    );
    expect(msg).toContain("Custodia Forte");
    expect(msg).toContain("nothing was imported");
  });
});

describe("field-level evidence", () => {
  it("maps source kinds onto evidence levels", () => {
    expect(evidenceLevelForSource("official_register")).toBe("official_register");
    expect(evidenceLevelForSource("manufacturer_label")).toBe("official_label");
    expect(evidenceLevelForSource("ai_interpretation")).toBe("ai_interpretation");
    expect(evidenceLevelForSource("something_else")).toBe("ai_interpretation");
  });

  it("separates authoritative identity from interpreted label uses", () => {
    const fields = masterEvidenceFields(CUSTODIA);
    const byKey = (k: string) => fields.find((f) => f.key === k)!;
    expect(byKey("registration_number").level).toBe("official_register");
    expect(byKey("active_ingredients.0").level).toBe("official_register");
    expect(byKey("activity_groups.0").level).toBe("authoritative_classification");
    expect(byKey("registered_uses").level).toBe("ai_interpretation");
    expect(byKey("withholding_period_days").value).toContain("30");
  });

  it("never claims blanket APVMA verification when uses are interpreted", () => {
    const s = masterEvidenceSummary(CUSTODIA);
    expect(s.authoritativeIdentity).toBe(true);
    expect(s.interpretedUses).toBe(true);
    expect(s.headline).toContain("AI-interpreted");
    expect(s.headline).not.toContain("APVMA Verified");
  });

  it("flags conflicting evidence first", () => {
    const s = masterEvidenceSummary({
      ...CUSTODIA,
      verification_conflicts: [
        {
          field: "registrant",
          extracted_value: "Adama",
          authoritative_value: "Adama Australia Pty Ltd",
          extracted_source: "ai_interpretation",
          authoritative_source: "official_register",
        },
      ],
    });
    expect(s.conflictCount).toBe(1);
    expect(s.headline).toContain("Conflicting evidence");
  });
});
