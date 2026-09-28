// "Find Missing Data" — Master-ID-anchored enrichment preview (Rork contract).
//
//   1. PREVIEW  — `chemical-info-lookup` { action: "master_backfill_preview_v2",
//      master_chemical_id }. The client names the record by id ONLY: no search
//      text, no patch, no loose name research. The backend stores the preview.
//   2. APPLY    — the existing audited `master_review_apply(preview_id,
//      master_id, reason)` path (applyMasterReviewPreview). No patch is sent.
//
// The action may not be deployed yet; that is detected and reported cleanly.

import { supabase } from "@/integrations/ios-supabase/client";
import { parseMasterReviewPreview, type MasterReviewPreview } from "@/lib/masterReviewPreview";

export const BACKFILL_FUNCTION = "chemical-info-lookup";
export const BACKFILL_ACTION = "master_backfill_preview_v2";
export const BACKFILL_UNAVAILABLE_MESSAGE =
  "The Master Catalogue enrichment service is not yet available on this environment.";

export const buildBackfillBody = (masterId: string) => ({
  action: BACKFILL_ACTION,
  master_chemical_id: masterId,
});

export type BackfillResult =
  | { outcome: "preview"; preview: MasterReviewPreview }
  | { outcome: "unavailable"; message: string }
  | { outcome: "error"; message: string };

const UNAVAILABLE =
  /unknown action|unsupported action|invalid action|not (yet )?(available|implemented|supported|deployed)|unrecognised action|unrecognized action|no such action|function not found|\b404\b/i;

async function errorText(error: any, data: any): Promise<string> {
  const parts: string[] = [];
  if (data && typeof data === "object" && typeof data.error === "string") parts.push(data.error);
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.status === "number") parts.push(String(ctx.status));
    if (ctx && typeof ctx.clone === "function") {
      const body = await ctx.clone().text();
      if (body) parts.push(body);
    }
  } catch {
    /* ignore unreadable body */
  }
  if (error?.message) parts.push(String(error.message));
  return parts.join(" ");
}

export function isBackfillUnavailable(text: string): boolean {
  return UNAVAILABLE.test(text) && /action|function|available|implemented|deployed|404/i.test(text);
}

/** Ask for a server-owned preview. Never writes. */
export async function requestMasterBackfillPreview(masterId: string): Promise<BackfillResult> {
  if (!masterId) return { outcome: "error", message: "No Master record selected." };
  let data: any;
  let error: any;
  try {
    ({ data, error } = await supabase.functions.invoke(BACKFILL_FUNCTION, {
      body: buildBackfillBody(masterId),
    }));
  } catch (e: any) {
    return { outcome: "unavailable", message: BACKFILL_UNAVAILABLE_MESSAGE };
  }
  if (error || (data && typeof data === "object" && typeof data.error === "string")) {
    const t = await errorText(error, data);
    if (isBackfillUnavailable(t)) return { outcome: "unavailable", message: BACKFILL_UNAVAILABLE_MESSAGE };
    return { outcome: "error", message: (data?.error as string) || "The enrichment preview could not be produced." };
  }
  const preview = parseMasterReviewPreview(data);
  if (!preview.previewId && isBackfillUnavailable(String(preview.message ?? ""))) {
    return { outcome: "unavailable", message: BACKFILL_UNAVAILABLE_MESSAGE };
  }
  return { outcome: "preview", preview };
}
