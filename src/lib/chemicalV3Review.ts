// Chemical V3 — approved list, actionable review decisions and front-label
// choice. Portal only calls the live RPCs; it never decides an issue is
// resolved by itself and never picks a front image on the operator's behalf.
import { supabase } from "@/integrations/ios-supabase/client";

type Row = Record<string, any>;
const sb = supabase as any;

export const V3_REVIEW_RPC = {
  approvedCatalogue: "chemical_v3_admin_approved_catalogue",
  issues: "chemical_v3_admin_review_issues",
  resolveIssue: "chemical_v3_resolve_review_issue",
  frontLabels: "chemical_v3_available_front_labels",
  setFrontLabel: "chemical_v3_set_front_label_image",
} as const;

export const APPROVED_TOAST = "Approved for the V3 catalogue";
export const DECISIONS_REQUIRED = "Complete the review decisions before approving this product.";

async function rpc(name: string, args?: Row): Promise<any> {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
const list = (d: any): Row[] => (Array.isArray(d) ? d : d ? [d] : []);

export const fetchApprovedCatalogue = async () => list(await rpc(V3_REVIEW_RPC.approvedCatalogue));
export const fetchReviewIssues = async (revisionId: string) => list(await rpc(V3_REVIEW_RPC.issues, { p_revision_id: revisionId }));
export const fetchFrontLabels = async (revisionId: string) => list(await rpc(V3_REVIEW_RPC.frontLabels, { p_revision_id: revisionId }));

export async function resolveReviewIssue(issueId: string, decision: string, note: string | null, payload: Row | null) {
  await rpc(V3_REVIEW_RPC.resolveIssue, { p_issue_id: issueId, p_decision: decision, p_note: note, p_payload: payload });
}
export async function setFrontLabelImage(revisionId: string, storagePath: string) {
  await rpc(V3_REVIEW_RPC.setFrontLabel, { p_revision_id: revisionId, p_storage_path: storagePath });
}

export const V3_MATCH_RPC = "chemical_v3_match_revision_to_catalogue";
export const MATCH_TOAST = "Matched to existing VineTrack catalogue product.";
export const MATCH_CONFIRM_TEXT =
  "The newly discovered revision will be superseded and vineyard chemicals linked to it will be moved to the approved VineTrack catalogue entry.\n\nExisting vineyard operational data and Saved Chemical identity are preserved.";
export async function matchRevisionToCatalogue(revisionId: string, catalogueProductId: string, note: string | null) {
  await rpc(V3_MATCH_RPC, { p_revision_id: revisionId, p_catalogue_product_id: catalogueProductId, p_note: note });
}
export interface CatalogueMatch { productId: string; revisionId: string | null; name: string | null; manufacturer: string | null; score: number | null; reason: string; confidence: "high" | "possible" }
const HIGH_REASONS = ["same_product_approved_revision", "same_registration"];
/** Catalogue match from a review-queue row; null when there's no matched product. */
export function catalogueMatchOf(row: Row | null | undefined): CatalogueMatch | null {
  const id = row?.catalogue_match_product_id;
  const reason = String(row?.catalogue_match_reason ?? "").toLowerCase();
  if (id == null || !reason) return null;
  if (!HIGH_REASONS.includes(reason) && reason !== "close_name_manufacturer") return null;
  return {
    productId: String(id), revisionId: row?.catalogue_match_revision_id != null ? String(row.catalogue_match_revision_id) : null,
    name: row?.catalogue_match_name ?? null, manufacturer: row?.catalogue_match_manufacturer ?? null,
    score: row?.catalogue_match_score != null ? Number(row.catalogue_match_score) : null,
    reason, confidence: HIGH_REASONS.includes(reason) ? "high" : "possible",
  };
}

/** The revision a row of the approved list points to — never looked up elsewhere. */
export function approvedRevisionId(row: Row): string | null {
  const id = row?.approved_revision_id ?? row?.revision_id ?? row?.id;
  return id == null ? null : String(id);
}

/** Superseded / historical revisions never belong in Pending Review. */
export function isPendingQueueRow(row: Row): boolean {
  const s = String(row?.review_status ?? row?.status ?? "").toLowerCase();
  return s !== "superseded" && s !== "approved" && s !== "rejected";
}

/** "manufacturer_label_identity" → "Manufacturer label identity". */
export function humaniseFieldKey(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (!/[_]/.test(s) && /\s/.test(s)) return s;
  const words = s.replace(/[_.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface IssueAction {
  decision: string; label: string;
  /** link = open manufacturer label; add_rate = open the rate editor (no RPC); confirm = ask first, then resolve. */
  kind: "resolve" | "correction" | "chooser" | "link" | "add_rate" | "confirm";
  confirmText?: string;
}

export const CONFIRM_NO_RATES_TEXT = "Confirm that the manufacturer label contains no vineyard/grapevine use rate for this product.";
export const MANUFACTURER_LABEL_NOTE = "The manufacturer hosts this label in an external document viewer. Confirm that the link opens the correct official manufacturer label.";
export const NO_VINEYARD_RATE_NOTE = "No usable vineyard rate has been recorded yet.";

const actionType = (issue: Row) => String(issue?.action_type ?? "").trim().toLowerCase();
const issueKey = (issue: Row) => String(issue?.issue_key ?? issue?.field_key ?? "").trim().toLowerCase();
export const isManufacturerLabelIssue = (i: Row) => actionType(i) === "confirm_manufacturer_label" || /(^|:)manufacturer_label$/.test(issueKey(i));
export const isVineyardRatesIssue = (i: Row) => actionType(i) === "resolve_vineyard_rates" || /(^|:)vineyard_rates$/.test(issueKey(i));

/** Each review decision always has at least one action. Decision codes come from action_type, not the button label. */
export function issueActions(issue: Row): IssueAction[] {
  const fix: IssueAction = { decision: "needs_correction", label: "Needs correction", kind: "correction" };
  const at = actionType(issue);
  if (isManufacturerLabelIssue(issue)) return [
    { decision: "open_label", label: "Open Manufacturer Label", kind: "link" },
    { decision: "confirm_official_link", label: "Confirm official manufacturer label", kind: "resolve" },
    fix,
  ];
  if (isVineyardRatesIssue(issue)) return [
    { decision: "add_rate", label: "+ Add vineyard rate", kind: "add_rate" },
    { decision: "confirm_no_vineyard_rates", label: "Confirm no vineyard rate", kind: "confirm", confirmText: CONFIRM_NO_RATES_TEXT },
    fix,
  ];
  if (at === "resolve_field") return [{ decision: "resolved", label: "Mark resolved", kind: "resolve" }, fix];
  if (at === "acknowledge") return [{ decision: "acknowledged", label: "Reviewed", kind: "resolve" }];
  const k = `${at} ${issueKey(issue)}`;
  if (k.includes("front")) return [{ decision: "selected", label: "Choose front label", kind: "chooser" }];
  if (k.includes("identity")) return [{ decision: "confirm_correct", label: "Confirm this is the correct label", kind: "resolve" }, fix];
  if (k.includes("label_date") || k.includes("label date") || k.includes("newer")) return [
    { decision: "use_current_label", label: "Use this manufacturer label", kind: "resolve" },
    { decision: "needs_newer_label", label: "Find / review newer label", kind: "correction" },
  ];
  if (k.includes("re_entry") || k.includes("reentry") || k.includes("not_stated")) return [{ decision: "confirm_not_stated", label: "Confirm not stated on label", kind: "resolve" }, fix];
  if (k.includes("complete") || k.includes("extraction")) return [{ decision: "acknowledged", label: "Reviewed", kind: "resolve" }, fix];
  return [{ decision: "acknowledged", label: "Reviewed", kind: "resolve" }];
}

export interface FingerprintView { tone: "ok" | "review" | "na"; value: string; note: string | null }
/** Label SHA presentation. Never fabricates a SHA; absence is informational, not a red core-field error. */
export function labelFingerprintView(revision: Row | null | undefined, issues: Row[]): FingerprintView {
  const sha = revision?.label_sha256 ?? revision?.label_sha;
  if (sha) return { tone: "ok", value: String(sha), note: null };
  const labelIssue = issues.find(isManufacturerLabelIssue);
  if (labelIssue && issueState(labelIssue) === "resolved") return { tone: "na", value: "Not captured — manufacturer-hosted viewer", note: null };
  return { tone: "review", value: "Not captured", note: "VineTrack could not download the underlying PDF from the manufacturer's document viewer." };
}

export type IssueState = "open" | "resolved" | "needs_correction";
export function issueState(issue: Row): IssueState {
  const s = String(issue?.status ?? "").toLowerCase();
  const code = String(issue?.resolution_code ?? "").toLowerCase();
  if (code === "needs_correction" || code === "needs_newer_label" || s === "needs_correction") return "needs_correction";
  if (s === "resolved" || s === "acknowledged" || s === "closed" || (code && s !== "open")) return "resolved";
  return "open";
}

/** Unresolved fields that already have a structured review decision are shown there only. */
export function outstandingWithoutIssue(unresolved: unknown[], issues: Row[]): string[] {
  const keys = new Set(issues.flatMap((i) => [i?.issue_key, i?.field_key].filter(Boolean).map((x: any) => String(x).toLowerCase())));
  return unresolved
    .map((u) => (typeof u === "string" ? u : (u as Row)?.field ?? (u as Row)?.key ?? (u as Row)?.label ?? ""))
    .filter((u) => u && !keys.has(String(u).toLowerCase()))
    .map(humaniseFieldKey);
}

/** Approval refused because review decisions remain open. */
export function isDecisionsRefusal(e: any): boolean {
  const t = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details ?? ""} ${e?.hint ?? ""}`.toLowerCase();
  return /review[ _]?(decision|issue)|unresolved|issues? remain|outstanding/.test(t);
}

export function frontLabelPath(row: Row): string | null {
  return row?.storage_path ?? row?.image_path ?? row?.path ?? null;
}
export function frontLabelCaption(row: Row): string {
  const p = row?.physical_page ?? row?.page_number ?? row?.page;
  return p != null ? `Physical page ${p}` : row?.label ?? "Label image";
}

/** The vineyard chemical created from this V3 product, matched by stored id only (never by name). Live columns: saved_chemicals.chemical_v3_product_id / chemical_v3_revision_id. */
export function findSavedForV3(saved: Row[], revision: Row | null | undefined): Row | null {
  if (!revision) return null;
  const ids = new Set([revision.id, revision.revision_id, revision.product_id, revision.v3_product_id].filter(Boolean).map(String));
  if (!ids.size) return null;
  const cols = ["v3_revision_id", "chemical_v3_revision_id", "source_revision_id", "v3_product_id", "chemical_v3_product_id", "source_product_id"];
  return saved.find((s) => cols.some((c) => s?.[c] != null && ids.has(String(s[c])))) ?? null;
}

/** Same cache entry the Chemicals page uses, so an Add to Vineyard refresh is shared. */
export const vineyardChemicalsKey = (vineyardId: string | null) => ["saved_chemicals", vineyardId, "active"] as const;

/** Revision states in which Approve / Reject / Review note are offered. */
export const V3_DECIDABLE_STATUSES = ["pending_review", "needs_attention"] as const;
export type V3ApprovalPanel = "decide" | "approved" | "superseded" | "rejected" | "readonly";
/** Which approval panel the drawer shows for a revision status. Post-approval review notes never change this. */
export function approvalPanelFor(status: string | null | undefined): V3ApprovalPanel {
  const s = String(status ?? "").toLowerCase();
  if ((V3_DECIDABLE_STATUSES as readonly string[]).includes(s)) return "decide";
  if (s === "approved") return "approved";
  if (s === "superseded") return "superseded";
  if (s === "rejected") return "rejected";
  return "readonly";
}
