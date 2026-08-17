import { describe, it, expect } from "vitest";
import {
  resolveReverifyIdentity,
  reverifyChemical,
  diffChemicalDrafts,
  candidateMatchesIdentity,
  type ReverifyCandidate,
} from "@/lib/chemicalReverify";
import {
  emptyDraft,
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";

function draftWith(p: Partial<ChemicalIntelligenceDraft>): ChemicalIntelligenceDraft {
  return { ...emptyDraft(), ...p };
}

const verified = draftWith({
  actives: [
    { name: "Tebuconazole", concentration: 430, concentration_unit: "g/L", identity_source: "official_register",
      activity_group: { scheme: "frac", code: "3" }, group_source: "authoritative_classification" },
  ],
  registration: { country: "AU", scheme: "apvma", number: "12345", registrant: "Acme", registered_product_name: "Acme Teb 430SC" },
  sources: [{ kind: "official_register", name: "APVMA PUBCRIS", retrieved_at: "2026-01-01T00:00:00Z" }],
  claimedStatus: "verified",
  verifiedAt: "2026-01-01T00:00:00Z",
});

describe("re-verify identity resolution", () => {
  it("prefers registration number, then registered product, then product + registrant, then name", () => {
    expect(resolveReverifyIdentity(verified, "Teb 430")!.kind).toBe("registration_number");

    const noNumber = draftWith({ registration: { ...verified.registration, number: undefined } });
    expect(resolveReverifyIdentity(noNumber, "Teb 430")!.kind).toBe("registered_product");

    const nameOnly = draftWith({ registration: { registrant: "Acme" } });
    expect(resolveReverifyIdentity(nameOnly, "Teb 430")!.kind).toBe("product_registrant");

    expect(resolveReverifyIdentity(emptyDraft(), "Teb 430")!.kind).toBe("product_name");
    expect(resolveReverifyIdentity(emptyDraft(), "")).toBeNull();
  });

  it("never matches a candidate with a different registration number", () => {
    const id = resolveReverifyIdentity(verified, "Teb 430")!;
    expect(candidateMatchesIdentity(id, { registration_number: "99999" })).toBe(false);
    expect(candidateMatchesIdentity(id, { registration_number: "12345" })).toBe(true);
  });
});

describe("re-verify outcomes", () => {
  const match: ReverifyCandidate = {
    product_name: "Acme Teb 430SC",
    registration_number: "12345",
    active_ingredient: "Tebuconazole 430 g/L",
    manufacturer: "Acme",
    country: "AU",
  };

  it("reports 'current' and never downgrades when nothing changed", async () => {
    const r = await reverifyChemical({ draft: verified, productName: "Acme Teb 430SC", lookup: async () => [match] });
    expect(r.outcome).toBe("current");
    expect(r.diff).toEqual([]);
    expect(r.proposed!.claimedStatus).toBe("verified");
    expect(r.proposed!.actives[0].activity_group?.code).toBe("3");
  });

  it("reports 'updated' with a structured diff, without mutating the input draft", async () => {
    const r = await reverifyChemical({
      draft: verified,
      productName: "Acme Teb 430SC",
      lookup: async () => [{ ...match, active_ingredient: "Tebuconazole 500 g/L", withholding_period_days: 30, target: "Powdery mildew" }],
    });
    expect(r.outcome).toBe("updated");
    expect(r.diff.some((d) => d.section === "chemistry" && /concentration/.test(d.label))).toBe(true);
    expect(r.diff.some((d) => d.section === "uses")).toBe(true);
    // input untouched
    expect(verified.actives[0].concentration).toBe(430);
  });

  it("fails safely on lookup errors and keeps the existing verification", async () => {
    const r = await reverifyChemical({
      draft: verified,
      productName: "Acme Teb 430SC",
      lookup: async () => { throw new Error("network down"); },
    });
    expect(r.outcome).toBe("failed");
    expect(r.proposed).toBeUndefined();
    expect(verified.claimedStatus).toBe("verified");
  });

  it("fails when nothing is returned and needs review on a weak match", async () => {
    const none = await reverifyChemical({ draft: verified, productName: "Acme Teb 430SC", lookup: async () => [] });
    expect(none.outcome).toBe("failed");

    const other = await reverifyChemical({
      draft: verified,
      productName: "Acme Teb 430SC",
      lookup: async () => [{ product_name: "Something Else", registration_number: "88888" }],
    });
    expect(other.outcome).toBe("needs_review");
    expect(other.proposed).toBeUndefined();
  });

  it("classification alone can never certify product identity", async () => {
    const legacy = draftWith({
      actives: [{ name: "Tebuconazole", identity_source: "legacy_record" }],
    });
    const r = await reverifyChemical({
      draft: legacy,
      productName: "Mystery Product",
      lookup: async () => [{ product_name: "Mystery Product", active_ingredient: "Tebuconazole" }],
    });
    // group filled from the built-in table, but registration identity stays empty
    expect(r.proposed?.actives[0].activity_group?.code).toBe("3");
    expect(r.proposed?.registration.number).toBeUndefined();
  });
});

describe("structured diff", () => {
  it("describes added and removed actives in human terms", () => {
    const before = draftWith({ actives: [{ name: "Tebuconazole", identity_source: "manual_entry" }] });
    const after = draftWith({ actives: [{ name: "Azoxystrobin", identity_source: "manual_entry" }] });
    const diff = diffChemicalDrafts(before, after);
    expect(diff.map((d) => d.label)).toEqual(
      expect.arrayContaining(["Active added: Azoxystrobin", "Active removed: Tebuconazole"]),
    );
    expect(diff.every((d) => !/[{}]/.test(d.label))).toBe(true);
  });
});
