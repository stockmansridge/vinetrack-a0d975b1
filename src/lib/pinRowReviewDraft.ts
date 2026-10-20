// Stage 1 review register — LOCAL DRAFT decisions + read-only writeback PREFLIGHT.
//
// Nothing here writes to the database. Decisions are operator_approved_draft,
// never server-confirmed. Files exported here are unsigned, non-authoritative
// working copies for resuming review.
import { parseRows } from "@/lib/paddockGeometry";
import { RECOVERY_VINEYARD_ID, type RecoveryRow, triadOf, pointInPolygon } from "@/lib/pinRowRecovery";
import { parsePolygonPoints } from "@/lib/paddockGeometry";
import { candidateMatchesPin, supportedCandidate, type ServerReconstructionReport } from "@/lib/pinRowReconstruction";

export type DecisionKind = "approve_for_writeback" | "hold" | "needs_field_verification" | "preserve_existing";
export type DecisionSource = "measured" | "reviewed_track" | "manual_field_check";
export const DECISION_LABEL: Record<DecisionKind, string> = {
  approve_for_writeback: "Approve for writeback (draft)",
  hold: "Hold",
  needs_field_verification: "Needs field verification",
  preserve_existing: "Preserve existing",
};
export const DRAFT_FORMAT = "vinetrack.pin-row-review-draft";
export const DRAFT_VERSION = 2;
/** Legacy vineyard-only key (v1). Never read: it was not scoped to a signed-in account. */
export const LEGACY_DRAFT_KEY = "vinetrack.pinRowReviewDraft." + RECOVERY_VINEYARD_ID;
/** Local draft key scoped to BOTH the signed-in auth user id and the vineyard. Null = no account → no drafts. */
export function draftStorageKey(userId: string | null | undefined): string | null {
  if (!userId || typeof userId !== "string") return null;
  return `vinetrack.pinRowReviewDraft.v2.${userId}.${RECOVERY_VINEYARD_ID}`;
}
export const AUTHORITY = "operator_approved_draft";

export type WarningKey = "no_gps_accuracy" | "no_reliable_direction" | "no_side" | "no_saved_block" | "current_only_map";
export const WARNING_LABEL: Record<WarningKey, string> = {
  no_gps_accuracy: "No reliable GPS accuracy",
  no_reliable_direction: "No reliable travel direction",
  no_side: "No left/right recorded",
  no_saved_block: "Saved block missing",
  current_only_map: "Current map only (capture-time layout unknown)",
};

/** Snapshot of the pin as it was when reviewed — used to detect staleness. */
export interface PinSnapshot {
  pin_id: string;
  vineyard_id: string;
  latitude: number | null;
  longitude: number | null;
  sync_version: number | string | null;
  updated_at: string | null;
  paddock_id: string | null;
  row_number: number | null;
  pin_row_number: number | null;
  driving_row_number: number | null;
  pin_side: string | null;
  side: string | null;
  location_scope: string | null;
  snapped_latitude: number | null;
  snapped_longitude: number | null;
  segments: string | null;
  /** Portal fingerprint of the current block rows+polygon (NOT the server geometry hash). */
  geometry_fingerprint: string | null;
  geometry_source: string;
}

export interface ReviewDecision {
  field_confirmation?: { observed_by: string; observed_at: string; method: string; note: string };
  authority: typeof AUTHORITY;
  pin_id: string;
  decision: DecisionKind;
  block_id: string | null;
  vine_row: number | null;
  driving_aisle: number | null;
  side: "left" | "right" | null;
  reason: string;
  source: DecisionSource | null;
  acknowledged_warnings: WarningKey[];
  /** Display label only (email). NOT proof of approval. */
  reviewer: string;
  /** Auth user id of the signed-in account that saved the draft. Drafts from other ids are never shown or accepted. */
  reviewer_user_id: string;
  reviewed_at: string;
  snapshot: PinSnapshot;
}

const n = (v: any): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const sv = (v: any): string | null => (v == null || v === "" ? null : String(v));

/** Deterministic FNV-1a fingerprint of a block's current rows + polygon. */
export function geometryFingerprint(paddock: any | null | undefined): string | null {
  if (!paddock) return null;
  const s = JSON.stringify([paddock.id, paddock.rows ?? null, paddock.polygon_points ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return "portal-fnv1a:" + (h >>> 0).toString(16).padStart(8, "0");
}

export function segmentsKey(segs: { row_number: number; segment_number: number | null }[] | null | undefined): string | null {
  if (!segs || !segs.length) return null;
  return [...segs].map((s) => `${s.row_number}:${s.segment_number ?? ""}`).sort().join(",");
}

export function snapshotOf(pin: any, paddock: any | null, segs: any[] | null, geometrySource: string): PinSnapshot {
  return {
    pin_id: String(pin.id),
    vineyard_id: String(pin.vineyard_id ?? ""),
    latitude: n(pin.latitude), longitude: n(pin.longitude),
    sync_version: pin.sync_version ?? null,
    updated_at: sv(pin.updated_at),
    paddock_id: sv(pin.paddock_id),
    row_number: n(pin.row_number), pin_row_number: n(pin.pin_row_number), driving_row_number: n(pin.driving_row_number),
    pin_side: sv(pin.pin_side), side: sv(pin.side), location_scope: sv(pin.location_scope),
    snapped_latitude: n(pin.snapped_latitude), snapped_longitude: n(pin.snapped_longitude),
    segments: segmentsKey(segs),
    geometry_fingerprint: geometryFingerprint(paddock),
    geometry_source: geometrySource,
  };
}

/** Warnings that must be acknowledged before approve_for_writeback. */
export function requiredWarnings(r: RecoveryRow): WarningKey[] {
  const t = triadOf(r);
  const w: WarningKey[] = [];
  if (r.accuracy == null) w.push("no_gps_accuracy");
  if (t.direction !== "qualified") w.push("no_reliable_direction");
  if (t.side !== "qualified") w.push("no_side");
  if (!r.savedBlockName) w.push("no_saved_block");
  w.push("current_only_map");
  return w;
}

export interface DecisionInput {
  field_confirmation?: { observed_by: string; observed_at: string; method: string; note: string };
  decision: DecisionKind;
  block_id: string | null;
  vine_row: number | null;
  driving_aisle: number | null;
  side: "left" | "right" | null;
  reason: string;
  source: DecisionSource | null;
  acknowledged_warnings: WarningKey[];
}

/** Validate a draft decision. Returns errors; empty = valid. */
export function validateDecision(r: RecoveryRow, input: DecisionInput, paddocks: any[], report?: ServerReconstructionReport | null): string[] {
  const e: string[] = [];
  if (!input.reason.trim()) e.push("A reason is required.");
  if (r.status === "preserve_existing" && input.decision === "approve_for_writeback")
    e.push("Pins with existing row metadata can only be held or preserved — never overwritten.");
  if (input.decision !== "approve_for_writeback") return e;
  if (!input.source) e.push("A source is required (measured / reviewed_track / manual_field_check).");
  if (!input.block_id) e.push("Choose a block.");
  const pad = paddocks.find((p) => p.id === input.block_id);
  if (input.block_id && !pad) e.push("Chosen block is not a current Stockman's Ridge block.");
  if (input.vine_row == null || !Number.isInteger(input.vine_row)) e.push("Choose a whole physical vine row.");
  else if (pad) {
    const nums = new Set(parseRows(pad.rows).map((x) => x.number));
    if (!nums.has(input.vine_row)) e.push(`Row ${input.vine_row} does not exist in the chosen block.`);
  }
  if (input.driving_aisle != null) {
    if (Math.abs(input.driving_aisle % 1) !== 0.5) e.push("Driving aisle must be a half row (e.g. 34.5).");
    else if (input.vine_row != null && Math.abs(input.vine_row - input.driving_aisle) !== 0.5)
      e.push("Vine row must be adjacent to the driving aisle.");
  }
  const missing = requiredWarnings(r).filter((w) => !input.acknowledged_warnings.includes(w));
  if (missing.length) e.push(`Acknowledge: ${missing.map((w) => WARNING_LABEL[w]).join(", ")}.`);
  // Fail closed on incomplete evidence.
  if (r.evidenceState === "unavailable") e.push("Capture evidence unavailable — cannot approve.");
  if (r.segmentsState === "unavailable") e.push("Row segments unavailable — cannot rule out existing metadata.");
  // BLOCK-CONFLICT: pin-row-only backfill may set paddock_id only when it is null.
  const saved = r.pin?.paddock_id ?? null;
  if (saved && input.block_id && input.block_id !== saved)
    e.push(`${BLOCK_CONFLICT}: chosen block differs from the saved block — needs a separate authoritative block correction, not eligible for pin-row backfill.`);
  if (pad) {
    const poly = parsePolygonPoints(pad.polygon_points);
    if (r.lat == null || r.lng == null) e.push("Pin has no GPS — cannot check it lies in the chosen block.");
    else if (poly.length < 3) e.push("Chosen block has no current polygon — cannot check the pin lies inside it.");
    else if (!pointInPolygon({ lat: r.lat, lng: r.lng }, poly)) e.push("GPS lies outside the chosen block's current polygon (current geometry only).");
  }
  // Left/right must never contradict what was recorded, nor be invented.
  if (r.sideConflict) e.push("Recorded left/right values conflict (pin_side / side / pressed_side) — resolve in the field first.");
  if (input.side && r.side && input.side !== r.side) e.push(`Side ${input.side} contradicts recorded side ${r.side}.`);
  if (input.side && !r.side && input.source !== "manual_field_check") e.push("No side was recorded — only a manual field check may supply one.");
  // Pairing against current geometry, unless verified in the field.
  if (input.source !== "manual_field_check") {
    const server = supportedCandidate(report ?? null, r.id);
    if (server && candidateMatchesPin(server, r) && input.block_id === server.proposed_block_id &&
        input.vine_row === server.suggestion?.vine_row && input.driving_aisle === server.suggestion?.driving_aisle && input.side === server.side?.value)
      return e;
    const g = r.geometry;
    const sameBlock = !input.block_id || input.block_id === (r.pin?.paddock_id ?? null);
    if (sameBlock && g?.aisle != null && input.driving_aisle != null && input.driving_aisle !== g.aisle)
      e.push(`Driving aisle ${input.driving_aisle} differs from the geometric aisle ${g.aisle} — needs a manual field check.`);
    if (sameBlock && g?.boundingRows && input.vine_row != null && !g.boundingRows.includes(input.vine_row))
      e.push(`Row ${input.vine_row} is not one of the bounding rows ${g.boundingRows.join(" & ")} — needs a manual field check.`);
    if (r.suggestedVineRow != null && input.vine_row != null && input.vine_row !== r.suggestedVineRow)
      e.push(`Row ${input.vine_row} contradicts the travel + side pairing (Row ${r.suggestedVineRow}) — needs a manual field check.`);
    // Acknowledging a warning never upgrades weak evidence.
    const t = triadOf(r);
    if (r.accuracy == null || t.direction !== "qualified" || t.side !== "qualified")
      e.push("Technical evidence is insufficient (GPS accuracy / travel direction / side) — only a manual field check can support approval.");
  }
  return e;
}

export const BLOCK_CONFLICT = "BLOCK-CONFLICT";

export function buildDecision(
  r: RecoveryRow, input: DecisionInput, reviewer: string, reviewerUserId: string, paddocks: any[],
  segs: any[] | null, now: Date = new Date(),
): ReviewDecision {
  const pad = reviewPaddock(r.pin, input.block_id, paddocks);
  return {
    authority: AUTHORITY,
    pin_id: r.id,
    decision: input.decision, block_id: input.block_id, vine_row: input.vine_row, driving_aisle: input.driving_aisle,
    side: input.side, source: input.source, acknowledged_warnings: [...input.acknowledged_warnings],
    reason: input.reason.trim(),
    ...(input.field_confirmation ? { field_confirmation: { ...input.field_confirmation } } : {}),
    reviewer,
    reviewer_user_id: reviewerUserId,
    reviewed_at: now.toISOString(),
    snapshot: snapshotOf(r.pin, pad, segs, r.geometrySource),
  };
}

/** Block used for the geometry fingerprint: chosen block, else saved block. */
export function reviewPaddock(pin: any, blockId: string | null, paddocks: any[]): any | null {
  const id = blockId ?? pin?.paddock_id ?? null;
  return id ? paddocks.find((p) => p.id === id) ?? null : null;
}

export interface CurrentPin { pin: any; segs: any[] | null; row: RecoveryRow | null }

// ---------- staleness ----------
const SNAP_FIELDS: (keyof PinSnapshot)[] = [
  "vineyard_id", "latitude", "longitude", "sync_version", "updated_at", "paddock_id", "row_number",
  "pin_row_number", "driving_row_number", "pin_side", "side", "location_scope",
  "snapped_latitude", "snapped_longitude", "segments",
];
export function snapshotDiff(a: PinSnapshot, b: PinSnapshot): string[] {
  const d = SNAP_FIELDS.filter((k) => String(a[k] ?? "") !== String(b[k] ?? ""));
  if (a.geometry_fingerprint !== b.geometry_fingerprint) d.push("geometry_fingerprint");
  return d;
}

// ---------- export / import ----------
export interface DraftFile {
  format: typeof DRAFT_FORMAT;
  version: number;
  vineyard_id: string;
  authority: typeof AUTHORITY;
  notice: string;
  exported_at: string;
  decisions: ReviewDecision[];
}
export const DRAFT_NOTICE =
  "Unsigned operator draft. NOT authoritative and NOT applied to the database. Requires owner approval and a guarded server writeback.";

export function exportDraftJson(decisions: ReviewDecision[], now: Date = new Date()): string {
  const f: DraftFile = { format: DRAFT_FORMAT, version: DRAFT_VERSION, vineyard_id: RECOVERY_VINEYARD_ID,
    authority: AUTHORITY, notice: DRAFT_NOTICE, exported_at: now.toISOString(), decisions };
  return JSON.stringify(f, null, 2);
}

/** CSV cell escaping including spreadsheet formula-injection neutralisation. */
export function csvCell(v: any): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportDraftCsv(decisions: ReviewDecision[]): string {
  const head = ["authority", "pin_id", "decision", "block_id", "vine_row", "driving_aisle", "side", "reason", "source",
    "acknowledged_warnings", "reviewer", "reviewer_user_id", "reviewed_at", "snap_latitude", "snap_longitude", "snap_sync_version",
    "snap_updated_at", "snap_geometry_fingerprint", "notice"];
  return [head.join(","), ...decisions.map((d) => [AUTHORITY, d.pin_id, d.decision, d.block_id, d.vine_row,
    d.driving_aisle, d.side, d.reason, d.source, d.acknowledged_warnings.join("|"), d.reviewer, d.reviewer_user_id, d.reviewed_at,
    d.snapshot.latitude, d.snapshot.longitude, d.snapshot.sync_version, d.snapshot.updated_at,
    d.snapshot.geometry_fingerprint, DRAFT_NOTICE].map(csvCell).join(","))].join("\n");
}

export interface ImportResult {
  accepted: ReviewDecision[];
  stale: { pin_id: string; fields: string[] }[];
  rejected: { pin_id: string | null; reason: string }[];
}

// ---------- strict schema validation of UNTRUSTED drafts (localStorage + imports) ----------
const isStr = (v: any) => typeof v === "string";
const isNumOrNull = (v: any) => v === null || (typeof v === "number" && Number.isFinite(v));
const isStrOrNull = (v: any) => v === null || typeof v === "string";
const SOURCES: DecisionSource[] = ["measured", "reviewed_track", "manual_field_check"];
const DECISION_KEYS = ["authority", "pin_id", "decision", "block_id", "vine_row", "driving_aisle", "side", "reason",
  "source", "acknowledged_warnings", "reviewer", "reviewer_user_id", "reviewed_at", "snapshot", "field_confirmation"];
const SNAP_KEYS: (keyof PinSnapshot)[] = ["pin_id", "vineyard_id", "latitude", "longitude", "sync_version", "updated_at",
  "paddock_id", "row_number", "pin_row_number", "driving_row_number", "pin_side", "side", "location_scope",
  "snapped_latitude", "snapped_longitude", "segments", "geometry_fingerprint", "geometry_source"];

/** Returns null when the object is a well-formed decision, else the first schema problem. */
export function schemaError(d: any): string | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "not an object";
  const extra = Object.keys(d).filter((k) => !DECISION_KEYS.includes(k));
  if (extra.length) return `unexpected field(s) ${extra.join(", ")}`;
  if (d.authority !== AUTHORITY) return "authority must be operator_approved_draft";
  if (!isStr(d.pin_id) || !d.pin_id) return "pin_id";
  if (!(typeof d.decision === "string" && Object.prototype.hasOwnProperty.call(DECISION_LABEL, d.decision))) return "decision";
  if (!isStrOrNull(d.block_id)) return "block_id";
  if (!isNumOrNull(d.vine_row)) return "vine_row";
  if (!isNumOrNull(d.driving_aisle)) return "driving_aisle";
  if (!(d.side === null || d.side === "left" || d.side === "right")) return "side";
  if (!isStr(d.reason)) return "reason";
  if (d.field_confirmation != null && (!d.field_confirmation || ["observed_by", "observed_at", "method", "note"].some((k) => typeof d.field_confirmation[k] !== "string" || !d.field_confirmation[k].trim()) || Number.isNaN(Date.parse(d.field_confirmation.observed_at)))) return "field_confirmation";
  if (!(d.source === null || SOURCES.includes(d.source))) return "source";
  if (!Array.isArray(d.acknowledged_warnings) || d.acknowledged_warnings.some((w: any) => !(typeof w === "string" && w in WARNING_LABEL))) return "acknowledged_warnings";
  if (!isStr(d.reviewer)) return "reviewer";
  if (!isStr(d.reviewer_user_id) || !d.reviewer_user_id) return "reviewer_user_id";
  if (!isStr(d.reviewed_at) || Number.isNaN(Date.parse(d.reviewed_at))) return "reviewed_at";
  const sn = d.snapshot;
  if (!sn || typeof sn !== "object" || Array.isArray(sn)) return "snapshot";
  if (Object.keys(sn).some((k) => !SNAP_KEYS.includes(k as any))) return "snapshot has unexpected fields";
  if (sn.pin_id !== d.pin_id) return "snapshot pin id mismatch";
  if (sn.vineyard_id !== RECOVERY_VINEYARD_ID) return "snapshot vineyard";
  return null;
}

export interface CurrentState {
  serverReport?: ServerReconstructionReport | null;
  current: Map<string, CurrentPin>;
  paddocks: any[];
  /** Signed-in auth user id. */
  userId: string | null;
  /** True only when pins, blocks, capture evidence AND row segments are all loaded without error. */
  evidenceReady: boolean;
}
export type DraftIssueKind = "rejected" | "stale" | "invalid" | "other_account";
export interface DraftIssue { pin_id: string | null; kind: DraftIssueKind; reason: string }
export interface ReconcileResult { accepted: ReviewDecision[]; issues: DraftIssue[] }

/**
 * Re-validate untrusted drafts against CURRENT live data. Used on cold load from
 * localStorage and on import. Nothing is accepted until evidence/segments are ready.
 * Accepted means "displayable as a local draft" — never confirmed or approved.
 */
export function reconcileDrafts(raw: unknown[], st: CurrentState): ReconcileResult {
  const out: ReconcileResult = { accepted: [], issues: [] };
  if (!st.userId) { out.issues.push({ pin_id: null, kind: "rejected", reason: "Not signed in — drafts not shown" }); return out; }
  const seen = new Set<string>();
  for (const d of raw) {
    const pid = d && typeof (d as any).pin_id === "string" ? (d as any).pin_id : null;
    const se = schemaError(d);
    if (se) { out.issues.push({ pin_id: pid, kind: "rejected", reason: `Malformed decision (${se})` }); continue; }
    const dec = d as ReviewDecision;
    if (dec.reviewer_user_id !== st.userId) { out.issues.push({ pin_id: pid, kind: "other_account", reason: "Saved by a different account — not shown; re-review as yourself" }); continue; }
    if (seen.has(dec.pin_id)) { out.issues.push({ pin_id: pid, kind: "rejected", reason: "Duplicate pin" }); continue; }
    seen.add(dec.pin_id);
    if (!st.evidenceReady) { out.issues.push({ pin_id: pid, kind: "invalid", reason: "Evidence/segments not loaded — draft held for revalidation" }); continue; }
    const c = st.current.get(dec.pin_id);
    if (!c || !c.row) { out.issues.push({ pin_id: pid, kind: "rejected", reason: "Pin not in current missing-row queue (deleted, moved or already has a row)" }); continue; }
    const now = snapshotOf(c.pin, reviewPaddock(c.pin, dec.block_id, st.paddocks), c.segs, c.row.geometrySource);
    const diff = snapshotDiff(dec.snapshot, now);
    if (diff.length) { out.issues.push({ pin_id: pid, kind: "stale", reason: `changed since review (${diff.join(", ")})` }); continue; }
    const v = validateDecision(c.row, dec, st.paddocks, st.serverReport);
    if (v.length) { out.issues.push({ pin_id: pid, kind: "invalid", reason: v.join(" ") }); continue; }
    out.accepted.push(dec);
  }
  return out;
}

/** Parse an exported JSON draft file (untrusted) and reconcile it. */
export function importDraftJson(text: string, st: CurrentState): ReconcileResult {
  let f: any;
  try { f = JSON.parse(text); } catch { return { accepted: [], issues: [{ pin_id: null, kind: "rejected", reason: "Not valid JSON" }] }; }
  if (!f || f.format !== DRAFT_FORMAT || f.version !== DRAFT_VERSION || f.authority !== AUTHORITY)
    return { accepted: [], issues: [{ pin_id: null, kind: "rejected", reason: "Unrecognised draft format/version" }] };
  if (f.vineyard_id !== RECOVERY_VINEYARD_ID) return { accepted: [], issues: [{ pin_id: null, kind: "rejected", reason: "Draft is for a different vineyard" }] };
  if (!Array.isArray(f.decisions)) return { accepted: [], issues: [{ pin_id: null, kind: "rejected", reason: "No decisions array" }] };
  return reconcileDrafts(f.decisions, st);
}

/** Parse raw localStorage text into an array of untrusted entries. */
export function parseStoredDrafts(text: string | null): unknown[] {
  if (!text) return [];
  try { const o = JSON.parse(text); return o && typeof o === "object" && !Array.isArray(o) ? Object.values(o) : []; } catch { return []; }
}

// ---------- writeback PREFLIGHT (read-only) ----------
export type PreflightOutcome = "structurally_eligible" | "conflict" | "not_approval";
export interface PreflightItem { pin_id: string; outcome: PreflightOutcome; checks: string[] }
export interface PreflightReport { items: PreflightItem[]; eligible: number; conflict: number; notApproval: number; ready: boolean }
export const PREFLIGHT_NOTICE =
  "Structurally eligible means the local draft passes safety checks, not that it is applied. Server dry-run, explicit owner approval and typed apply are required.";

export function writebackPreflight(raw: unknown[], st: CurrentState): PreflightReport {
  const items: PreflightItem[] = [];
  for (const d0 of raw) {
    const pid = d0 && typeof (d0 as any).pin_id === "string" ? (d0 as any).pin_id : "(unknown)";
    const se = schemaError(d0);
    if (se) { items.push({ pin_id: pid, outcome: "conflict", checks: [`malformed draft (${se})`] }); continue; }
    const d = d0 as ReviewDecision;
    if (!st.userId || d.reviewer_user_id !== st.userId) { items.push({ pin_id: pid, outcome: "conflict", checks: ["draft not saved by the signed-in account"] }); continue; }
    if (d.decision !== "approve_for_writeback") { items.push({ pin_id: d.pin_id, outcome: "not_approval", checks: [DECISION_LABEL[d.decision]] }); continue; }
    const fails: string[] = [];
    if (!st.evidenceReady) fails.push("evidence/segments not fully loaded — cannot be eligible");
    const c = st.current.get(d.pin_id);
    if (!c) fails.push("pin no longer live / visible");
    else {
      const p = c.pin;
      if (String(p.id) !== d.pin_id) fails.push("pin id mismatch");
      if (String(p.vineyard_id) !== RECOVERY_VINEYARD_ID) fails.push("pin not in Stockman's Ridge");
      if (p.deleted_at) fails.push("pin deleted");
      if (n(p.row_number) != null || n(p.pin_row_number) != null) fails.push("pin now has a saved row");
      if (n(p.driving_row_number) != null) fails.push("pin now has a saved aisle");
      if (c.segs == null) fails.push("row segments unreadable — cannot rule out existing segments");
      else if (c.segs.length) fails.push("pin has saved row segments");
      if (p.location_scope === "row") fails.push("pin location_scope is row");
      if (p.paddock_id && d.block_id !== p.paddock_id) fails.push(`${BLOCK_CONFLICT}: draft block differs from the current saved block`);
      const diff = snapshotDiff(d.snapshot, snapshotOf(p, reviewPaddock(p, d.block_id, st.paddocks), c.segs, c.row?.geometrySource ?? d.snapshot.geometry_source));
      if (diff.length) fails.push(`changed since review (${diff.join(", ")}) — re-review`);
      if (!c.row) fails.push("pin not assessable");
      else fails.push(...validateDecision(c.row, d, st.paddocks, st.serverReport));
    }
    items.push({ pin_id: d.pin_id, outcome: fails.length ? "conflict" : "structurally_eligible",
      checks: fails.length ? fails : ["format ok", "own account", "row exists in block", "inside current block polygon", "adjacency ok", "side not contradicted", "snapshot unchanged", "no saved row/segments"] });
  }
  return {
    items, ready: st.evidenceReady,
    eligible: items.filter((i) => i.outcome === "structurally_eligible").length,
    conflict: items.filter((i) => i.outcome === "conflict").length,
    notApproval: items.filter((i) => i.outcome === "not_approval").length,
  };
}
