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

/* ------------------------------------------------ Rork finalised contract */

export type BackfillStatus =
  | "preview_ready"
  | "already_complete"
  | "no_material_change"
  | "manufacturer_label_not_found"
  | "identity_conflict"
  | "evidence_conflict"
  | "unknown";

export const BACKFILL_STATUS_MESSAGE: Partial<Record<BackfillStatus, string>> = {
  already_complete: "This Master record is already complete for the current enrichment criteria.",
  no_material_change: "No new evidence-backed changes were found.",
  manufacturer_label_not_found:
    "The product was identified, but a trusted manufacturer label could not be found.",
  identity_conflict:
    "The manufacturer evidence does not match this Master registration identity. Nothing has been changed.",
  evidence_conflict:
    "New evidence conflicts with existing Master data and requires review. Nothing has been changed.",
};

const KNOWN: BackfillStatus[] = [
  "preview_ready", "already_complete", "no_material_change",
  "manufacturer_label_not_found", "identity_conflict", "evidence_conflict",
];

const o = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
};
const asList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => {
        if (typeof x === "string") return x;
        const e = o(x);
        return str(e.message) ?? str(e.detail) ?? str(e.field) ?? JSON.stringify(x);
      })
    : [];

export interface BackfillView {
  status: BackfillStatus;
  statusMessage: string | null;
  lockedIdentity: string | null;
  reportedRegistrationNumber: string | null;
  registrationMismatch: boolean;
  manufacturerLabelUrl: string | null;
  source: string | null;
  conflicts: string[];
  remaining: string[];
  findings: string[];
  /** Apply is permitted only for preview_ready (or legacy unknown) with a preview id. */
  canApply: boolean;
}

function identityText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  const e = o(v);
  const key = [e.registration_country ?? e.country, e.registration_scheme ?? e.scheme, e.registration_number ?? e.number]
    .map(str).filter(Boolean).join(" · ");
  const name = str(e.registered_product_name ?? e.product_name ?? e.name);
  return [name, key].filter(Boolean).join(" — ") || null;
}

/** Read Rork's nested evidence/findings/status. Informational — never infers states. */
export function readBackfillView(
  preview: MasterReviewPreview,
  storedRegistration: string | null | undefined,
  fallbackIdentity: string | null,
): BackfillView {
  const raw = o(preview.raw);
  const inner = o(raw.preview ?? raw.data);
  const s = { ...raw, ...inner };
  const ev = o(s.evidence);
  const f = o(s.findings);
  const statusRaw = String(s.status ?? s.outcome ?? "").trim().toLowerCase();
  const status: BackfillStatus = (KNOWN as string[]).includes(statusRaw) ? (statusRaw as BackfillStatus) : "unknown";

  const reported = str(ev.reported_registration_number);
  const stored = str(storedRegistration);
  const findings: string[] = [];
  if (f.classified) findings.push("Resistance classification resolved");
  if (f.not_applicable) findings.push("No resistance group applies");
  if (f.vineyard_rates_added) findings.push("Vineyard rates found");
  if (f.no_vineyard_use) findings.push("No vineyard registration found");

  const conflicts = asList(ev.conflicts);
  const legacyConflicts = conflicts.length ? conflicts : asList(s.conflicts ?? preview.proposedPatch?.verification_conflicts);

  return {
    status,
    statusMessage: BACKFILL_STATUS_MESSAGE[status] ?? null,
    lockedIdentity:
      identityText(ev.locked_identity) ?? str(s.registration_identity_key) ?? fallbackIdentity,
    reportedRegistrationNumber: reported,
    registrationMismatch: !!reported && !!stored && reported.toLowerCase() !== stored.toLowerCase(),
    manufacturerLabelUrl: str(ev.manufacturer_label_url ?? s.manufacturer_label_url),
    source: str(ev.source ?? s.evidence_source),
    conflicts: legacyConflicts,
    remaining: asList(s.remaining_unresolved ?? s.unresolved_fields ?? preview.proposedPatch?.verification_unresolved_fields),
    findings,
    canApply: (status === "preview_ready" || status === "unknown") && !!preview.previewId,
  };
}
