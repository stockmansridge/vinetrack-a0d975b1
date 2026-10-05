// Customer-facing Chemical Search helpers. Internal contracts are the
// chemical_v3_* RPCs / tables, but nothing in this module produces customer
// text containing internal names, raw database errors or "V3".
import { pick } from "@/lib/chemicalV3";

export const CHEMICAL_SEARCH_TITLE = "Add Chemical";
export const NOT_SEEN_BEFORE = "We couldn't find this product in the VineTrack catalogue.";
export const NOT_SEEN_BEFORE_DETAIL =
  "Let VineTrack AI find this product. We extract the vineyard label details for you to add to your vineyard. It will also be sent to VineTrack administrators for review and verification so it can be added to the VineTrack Catalogue.";
export const DISCOVERY_NOTE =
  "This product hasn't been seen before. Finding the manufacturer's information may take a little while. You can leave this page and come back.";
export const PENDING_REVIEW_LABEL = "Pending VineTrack review";
export const PENDING_REVIEW_NOTE =
  "This is a newly found product and is waiting for VineTrack catalogue review. You can add it to this vineyard now.";
export const CATALOGUE_LABEL = "VineTrack catalogue";
export const DISCOVERY_UNAVAILABLE =
  "Product discovery is temporarily unavailable. Try again or enter the product manually.";
export const DISCOVERY_FAILED =
  "We couldn't finish finding this product. You can retry or enter it manually.";
export const OWNER_MANAGER_ONLY = "Only an Owner or Manager can add chemicals to this vineyard.";
export const SEARCH_FAILED = "Chemical Search is temporarily unavailable. Try again or enter the product manually.";
export const ADD_FAILED = "This product couldn't be added. Try again or enter it manually.";
export const REUSED_DISCOVERY =
  "Someone has already started finding this product. We're using the same search instead of starting another.";

/** Statuses a customer can add (the database decides whether they actually may). */
export const CUSTOMER_ADDABLE = ["approved", "pending_review", "needs_attention"];
export function isCustomerAddable(status: unknown): boolean {
  return CUSTOMER_ADDABLE.includes(String(status ?? "").toLowerCase());
}
export function isPendingStatus(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "pending_review" || s === "needs_attention";
}

/** Customer-friendly progress wording from the backend's stage/status value. */
export function customerStage(stage: unknown, status?: unknown): string {
  const s = `${String(stage ?? "")} ${String(status ?? "")}`.toLowerCase();
  if (/fail|error|cancel/.test(s)) return "We couldn't finish finding this product";
  if (/pending_review|needs_attention|complete|done|finish/.test(s)) return "Finishing product details…";
  if (/rate/.test(s)) return "Preparing rates…";
  if (/direction|use|crop/.test(s)) return "Reading vineyard directions…";
  if (/extract|read|pars|product|detail/.test(s)) return "Reading product information…";
  if (/label|pdf|download/.test(s)) return "Finding the manufacturer label…";
  return "Searching manufacturer sources…";
}

/** Maps any backend error to customer wording. Never returns raw messages. */
export function customerError(e: unknown, kind: "search" | "discovery" | "add"): string {
  const m = String((e as any)?.message ?? (e as any)?.code ?? e ?? "").toLowerCase();
  if (/permission|not allowed|forbidden|owner|manager|42501|denied|not authori/.test(m)) return OWNER_MANAGER_ONLY;
  if (kind === "add") return ADD_FAILED;
  if (kind === "discovery") return DISCOVERY_UNAVAILABLE;
  return SEARCH_FAILED;
}

export function discoveryRevisionId(job: Record<string, any> | null | undefined): string | null {
  const v = pick(job, "revision_id", "product_revision_id", "candidate_revision_id");
  return v ? String(v) : null;
}

export function resultRevisionId(row: Record<string, any>): string | null {
  const v = pick(row, "revision_id", "current_revision_id", "approved_revision_id");
  return v ? String(v) : null;
}

/** "Added to X" / already-there message after chemical_v3_add_to_vineyard. */
export function addedMessage(reused: boolean, vineyardName: string | null): string {
  return reused ? "Already in this vineyard chemical list" : `Added to ${vineyardName ?? "this vineyard"}`;
}
