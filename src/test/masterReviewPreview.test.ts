import { describe, it, expect } from "vitest";
import {
  buildMasterReviewPreviewBody,
  classifyApplyOutcome,
  normaliseIdentityGuard,
  parseMasterReviewPreview,
  previewApplyBlockedReason,
  previewExpired,
} from "@/lib/masterReviewPreview";
import type { MasterChemicalRow } from "@/lib/masterChemicals";

const prosaro: MasterChemicalRow = {
  id: "master-prosaro",
  registration_country: "AU",
  registration_scheme: "apvma",
  registration_number: "63243",
  registered_product_name: "Prosaro 420 SC Foliar Fungicide",
  catalogue_version: 4,
};

// Mirrors the live LD-2 resolver output for APVMA 63243: the authoritative
// label wording is "Harvest - NOT REQUIRED WHEN USED AS DIRECTED", i.e. WHP 0
// (never 21 days), and the label reference is the full eLabels PDF URL.
const PROSARO_LABEL_REFERENCE = "https://elabels.apvma.gov.au/63243ELBL.pdf";

const productionPreview = {
  preview_id: "prev-6f0c1a2b-9999",
  master_chemical_id: "master-prosaro",
  base_revision: 4,
  identity_guard: { status: "match", detail: "APVMA 63243 confirmed" },
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  writable: true,
  current_values: {
    label_reference: null,
    withholding_period_days: null,
  },
  proposed_patch: {
    label_reference: PROSARO_LABEL_REFERENCE,
    withholding_period_days: 0,
  },
  changes: [
    { field: "label_reference", current: null, proposed: PROSARO_LABEL_REFERENCE },
    { field: "withholding_period_days", current: null, proposed: 0 },
  ],
};

describe("master review preview request", () => {
  it("sends only the action and identity — never a patch", () => {
    const body = buildMasterReviewPreviewBody(prosaro) as unknown as Record<string, unknown>;
    expect(body.action).toBe("master_review_preview");
    expect(body.master_chemical_id).toBe("master-prosaro");
    expect(body.registration_number).toBe("63243");
    for (const forbidden of ["patch", "proposed_patch", "proposed_values", "changes", "review_status"]) {
      expect(body[forbidden]).toBeUndefined();
    }
  });
});

describe("preview parsing (Prosaro 63243)", () => {
  const p = parseMasterReviewPreview(productionPreview);

  it("exposes preview id, base revision, guard and expiry", () => {
    expect(p.previewId).toBe("prev-6f0c1a2b-9999");
    expect(p.baseRevision).toBe(4);
    expect(p.identityGuard).toBe("match");
    expect(p.expiresAt).toBeTruthy();
    expect(previewExpired(p)).toBe(false);
  });

  it("surfaces the full authoritative eLabel reference and the label WHP of 0", () => {
    const byField = Object.fromEntries(p.changes.map((c) => [c.field, c]));
    expect(byField.label_reference.current).toBeNull();
    expect(byField.label_reference.proposed).toBe(PROSARO_LABEL_REFERENCE);
    // "NOT REQUIRED WHEN USED AS DIRECTED" => 0, never 21 days.
    expect(byField.withholding_period_days.proposed).toBe("0");
    expect(byField.withholding_period_days.proposed).not.toBe("21");
    expect(previewApplyBlockedReason(p)).toBeNull();
  });

  it("blocks apply when expired, empty or identity-refused", () => {
    expect(previewApplyBlockedReason({ ...p, changes: [] })).toMatch(/nothing to apply/i);
    expect(previewApplyBlockedReason({ ...p, previewId: null })).toMatch(/writable preview/i);
    expect(previewApplyBlockedReason({ ...p, identityGuard: "rekey_required" })).toMatch(/re-key/i);
    expect(
      previewApplyBlockedReason({ ...p, expiresAt: new Date(Date.now() - 1000).toISOString() }),
    ).toMatch(/expired/i);
  });

  it("treats a resolver response with no preview as not writable", () => {
    const none = parseMasterReviewPreview({ message: "No APVMA source available" });
    expect(none.previewId).toBeNull();
    expect(none.writable).toBe(false);
    expect(previewApplyBlockedReason(none)).toMatch(/writable preview/i);
  });
});

describe("identity guard + apply outcome classification", () => {
  it("normalises guard values", () => {
    expect(normaliseIdentityGuard("MATCH")).toBe("match");
    expect(normaliseIdentityGuard("rekey_required")).toBe("rekey_required");
    expect(normaliseIdentityGuard("identity_mismatch")).toBe("mismatch");
    expect(normaliseIdentityGuard(undefined)).toBe("unknown");
  });

  it("maps every contract error state", () => {
    expect(classifyApplyOutcome("already_applied")).toBe("already_applied");
    expect(classifyApplyOutcome("preview_expired")).toBe("preview_expired");
    expect(classifyApplyOutcome("preview_not_yours")).toBe("preview_not_yours");
    expect(classifyApplyOutcome("revision_mismatch")).toBe("revision_mismatch");
    expect(classifyApplyOutcome("preview_mismatch")).toBe("preview_mismatch");
    expect(classifyApplyOutcome("identity_rekey_refused")).toBe("identity_rekey_refused");
    expect(classifyApplyOutcome("42501 permission denied")).toBe("not_permitted");
    expect(classifyApplyOutcome("no_writable_preview")).toBe("source_unavailable");
    expect(classifyApplyOutcome("applied")).toBe("applied");
  });
});
