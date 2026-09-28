import { describe, it, expect } from "vitest";
import { candidateProductLines } from "@/lib/resistance/resistanceCandidate";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";

const chem = (row: Record<string, unknown>) =>
  toChemicalIntelligence({ id: "c1", vineyard_id: "v1", name: "P", ...row });

function lineFor(row: Record<string, unknown>, lineExtra: Record<string, unknown> = {}) {
  const intel = chem(row);
  const app = {
    products: [{ savedChemicalId: "c1", productName: "P", activityGroups: [], ...lineExtra }],
  } as any;
  return candidateProductLines(app, new Map([["c1", intel]]))[0];
}

describe("manual resistance group reaches the live assessment as unverified", () => {
  it("manual Group 3 → unverified fallback group", () => {
    const l = lineFor(
      { chemical_group: "Group 3", resistance_classification_state: "unresolved" },
      { legacyChemicalGroup: "Group 3" },
    );
    expect(l.groups.codes).toEqual(["3"]);
    expect(l.availability).toBe("available_unverified");
  });

  it("manual blank group → unavailable", () => {
    const l = lineFor({ chemical_group: "", resistance_classification_state: "unresolved" });
    expect(l.groups.codes).toEqual([]);
    expect(l.availability).toBe("unavailable");
  });

  it("structured FRAC 3 → structured path wins", () => {
    const l = lineFor(
      {
        chemical_group: "junk 9",
        resistance_classification_state: "classified",
        verification_status: "verified",
        activity_group_scheme: "frac",
        activity_groups: ["3"],
        active_ingredients: [{ name: "Tebuconazole", activity_group: { scheme: "frac", code: "3" } }],
      },
      { activityGroups: [{ scheme: "frac", code: "3" }], legacyChemicalGroup: "junk 9" },
    );
    expect(l.groups.codes).toEqual(["3"]);
    expect(l.availability).not.toBe("available_unverified");
  });

  it("structured unresolved is not upgraded by legacy text", () => {
    const l = lineFor(
      {
        chemical_group: "Group 7",
        resistance_classification_state: "unresolved",
        active_ingredients: [{ name: "A" }, { name: "B" }],
      },
      { legacyChemicalGroup: "Group 7" },
    );
    expect(l.groups.codes).not.toContain("7");
    expect(l.availability).not.toBe("verified");
  });
});
