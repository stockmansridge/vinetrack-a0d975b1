import { describe, expect, it } from "vitest";
import {
  changeType,
  diffRegisteredUses,
  groupUseDiff,
  isGrapeUse,
  isRegisteredUsesField,
  parseRegisteredUses,
} from "@/lib/masterPreviewDiff";
import { parseMasterReviewPreview } from "@/lib/masterReviewPreview";

const grapeUse = {
  crop: "GRAPES",
  target_raw: "POWDERY MILDEW",
  rates: [
    { basis: "range_per_100_litres", unit: "mL", min_value: 35, max_value: 54 },
  ],
  withholding_period_days: 0,
  restrictions: "Harvest - NOT REQUIRED WHEN USED AS DIRECTED",
  provenance: { rates: "manufacturer_label" },
};

describe("masterPreviewDiff", () => {
  it("classifies added / removed / changed / unchanged", () => {
    expect(changeType(null, "21 days")).toBe("added");
    expect(changeType("21 days", null)).toBe("removed");
    expect(changeType("21 days", "14 days")).toBe("changed");
    expect(changeType("21 days", "21 days")).toBe("unchanged");
  });

  it("recognises registered use fields", () => {
    expect(isRegisteredUsesField("registered_uses")).toBe(true);
    expect(isRegisteredUsesField("label_reference")).toBe(false);
  });

  it("renders a Prosaro grape use without JSON", () => {
    const [use] = parseRegisteredUses([grapeUse]);
    expect(use.crop).toBe("GRAPES");
    expect(use.target).toBe("POWDERY MILDEW");
    expect(use.ratesText).toBe("35–54 mL/100 L");
    expect(use.rateBasisText).toBe("Per 100 L (range)");
    expect(use.whp).toBe("Not required when used as directed");
    expect(use.restrictions).toContain("NOT REQUIRED WHEN USED AS DIRECTED");
    expect(use.source).toBe("manufacturer label");
    expect(isGrapeUse(use)).toBe(true);
  });

  it("groups added / changed / removed / unchanged uses and marks changed fields", () => {
    const current = [
      grapeUse,
      { crop: "WHEAT", target_raw: "STRIPE RUST", rates: [], withholding_period_days: 21 },
    ];
    const proposed = [
      { ...grapeUse, withholding_period_days: 7, restrictions: "Do not graze" },
      { crop: "BARLEY", target_raw: "LEAF RUST", rates: [] },
    ];
    const groups = groupUseDiff(diffRegisteredUses(current, proposed));
    expect(groups.added.map((r) => r.proposed?.crop)).toEqual(["BARLEY"]);
    expect(groups.removed.map((r) => r.current?.crop)).toEqual(["WHEAT"]);
    expect(groups.changed).toHaveLength(1);
    expect(groups.changed[0].changedFields).toEqual(["WHP", "Restrictions"]);
  });

  it("accepts registered uses supplied as a JSON string", () => {
    expect(parseRegisteredUses(JSON.stringify([grapeUse]))).toHaveLength(1);
  });

  it("exposes identity detail and raw values from a preview payload", () => {
    const p = parseMasterReviewPreview({
      preview_id: "90213c1d",
      base_revision: 1,
      identity_guard: {
        status: "unknown",
        stored: { registration_country: "AU", registration_scheme: "APVMA", registration_number: "63243" },
        resolved: { registration_country: "AU", registration_scheme: "APVMA", registration_number: "63243" },
      },
      current_values: { registered_uses: [] },
      proposed_patch: { registered_uses: [grapeUse] },
      changes: [{ field: "registered_uses", current: [], proposed: [grapeUse], source: "apvma" }],
    });
    expect(p.identityStored?.number).toBe("63243");
    expect(p.identityResolved?.number).toBe("63243");
    expect(p.identityFailedCheck).toBeNull();
    expect(Array.isArray(p.changes[0].proposedRaw)).toBe(true);
    expect(p.changes[0].source).toBe("apvma");
  });
});
