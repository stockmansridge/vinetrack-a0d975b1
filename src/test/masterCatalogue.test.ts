// Master Chemical Catalogue Stage 2 — portal integration fixtures.
//
// Reference fixture: Custodia 320 SC (AU:apvma:66541), two actives.
import { describe, it, expect } from "vitest";
import {
  approvalReadiness,
  isApprovedMaster,
  isTrustedMasterEnvelope,
  masterChemicalDraft,
  masterIdentityKey,
  masterRevision,
  masterUpdateAvailable,
  matchMasterByIdentity,
  normaliseMatchSource,
  normaliseReviewStatus,
  parseMasterLookupEnvelope,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";

const CUSTODIA: MasterChemicalRow = {
  id: "m-custodia",
  registration_country: "AU",
  registration_scheme: "apvma",
  registration_number: "66541",
  registration_identity_key: "AU:apvma:66541",
  registered_product_name: "Custodia 320 SC",
  registrant: "Adama Australia Pty Ltd",
  review_status: "approved",
  verification_status: "verified",
  catalogue_version: 3,
  label_reference: "https://portal.apvma.gov.au/pubcris?p_=66541",
  label_version: "2024-06",
  active_ingredients: [
    {
      name: "Tebuconazole",
      concentration: 200,
      concentration_unit: "g/L",
      activity_group: { scheme: "frac", code: "3" },
      group_source: "authoritative_classification",
      identity_source: "authoritative_register",
    },
    {
      name: "Azoxystrobin",
      concentration: 120,
      concentration_unit: "g/L",
      activity_group: { scheme: "frac", code: "11" },
      group_source: "authoritative_classification",
      identity_source: "authoritative_register",
    },
  ],
  // Real product: no invented rate / WHP / REI values live in this fixture.
  // Generic numeric behaviour is tested with a fictional chemical instead.
  registered_uses: [
    {
      crop: "Grapevines",
      target_raw: "Powdery mildew",
      rates: [],
    },
  ],
  verification_unresolved_fields: [
    "registered_uses.rates",
    "registered_uses.withholding_period_days",
    "registered_uses.re_entry_period_hours",
  ],
  verification_conflicts: [],
};


const CUSTODIA_FORTE: MasterChemicalRow = {
  ...CUSTODIA,
  id: "m-custodia-forte",
  registration_number: "99999",
  registration_identity_key: "AU:apvma:99999",
  registered_product_name: "Custodia Forte",
};

describe("master catalogue — identity and trust", () => {
  it("keeps both Custodia actives with their concentrations and FRAC groups", () => {
    const draft = masterChemicalDraft(CUSTODIA);
    expect(draft.actives.map((a) => a.name)).toEqual(["Tebuconazole", "Azoxystrobin"]);
    expect(draft.actives.map((a) => a.concentration)).toEqual([200, 120]);
    expect(draft.actives.map((a) => a.activity_group?.code)).toEqual(["3", "11"]);
  });

  it("derives the registration identity key", () => {
    expect(masterIdentityKey(CUSTODIA)).toBe("AU:apvma:66541");
    expect(masterIdentityKey({ ...CUSTODIA, registration_identity_key: null })).toBe(
      "AU:apvma:66541",
    );
  });

  it("matches exactly and never by substring", () => {
    const rows = [CUSTODIA, CUSTODIA_FORTE];
    expect(matchMasterByIdentity(rows, { productName: "Custodia 320 SC", country: "AU" })?.id).toBe("m-custodia");
    expect(matchMasterByIdentity(rows, { productName: "Custodia Forte", country: "AU" })?.id).toBe(
      "m-custodia-forte",
    );
    expect(matchMasterByIdentity(rows, { productName: "Custodia", country: "AU" })).toBeNull();
  });

  it("prefers the registration identity key when supplied", () => {
    expect(
      matchMasterByIdentity([CUSTODIA, CUSTODIA_FORTE], {
        identityKey: "au:apvma:66541 ",
        productName: "Custodia Forte",
        country: "AU",
      })?.id,
    ).toBe("m-custodia");
  });

  it("never matches candidate or retired records", () => {
    const candidate = { ...CUSTODIA, review_status: "candidate" };
    expect(isApprovedMaster(candidate)).toBe(false);
    expect(matchMasterByIdentity([candidate], { productName: "Custodia 320 SC", country: "AU" })).toBeNull();
    expect(
      matchMasterByIdentity([{ ...CUSTODIA, review_status: "retired" }], {
        productName: "Custodia 320 SC",
      }),
    ).toBeNull();
  });
});

describe("master lookup envelope", () => {
  it("parses a master hit", () => {
    const env = parseMasterLookupEnvelope({
      match_source: "master",
      master_chemical_id: "m-custodia",
      master_revision: 3,
      catalogue_status: "approved",
      registration_identity_key: "AU:apvma:66541",
    });
    expect(env.matchSource).toBe("master");
    expect(env.masterChemicalId).toBe("m-custodia");
    expect(env.masterRevision).toBe(3);
    expect(isTrustedMasterEnvelope(env)).toBe(true);
  });

  it("does not trust an AI candidate or an unapproved master", () => {
    expect(isTrustedMasterEnvelope(parseMasterLookupEnvelope({ match_source: "ai_candidate" }))).toBe(
      false,
    );
    expect(
      isTrustedMasterEnvelope(
        parseMasterLookupEnvelope({ match_source: "master", catalogue_status: "candidate" }),
      ),
    ).toBe(false);
    expect(normaliseMatchSource("nonsense")).toBe("unresolved");
    expect(normaliseReviewStatus("Approved")).toBe("approved");
  });

  it("reads an inlined master record", () => {
    const env = parseMasterLookupEnvelope({ match_source: "master", master: CUSTODIA });
    expect(env.master?.id).toBe("m-custodia");
    expect(env.catalogueStatus).toBe("approved");
    expect(env.masterRevision).toBe(3);
  });
});

describe("revision drift", () => {
  it("offers an update only when the master moved ahead", () => {
    const saved = { master_chemical_id: "m-custodia", master_source_revision: 3 };
    expect(masterUpdateAvailable(saved, CUSTODIA)).toBe(false);
    expect(masterUpdateAvailable(saved, { ...CUSTODIA, catalogue_version: 4 })).toBe(true);
    expect(masterUpdateAvailable(saved, { ...CUSTODIA, catalogue_version: 2 })).toBe(false);
  });

  it("offers an update when the saved revision is unknown", () => {
    expect(
      masterUpdateAvailable({ master_chemical_id: "m-custodia", master_source_revision: null }, CUSTODIA),
    ).toBe(true);
  });

  it("never offers an update for unlinked chemicals or retired masters", () => {
    expect(masterUpdateAvailable({ master_chemical_id: null }, CUSTODIA)).toBe(false);
    expect(
      masterUpdateAvailable(
        { master_chemical_id: "m-custodia", master_source_revision: 1 },
        { ...CUSTODIA, review_status: "retired" },
      ),
    ).toBe(false);
  });

  it("exposes the catalogue revision", () => {
    expect(masterRevision(CUSTODIA)).toBe(3);
    expect(masterRevision({ ...CUSTODIA, catalogue_version: null })).toBeUndefined();
  });
});

describe("approval readiness (UI guidance only)", () => {
  it("passes a Custodia record with no outstanding evidence gaps", () => {
    expect(
      approvalReadiness({ ...CUSTODIA, verification_unresolved_fields: [] }),
    ).toEqual({ ready: true, reasons: [] });
  });

  it("blocks approval while label facts remain unresolved", () => {
    const r = approvalReadiness(CUSTODIA);
    expect(r.ready).toBe(false);
    expect(r.reasons.join(" ")).toContain("registered_uses.rates");
  });

  it("is country-scoped: an AU master never matches an NZ vineyard", () => {
    expect(
      matchMasterByIdentity([CUSTODIA], { productName: "Custodia 320 SC", country: "NZ" }),
    ).toBeNull();
  });

  it("flags missing evidence", () => {
    const r = approvalReadiness({
      ...CUSTODIA,
      label_reference: null,
      registration_number: null,
      registration_identity_key: null,
      verification_unresolved_fields: ["registration_number"],
    });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/label reference/i);
    expect(r.reasons.join(" ")).toMatch(/registration identity/i);
    expect(r.reasons.join(" ")).toMatch(/Unresolved fields/i);
  });
});
