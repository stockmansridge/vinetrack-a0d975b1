import { describe, it, expect, vi, beforeEach } from "vitest";
const invoke = vi.fn(); const rpc = vi.fn(); const from = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: any[]) => invoke(...a) },
    rpc: (...a: any[]) => rpc(...a),
    from: (...a: any[]) => from(...a),
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));
import { readBackfillView, requestMasterBackfillPreview, BACKFILL_STATUS_MESSAGE } from "@/lib/masterBackfill";
import { applyMasterReviewPreview, parseMasterReviewPreview } from "@/lib/masterReviewPreview";

const view = (data: any, reg = "90143") => readBackfillView(parseMasterReviewPreview(data), reg, null);
beforeEach(() => { invoke.mockReset(); rpc.mockReset(); from.mockReset(); });

describe("master_backfill_preview_v2 contract", () => {
  it("1 nested manufacturer label", () => {
    const v = view({ status: "preview_ready", preview_id: "p", evidence: { manufacturer_label_url: "https://m.example/l.pdf" } });
    expect(v.manufacturerLabelUrl).toBe("https://m.example/l.pdf");
  });
  it("2 nested conflicts", () => {
    expect(view({ status: "evidence_conflict", evidence: { conflicts: ["registrant", { field: "category" }] } }).conflicts)
      .toEqual(["registrant", "category"]);
  });
  it("3 locked identity from evidence, then top-level key; mismatch reported", () => {
    expect(view({ evidence: { locked_identity: "AU · APVMA · 90143" } }).lockedIdentity).toBe("AU · APVMA · 90143");
    expect(view({ registration_identity_key: "AU|APVMA|90143" }).lockedIdentity).toBe("AU|APVMA|90143");
    const v = view({ status: "identity_conflict", evidence: { reported_registration_number: "99999" } });
    expect(v.registrationMismatch).toBe(true);
    expect(v.source).toBeNull();
  });
  it.each([
    ["already_complete"], ["no_material_change"], ["manufacturer_label_not_found"],
    ["identity_conflict"], ["evidence_conflict"],
  ])("4–8 %s → friendly message, no Apply", (status) => {
    const v = view({ status, changes: [{ field: "x", proposed: "y" }] });
    expect(v.statusMessage).toBe(BACKFILL_STATUS_MESSAGE[status as keyof typeof BACKFILL_STATUS_MESSAGE]);
    expect(v.canApply).toBe(false);
  });
  it("findings are informational", () => {
    expect(view({ status: "manufacturer_label_not_found", findings: { classified: true, no_vineyard_use: true } }).findings)
      .toEqual(["Resistance classification resolved", "No vineyard registration found"]);
  });
  it("9 preview_ready with preview id permits Apply", () => {
    expect(view({ status: "preview_ready", preview_id: "p1", changes: [{ field: "x", proposed: "y" }] }).canApply).toBe(true);
    expect(view({ status: "preview_ready" }).canApply).toBe(false);
  });
  it("10 result_revision recognised; 11 proposed patch never sent", async () => {
    invoke.mockResolvedValue({ data: { status: "preview_ready", preview_id: "p1", proposed_patch: { product_category: "herbicide" } }, error: null });
    const r = await requestMasterBackfillPreview("m1");
    expect(invoke.mock.calls[0][1].body).toEqual({ action: "master_backfill_preview_v2", master_chemical_id: "m1" });
    expect(r.outcome).toBe("preview");
    rpc.mockResolvedValue({ data: { status: "applied", result_revision: 7 }, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
    const res = await applyMasterReviewPreview({ previewId: "p1", masterId: "m1", reason: "r" });
    expect(res.revision).toBe(7);
    expect(rpc.mock.calls[0][1]).toEqual({ p_master_id: "m1", p_preview_id: "p1", p_reason: "r" });
  });
});
