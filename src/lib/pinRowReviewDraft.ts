// Stage 1 review register — LOCAL DRAFT decisions + read-only writeback PREFLIGHT.
//
// Nothing here writes to the database. Decisions are operator_approved_draft,
// never server-confirmed. Files exported here are unsigned, non-authoritative
// working copies for resuming review.
import { parseRows } from "@/lib/paddockGeometry";
import { RECOVERY_VINEYARD_ID, type RecoveryRow, triadOf } from "@/lib/pinRowRecovery";

export type DecisionKind = "approve_for_writeback" | "hold" | "needs_field_verification" | "preserve_existing";
export type DecisionSource = "measured" | "reviewed_track" | "manual_field_check";
export const DECISION_LABEL: Record<DecisionKind, string> = {
  approve_for_writeback: "Approve for writeback (draft)",
  hold: "Hold",
  needs_field_verification: "Needs field verification",
  preserve_existing: "Preserve existing",
};
export const DRAFT_FORMAT = "vinetrack.pin-row-review-draft";
export const DRAFT_VERSION = 1;
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
  reviewer: string;
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
export function validateDecision(r: RecoveryRow, input: DecisionInput, paddocks: any[]): string[] {
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
  return e;
}

export function buildDecision(
  r: RecoveryRow, input: DecisionInput, reviewer: string, paddocks: any[],
  segs: any[] | null, now: Date = new Date(),
): ReviewDecision {
  const pad = paddocks.find((p) => p.id === (r.pin.paddock_id ?? input.block_id)) ?? null;
  return {
    authority: AUTHORITY,
    pin_id: r.id,
    ...input,
    reason: input.reason.trim(),
    reviewer,
    reviewed_at: now.toISOString(),
    snapshot: snapshotOf(r.pin, pad, segs, r.geometrySource),
  };
}

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
    "acknowledged_warnings", "reviewer", "reviewed_at", "snap_latitude", "snap_longitude", "snap_sync_version",
    "snap_updated_at", "snap_geometry_fingerprint", "notice"];
  return [head.join(","), ...decisions.map((d) => [AUTHORITY, d.pin_id, d.decision, d.block_id, d.vine_row,
    d.driving_aisle, d.side, d.reason, d.source, d.acknowledged_warnings.join("|"), d.reviewer, d.reviewed_at,
    d.snapshot.latitude, d.snapshot.longitude, d.snapshot.sync_version, d.snapshot.updated_at,
    d.snapshot.geometry_fingerprint, DRAFT_NOTICE].map(csvCell).join(","))].join("\n");
}

export interface ImportResult {
  accepted: ReviewDecision[];
  stale: { pin_id: string; fields: string[] }[];
  rejected: { pin_id: string | null; reason: string }[];
}

/** Parse + reconcile an exported JSON draft against the current live data. */
export function importDraftJson(
  text: string,
  current: { pin: any; paddock: any | null; segs: any[] | null; row: RecoveryRow | null }[],
): ImportResult {
  const out: ImportResult = { accepted: [], stale: [], rejected: [] };
  let f: any;
  try { f = JSON.parse(text); } catch { out.rejected.push({ pin_id: null, reason: "Not valid JSON" }); return out; }
  if (f?.format !== DRAFT_FORMAT || f?.version !== DRAFT_VERSION) { out.rejected.push({ pin_id: null, reason: "Unrecognised draft format/version" }); return out; }
  if (f.vineyard_id !== RECOVERY_VINEYARD_ID) { out.rejected.push({ pin_id: null, reason: "Draft is for a different vineyard" }); return out; }
  const byId = new Map(current.map((c) => [String(c.pin.id), c]));
  const seen = new Set<string>();
  for (const d of Array.isArray(f.decisions) ? f.decisions : []) {
    const id = typeof d?.pin_id === "string" ? d.pin_id : null;
    if (!id || !d.snapshot || d.authority !== AUTHORITY || !(d.decision in DECISION_LABEL)) {
      out.rejected.push({ pin_id: id, reason: "Malformed decision" }); continue;
    }
    if (seen.has(id)) { out.rejected.push({ pin_id: id, reason: "Duplicate pin in file" }); continue; }
    seen.add(id);
    if (d.snapshot.pin_id !== id) { out.rejected.push({ pin_id: id, reason: "Snapshot pin id mismatch" }); continue; }
    const c = byId.get(id);
    if (!c || !c.row) { out.rejected.push({ pin_id: id, reason: "Pin not in current missing-row queue (deleted, moved or already has a row)" }); continue; }
    const now = snapshotOf(c.pin, c.paddock, c.segs, c.row.geometrySource);
    const diff = snapshotDiff(d.snapshot, now);
    if (diff.length) { out.stale.push({ pin_id: id, fields: diff }); continue; }
    out.accepted.push(d as ReviewDecision);
  }
  return out;
}

// ---------- writeback PREFLIGHT (read-only) ----------
export type PreflightOutcome = "eligible_pending_owner" | "conflict" | "not_approval";
export interface PreflightItem { pin_id: string; outcome: PreflightOutcome; checks: string[] }
export interface PreflightReport { items: PreflightItem[]; eligible: number; conflict: number; notApproval: number }

export function writebackPreflight(
  decisions: ReviewDecision[],
  current: Map<string, { pin: any; paddock: any | null; segs: any[] | null; row: RecoveryRow | null }>,
  paddocks: any[],
): PreflightReport {
  const items: PreflightItem[] = [];
  for (const d of decisions) {
    if (d.decision !== "approve_for_writeback") { items.push({ pin_id: d.pin_id, outcome: "not_approval", checks: [DECISION_LABEL[d.decision]] }); continue; }
    const c = current.get(d.pin_id);
    const fails: string[] = [];
    if (!c) fails.push("pin no longer live / visible");
    else {
      const p = c.pin;
      if (String(p.vineyard_id) !== RECOVERY_VINEYARD_ID) fails.push("pin not in Stockman's Ridge");
      if (p.deleted_at) fails.push("pin deleted");
      if (n(p.row_number) != null || n(p.pin_row_number) != null) fails.push("pin now has a saved row");
      if (n(p.driving_row_number) != null) fails.push("pin now has a saved aisle");
      if (c.segs == null) fails.push("row segments unreadable — cannot rule out existing segments");
      else if (c.segs.length) fails.push("pin has saved row segments");
      if (p.location_scope === "row") fails.push("pin location_scope is row");
      const diff = snapshotDiff(d.snapshot, snapshotOf(p, c.paddock, c.segs, d.snapshot.geometry_source));
      if (diff.length) fails.push(`changed since review (${diff.join(", ")}) — re-review`);
      if (c.row) {
        const v = validateDecision(c.row, d, paddocks);
        fails.push(...v);
      }
    }
    items.push({ pin_id: d.pin_id, outcome: fails.length ? "conflict" : "eligible_pending_owner",
      checks: fails.length ? fails : ["row exists in block", "adjacency ok", "snapshot unchanged", "no saved row/segments"] });
  }
  return {
    items,
    eligible: items.filter((i) => i.outcome === "eligible_pending_owner").length,
    conflict: items.filter((i) => i.outcome === "conflict").length,
    notApproval: items.filter((i) => i.outcome === "not_approval").length,
  };
}
