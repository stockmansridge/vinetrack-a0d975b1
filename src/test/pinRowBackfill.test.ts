import { describe, it, expect, vi } from "vitest";
import { assessPin } from "@/lib/pinRowRecovery";
import { buildDecision, requiredWarnings, type DecisionInput } from "@/lib/pinRowReviewDraft";
import { buildBatch, batchCsv, verifyApplied, isMissingRpc } from "@/lib/pinRowBackfill";

const VY = "fe952afe-437f-4be7-8cbf-fdd8e630411c";
const M = 1 / (111320 * Math.cos((-34 * Math.PI) / 180));
const rows = [1, 2, 3, 4, 5].map((n) => ({ number: n, startPoint: { latitude: -34, longitude: 150 + (n - 1) * 2.8 * M }, endPoint: { latitude: -33.999, longitude: 150 + (n - 1) * 2.8 * M } }));
const poly = [{ latitude: -34.0001, longitude: 150 - M }, { latitude: -34.0001, longitude: 150 + 12 * M }, { latitude: -33.9989, longitude: 150 + 12 * M }, { latitude: -33.9989, longitude: 150 - M }];
const paddocks = [{ id: "b1", name: "Blackberries", rows, polygon_points: poly }];
const pin = (o: any = {}) => ({ id: "p1", vineyard_id: VY, latitude: -33.9995, longitude: 150 + 7 * M, paddock_id: "b1", sync_version: 3, updated_at: "2026-10-14T00:00:00Z", pin_side: "Right", ...o });
const row = (p = pin()) => assessPin(p, { paddocks, evidence: new Map(), segments: new Map(), trips: "not_loaded" });
const inp = (r: any, o: Partial<DecisionInput> = {}): DecisionInput => ({ decision: "approve_for_writeback", block_id: "b1", vine_row: 4, driving_aisle: 3.5, side: "right", reason: "field", source: "manual_field_check", acknowledged_warnings: requiredWarnings(r), ...o });

describe("backfill batch", () => {
  it("only approved drafts enter the batch; unreviewed pins are held, never nearest-row filled", () => {
    const r = row(); const r2 = row(pin({ id: "p2" }));
    const b = buildBatch([r, r2], { p1: buildDecision(r, inp(r), "jh", "u", paddocks, []) });
    expect(b.entries.map((e) => e.item.pin_id)).toEqual(["p1"]);
    expect(b.hold).toEqual([{ pin_id: "p2", title: r2.title, why: "no owner-reviewed row" }]);
  });
  it("carries exact CAS values and raw GPS; row is the reviewer's, not geometry", () => {
    const r = row();
    const it = buildBatch([r], { p1: buildDecision(r, inp(r), "jh", "u", paddocks, []) }).entries[0].item;
    expect(it).toMatchObject({ pin_row_number: 4, driving_row_number: 3.5, expected_sync_version: "3", expected_updated_at: "2026-10-14T00:00:00Z", expected_latitude: -33.9995 });
  });
  it("weak evidence without a field check is held, and marked field-confirmed when checked", () => {
    const r = row();
    const weak = { ...buildDecision(r, inp(r), "jh", "u", paddocks, []), source: "reviewed_track" as const };
    expect(buildBatch([r], { p1: weak }).entries.length).toBe(0);
    expect(buildBatch([r], { p1: buildDecision(r, inp(r), "jh", "u", paddocks, []) }).entries[0].cls).toBe("manual_field_confirmed");
  });
  it("never sends a side that differs from recorded pin_side unless field-checked", () => {
    const r = row(pin({ pin_side: null }));
    const d = { ...buildDecision(r, inp(r, { side: "left" }), "jh", "u", paddocks, []), source: "measured" as const };
    // measured + weak evidence is held entirely
    expect(buildBatch([r], { p1: d }).entries.length).toBe(0);
  });
  it("CSV marks proposals as not applied and holds as unresolved", () => {
    const r = row(); const b = buildBatch([r, row(pin({ id: "p9" }))], { p1: buildDecision(r, inp(r), "jh", "u", paddocks, []) });
    const csv = batchCsv(b);
    expect(csv).toMatch(/PROPOSED — not applied/);
    expect(csv).toMatch(/unresolved — not written/);
  });
  it("read-back counts a receipt only when pins and audit agree", async () => {
    const q = (data: any) => ({ select: () => ({ in: async () => ({ data, error: null }), eq: async () => ({ data, error: null }) }) });
    const db = { from: vi.fn((t: string) => t === "pins" ? q([{ id: "p1", pin_row_number: 4, snapped_to_row: true }, { id: "p2", pin_row_number: null }])
      : t === "pin_placements" ? q([]) : q([{ pin_id: "p1", after: { pin_row_number: 4 } }])) };
    const v = await verifyApplied(db, "a1", [{ pin_id: "p1", outcome: "assigned_snapped" }, { pin_id: "p2", outcome: "assigned_unsnapped" }]);
    expect(v).toMatchObject({ verified: 1, total: 2 });
  });
  it("detects missing server functions", () => {
    expect(isMissingRpc({ code: "PGRST202" })).toBe(true);
  });
});
