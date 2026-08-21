// Master Catalogue Review — R2-C2 actions + correction UX.
//
// R2-C1 gave the admin a staged Preview + Apply. R2-C2 adds the *safe* write
// actions the shared VineTrack backend (SQL 203) already exposes, and — just
// as importantly — says plainly when there is NO action available so a warning
// never looks actionable when it is not.
//
// Live SQL 203 signatures, verified against the shared project's schema cache:
//
//   public.master_review_correct(p_expected_revision, p_master_id, p_patch, p_reason)
//   public.master_review_adjudicate(p_conflict, p_expected_revision, p_field,
//                                   p_master_id, p_reason, p_selected)
//   public.master_review_rekey(p_expected_revision, p_master_id, p_new_country,
//                              p_new_number, p_new_scheme, p_reason)
//   public.master_chemical_review_actions  (review timeline, RLS-gated)
//
// Everything runs under the signed-in admin's JWT on the shared project. The
// portal never sends authoritative evidence: a manual correction is always
// recorded by the backend as `manual_entry`, never as official evidence.
//
// Deliberately NOT implemented (backend returns `typed_handler_missing`):
// registered uses, rates, withholding periods, re-entry intervals, active
// ingredients and activity groups are typed/evidence-level structures and
// cannot be hand-edited from the portal.

import { supabase } from "@/integrations/ios-supabase/client";
import {
  fetchMasterChemical,
  masterIdentityKey,
  masterRevision,
  normaliseReviewStatus,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";
import type { ClassifiedConflict } from "@/lib/masterReview";
import type { WriteConflict } from "@/lib/chemicalIntelligenceWrite";

export const MASTER_REVIEW_CORRECT_RPC = "master_review_correct";
export const MASTER_REVIEW_ADJUDICATE_RPC = "master_review_adjudicate";
export const MASTER_REVIEW_REKEY_RPC = "master_review_rekey";
export const MASTER_REVIEW_ACTIONS_TABLE = "master_chemical_review_actions";

/* ------------------------------------------------------- action taxonomy */

export type MasterActionKind =
  | "resolved_automatically"
  | "refresh_from_apvma"
  | "admin_correction_available"
  | "admin_decision_required"
  | "not_manually_resolvable";

export const MASTER_ACTION_LABEL: Record<MasterActionKind, string> = {
  resolved_automatically: "Resolved automatically",
  refresh_from_apvma: "Refresh from APVMA",
  admin_correction_available: "Admin correction available",
  admin_decision_required: "Admin decision required",
  not_manually_resolvable: "Cannot be manually resolved yet",
};

export const MASTER_ACTION_DETAIL: Record<MasterActionKind, string> = {
  resolved_automatically:
    "The authoritative source already wins — no admin action is required.",
  refresh_from_apvma:
    "The Master record is stale. Run Preview APVMA update — the authoritative resolver may resolve this.",
  admin_correction_available:
    "This field can be corrected by an admin. Corrections are recorded as manual entry, never as official evidence.",
  admin_decision_required:
    "An admin must record which evidence stands. Selecting an authoritative value is not available yet.",
  not_manually_resolvable:
    "Requires typed / evidence-level backend support. It cannot be edited or adjudicated from the portal yet.",
};

/* -------------------------------------------------------- editable fields */

export type MasterCorrectableField =
  | "common_names"
  | "product_category"
  | "form_type"
  | "label_reference"
  | "label_version"
  | "review_notes"
  | "registrant"
  | "registered_product_name";

export interface MasterCorrectableFieldSpec {
  key: MasterCorrectableField;
  label: string;
  help: string;
  /** Comma-separated list persisted as a text[] patch value. */
  list?: boolean;
  multiline?: boolean;
  /** Only offered when jurisdiction / lifecycle rules allow it. */
  identity?: boolean;
}

export const MASTER_CORRECTABLE_FIELDS: MasterCorrectableFieldSpec[] = [
  {
    key: "common_names",
    label: "Common names",
    help: "Comma-separated alternate trade names growers may search for.",
    list: true,
  },
  { key: "product_category", label: "Product category", help: "e.g. fungicide, insecticide, herbicide." },
  { key: "form_type", label: "Form type", help: "e.g. SC, WG, EC." },
  {
    key: "label_reference",
    label: "Label reference",
    help: "Absolute http(s) link to the registered label PDF.",
  },
  { key: "label_version", label: "Label version", help: "Label revision as printed on the PDF." },
  { key: "review_notes", label: "Review notes", help: "Internal review commentary.", multiline: true },
  {
    key: "registrant",
    label: "Registrant",
    help: "Only correctable while the record is an unapproved candidate.",
    identity: true,
  },
  {
    key: "registered_product_name",
    label: "Registered product name",
    help: "Only correctable while the record is an unapproved candidate.",
    identity: true,
  },
];

/**
 * Registrant / product name touch registration identity. The backend refuses
 * them once a record is approved (the registration is then load-bearing for
 * linked Saved Chemicals), so the portal only offers them for candidates.
 */
export const identityFieldsCorrectable = (row: MasterChemicalRow): boolean =>
  normaliseReviewStatus(row.review_status) === "candidate";

export function correctableFieldsFor(row: MasterChemicalRow): MasterCorrectableFieldSpec[] {
  const identityOk = identityFieldsCorrectable(row);
  return MASTER_CORRECTABLE_FIELDS.filter((f) => !f.identity || identityOk);
}

const CORRECTABLE_KEYS = new Set<string>(MASTER_CORRECTABLE_FIELDS.map((f) => f.key));

/** Field aliases the backend uses inside unresolved lists / conflicts. */
const FIELD_ALIASES: Record<string, MasterCorrectableField> = {
  label: "label_reference",
  label_url: "label_reference",
  label_reference: "label_reference",
  label_version: "label_version",
  common_names: "common_names",
  common_name: "common_names",
  product_category: "product_category",
  category: "product_category",
  form_type: "form_type",
  formulation: "form_type",
  formulation_type: "form_type",
  registrant: "registrant",
  product_name: "registered_product_name",
  registered_product_name: "registered_product_name",
  review_notes: "review_notes",
};

/** Typed / evidence-level structures SQL 203 refuses to hand-edit. */
const TYPED_ONLY = [
  "active_ingredient",
  "active_ingredients",
  "activity_group",
  "activity_groups",
  "constituent",
  "concentration",
];

/** Fields a fresh APVMA resolve is expected to fill. */
const REFRESHABLE = [
  "registered_use",
  "registered_uses",
  "rate",
  "rates",
  "withholding",
  "whp",
  "re_entry",
  "rei",
  "verified_at",
  "retrieved_at",
];

const norm = (field: unknown) => String(field ?? "").trim().toLowerCase();

const hits = (field: string, needles: string[]) => needles.some((n) => field.includes(n));

export function correctableFieldFor(field: unknown): MasterCorrectableField | null {
  const n = norm(field).replace(/\s+/g, "_");
  const direct = FIELD_ALIASES[n] ?? (CORRECTABLE_KEYS.has(n) ? (n as MasterCorrectableField) : null);
  return direct ?? null;
}

/** Registration identity conflicts must never be adjudicated generically. */
export function isIdentityField(field: unknown): boolean {
  const n = norm(field);
  return (
    n.includes("registration_number") ||
    n.includes("registration_identity") ||
    n.includes("registration_scheme") ||
    n.includes("registration_country")
  );
}

export interface MasterIssueAction {
  kind: MasterActionKind;
  label: string;
  detail: string;
  /** Field the correction dialog should open on, when correctable. */
  correctField: MasterCorrectableField | null;
  /** True when `master_review_adjudicate` accepts this conflict. */
  adjudicable: boolean;
}

const action = (
  kind: MasterActionKind,
  over: Partial<MasterIssueAction> = {},
): MasterIssueAction => ({
  kind,
  label: MASTER_ACTION_LABEL[kind],
  detail: MASTER_ACTION_DETAIL[kind],
  correctField: null,
  adjudicable: false,
  ...over,
});

/** What can an admin actually do about an unresolved / missing field? */
export function unresolvedFieldAction(
  field: unknown,
  row: MasterChemicalRow,
): MasterIssueAction {
  const n = norm(field);
  const correct = correctableFieldFor(field);
  if (correct && correctableFieldsFor(row).some((f) => f.key === correct)) {
    return action("admin_correction_available", { correctField: correct });
  }
  if (hits(n, TYPED_ONLY)) return action("not_manually_resolvable");
  if (hits(n, REFRESHABLE)) {
    return masterIdentityKey(row)
      ? action("refresh_from_apvma")
      : action("not_manually_resolvable");
  }
  if (isIdentityField(n)) {
    return action("admin_decision_required", {
      detail:
        "Registration identity cannot be adjudicated. Use the guarded identity correction, or retire and re-create the record.",
    });
  }
  return action("not_manually_resolvable");
}

/** What can an admin actually do about a classified evidence conflict? */
export function conflictAction(
  item: ClassifiedConflict,
  row: MasterChemicalRow,
): MasterIssueAction {
  const field = item.conflict.field;
  if (item.klass === "auto_resolved") return action("resolved_automatically");
  if (item.klass === "unresolved_missing") return unresolvedFieldAction(field, row);

  // decision_required
  if (isIdentityField(field)) {
    return action("admin_decision_required", {
      detail: identityFieldsCorrectable(row)
        ? "Registration identity conflicts are never adjudicated generically. Use the guarded identity correction below."
        : "Registration identity conflicts cannot be adjudicated. An approved or linked record must be retired and re-created rather than silently re-keyed.",
    });
  }
  if (hits(norm(field), TYPED_ONLY)) return action("not_manually_resolvable");
  return action("admin_decision_required", { adjudicable: true });
}

/* --------------------------------------------------------------- outcomes */

export type MasterActionOutcome =
  | "ok"
  | "revision_mismatch"
  | "typed_handler_missing"
  | "identity_locked"
  | "not_permitted"
  | "invalid_field"
  | "failed";

export const MASTER_ACTION_MESSAGE: Record<MasterActionOutcome, string> = {
  ok: "Saved. The Master record has a new revision.",
  revision_mismatch:
    "The Master record changed while this screen was open. Reload the record and try again.",
  typed_handler_missing:
    "The backend has no typed handler for this field yet — it cannot be corrected or adjudicated from the portal.",
  identity_locked:
    "The backend refused this change because it would alter a locked registration identity.",
  not_permitted: "The backend refused this change for your account.",
  invalid_field: "The backend does not accept a manual correction for this field.",
  failed: "The change did not complete.",
};

export function classifyActionOutcome(raw: unknown): MasterActionOutcome {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return "failed";
  if (s.includes("typed_handler_missing")) return "typed_handler_missing";
  if (s.includes("revision_mismatch") || s.includes("stale_revision")) return "revision_mismatch";
  if (s.includes("identity") && (s.includes("locked") || s.includes("refused") || s.includes("rekey")))
    return "identity_locked";
  if (s.includes("invalid_field") || s.includes("unsupported_field")) return "invalid_field";
  if (
    s.includes("not_authorised") ||
    s.includes("not_authorized") ||
    s.includes("42501") ||
    s.includes("permission") ||
    s.includes("denied")
  )
    return "not_permitted";
  if (s.includes("ok") || s.includes("applied") || s.includes("success") || s.includes("corrected"))
    return "ok";
  return "failed";
}

export interface MasterActionResult {
  outcome: MasterActionOutcome;
  message: string;
  row: MasterChemicalRow | null;
  raw: unknown;
}

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};

async function callReviewRpc(
  fn: string,
  args: Record<string, unknown>,
  masterId: string,
): Promise<MasterActionResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("Your session has expired. Sign in again before recording a review action.");
  }
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) {
    const outcome = classifyActionOutcome(`${error.code ?? ""} ${error.message ?? ""}`);
    return {
      outcome: outcome === "ok" ? "failed" : outcome,
      message:
        outcome === "failed"
          ? error.message || MASTER_ACTION_MESSAGE.failed
          : MASTER_ACTION_MESSAGE[outcome],
      row: null,
      raw: error,
    };
  }
  const payload = Array.isArray(data) ? obj(data[0]) : obj(data);
  const status = payload.status ?? payload.outcome ?? payload.result ?? payload.error ?? data ?? "ok";
  const outcome = classifyActionOutcome(status);
  return {
    outcome,
    message:
      (typeof payload.message === "string" && payload.message.trim()) ||
      MASTER_ACTION_MESSAGE[outcome],
    row: outcome === "ok" ? await fetchMasterChemical(masterId) : null,
    raw: data,
  };
}

/* -------------------------------------------------------------- correct */

export interface MasterCorrectionInput {
  row: MasterChemicalRow;
  patch: Partial<Record<MasterCorrectableField, string | string[] | null>>;
  reason: string;
}

/** Normalise the typed form values into the SQL 203 patch shape. */
export function buildCorrectionPatch(
  input: Partial<Record<MasterCorrectableField, string>>,
): Record<string, string | string[] | null> {
  const patch: Record<string, string | string[] | null> = {};
  for (const spec of MASTER_CORRECTABLE_FIELDS) {
    const raw = input[spec.key];
    if (raw === undefined) continue;
    const value = (raw ?? "").trim();
    if (spec.list) {
      const list = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      patch[spec.key] = list.length ? list : null;
    } else {
      patch[spec.key] = value === "" ? null : value;
    }
  }
  return patch;
}

export async function correctMasterFields(
  input: MasterCorrectionInput,
): Promise<MasterActionResult> {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("A correction reason is required.");
  const patch = input.patch ?? {};
  const keys = Object.keys(patch);
  if (!keys.length) throw new Error("Nothing to correct — change at least one field.");
  const allowed = new Set(correctableFieldsFor(input.row).map((f) => f.key));
  const bad = keys.filter((k) => !allowed.has(k as MasterCorrectableField));
  if (bad.length) {
    throw new Error(`These fields cannot be corrected from the portal: ${bad.join(", ")}.`);
  }
  return callReviewRpc(
    MASTER_REVIEW_CORRECT_RPC,
    {
      p_master_id: input.row.id,
      p_expected_revision: masterRevision(input.row) ?? null,
      p_patch: patch,
      p_reason: reason,
    },
    input.row.id,
  );
}

/* ------------------------------------------------------------ adjudicate */

/**
 * SQL 203 adjudication decisions. Authoritative selection is intentionally not
 * exposed — the backend returns `typed_handler_missing` for it.
 */
export type MasterAdjudicationDecision = "stored" | "superseded_by_refresh";

export const MASTER_ADJUDICATION_LABEL: Record<MasterAdjudicationDecision, string> = {
  stored: "Keep the stored value",
  superseded_by_refresh: "Superseded by a later APVMA refresh",
};

export const MASTER_ADJUDICATION_HELP: Record<MasterAdjudicationDecision, string> = {
  stored: "Records that the value already stored on the Master record stands. Nothing is overwritten.",
  superseded_by_refresh:
    "Records that this conflict was settled by a later authoritative refresh and no longer needs review.",
};

export interface MasterAdjudicationInput {
  row: MasterChemicalRow;
  field: string;
  conflict: WriteConflict | Record<string, unknown>;
  decision: MasterAdjudicationDecision;
  reason: string;
}

export async function adjudicateMasterConflict(
  input: MasterAdjudicationInput,
): Promise<MasterActionResult> {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("An adjudication reason is required.");
  if (isIdentityField(input.field)) {
    throw new Error(
      "Registration identity conflicts cannot be adjudicated. Use the guarded identity correction, or retire and re-create the record.",
    );
  }
  return callReviewRpc(
    MASTER_REVIEW_ADJUDICATE_RPC,
    {
      p_master_id: input.row.id,
      p_expected_revision: masterRevision(input.row) ?? null,
      p_field: input.field,
      p_conflict: input.conflict ?? {},
      p_selected: input.decision,
      p_reason: reason,
    },
    input.row.id,
  );
}

/* ----------------------------------------------------------------- rekey */

export interface MasterRekeyEligibility {
  allowed: boolean;
  reason: string;
}

/**
 * Re-keying rewrites the registration identity. It is only ever offered for an
 * unapproved candidate that no Saved Chemical is linked to — anything else must
 * be retired and re-created so linked growers are never silently re-pointed.
 */
export function rekeyEligibility(
  row: MasterChemicalRow,
  linkedSavedCount: number | null | undefined,
): MasterRekeyEligibility {
  if (normaliseReviewStatus(row.review_status) !== "candidate") {
    return {
      allowed: false,
      reason:
        "Only unapproved candidates can be re-keyed. Retire this record and create the correct registration instead.",
    };
  }
  if ((linkedSavedCount ?? 0) > 0) {
    return {
      allowed: false,
      reason:
        "Saved Chemicals are linked to this record. Retire it and create the correct registration — linked growers are never silently re-keyed.",
    };
  }
  if (linkedSavedCount == null) {
    return { allowed: false, reason: "Checking linked Saved Chemicals…" };
  }
  return { allowed: true, reason: "Unlinked candidate — the guarded re-key is available." };
}

export interface MasterRekeyInput {
  row: MasterChemicalRow;
  country: string;
  scheme: string;
  number: string;
  reason: string;
}

export async function rekeyMasterIdentity(
  input: MasterRekeyInput,
): Promise<MasterActionResult> {
  const reason = (input.reason ?? "").trim();
  const country = (input.country ?? "").trim().toUpperCase();
  const scheme = (input.scheme ?? "").trim().toLowerCase();
  const number = (input.number ?? "").trim();
  if (!reason) throw new Error("A re-key reason is required.");
  if (!country || !scheme || !number) {
    throw new Error("Country, scheme and registration number are all required to re-key.");
  }
  return callReviewRpc(
    MASTER_REVIEW_REKEY_RPC,
    {
      p_master_id: input.row.id,
      p_expected_revision: masterRevision(input.row) ?? null,
      p_new_country: country,
      p_new_scheme: scheme,
      p_new_number: number,
      p_reason: reason,
    },
    input.row.id,
  );
}

/** How many Saved Chemicals point at this Master record. */
export async function countLinkedSavedChemicals(masterId: string): Promise<number> {
  const { count, error } = await (supabase as any)
    .from("saved_chemicals")
    .select("id", { count: "exact", head: true })
    .eq("master_chemical_id", masterId);
  if (error) throw error;
  return count ?? 0;
}

/* --------------------------------------------------------------- history */

export interface MasterReviewActionRow {
  id: string;
  master_chemical_id?: string | null;
  action?: string | null;
  action_type?: string | null;
  field?: string | null;
  conflict_field?: string | null;
  selected?: string | null;
  decision?: string | null;
  reason?: string | null;
  base_revision?: number | string | null;
  result_revision?: number | string | null;
  created_at?: string | null;
  performed_at?: string | null;
  performed_by?: string | null;
  reviewer_id?: string | null;
  reviewer_email?: string | null;
  [key: string]: unknown;
}

export interface MasterReviewTimelineEntry {
  id: string;
  action: string;
  reviewer: string;
  at: string | null;
  reason: string | null;
  target: string | null;
  baseRevision: number | null;
  resultRevision: number | null;
}

const numeric = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const label = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s.replace(/_/g, " ") : "";
};

export function toReviewTimeline(rows: MasterReviewActionRow[]): MasterReviewTimelineEntry[] {
  return rows.map((r, i) => ({
    id: String(r.id ?? i),
    action: label(r.action ?? r.action_type) || "Review action",
    reviewer:
      String(r.reviewer_email ?? "").trim() ||
      String(r.performed_by ?? r.reviewer_id ?? "").trim() ||
      "Unknown reviewer",
    at: (r.performed_at as string) ?? (r.created_at as string) ?? null,
    reason: String(r.reason ?? "").trim() || null,
    target:
      label(r.field ?? r.conflict_field) ||
      (label(r.selected ?? r.decision) ? `decision: ${label(r.selected ?? r.decision)}` : null) ||
      null,
    baseRevision: numeric(r.base_revision),
    resultRevision: numeric(r.result_revision),
  }));
}

export async function fetchMasterReviewActions(
  masterChemicalId: string,
): Promise<MasterReviewTimelineEntry[]> {
  const { data, error } = await (supabase as any)
    .from(MASTER_REVIEW_ACTIONS_TABLE)
    .select("*")
    .eq("master_chemical_id", masterChemicalId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return toReviewTimeline((data ?? []) as MasterReviewActionRow[]);
}

/* ------------------------------------------------- approval-gap treatment */

/**
 * Map an `approvalReadiness` reason (free text mirrored from the backend's
 * rules) onto the action taxonomy so an evidence gap never looks actionable
 * when nothing can be done about it from the portal.
 */
export function readinessReasonAction(
  reason: string,
  row: MasterChemicalRow,
): MasterIssueAction {
  const n = norm(reason);
  if (n.includes("label reference")) return unresolvedFieldAction("label_reference", row);
  if (n.includes("registrant")) return unresolvedFieldAction("registrant", row);
  if (n.includes("frac") || n.includes("hrac") || n.includes("irac") || n.includes("group"))
    return unresolvedFieldAction("activity_group", row);
  if (n.includes("active ingredient")) return unresolvedFieldAction("active_ingredients", row);
  if (n.includes("registration identity")) return unresolvedFieldAction("registration_number", row);
  if (n.includes("verification conflict"))
    return action("admin_decision_required", {
      detail: "Resolve the listed evidence conflicts below before approving.",
    });
  if (n.includes("unresolved fields"))
    return action("refresh_from_apvma", {
      detail: MASTER_ACTION_DETAIL.refresh_from_apvma,
    });
  return action("not_manually_resolvable");
}
