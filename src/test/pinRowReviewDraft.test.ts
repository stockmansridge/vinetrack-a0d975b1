import { describe, it, expect, vi } from "vitest";
import { assessPin } from "@/lib/pinRowRecovery";
import {
  buildDecision, validateDecision, requiredWarnings, exportDraftJson, importDraftJson, writebackPreflight,
  csvCell, exportDraftCsv, type DecisionInput, type CurrentPin,
} from "@/lib/pinRowReviewDraft";

const VY = "fe952afe-437f-4be7-8cbf-fdd8e630411c";
const M_LNG = 1 / (111320 * Math.cos((-34 * Math.PI) / 180));
const rows = [1, 2, 3, 4, 5].map((n) => ({ number: n,
  startPoint: { latitude: -34, longitude: 150 + (n - 1) * 2.8 * M_LNG },
  endPoint: { latitude: -33.999, longitude: 150 + (n - 1) * 2.8 * M_LNG } }));
const poly = [{ latitude: -34.0001, longitude: 150 - M_LNG }, { latitude: -34.0001, longitude: 150 + 12 * M_LNG },
  { latitude: -33.9989, longitude: 150 + 12 * M_LNG }, { latitude: -33.9989, longitude: 150 - M_LNG }];
const pad = { id: "b1", name: "Blackberries", rows, polygon_points: poly };
const paddocks = [pad];
const basePin = { id: "p1", vineyard_id: VY, latitude: -33.9995, longitude: 150 + 7 * M_LNG, paddock_id: "b1", sync_version: 3, updated_at: "2026-10-14T00:00:00Z", pin_side: "Right" };
const ev = (segs: Map<string, any[]> | null = new Map()) => ({ paddocks, evidence: new Map(), segments: segs, trips: "not_loaded" as const });
const row = (pin: any = basePin, segs?: Map<string, any[]> | null) => assessPin(pin, ev(segs));
const allWarn = (r: any) => requiredWarnings(r);
const approve = (r: any, o: Partial<DecisionInput> = {}): DecisionInput => ({ decision: "approve_for_writeback", block_id: "b1", vine_row: 4,
  driving_aisle: 3.5, side: "right", reason: "Field check with owner", source: "manual_field_check", acknowledged_warnings: allWarn(r), ...o });
const cur = (pin: any, segs: any[] | null = []): CurrentPin => ({ pin, segs, row: assessPin(pin, ev(segs ? new Map([[pin.id, segs]]) : null)) });

describe("draft decisions (local only)", () => {
  it("requires reason, source, block, existing row and acknowledgements", () => {
    const r = row();
    expect(validateDecision(r, approve(r), paddocks)).toEqual([]);
    expect(validateDecision(r, approve(r, { reason: " " }), paddocks).join()).toMatch(/reason/);
    expect(validateDecision(r, approve(r, { source: null }), paddocks).join()).toMatch(/source/);
    expect(validateDecision(r, approve(r, { block_id: null }), paddocks).join()).toMatch(/block/);
    expect(validateDecision(r, approve(r, { vine_row: 99 }), paddocks).join()).toMatch(/does not exist/);
    expect(validateDecision(r, approve(r, { acknowledged_warnings: [] }), paddocks).join()).toMatch(/Acknowledge/);
  });
  it("checks aisle/vine-row adjacency", () => {
    const r = row();
    expect(validateDecision(r, approve(r, { driving_aisle: 1.5 }), paddocks).join()).toMatch(/adjacent/);
    expect(validateDecision(r, approve(r, { driving_aisle: 3 }), paddocks).join()).toMatch(/half row/);
  });
  it("missing block / side / headland pins demand the matching warnings", () => {
    const noBlock = row({ ...basePin, paddock_id: null, pin_side: null });
    expect(allWarn(noBlock)).toEqual(expect.arrayContaining(["no_saved_block", "no_side", "no_gps_accuracy", "no_reliable_direction", "current_only_map"]));
    const head = row({ ...basePin, latitude: -34.00005 });
    expect(head.status).toBe("not_resolvable");
    expect(validateDecision(head, approve(head, { acknowledged_warnings: [] }), paddocks).length).toBeGreaterThan(0);
  });
  it("preserved-metadata pins can never be approved", () => {
    const r = row(basePin, new Map([["p1", [{ row_number: 108, segment_number: 1 }]]]));
    expect(r.status).toBe("preserve_existing");
    expect(validateDecision(r, approve(r), paddocks).join()).toMatch(/never overwritten/);
    expect(validateDecision(r, { ...approve(r), decision: "preserve_existing" }, paddocks)).toEqual([]);
  });
  it("decision records reviewer, time, authority and immutable snapshot", () => {
    const r = row();
    const d = buildDecision(r, approve(r), "jh@example.com", paddocks, [], new Date("2026-10-19T12:00:00Z"));
    expect(d).toMatchObject({ authority: "operator_approved_draft", pin_id: "p1", reviewer: "jh@example.com", reviewed_at: "2026-10-19T12:00:00.000Z" });
    expect(d.snapshot).toMatchObject({ pin_id: "p1", latitude: basePin.latitude, sync_version: 3 });
    expect(d.snapshot.geometry_fingerprint).toMatch(/^portal-fnv1a:/);
  });
});

describe("export / import reconciliation", () => {
  const r = row();
  const d = buildDecision(r, approve(r), "jh", paddocks, []);
  const file = exportDraftJson([d]);
  it("round-trips when nothing changed", () => {
    const res = importDraftJson(file, [cur(basePin)], paddocks);
    expect(res.accepted.length).toBe(1);
    expect(res.stale.length + res.rejected.length).toBe(0);
  });
  it("refuses stale decisions when sync_version, coordinates or map change", () => {
    expect(importDraftJson(file, [cur({ ...basePin, sync_version: 4 })], paddocks).stale[0].fields).toContain("sync_version");
    expect(importDraftJson(file, [cur({ ...basePin, latitude: -33.99951 })], paddocks).stale[0].fields).toContain("latitude");
    const moved = [{ ...pad, rows: rows.slice(0, 4) }];
    expect(importDraftJson(file, [cur(basePin)], moved).stale[0].fields).toContain("geometry_fingerprint");
  });
  it("rejects pins that left the queue, other vineyards and malformed files", () => {
    expect(importDraftJson(file, [], paddocks).rejected[0].reason).toMatch(/not in current/);
    expect(importDraftJson(file.replace(VY, "other"), [cur(basePin)], paddocks).rejected[0].reason).toMatch(/different vineyard/);
    expect(importDraftJson("{bad", [], paddocks).rejected.length).toBe(1);
  });
  it("CSV neutralises formula injection", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    const evil = buildDecision(r, approve(r, { reason: "@SUM(A1)" }), "jh", paddocks, []);
    expect(exportDraftCsv([evil])).toContain(`"'@SUM(A1)"`);
  });
});

describe("writeback preflight (read-only)", () => {
  const r = row();
  const d = buildDecision(r, approve(r), "jh", paddocks, []);
  it("eligible only when unchanged and unassigned", () => {
    const rep = writebackPreflight([d], new Map([["p1", cur(basePin)]]), paddocks);
    expect(rep).toMatchObject({ eligible: 1, conflict: 0 });
  });
  it("conflicts on changed revision, new saved row, segments, unreadable segments, deletion", () => {
    const check = (pin: any, segs: any[] | null = []) => writebackPreflight([d], new Map([["p1", cur(pin, segs)]]), paddocks).items[0];
    expect(check({ ...basePin, sync_version: 9 }).checks.join()).toMatch(/changed since review/);
    expect(check({ ...basePin, pin_row_number: 4 }).checks.join()).toMatch(/saved row/);
    expect(check(basePin, [{ row_number: 108, segment_number: 1 }]).checks.join()).toMatch(/segments/);
    expect(check(basePin, null).checks.join()).toMatch(/unreadable/);
    expect(writebackPreflight([d], new Map(), paddocks).items[0].outcome).toBe("conflict");
  });
  it("holds are reported but never eligible", () => {
    const h = buildDecision(r, { ...approve(r), decision: "hold" }, "jh", paddocks, []);
    expect(writebackPreflight([h], new Map([["p1", cur(basePin)]]), paddocks)).toMatchObject({ eligible: 0, notApproval: 1 });
  });
  it("performs no network or database writes", async () => {
    const mod = await import("@/integrations/ios-supabase/client");
    const spy = vi.spyOn(mod.supabase, "from");
    const rpc = vi.spyOn(mod.supabase, "rpc");
    writebackPreflight([d], new Map([["p1", cur(basePin)]]), paddocks);
    importDraftJson(exportDraftJson([d]), [cur(basePin)], paddocks);
    expect(spy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
