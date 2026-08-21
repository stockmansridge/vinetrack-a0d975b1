// P9 — WHP / REI / restrictions parity.
//
// Regression anchors:
//   Spray Seal 80160    → WHP 0 backed by "not required when used as directed"
//   Custodia Forte 91636→ WHP 28 days
//   unresolved REI      → stays unresolved, never inferred from WHP
//   long restrictions   → verbatim, never shortened
//   legacy record       → missing provenance never becomes zero
import { describe, it, expect } from "vitest";
import { withholdingDisplay, isNotRequiredWording } from "@/lib/chemicalLabelRates";
import { parseChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { composeRestrictions, parseRestrictions } from "@/lib/chemicalCategories";
import { diffChemicalDrafts } from "@/lib/chemicalReverify";
import { emptyDraft } from "@/lib/chemicalIntelligenceWrite";

const LONG =
  "DO NOT apply to grapevines intended for export wine unless the requirements of the relevant importing country have been confirmed. " +
  "DO NOT graze treated areas or cut for stock food for 14 days after application. Re-entry: DO NOT enter treated areas until spray has dried.";

const row = (uses: unknown[]) =>
  ({
    id: "c1",
    name: "Test product",
    registered_uses: uses,
    intelligence_schema_version: 1,
  }) as any;

describe("WHP rule", () => {
  it("shows the label statement only when the label wording supports it", () => {
    expect(withholdingDisplay(0, "Harvest — NOT REQUIRED WHEN USED AS DIRECTED")).toBe(
      "Not required when used as directed",
    );
    expect(withholdingDisplay(0, "Do not graze")).toBe("0 days");
    expect(withholdingDisplay(0, null)).toBe("0 days");
    expect(isNotRequiredWording("not required when used as directed")).toBe(true);
  });

  it("keeps a missing WHP unavailable rather than zero", () => {
    expect(withholdingDisplay(undefined, "anything")).toBeUndefined();
    expect(withholdingDisplay(null)).toBeUndefined();
  });

  it("Spray Seal 80160 — zero WHP reads as the label statement", () => {
    const chem = parseChemicalIntelligence(
      row([
        {
          crop: "GRAPES",
          target_raw: "POWDERY MILDEW",
          withholding_period_days: 0,
          restrictions: "Harvest - NOT REQUIRED WHEN USED AS DIRECTED",
        },
      ]),
    );
    const use = chem.registeredUses[0];
    expect(use.withholdingDays).toBe(0);
    expect(use.withholdingText).toBe("Not required when used as directed");
  });

  it("Custodia Forte 91636 — per-use WHP stays tied to its crop/target", () => {
    const chem = parseChemicalIntelligence(
      row([
        { crop: "Grapevines", target_raw: "Powdery mildew", withholding_period_days: 28, re_entry_period_hours: 24 },
        { crop: "Apples", target_raw: "Black spot", withholding_period_days: 7 },
      ]),
    );
    expect(chem.registeredUses[0].withholdingText).toBe("28 days");
    expect(chem.registeredUses[0].reEntryHours).toBe(24);
    expect(chem.registeredUses[1].withholdingText).toBe("7 days");
  });
});

describe("REI rule", () => {
  it("preserves authoritative hours and never infers from WHP", () => {
    const chem = parseChemicalIntelligence(
      row([{ crop: "Grapevines", withholding_period_days: 28 }]),
    );
    expect(chem.registeredUses[0].reEntryHours).toBeNull();
    expect(chem.registeredUses[0].reEntryPeriod).toBeNull();
    expect(chem.registeredUses[0].withholdingDays).toBe(28);
  });

  it("does not substitute a default for an unresolved REI", () => {
    const chem = parseChemicalIntelligence(row([{ crop: "Grapevines", re_entry_period_hours: 12 }]));
    expect(chem.registeredUses[0].reEntryHours).toBe(12);
  });
});

describe("restrictions behaviour", () => {
  it("keeps long label restrictions verbatim", () => {
    const chem = parseChemicalIntelligence(row([{ crop: "Grapevines", restrictions: LONG }]));
    expect(chem.registeredUses[0].restrictions).toBe(LONG);
  });

  it("legacy restrictions round-trip without inventing periods", () => {
    const p = parseRestrictions("Do not graze treated areas.");
    expect(p.whpDays).toBe("");
    expect(p.reiHours).toBe("");
    expect(composeRestrictions(p)).toBe("Do not graze treated areas.");
    expect(composeRestrictions({ whpDays: "1", reiHours: "1", rest: "" })).toBe(
      "WHP: 1 day. REI: 1 hour.",
    );
    expect(parseRestrictions("WHP: 1 day. REI: 1 hour.").whpDays).toBe("1");
  });
});

describe("re-verify diff", () => {
  it("renders periods as label wording, not bare numbers", () => {
    const before = {
      ...emptyDraft(),
      registeredUses: [
        {
          crop: "GRAPES",
          target_raw: "POWDERY MILDEW",
          rates: [],
          withholding_period_days: 0,
          restrictions: "NOT REQUIRED WHEN USED AS DIRECTED",
        },
      ],
    } as any;
    const after = {
      ...emptyDraft(),
      registeredUses: [
        {
          crop: "GRAPES",
          target_raw: "POWDERY MILDEW",
          rates: [],
          withholding_period_days: 14,
          re_entry_period_hours: 1,
          restrictions: LONG,
        },
      ],
    } as any;
    const diff = diffChemicalDrafts(before, after);
    const whp = diff.find((d) => d.label.includes("withholding"))!;
    expect(whp.before).toBe("Not required when used as directed");
    expect(whp.after).toBe("14 days");
    const rei = diff.find((d) => d.label.includes("re-entry"))!;
    expect(rei.before).toBe("—");
    expect(rei.after).toBe("1 hour");
    const restr = diff.find((d) => d.label.includes("restrictions"))!;
    expect(restr.after).toBe(LONG);
  });
});

describe("legacy record with no provenance", () => {
  it("yields no invented periods", () => {
    const chem = parseChemicalIntelligence({ id: "c2", name: "Legacy", restrictions: "Some note" } as any);
    expect(chem.registeredUses).toHaveLength(0);
  });
});
