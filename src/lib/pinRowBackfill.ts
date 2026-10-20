// Stage 1 writeback — builds the bounded batch from re-validated local drafts and
// calls the audited server RPCs from sql/267. The browser never updates pins directly.
// Authorisation, CAS, projection and snapping are decided by the server only.
import { RECOVERY_VINEYARD_ID, normSide, triadOf, type RecoveryRow } from "@/lib/pinRowRecovery";
import { csvCell, type ReviewDecision } from "@/lib/pinRowReviewDraft";
import { candidateMatchesPin, supportedCandidate, type ServerReconstructionReport } from "@/lib/pinRowReconstruction";

export type BatchClass = "defensible_technical" | "manual_field_confirmed";
export interface BackfillItem {
  field_confirmation?: ReviewDecision["field_confirmation"];
  pin_id: string; paddock_id: string; pin_row_number: number; driving_row_number: number | null;
  pin_side: "left" | "right" | null; source: string; reason: string;
  expected_sync_version: string; expected_updated_at: string | null;
  expected_latitude: number; expected_longitude: number;
}
export interface BatchEntry { item: BackfillItem; cls: BatchClass; title: string; block: string | null }
export interface HoldEntry { pin_id: string; title: string; why: string }
export interface ProposedBatch { entries: BatchEntry[]; hold: HoldEntry[]; defensible: number; fieldConfirmed: number }

/** Technically defensible = GPS + qualified travel direction + left/right + saved block, and the row equals the pairing. */
export function isDefensible(r: RecoveryRow, d: ReviewDecision): boolean {
  const t = triadOf(r);
  return t.gps === "qualified" && t.direction === "qualified" && t.side === "qualified" && !!r.savedBlockName
    && r.suggestedVineRow != null && d.vine_row === r.suggestedVineRow && d.block_id === r.pin.paddock_id;
}

/**
 * Build the batch ONLY from drafts already re-validated for this account (accepted map).
 * Never fills a row from nearest geometry, never applies offsets, never invents a side.
 */
export function buildBatch(rows: RecoveryRow[], accepted: Record<string, ReviewDecision>, report?: ServerReconstructionReport | null): ProposedBatch {
  const entries: BatchEntry[] = []; const hold: HoldEntry[] = [];
  for (const r of rows) {
    const d = accepted[r.id];
    if (!d || d.decision !== "approve_for_writeback") {
      hold.push({ pin_id: r.id, title: r.title, why: d ? `draft: ${d.decision}` : r.status === "preserve_existing" ? "preserve existing metadata" : "no owner-reviewed row" });
      continue;
    }
    if (r.status === "preserve_existing" || r.pin.row_number != null || r.pin.pin_row_number != null || r.pin.driving_row_number != null || r.pin.location_scope === "row") {
      hold.push({ pin_id: r.id, title: r.title, why: "preserve existing metadata" }); continue;
    }
    const server = supportedCandidate(report ?? null, r.id);
    const defensible = report !== undefined ? !!server && candidateMatchesPin(server, r) && d.block_id === server.proposed_block_id &&
      d.vine_row === server.suggestion?.vine_row && d.driving_aisle === server.suggestion?.driving_aisle && d.side === server.side?.value : isDefensible(r, d);
    if (!defensible && d.source !== "manual_field_check") { hold.push({ pin_id: r.id, title: r.title, why: "evidence insufficient and not field-confirmed" }); continue; }
    if (report !== undefined && d.source === "manual_field_check" && (!d.field_confirmation ||
        [d.field_confirmation.observed_by, d.field_confirmation.observed_at, d.field_confirmation.method, d.field_confirmation.note].some((v) => !v?.trim()) || Number.isNaN(Date.parse(d.field_confirmation.observed_at)))) {
      hold.push({ pin_id: r.id, title: r.title, why: "explicit field confirmation missing" }); continue;
    }
    if (r.lat == null || r.lng == null || !d.block_id || d.vine_row == null) { hold.push({ pin_id: r.id, title: r.title, why: "incomplete" }); continue; }
    // Side: only send when it equals the recorded pin_side, or a field check supplies it.
    const recorded = normSide(r.pin.pin_side);
    const side = d.side && (d.side === recorded || d.source === "manual_field_check") ? d.side : null;
    entries.push({
      cls: defensible ? "defensible_technical" : "manual_field_confirmed", title: r.title, block: r.savedBlockName,
      item: {
        pin_id: r.id, paddock_id: d.block_id, pin_row_number: d.vine_row, driving_row_number: d.driving_aisle,
        pin_side: side, source: d.source ?? "", reason: d.reason,
        ...(d.field_confirmation ? { field_confirmation: d.field_confirmation } : {}),
        expected_sync_version: String(r.pin.sync_version ?? ""), expected_updated_at: r.pin.updated_at ?? null,
        expected_latitude: Number(r.pin.latitude), expected_longitude: Number(r.pin.longitude),
      },
    });
  }
  return { entries, hold, defensible: entries.filter((e) => e.cls === "defensible_technical").length,
    fieldConfirmed: entries.filter((e) => e.cls === "manual_field_confirmed").length };
}

export function batchCsv(b: ProposedBatch, dry?: Map<string, any>): string {
  const head = ["status", "class", "pin_id", "title", "block", "pin_row_number", "driving_row_number", "pin_side", "source",
    "reason", "expected_sync_version", "raw_latitude", "raw_longitude", "dry_run_outcome", "dry_run_fails", "snap_lat", "snap_lng", "note"];
  const note = "PROPOSED — not applied until owner confirms server apply";
  return [head.join(","),
    ...b.entries.map((e) => { const r = dry?.get(e.item.pin_id); return ["proposed", e.cls, e.item.pin_id, e.title, e.block, e.item.pin_row_number,
      e.item.driving_row_number, e.item.pin_side, e.item.source, e.item.reason, e.item.expected_sync_version,
      e.item.expected_latitude, e.item.expected_longitude, r?.outcome ?? "not run", (r?.fails ?? []).join("|"),
      r?.projection?.snapped_latitude, r?.projection?.snapped_longitude, note].map(csvCell).join(","); }),
    ...b.hold.map((h) => ["hold", "", h.pin_id, h.title, "", "", "", "", "", h.why, "", "", "", "", "", "", "", "unresolved — not written"].map(csvCell).join(","))].join("\n");
}

export const isMissingRpc = (e: any) => e?.code === "PGRST202" || /could not find the function/i.test(e?.message ?? "");

export async function dryRun(db: any, items: BackfillItem[]) {
  if (!items.length) return { data: null, error: { message: "No owner-approved items; no request sent." } };
  return db.rpc("pin_row_backfill_dry_run", { p_vineyard: RECOVERY_VINEYARD_ID, p_items: items });
}
export async function createApproval(db: any, items: BackfillItem[]) {
  if (!items.length) return { data: null, error: { message: "No owner-approved items; no approval created." } };
  return db.rpc("pin_row_backfill_create_approval", { p_vineyard: RECOVERY_VINEYARD_ID, p_items: items });
}
export async function applyApproval(db: any, approvalId: string, hash: string, phrase: string) {
  return db.rpc("pin_row_backfill_apply", { p_approval: approvalId, p_items_hash: hash, p_confirm: phrase });
}

/** Read back pins, placements and audit; a receipt counts only when all three agree. */
export async function verifyApplied(db: any, approvalId: string, receipts: { pin_id: string; outcome: string }[]) {
  const ids = receipts.map((r) => r.pin_id);
  const [pins, placements, audit] = await Promise.all([
    db.from("pins").select("id,pin_row_number,driving_row_number,pin_side,snapped_latitude,snapped_longitude,snapped_to_row,sync_version,latitude,longitude").in("id", ids),
    db.from("pin_placements").select("*").in("pin_id", ids),
    db.from("pin_row_backfill_audit").select("pin_id,outcome,after").eq("approval_id", approvalId),
  ]);
  const err = pins.error?.message ?? audit.error?.message ?? null;
  const pm = new Map((pins.data ?? []).map((p: any) => [String(p.id), p]));
  const am = new Map((audit.data ?? []).map((a: any) => [String(a.pin_id), a]));
  const verifiedReceipts = receipts.filter((r) => {
    const p: any = pm.get(r.pin_id); const a: any = am.get(r.pin_id);
    return p && a && p.pin_row_number != null && a.after?.pin_row_number === p.pin_row_number
      && (r.outcome !== "assigned_snapped" || p.snapped_to_row === true);
  });
  return { verified: verifiedReceipts.length, failedIds: receipts.filter((r) => !verifiedReceipts.includes(r)).map((r) => r.pin_id), total: receipts.length, placementRows: placements.error ? null : (placements.data ?? []).length,
    placementError: placements.error?.message ?? null, error: err };
}
