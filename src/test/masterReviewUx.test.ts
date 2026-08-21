import { describe, it, expect } from "vitest";
import {
  classifyMasterConflict,
  diffMasterRows,
  hasMasterChanges,
  masterReviewSummary,
  safeExternalUrl,
} from "@/lib/masterReview";
import type { MasterChemicalRow } from "@/lib/masterChemicals";

const conflict = (over: Partial<any> = {}) => ({
  field: "registration_number",
  extracted_value: "63243",
  authoritative_value: "63244",
  extracted_source: "ai_interpretation",
  authoritative_source: "official_register",
  ...over,
});

describe("safe evidence links", () => {
  it("links only absolute http(s) URLs", () => {
    expect(safeExternalUrl("https://apvma.gov.au/x")).toBe("https://apvma.gov.au/x");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("APVMA 63243")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe("conflict classification", () => {
  it("auto-resolves official register vs AI in favour of the register", () => {
    const c = classifyMasterConflict(conflict() as any);
    expect(c.klass).toBe("auto_resolved");
    expect(c.winningValue).toBe("63244");
    expect(c.rejectedValue).toBe("63243");
  });

  it("requires a decision when two authoritative sources disagree", () => {
    const c = classifyMasterConflict(
      conflict({ extracted_source: "manufacturer_label" }) as any,
    );
    expect(c.klass).toBe("decision_required");
    expect(c.winningValue).toBeNull();
  });

  it("treats an empty side as a missing field, not a conflict", () => {
    const c = classifyMasterConflict(conflict({ extracted_value: "" }) as any);
    expect(c.klass).toBe("unresolved_missing");
  });

  it("treats formatting-only differences as resolved", () => {
    const c = classifyMasterConflict(
      conflict({ extracted_value: "Prosaro", authoritative_value: "prosaro" }) as any,
    );
    expect(c.klass).toBe("auto_resolved");
    expect(c.rejectedValue).toBeNull();
  });
});

describe("review summary", () => {
  const row: MasterChemicalRow = {
    id: "1",
    registration_country: "AU",
    registration_scheme: "apvma",
    registration_number: "63243",
    registered_product_name: "Prosaro 420 SC",
    verification_conflicts: [conflict(), conflict({ extracted_source: "official_register" })],
    verification_unresolved_fields: ["label_reference"],
  };

  it("splits decisions from auto-resolved and lists unresolved fields", () => {
    const s = masterReviewSummary(row, { blockingReasons: ["No authoritative label reference."] });
    expect(s.decisionsRequired).toBe(1);
    expect(s.autoResolved).toBe(1);
    expect(s.unresolvedFields).toContain("label_reference");
    expect(s.refreshable).toBe(true);
    expect(s.fresherAvailable).toBeNull();
    expect(s.headline).toMatch(/admin decision/i);
  });
});

describe("refresh diff", () => {
  it("flags changed fields only", () => {
    const before: MasterChemicalRow = {
      id: "1",
      registered_product_name: "Prosaro 420 SC",
      label_reference: null,
    };
    const after: MasterChemicalRow = {
      ...before,
      label_reference: "https://elabels.example/prosaro.pdf",
    };
    const diffs = diffMasterRows(before, after);
    expect(hasMasterChanges(diffs)).toBe(true);
    expect(diffs.find((d) => d.key === "label_reference")?.changed).toBe(true);
    expect(diffs.find((d) => d.key === "registered_product_name")?.changed).toBe(false);
  });

  it("reports no changes when nothing moved", () => {
    const row: MasterChemicalRow = { id: "1", registered_product_name: "X" };
    expect(hasMasterChanges(diffMasterRows(row, { ...row }))).toBe(false);
  });
});
