// Master Catalogue Review — R2-C1 staged Preview + Apply.
//
// Replaces the old write-through "Refresh from APVMA" flow. The portal no
// longer asks the backend to write during review. Instead:
//
//   1. PREVIEW  — `chemical-info-lookup` with `action: "master_review_preview"`
//      on the shared VineTrack project. The backend resolves current APVMA /
//      LD-2 data, stores a server-side preview, and returns current values,
//      proposed values, a change list, the base revision it was computed
//      against, an identity-guard verdict and an expiry. The client NEVER
//      sends a patch or proposed values, and the returned `proposed_patch` is
//      DISPLAY ONLY.
//
//   2. APPLY    — `master_review_apply(preview_id, master_id, reason)` RPC,
//      executed with the signed-in admin's JWT (the shared-project client
//      below carries the admin session; service-role credentials are never
//      used from the browser and are not available here). The authoritative
//      patch is never sent back — SQL applies the stored preview by id.
//
// Nothing here adjudicates conflicts, corrects fields, or re-keys identity.

import { supabase } from "@/integrations/ios-supabase/client";
import { fetchMasterChemical, type MasterChemicalRow } from "@/lib/masterChemicals";
import { withClientDiagnostics } from "@/lib/chemicalLookupRequest";

const LOOKUP_FUNCTION = "chemical-info-lookup";
export const MASTER_REVIEW_APPLY_RPC = "master_review_apply";

/* ------------------------------------------------------------ preview I/O */

export interface MasterReviewPreviewBody {
  action: "master_review_preview";
  master_chemical_id: string;
  /** Identity echo so the backend can refuse a mismatched preview. */
  registration_country?: string;
  registration_scheme?: string;
  registration_number?: string;
  product_name?: string;
}

/**
 * Exact preview request body. Deliberately carries no patch, no proposed
 * values and no review status — the client only names the record.
 */
export function buildMasterReviewPreviewBody(
  row: MasterChemicalRow,
): MasterReviewPreviewBody {
  const t = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? undefined : s;
  };
  return {
    action: "master_review_preview",
    master_chemical_id: row.id,
    registration_country: t(row.registration_country),
    registration_scheme: t(row.registration_scheme),
    registration_number: t(row.registration_number),
    product_name: t(row.registered_product_name),
  };
}

export type IdentityGuardStatus = "match" | "rekey_required" | "mismatch" | "unknown";

export const IDENTITY_GUARD_LABEL: Record<IdentityGuardStatus, string> = {
  match: "Identity confirmed",
  rekey_required: "Identity re-key required",
  mismatch: "Identity mismatch",
  unknown: "Identity not confirmed",
};

export interface MasterPreviewChange {
  field: string;
  label: string;
  current: string | null;
  proposed: string | null;
  /** Attribution reported by the resolver, when present. */
  source?: string | null;
  /** Untouched wire values — used for structured (non-JSON) rendering. */
  currentRaw?: unknown;
  proposedRaw?: unknown;
}

export interface MasterIdentity {
  country: string | null;
  scheme: string | null;
  number: string | null;
  productName: string | null;
}

export const identityEmpty = (i: MasterIdentity | null): boolean =>
  !i || (!i.country && !i.scheme && !i.number && !i.productName);

export const formatIdentity = (i: MasterIdentity | null): string => {
  if (identityEmpty(i)) return "Not reported";
  const id = i as MasterIdentity;
  const key = [id.country, id.scheme, id.number].filter(Boolean).join(" · ");
  return [id.productName, key].filter(Boolean).join(" — ") || "Not reported";
};

export interface MasterReviewPreview {
  /** Server-side preview id — the only thing Apply sends back. */
  previewId: string | null;
  masterChemicalId: string | null;
  baseRevision: number | null;
  currentValues: Record<string, unknown>;
  /** DISPLAY ONLY. Never sent to SQL. */
  proposedPatch: Record<string, unknown>;
  changes: MasterPreviewChange[];
  identityGuard: IdentityGuardStatus;
  identityGuardDetail: string | null;
  /** Which identity check failed (country / scheme / number / product name). */
  identityFailedCheck: string | null;
  /** Identity currently stored on the Master record, as echoed by the server. */
  identityStored: MasterIdentity | null;
  /** Identity the resolver matched against the source register. */
  identityResolved: MasterIdentity | null;
  expiresAt: string | null;
  /** False when the resolver had no source data / produced nothing writable. */
  writable: boolean;
  /** Backend message, surfaced verbatim. */
  message: string | null;
  raw: unknown;
}

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};

const text = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normaliseIdentityGuard(value: unknown): IdentityGuardStatus {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (["match", "matched", "ok", "confirmed", "pass", "true"].includes(s)) return "match";
  if (s.includes("rekey") || s.includes("re_key") || s.includes("re-key")) return "rekey_required";
  if (s.includes("mismatch") || s.includes("conflict") || s === "false") return "mismatch";
  return "unknown";
}

const humanLabel = (field: string) =>
  field.replace(/[_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function normaliseChanges(
  raw: unknown,
  current: Record<string, any>,
  proposed: Record<string, any>,
): MasterPreviewChange[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry): MasterPreviewChange | null => {
        if (typeof entry === "string") {
          return {
            field: entry,
            label: humanLabel(entry),
            current: text(current[entry]),
            proposed: text(proposed[entry]),
            source: null,
            currentRaw: current[entry],
            proposedRaw: proposed[entry],
          };
        }
        const e = obj(entry);
        const field = text(e.field ?? e.key ?? e.name) ?? "";
        if (!field) return null;
        return {
          field,
          label: text(e.label) ?? humanLabel(field),
          current: text(e.current ?? e.before ?? e.from ?? current[field]),
          proposed: text(e.proposed ?? e.after ?? e.to ?? proposed[field]),
          source: text(e.source ?? e.provenance ?? e.origin),
          currentRaw: e.current ?? e.before ?? e.from ?? current[field],
          proposedRaw: e.proposed ?? e.after ?? e.to ?? proposed[field],
        };
      })
      .filter((c): c is MasterPreviewChange => !!c);
  }

  if (raw && typeof raw === "object") {
    return Object.entries(obj(raw)).map(([field, v]) => {
      const e = obj(v);
      const hasPair = "current" in e || "proposed" in e || "before" in e || "after" in e;
      const currentRaw = hasPair ? (e.current ?? e.before) : current[field];
      const proposedRaw = hasPair ? (e.proposed ?? e.after) : v;
      return {
        field,
        label: humanLabel(field),
        current: text(currentRaw),
        proposed: text(proposedRaw),
        source: text(e.source ?? e.provenance),
        currentRaw,
        proposedRaw,
      };
    });
  }

  // No explicit change list: derive from the proposed patch (display only).
  return Object.keys(proposed).map((field) => ({
    field,
    label: humanLabel(field),
    current: text(current[field]),
    proposed: text(proposed[field]),
    source: null,
    currentRaw: current[field],
    proposedRaw: proposed[field],
  }));
}

function readIdentity(value: unknown): MasterIdentity | null {
  const v = obj(value);
  const identity: MasterIdentity = {
    country: text(v.registration_country ?? v.country ?? v.country_code),
    scheme: text(v.registration_scheme ?? v.scheme),
    number: text(v.registration_number ?? v.number ?? v.apvma_number),
    productName: text(v.registered_product_name ?? v.product_name ?? v.name),
  };
  return identityEmpty(identity) ? null : identity;
}

const IDENTITY_CHECK_LABEL: Record<string, string> = {
  registration_country: "Registration country",
  registration_scheme: "Registration scheme",
  registration_number: "Registration number",
  registered_product_name: "Registered product name",
};

function identityFailedCheck(
  s: Record<string, any>,
  current: Record<string, any>,
  proposed: Record<string, any>,
): string | null {
  const g = obj(s.identity_guard);
  const explicit = text(g.failed_check ?? g.field ?? g.check ?? s.identity_guard_field);
  if (explicit) return IDENTITY_CHECK_LABEL[explicit] ?? humanLabel(explicit);
  const stored = readIdentity(g.stored ?? g.master ?? g.expected ?? current);
  const resolved = readIdentity(g.resolved ?? g.actual ?? g.source ?? s.resolved_identity ?? proposed);
  if (!stored || !resolved) return null;
  const keys: (keyof MasterIdentity)[] = ["number", "country", "scheme", "productName"];
  const labels: Record<string, string> = {
    number: "Registration number",
    country: "Registration country",
    scheme: "Registration scheme",
    productName: "Registered product name",
  };
  for (const k of keys) {
    const a = stored[k];
    const b = resolved[k];
    if (a && b && a.toLowerCase() !== b.toLowerCase()) return labels[k];
  }
  return null;
}

/** Parse whatever the resolver returned into the preview view-model. */
export function parseMasterReviewPreview(payload: unknown): MasterReviewPreview {
  const root = obj(payload);
  const src = obj(root.preview ?? root.review_preview ?? root.data) ;
  const s = { ...root, ...src };

  const current = obj(s.current_values ?? s.current ?? s.master_current);
  const proposed = obj(s.proposed_patch ?? s.proposed_values ?? s.proposed ?? s.patch);
  const changes = normaliseChanges(s.changes ?? s.change_list ?? s.diff, current, proposed);

  const previewId = text(s.preview_id ?? s.previewId ?? s.id);
  const writableRaw = s.writable ?? s.is_writable ?? s.has_writable_preview;
  const writable =
    writableRaw == null ? !!previewId && changes.length > 0 : writableRaw === true;

  return {
    previewId,
    masterChemicalId: text(s.master_chemical_id ?? s.masterChemicalId),
    baseRevision: num(s.base_revision ?? s.baseRevision ?? s.catalogue_version),
    currentValues: current,
    proposedPatch: proposed,
    changes,
    identityGuard: normaliseIdentityGuard(
      obj(s.identity_guard).status ?? s.identity_guard_status ?? s.identity_guard,
    ),
    identityGuardDetail:
      text(obj(s.identity_guard).detail ?? obj(s.identity_guard).reason ?? s.identity_guard_reason),
    identityFailedCheck: identityFailedCheck(s, current, proposed),
    identityStored: readIdentity(
      obj(s.identity_guard).stored ?? obj(s.identity_guard).master ?? obj(s.identity_guard).expected ?? current,
    ),
    identityResolved: readIdentity(
      obj(s.identity_guard).resolved ??
        obj(s.identity_guard).actual ??
        obj(s.identity_guard).source ??
        s.resolved_identity ??
        proposed,
    ),
    expiresAt: text(s.expires_at ?? s.expiry ?? s.expiresAt),
    writable,
    message: text(s.message ?? root.message),
    raw: payload,
  };
}

export const previewExpired = (p: MasterReviewPreview, now: Date = new Date()): boolean => {
  if (!p.expiresAt) return false;
  const t = Date.parse(p.expiresAt);
  return Number.isFinite(t) && t <= now.getTime();
};

/** Can this preview be applied at all? */
export function previewApplyBlockedReason(p: MasterReviewPreview): string | null {
  if (!p.previewId) {
    return "The resolver did not return a writable preview for this record. Nothing can be applied.";
  }
  if (!p.writable || p.changes.length === 0) {
    return "No changes were proposed — there is nothing to apply.";
  }
  if (p.identityGuard === "mismatch" || p.identityGuard === "rekey_required") {
    return "The identity guard refused this preview. Registration re-keying is not available in this release.";
  }
  if (previewExpired(p)) {
    return "This preview has expired. Run the preview again.";
  }
  return null;
}

/** Ask the shared backend for a server-side preview. Never writes. */
export async function requestMasterReviewPreview(
  row: MasterChemicalRow,
): Promise<MasterReviewPreview> {
  const body = buildMasterReviewPreviewBody(row);
  const { data, error } = await supabase.functions.invoke(LOOKUP_FUNCTION, {
    body: withClientDiagnostics(body as unknown as Record<string, unknown>),
  });
  if (error) {
    const serverMsg = (data as any)?.error;
    throw new Error(
      typeof serverMsg === "string" && serverMsg
        ? serverMsg
        : "Preview source unavailable. The APVMA resolver could not be reached.",
    );
  }
  const err = text(obj(data).error);
  if (err) throw new Error(err);
  return parseMasterReviewPreview(data);
}

/* --------------------------------------------------------------- apply */

export type MasterApplyOutcome =
  | "applied"
  | "already_applied"
  | "preview_expired"
  | "preview_not_yours"
  | "revision_mismatch"
  | "preview_mismatch"
  | "identity_rekey_refused"
  | "not_permitted"
  | "source_unavailable"
  | "failed";

export const MASTER_APPLY_MESSAGE: Record<MasterApplyOutcome, string> = {
  applied: "Preview applied. The Master record has a new revision.",
  already_applied: "This preview was already applied — nothing changed.",
  preview_expired: "This preview has expired. Run the preview again and re-check the changes.",
  preview_not_yours: "This preview belongs to another admin. Run your own preview.",
  revision_mismatch:
    "The Master record changed since this preview was taken. Run the preview again.",
  preview_mismatch:
    "The stored preview does not match this Master record. Run the preview again.",
  identity_rekey_refused:
    "The backend refused the apply because the registration identity would change. Re-keying is not available in this release.",
  not_permitted: "The backend refused this apply for your account.",
  source_unavailable: "No writable preview is available — the source could not be resolved.",
  failed: "The apply did not complete.",
};

export function classifyApplyOutcome(raw: unknown): MasterApplyOutcome {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return "failed";
  if (s.includes("already_applied") || s.includes("already applied")) return "already_applied";
  if (s.includes("preview_expired") || s.includes("expired")) return "preview_expired";
  if (s.includes("preview_not_yours") || s.includes("not_yours")) return "preview_not_yours";
  if (s.includes("revision_mismatch")) return "revision_mismatch";
  if (s.includes("preview_mismatch")) return "preview_mismatch";
  if (s.includes("rekey") || s.includes("re_key") || s.includes("identity")) {
    return "identity_rekey_refused";
  }
  if (s.includes("no_writable_preview") || s.includes("source_unavailable") || s.includes("not_found")) {
    return "source_unavailable";
  }
  if (s.includes("permission") || s.includes("denied") || s.includes("42501") || s.includes("forbidden")) {
    return "not_permitted";
  }
  if (s.includes("applied") || s === "ok" || s === "success") return "applied";
  return "failed";
}

export interface MasterApplyResult {
  outcome: MasterApplyOutcome;
  message: string;
  /** Revision after the apply, when the backend reported one. */
  revision: number | null;
  row: MasterChemicalRow | null;
  raw: unknown;
}

export interface MasterApplyInput {
  previewId: string;
  masterId: string;
  reason: string;
}

/**
 * Apply the stored server preview.
 *
 * `master_review_apply(preview_id, master_id, reason)` runs under the signed-in
 * admin's JWT — the shared-project client is anon+session only, so a
 * service-role apply is impossible from here. No patch is transmitted.
 */
export async function applyMasterReviewPreview(
  input: MasterApplyInput,
): Promise<MasterApplyResult> {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("A review reason is required before applying.");
  if (!input.previewId) throw new Error("No stored preview to apply.");

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("Your session has expired. Sign in again before applying a review.");
  }

  // Live SQL203 signature (verified against the shared project's schema cache):
  //   public.master_review_apply(p_master_id, p_preview_id, p_reason)
  const { data, error } = await (supabase as any).rpc(MASTER_REVIEW_APPLY_RPC, {
    p_master_id: input.masterId,
    p_preview_id: input.previewId,
    p_reason: reason,
  });

  if (error) {
    const outcome = classifyApplyOutcome(`${error.code ?? ""} ${error.message ?? ""}`);
    return {
      outcome: outcome === "applied" ? "failed" : outcome,
      message:
        outcome === "failed"
          ? error.message || MASTER_APPLY_MESSAGE.failed
          : MASTER_APPLY_MESSAGE[outcome],
      revision: null,
      row: null,
      raw: error,
    };
  }

  const payload = Array.isArray(data) ? obj(data[0]) : obj(data);
  const statusRaw =
    payload.status ?? payload.outcome ?? payload.result ?? payload.error ?? data;
  const outcome = classifyApplyOutcome(statusRaw);
  const revision = num(payload.revision ?? payload.catalogue_version ?? payload.new_revision);

  const row =
    outcome === "applied" || outcome === "already_applied"
      ? await fetchMasterChemical(input.masterId)
      : null;

  return {
    outcome,
    message: text(payload.message) ?? MASTER_APPLY_MESSAGE[outcome],
    revision: revision ?? null,
    row,
    raw: data,
  };
}
