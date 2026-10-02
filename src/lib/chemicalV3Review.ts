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

export interface IssueAction { decision: string; label: string; kind: "resolve" | "correction" | "chooser" }

/** Each review decision always has at least one action. */
export function issueActions(issue: Row): IssueAction[] {
  const k = `${issue?.action_type ?? ""} ${issue?.issue_key ?? ""}`.toLowerCase();
  const fix: IssueAction = { decision: "needs_correction", label: "Needs correction", kind: "correction" };
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

/** The vineyard chemical created from this V3 product, matched by stored id only (never by name). */
export function findSavedForV3(saved: Row[], revision: Row | null | undefined): Row | null {
  if (!revision) return null;
  const ids = new Set([revision.id, revision.revision_id, revision.product_id, revision.v3_product_id].filter(Boolean).map(String));
  if (!ids.size) return null;
  const cols = ["v3_revision_id", "chemical_v3_revision_id", "source_revision_id", "v3_product_id", "chemical_v3_product_id", "source_product_id"];
  return saved.find((s) => cols.some((c) => s?.[c] != null && ids.has(String(s[c])))) ?? null;
}

/** Same cache entry the Chemicals page uses, so an Add to Vineyard refresh is shared. */
export const vineyardChemicalsKey = (vineyardId: string | null) => ["saved_chemicals", vineyardId, "active"] as const;
