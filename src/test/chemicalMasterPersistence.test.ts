// Master result → Save → Chemical Store parity (structured intelligence).
import { describe, it, expect } from "vitest";
import {
  buildMasterSavedChemicalInput,
  normaliseMasterSearchHit,
  persistedDefaultRates,
} from "@/lib/chemicalSearchV2";
import {
  RESISTANCE_NOT_APPLICABLE_TEXT,
  RESISTANCE_UNKNOWN_TEXT,
  resistanceGroupDisplay,
  toChemicalIntelligence,
} from "@/lib/chemicalIntelligence";

const rates = persistedDefaultRates({});

/** What the store re-reads: the saved input with SQL 194 columns merged in. */
function saveAndReread(row: Record<string, unknown>) {
  const hit = normaliseMasterSearchHit(row)!;
  const input = buildMasterSavedChemicalInput(hit, rates);
  const persisted = {
    id: "s1",
    vineyard_id: "v1",
    ...input,
    ...(input.intelligence ?? {}),
  } as Record<string, unknown>;
  delete persisted.intelligence;
  return { input, display: resistanceGroupDisplay(toChemicalIntelligence(persisted)) };
}

describe("Master → Saved Chemical structured persistence", () => {
  it("classified FRAC 3 keeps the structured active, group and scheme", () => {
    const { input, display } = saveAndReread({
      id: "m-teb",
      product_name: "Folicur 430 SC",
      active_ingredients: [
        { name: "Tebuconazole", concentration: 430, concentration_unit: "g/L", activity_group: { scheme: "frac", code: "3" } },
      ],
      activity_groups: ["3"],
      activity_group_scheme: "frac",
      resistance_classification_state: "classified",
    });
    expect(input.intelligence?.active_ingredients).toHaveLength(1);
    expect((input.intelligence!.active_ingredients![0] as any).name).toBe("Tebuconazole");
    expect(input.intelligence?.activity_groups).toEqual(["3"]);
    expect(input.intelligence?.activity_group_scheme).toBe("frac");
    expect(input.resistance_classification_state).toBe("classified");
    expect(display.text).toBe("FRAC 3");
  });

  it("Beast / HRAC 10 with a bare per-active code qualified by the row scheme", () => {
    const { input, display } = saveAndReread({
      id: "m-beast",
      catalogue_version: 4,
      product_name: "CropSure Beast 200 Herbicide",
      registrant: "CROPSURE PTY LTD",
      registration_country: "AU",
      registration_scheme: "APVMA",
      registration_number: "90143",
      active_ingredients: [{ name: "Glufosinate-ammonium", concentration: 200, concentration_unit: "g/L", activity_group: "10" }],
      activity_groups: ["10"],
      activity_group_scheme: "HRAC",
      resistance_classification_state: "classified",
    });
    expect(input.intelligence?.activity_groups).toEqual(["10"]);
    expect(input.intelligence?.activity_group_scheme).toBe("hrac");
    expect(input.intelligence?.registration_number).toBe("90143");
    expect(input.master_chemical_id).toBe("m-beast");
    expect(input.master_source_revision).toBe(4);
    expect(display.text).toBe("HRAC 10");
  });

  it("multi-active FRAC 3 + 11 does not collapse", () => {
    const { input, display } = saveAndReread({
      id: "m-mix",
      product_name: "Mix",
      active_ingredients: [
        { name: "Tebuconazole", activity_group: { scheme: "frac", code: "3" } },
        { name: "Azoxystrobin", activity_group: { scheme: "frac", code: "11" } },
      ],
      activity_groups: ["3", "11"],
      activity_group_scheme: "frac",
      resistance_classification_state: "classified",
    });
    expect(input.intelligence?.activity_groups).toEqual(["3", "11"]);
    expect(display.text).toBe("FRAC 3 + 11");
  });

  it("explicit not_applicable survives and renders", () => {
    const { input, display } = saveAndReread({
      id: "m-na",
      product_name: "Wetter",
      active_ingredients: [{ name: "Alcohol alkoxylate", activity_group: { scheme: "not_applicable" } }],
      activity_groups: [],
      activity_group_scheme: "not_applicable",
      resistance_classification_state: "not_applicable",
    });
    expect(input.resistance_classification_state).toBe("not_applicable");
    expect(display.text).toBe(RESISTANCE_NOT_APPLICABLE_TEXT);
  });

  it("unresolved stays unresolved even with a partial group", () => {
    const { input, display } = saveAndReread({
      id: "m-un",
      product_name: "Partial",
      active_ingredients: [
        { name: "A", activity_group: { scheme: "frac", code: "3" } },
        { name: "B" },
      ],
      activity_groups: ["3"],
      activity_group_scheme: "frac",
      resistance_classification_state: "unresolved",
    });
    expect(input.resistance_classification_state).toBe("unresolved");
    expect(display.text).toBe(RESISTANCE_UNKNOWN_TEXT);
  });

  it("empty group list never becomes not_applicable", () => {
    const { input } = saveAndReread({ id: "m-e", product_name: "E", activity_groups: [] });
    expect(input.resistance_classification_state).toBeNull();
  });
});
