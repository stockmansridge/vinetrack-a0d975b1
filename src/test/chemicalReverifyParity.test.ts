// P5 — Saved Chemical re-verify parity regressions.
//
// Every case drives the REAL resolver parser with a production-shaped payload,
// then the real merge engine. Nothing here may weaken a stored Saved Chemical.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseChemicalLookup } from "@/lib/chemicalLookupResolver";
import {
  isReferenceOnlyRate,
  mergeAuthoritativeDraft,
  diffChemicalDrafts,
  type ReverifyIdentity,
} from "@/lib/chemicalReverify";
import {
  reverifyFromLookupResult,
  reverifySavedChemical,
  resolvedMatchesStored,
} from "@/lib/chemicalReverifyLookup";
import { emptyDraft, type ChemicalIntelligenceDraft } from "@/lib/chemicalIntelligenceWrite";

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/test/fixtures/${name}.json`, "utf8"));

const lookup = (name: string) => parseChemicalLookup(fixture(name), "AU");

const identityFor = (draft: ChemicalIntelligenceDraft, product: string): ReverifyIdentity => ({
  kind: "registration_number",
  query: product,
  country: "AU",
  registrationScheme: draft.registration.scheme,
  registrationNumber: draft.registration.number,
  productName: draft.registration.registered_product_name ?? product,
  description: `APVMA ${draft.registration.number} (AU)`,
});

const run = (stored: ChemicalIntelligenceDraft, name: string, product: string) =>
  reverifyFromLookupResult({
    draft: stored,
    identity: identityFor(stored, product),
    result: lookup(name),
    vineyardCountry: "AU",
  });

describe("P5 re-verify — stable authoritative products", () => {
  it("Sprayseal 80160 re-verifies with no false change", () => {
    const stored = lookup("ld2-sprayseal-au").draft!;
    const r = run(stored, "ld2-sprayseal-au", "Sprayseal Pruning Wound Treatment");
    expect(r.state).toBe("no_change");
    expect(r.diff).toEqual([]);
    expect(r.proposed!.registration.number).toBe("80160");
  });

  it("Custodia Forte 91636 keeps ranges, hectare rates and WHP 28 through re-verify", () => {
    const stored = lookup("ld2-custodia-forte-au").draft!;
    const r = run(stored, "ld2-custodia-forte-au", "CUSTODIA FORTE FUNGICIDE");
    expect(r.state).toBe("no_change");
    const use = r.proposed!.registeredUses.find((u) => /POWDERY/i.test(u.target_raw))!;
    expect(use.rates).toHaveLength(2);
    expect(use.rates[0].min_value).toBe(35);
    expect(use.rates[0].max_value).toBe(54);
    expect(use.rates.some((x) => x.basis === "per_hectare" && x.value === 540)).toBe(true);
    expect(use.withholding_period_days).toBe(28);
    // per-use provenance survives the round trip
    expect(use.provenance?.rates).toBe("manufacturer_label");
  });

  it("Prosaro 63243 basis:\"other\" stays reference-only and never becomes an applicable rate", () => {
    const resolved = lookup("ld2-prosaro-au").draft!;
    const other = resolved.registeredUses
      .flatMap((u) => u.rates)
      .filter((x) => x.basis === "other");
    expect(other.length).toBeGreaterThan(0);
    expect(other.every(isReferenceOnlyRate)).toBe(true);

    // A stored use that already carries a real rate is not overwritten by one.
    const stored: ChemicalIntelligenceDraft = {
      ...resolved,
      registeredUses: resolved.registeredUses.map((u, i) =>
        i === 0
          ? { ...u, rates: [{ label: "", basis: "per_hectare", unit: "mL", value: 300 }] }
          : u,
      ),
    };
    const merged = mergeAuthoritativeDraft(stored, resolved);
    const first = merged.registeredUses[0];
    expect(first.rates[0].value).toBe(300);
    expect(first.rates[0].basis).toBe("per_hectare");
    expect(first.rates.slice(1).every(isReferenceOnlyRate)).toBe(true);
  });
});

describe("P5 re-verify — weak, unresolved and ambiguous answers", () => {
  const verified = lookup("ld2-sprayseal-au").draft!;

  it("Custodia 320SC style unresolved answer borrows nothing", () => {
    const r = reverifyFromLookupResult({
      draft: verified,
      identity: identityFor(verified, "CUSTODIA 320SC"),
      result: lookup("spray-seal-unresolved"),
      vineyardCountry: "AU",
    });
    expect(r.state).toBe("unresolved");
    expect(r.proposed).toBeUndefined();
    expect(r.diff).toEqual([]);
  });

  it("Ridomil Gold style ambiguity never auto-selects a registration", () => {
    const payload = { ...fixture("spray-seal-unresolved"), match_source: "ambiguous" };
    const r = reverifyFromLookupResult({
      draft: verified,
      identity: identityFor(verified, "Ridomil Gold"),
      result: parseChemicalLookup(payload, "AU"),
      vineyardCountry: "AU",
    });
    expect(r.state).toBe("unresolved");
    expect(r.title).toMatch(/more than one/i);
    expect(r.proposed).toBeUndefined();
  });

  it("never re-keys a Saved Chemical onto a different registration number", () => {
    const other = lookup("ld2-custodia-forte-au");
    const r = reverifyFromLookupResult({
      draft: verified,
      identity: identityFor(verified, "Sprayseal Pruning Wound Treatment"),
      result: other,
      vineyardCountry: "AU",
    });
    expect(r.state).toBe("unresolved");
    expect(r.proposed).toBeUndefined();
    expect(resolvedMatchesStored(identityFor(verified, "Sprayseal"), other.draft!)).toBe(false);
  });

  it("a foreign registration is never authoritative for this vineyard", () => {
    const r = reverifyFromLookupResult({
      draft: verified,
      identity: identityFor(verified, "Sprayseal Pruning Wound Treatment"),
      result: lookup("ld2-sprayseal-au"),
      vineyardCountry: "NZ",
    });
    expect(r.state).toBe("unresolved");
    expect(r.jurisdiction).toBe("mismatch");
    expect(r.proposed).toBeUndefined();
  });

  it("reports source unavailable and leaves the record untouched", async () => {
    const r = await reverifySavedChemical({
      draft: verified,
      productName: "Sprayseal Pruning Wound Treatment",
      vineyardCountry: "AU",
      resolver: async () => {
        throw new Error("resolver offline.");
      },
    });
    expect(r.state).toBe("unavailable");
    expect(r.proposed).toBeUndefined();
    expect(verified.registration.number).toBe("80160");
  });
});

describe("P5 re-verify — merge safety", () => {
  const stored = lookup("ld2-custodia-forte-au").draft!;

  it("silent refreshed evidence never blanks stored label facts", () => {
    const weakened: ChemicalIntelligenceDraft = {
      ...stored,
      registeredUses: stored.registeredUses.map((u) => ({
        ...u,
        rates: [],
        withholding_period_days: undefined,
        re_entry_period_hours: undefined,
        restrictions: undefined,
        provenance: undefined,
      })),
      actives: stored.actives.map((a) => ({ ...a, concentration: undefined })),
    };
    const merged = mergeAuthoritativeDraft(stored, weakened);
    expect(diffChemicalDrafts(stored, merged)).toEqual([]);
    expect(merged.registeredUses[0].provenance).toEqual(stored.registeredUses[0].provenance);
  });

  it("matches registered uses by crop and target, not array order", () => {
    const reversed: ChemicalIntelligenceDraft = {
      ...stored,
      registeredUses: [...stored.registeredUses].reverse(),
    };
    expect(diffChemicalDrafts(stored, mergeAuthoritativeDraft(stored, reversed))).toEqual([]);
  });

  it("surfaces WHP, re-entry and restriction changes as an authoritative update", () => {
    const changed: ChemicalIntelligenceDraft = {
      ...stored,
      registeredUses: stored.registeredUses.map((u, i) =>
        i === 0
          ? {
              ...u,
              withholding_period_days: 14,
              re_entry_period_hours: 24,
              restrictions: "DO NOT HARVEST FOR 2 WEEKS AFTER APPLICATION.",
            }
          : u,
      ),
    };
    const merged = mergeAuthoritativeDraft(stored, changed);
    const diff = diffChemicalDrafts(stored, merged);
    const labels = diff.map((d) => d.label).join(" | ");
    expect(labels).toMatch(/withholding period/);
    expect(labels).toMatch(/re-entry period/);
    expect(labels).toMatch(/restrictions/);
  });

  it("treats purely additive evidence as new authoritative data", () => {
    const bare: ChemicalIntelligenceDraft = {
      ...emptyDraft(),
      registration: { country: "AU", scheme: "apvma", number: "91636" },
    };
    const r = reverifyFromLookupResult({
      draft: bare,
      identity: identityFor(bare, "CUSTODIA FORTE FUNGICIDE"),
      result: lookup("ld2-custodia-forte-au"),
      vineyardCountry: "AU",
    });
    expect(r.state).toBe("new_authoritative");
    expect(r.proposed!.registeredUses.length).toBeGreaterThan(0);
  });
});
