import { describe, it, expect } from "vitest";
import {
  RESISTANCE_MANUAL_WARNING,
  RESISTANCE_NOT_APPLICABLE_TEXT,
  RESISTANCE_UNKNOWN_TEXT,
  RESISTANCE_UNRESOLVED_WARNING,
  resistanceGroupDisplay,
  toChemicalIntelligence,
} from "@/lib/chemicalIntelligence";

const base = { id: "c1", vineyard_id: "v1", name: "P" };
const show = (row: Record<string, unknown>) =>
  resistanceGroupDisplay(toChemicalIntelligence({ ...base, ...row }));

describe("manual resistance group display", () => {
  it("manual group stays visible, marked manual and unverified", () => {
    const d = show({ chemical_group: "Group 3", resistance_classification_state: "unresolved" });
    expect(d.kind).toBe("manual");
    expect(d.text).toBe("Group 3 (unverified)");
    expect(d.warning).toBe(RESISTANCE_MANUAL_WARNING);
  });

  it("manual with no group shows unknown", () => {
    const d = show({ chemical_group: "", resistance_classification_state: "unresolved" });
    expect(d.text).toBe(RESISTANCE_UNKNOWN_TEXT);
    expect(d.warning).toBe(RESISTANCE_UNRESOLVED_WARNING);
  });

  it("structured unresolved with partial group ignores the legacy projection", () => {
    const d = show({
      chemical_group: "3",
      resistance_classification_state: "unresolved",
      activity_group_scheme: "frac",
      activity_groups: ["3"],
      active_ingredients: [{ name: "A", activity_group: { scheme: "frac", code: "3" } }, { name: "B" }],
    });
    expect(d.kind).toBe("unresolved");
    expect(d.text).toBe(RESISTANCE_UNKNOWN_TEXT);
  });

  it("classified structured FRAC 3 still displays FRAC 3", () => {
    const d = show({
      resistance_classification_state: "classified",
      activity_group_scheme: "frac",
      activity_groups: ["3"],
      active_ingredients: [{ name: "Tebuconazole", activity_group: { scheme: "frac", code: "3" } }],
    });
    expect(d.text).toBe("FRAC 3");
  });

  it("not applicable still displays no group applies", () => {
    expect(show({ resistance_classification_state: "not_applicable", chemical_group: "x" }).text).toBe(
      RESISTANCE_NOT_APPLICABLE_TEXT,
    );
  });
});
