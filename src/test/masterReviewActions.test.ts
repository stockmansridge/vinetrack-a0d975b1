import { describe, it, expect } from "vitest";
import { classifyMasterConflict } from "@/lib/masterReview";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import {
  buildCorrectionPatch,
  conflictAction,
  correctableFieldsFor,
  identityFieldsCorrectable,
  isIdentityField,
  readinessReasonAction,
  rekeyEligibility,
  toReviewTimeline,
  unresolvedFieldAction,
  classifyActionOutcome,
} from "@/lib/masterReviewActions";

const prosaro = (over: Partial<MasterChemicalRow> = {}): MasterChemicalRow => ({
  id: "m1",
  registration_country: "AU",
  registration_scheme: "apvma",
  registration_number: "63243",
  registered_product_name: "Prosaro 420 SC",
  review_status: "candidate",
  ...over,
});

const conflict = (over: Record<string, any> = {}) =>
  classifyMasterConflict({
    field: "registration_number",
    extracted_value: "63243",
    authoritative_value: "63244",
    extracted_source: "ai_interpretation",
    authoritative_source: "official_register",
    ...over,
  } as any);

describe("action treatment", () => {
  it("marks AI-vs-authoritative conflicts as resolved automatically", () => {
    const act = conflictAction(conflict(), prosaro());
    expect(act.kind).toBe("resolved_automatically");
    expect(act.adjudicable).toBe(false);
  });

  it("never adjudicates registration identity generically", () => {
    const item = conflict({ extracted_source: "manufacturer_label" });
    const act = conflictAction(item, prosaro());
    expect(act.kind).toBe("admin_decision_required");
    expect(act.adjudicable).toBe(false);
    expect(isIdentityField("registration_number")).toBe(true);
  });

  it("offers adjudication for a non-identity same-authority conflict", () => {
    const item = conflict({
      field: "product_category",
      extracted_source: "manufacturer_label",
    });
    const act = conflictAction(item, prosaro());
    expect(act.kind).toBe("admin_decision_required");
    expect(act.adjudicable).toBe(true);
  });

  it("says activity-group gaps cannot be manually resolved yet", () => {
    const act = unresolvedFieldAction("activity_group", prosaro());
    expect(act.kind).toBe("not_manually_resolvable");
    expect(act.correctField).toBeNull();
  });

  it("routes rate / WHP / REI gaps to an APVMA refresh, not manual editing", () => {
    for (const f of ["rates", "withholding_period_days", "re_entry_period_hours"]) {
      const act = unresolvedFieldAction(f, prosaro());
      expect(act.kind).toBe("refresh_from_apvma");
      expect(act.correctField).toBeNull();
    }
  });

  it("offers a correction for supported fields", () => {
    expect(unresolvedFieldAction("label_reference", prosaro()).correctField).toBe(
      "label_reference",
    );
    expect(unresolvedFieldAction("label", prosaro()).kind).toBe("admin_correction_available");
  });

  it("maps approval-gap reasons onto the same taxonomy", () => {
    expect(readinessReasonAction("No authoritative label reference.", prosaro()).kind).toBe(
      "admin_correction_available",
    );
    expect(
      readinessReasonAction("One or more actives have no FRAC/HRAC/IRAC group.", prosaro()).kind,
    ).toBe("not_manually_resolvable");
  });
});

describe("correctable fields", () => {
  it("exposes registrant / product name only for candidates", () => {
    expect(identityFieldsCorrectable(prosaro())).toBe(true);
    const approved = prosaro({ review_status: "approved" });
    expect(identityFieldsCorrectable(approved)).toBe(false);
    expect(correctableFieldsFor(approved).map((f) => f.key)).not.toContain("registrant");
  });

  it("never exposes typed structures", () => {
    const keys = correctableFieldsFor(prosaro()).map((f) => f.key);
    for (const banned of ["registered_uses", "rates", "withholding_period_days", "active_ingredients"]) {
      expect(keys).not.toContain(banned as any);
    }
  });

  it("builds a list patch for common names and nulls empties", () => {
    const patch = buildCorrectionPatch({ common_names: "Prosaro, Prosaro SC", label_version: "" });
    expect(patch.common_names).toEqual(["Prosaro", "Prosaro SC"]);
    expect(patch.label_version).toBeNull();
  });
});

describe("re-key guard", () => {
  it("allows only unlinked candidates", () => {
    expect(rekeyEligibility(prosaro(), 0).allowed).toBe(true);
    expect(rekeyEligibility(prosaro(), 2).allowed).toBe(false);
    expect(rekeyEligibility(prosaro({ review_status: "approved" }), 0).allowed).toBe(false);
    expect(rekeyEligibility(prosaro(), null).allowed).toBe(false);
  });
});

describe("outcomes and history", () => {
  it("classifies typed_handler_missing and revision mismatch", () => {
    expect(classifyActionOutcome("typed_handler_missing")).toBe("typed_handler_missing");
    expect(classifyActionOutcome("revision_mismatch")).toBe("revision_mismatch");
    expect(classifyActionOutcome("42501 not_authorised")).toBe("not_permitted");
    expect(classifyActionOutcome("ok")).toBe("ok");
  });

  it("projects review actions into a timeline", () => {
    const rows = [
      {
        id: "a1",
        action: "field_correction",
        field: "label_reference",
        reason: "Added label PDF",
        base_revision: 3,
        result_revision: 4,
        created_at: "2026-08-20T01:00:00Z",
        reviewer_email: "admin@example.com",
      },
    ];
    const [e] = toReviewTimeline(rows as any);
    expect(e.action).toBe("field correction");
    expect(e.reviewer).toBe("admin@example.com");
    expect(e.target).toBe("label reference");
    expect(e.baseRevision).toBe(3);
    expect(e.resultRevision).toBe(4);
  });
});
