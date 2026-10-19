import { describe, it, expect, vi } from "vitest";
import { assessPin } from "@/lib/pinRowRecovery";
import {
  buildDecision, validateDecision, requiredWarnings, exportDraftJson, importDraftJson, writebackPreflight,
  csvCell, exportDraftCsv, reconcileDrafts, draftStorageKey, parseStoredDrafts, LEGACY_DRAFT_KEY,
  type DecisionInput, type CurrentPin, type CurrentState,
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
const U = "user-a";
const st = (pins: CurrentPin[], o: Partial<CurrentState> = {}, pads = paddocks): CurrentState =>
  ({ current: new Map(pins.map((c) => [String(c.pin.id), c])), paddocks: pads, userId: U, evidenceReady: true, ...o });
const bd = (r: any, i: DecisionInput, who = "jh", uid = U) => buildDecision(r, i, who, uid, paddocks, []);

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
    const d = buildDecision(r, approve(r), "jh@example.com", U, paddocks, [], new Date("2026-10-19T12:00:00Z"));
    expect(d).toMatchObject({ authority: "operator_approved_draft", pin_id: "p1", reviewer: "jh@example.com", reviewed_at: "2026-10-19T12:00:00.000Z" });
    expect(d.snapshot).toMatchObject({ pin_id: "p1", latitude: basePin.latitude, sync_version: 3 });
    expect(d.snapshot.geometry_fingerprint).toMatch(/^portal-fnv1a:/);
  });
});

describe("export / import reconciliation", () => {
  const r = row();
  const d = bd(r, approve(r));
  const file = exportDraftJson([d]);
  it("round-trips when nothing changed", () => {
    const res = importDraftJson(file, st([cur(basePin)]));
    expect(res.accepted.length).toBe(1);
    expect(res.issues.length).toBe(0);
  });
  it("refuses stale decisions when sync_version, coordinates or map change", () => {
    expect(importDraftJson(file, st([cur({ ...basePin, sync_version: 4 })])).issues[0].reason).toMatch(/sync_version/;
    expect(importDraftJson(file, st([cur({ ...basePin, latitude: -33.99951 })])).issues[0].reason).toMatch(/latitude/;
    const moved = [{ ...pad, rows: rows.slice(0, 4) }];
    expect(importDraftJson(file, st([cur(basePin)], {}, moved)).issues[0].reason).toMatch(/geometry_fingerprint/;
  });
  it("rejects pins that left the queue, other vineyards and malformed files", () => {
    expect(importDraftJson(file, st([])).issues[0].reason).toMatch(/not in current/);
    expect(importDraftJson(file.replace(`"vineyard_id": "${VY}",\n  "authority"`, `"vineyard_id": "other",\n  "authority"`), st([cur(basePin)])).issues[0].reason).toMatch(/different vineyard/);
    expect(importDraftJson("{bad", st([])).issues.length).toBe(1);
  });
  it("CSV neutralises formula injection", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    const evil = bd(r, approve(r, { reason: "@SUM(A1)" }));
    expect(exportDraftCsv([evil])).toContain(`"'@SUM(A1)"`);
  });
});

describe("writeback preflight (read-only)", () => {
  const r = row();
  const d = bd(r, approve(r));
  it("eligible only when unchanged and unassigned", () => {
    const rep = writebackPreflight([d], st([cur(basePin)]));
    expect(rep).toMatchObject({ eligible: 1, conflict: 0 });
  });
  it("conflicts on changed revision, new saved row, segments, unreadable segments, deletion", () => {
    const check = (pin: any, segs: any[] | null = []) => writebackPreflight([d], st([cur(pin, segs)])).items[0];
    expect(check({ ...basePin, sync_version: 9 }).checks.join()).toMatch(/changed since review/);
    expect(check({ ...basePin, pin_row_number: 4 }).checks.join()).toMatch(/saved row/);
    expect(check(basePin, [{ row_number: 108, segment_number: 1 }]).checks.join()).toMatch(/segments/);
    expect(check(basePin, null).checks.join()).toMatch(/unreadable/);
    expect(writebackPreflight([d], st([])).items[0].outcome).toBe("conflict");
  });
  it("holds are reported but never eligible", () => {
    const h = bd(r, { ...approve(r), decision: "hold" });
    expect(writebackPreflight([h], st([cur(basePin)]))).toMatchObject({ eligible: 0, notApproval: 1 });
  });
  it("performs no network or database writes", async () => {
    const mod = await import("@/integrations/ios-supabase/client");
    const spy = vi.spyOn(mod.supabase, "from");
    const rpc = vi.spyOn(mod.supabase, "rpc");
    writebackPreflight([d], st([cur(basePin)]));
    importDraftJson(exportDraftJson([d]), st([cur(basePin)]));
    expect(spy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("safety hardening", () => {
  const r = row();
  const d = bd(r, approve(r));
  it("draft storage key is scoped to auth user AND vineyard; no user = no key", () => {
    expect(draftStorageKey("user-a")).toBe(`vinetrack.pinRowReviewDraft.v2.user-a.${VY}`);
    expect(draftStorageKey("user-a")).not.toBe(draftStorageKey("user-b"));
    expect(draftStorageKey(null)).toBeNull();
    expect(draftStorageKey("user-a")).not.toBe(LEGACY_DRAFT_KEY);
  });
  it("same browser, different account: other user's drafts are never accepted or eligible", () => {
    localStorage.setItem(draftStorageKey("user-a")!, JSON.stringify({ p1: d }));
    expect(localStorage.getItem(draftStorageKey("user-b")!)).toBeNull();
    const asB = st([cur(basePin)], { userId: "user-b" });
    const raw = parseStoredDrafts(localStorage.getItem(draftStorageKey("user-a")!));
    const res = reconcileDrafts(raw, asB);
    expect(res.accepted).toEqual([]);
    expect(res.issues[0].kind).toBe("other_account");
    expect(writebackPreflight(raw, asB).eligible).toBe(0);
    expect(reconcileDrafts(raw, st([cur(basePin)], { userId: null })).accepted).toEqual([]);
    localStorage.clear();
  });
  it("stale localStorage drafts are held until evidence/segments load, then revalidated", () => {
    expect(reconcileDrafts([d], st([cur(basePin)], { evidenceReady: false })).accepted).toEqual([]);
    expect(writebackPreflight([d], st([cur(basePin)], { evidenceReady: false })).eligible).toBe(0);
    expect(reconcileDrafts([d], st([cur({ ...basePin, sync_version: 5 })])).issues[0].kind).toBe("stale");
    expect(reconcileDrafts([d], st([cur(basePin)])).accepted.length).toBe(1);
  });
  it("tampered imports (forged row/side/source/warnings/authority/extra fields) are rejected", () => {
    const forge = (o: any) => importDraftJson(exportDraftJson([{ ...d, ...o }]), st([cur(basePin)]));
    expect(forge({ vine_row: 99 }).accepted).toEqual([]);
    expect(forge({ side: "up" }).issues[0].reason).toMatch(/side/);
    expect(forge({ side: "left" }).issues[0].reason).toMatch(/contradicts/);
    expect(forge({ source: "owner" }).issues[0].reason).toMatch(/source/);
    expect(forge({ acknowledged_warnings: [] }).issues[0].reason).toMatch(/Acknowledge/);
    expect(forge({ acknowledged_warnings: ["bogus"] }).accepted).toEqual([]);
    expect(forge({ authority: "server_confirmed" }).accepted).toEqual([]);
    expect(forge({ owner_approved: true }).issues[0].reason).toMatch(/unexpected/);
    expect(forge({ reviewer: "owner@vinetrack", reviewer_user_id: "owner-id" }).issues[0].kind).toBe("other_account");
    expect(forge({ source: "measured" }).issues[0].reason).toMatch(/manual field check/);
    expect(forge({ snapshot: { ...d.snapshot, pin_id: "zzz" } }).accepted).toEqual([]);
  });
  it("saved-block mismatch is BLOCK-CONFLICT and never eligible", () => {
    const pads = [...paddocks, { ...pad, id: "b2", name: "Other" }];
    const e = validateDecision(r, approve(r, { block_id: "b2" }), pads);
    expect(e.join()).toMatch(/BLOCK-CONFLICT/);
    const d2 = buildDecision(r, approve(r, { block_id: "b2" }), "jh", U, pads, []);
    expect(writebackPreflight([d2], st([cur(basePin)], {}, pads)).items[0].checks.join()).toMatch(/BLOCK-CONFLICT/);
  });
  it("GPS outside the chosen current block polygon is refused", () => {
    const far = { ...pad, id: "b3", polygon_points: poly.map((p) => ({ ...p, longitude: p.longitude + 0.01 })) };
    const nb = row({ ...basePin, paddock_id: null });
    expect(validateDecision(nb, approve(nb, { block_id: "b3" }), [...paddocks, far]).join()).toMatch(/outside the chosen block/);
  });
  it("contradictory or invented side is refused", () => {
    expect(validateDecision(r, approve(r, { side: "left" }), paddocks).join()).toMatch(/contradicts recorded side/);
    const noSide = row({ ...basePin, pin_side: null });
    expect(validateDecision(noSide, approve(noSide, { side: "left", source: "reviewed_track" }), paddocks).join()).toMatch(/No side was recorded/);
    const conflict = row({ ...basePin, pin_side: "Left", side: "Right" });
    expect(validateDecision(conflict, approve(conflict, { side: null }), paddocks).join()).toMatch(/conflict/);
  });
  it("wrong aisle/row pairing without a field check is refused; warnings never upgrade evidence", () => {
    const e = validateDecision(r, approve(r, { source: "reviewed_track", vine_row: 2, driving_aisle: 2.5 }), paddocks).join();
    expect(e).toMatch(/differs from the geometric aisle/);
    expect(e).toMatch(/not one of the bounding rows/);
    expect(validateDecision(r, approve(r, { source: "measured" }), paddocks).join()).toMatch(/only a manual field check/);
  });
  it("missing segments / evidence fail closed", () => {
    const noSeg = cur(basePin, null);
    expect(validateDecision(noSeg.row!, approve(noSeg.row!), paddocks).join()).toMatch(/segments unavailable/);
    expect(writebackPreflight([d], st([noSeg])).eligible).toBe(0);
  });
  it("module exposes no write path", async () => {
    const mod = await import("@/lib/pinRowReviewDraft");
    expect(Object.keys(mod).filter((k) => /write(?!backPreflight)|update|apply|commit|rpc/i.test(k))).toEqual([]);
  });
});
