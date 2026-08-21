// Master Catalogue review model (Stage 1 — review UX only).
//
// Read-only projections over the SQL 199 / SQL 194 columns the shared
// VineTrack backend already stores. Nothing here writes: the only Master
// writes the portal has are `review_status` / `review_notes`
// (see `setMasterReviewStatus`) and the backend-owned APVMA refresh.
//
// Its job is to answer the question the current screen cannot: *what does an
// admin actually have to decide before approving this record?*

import {
  isAuthoritativeSource,
  type DataSourceKind,
  type WriteConflict,
} from "@/lib/chemicalIntelligenceWrite";
import {
  masterChemicalDraft,
  masterRevision,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";

/* -------------------------------------------------------------- safe URLs */

/**
 * Returns a rendered-as-a-link URL, or null. Only absolute http(s) URLs are
 * ever linked — a `javascript:` or `data:` reference stays plain text.
 */
export function safeExternalUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

/* ------------------------------------------------------ conflict taxonomy */

export type MasterConflictClass =
  | "auto_resolved" // authoritative source beats AI — no admin decision
  | "decision_required" // same-authority disagreement / ambiguous identity
  | "unresolved_missing"; // one side has no value: a gap, not a conflict

export const MASTER_CONFLICT_CLASS_LABEL: Record<MasterConflictClass, string> = {
  auto_resolved: "Resolved by source precedence",
  decision_required: "Admin decision required",
  unresolved_missing: "Missing information",
};

export interface ClassifiedConflict {
  conflict: WriteConflict;
  klass: MasterConflictClass;
  /** Value the catalogue holds after precedence has been applied. */
  winningValue: string | null;
  /** Value that precedence rejected (shown as rejected evidence). */
  rejectedValue: string | null;
  winningSource?: DataSourceKind;
  rejectedSource?: DataSourceKind;
  explanation: string;
}

const val = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" || s === "—" ? null : s;
};

/**
 * Classify one stored `verification_conflicts` entry.
 *
 * Rules (frontend presentation of the backend's stored precedence — this does
 * not change what the backend persisted):
 *   * official register / manufacturer label / authoritative classification
 *     versus AI or self-reported → the authoritative side already won.
 *   * both sides authoritative, or both non-authoritative → genuine ambiguity
 *     that an admin has to resolve.
 *   * either side empty → a missing field, reported as unresolved.
 */
export function classifyMasterConflict(conflict: WriteConflict): ClassifiedConflict {
  const extracted = val(conflict.extracted_value);
  const authoritative = val(conflict.authoritative_value);
  const extractedAuth = isAuthoritativeSource(conflict.extracted_source);
  const authorityAuth = isAuthoritativeSource(conflict.authoritative_source);

  if (!extracted || !authoritative) {
    return {
      conflict,
      klass: "unresolved_missing",
      winningValue: authoritative ?? extracted,
      rejectedValue: null,
      winningSource: authoritative ? conflict.authoritative_source : conflict.extracted_source,
      explanation:
        "Only one side of this comparison carries a value, so this is a missing field rather than a conflict.",
    };
  }

  if (extracted.toLowerCase() === authoritative.toLowerCase()) {
    return {
      conflict,
      klass: "auto_resolved",
      winningValue: authoritative,
      rejectedValue: null,
      winningSource: conflict.authoritative_source,
      explanation: "Both sources agree once formatting is ignored.",
    };
  }

  if (authorityAuth && !extractedAuth) {
    return {
      conflict,
      klass: "auto_resolved",
      winningValue: authoritative,
      rejectedValue: extracted,
      winningSource: conflict.authoritative_source,
      rejectedSource: conflict.extracted_source,
      explanation:
        "The authoritative source wins automatically. The other value is retained as rejected evidence only.",
    };
  }

  if (extractedAuth && !authorityAuth) {
    return {
      conflict,
      klass: "auto_resolved",
      winningValue: extracted,
      rejectedValue: authoritative,
      winningSource: conflict.extracted_source,
      rejectedSource: conflict.authoritative_source,
      explanation:
        "The authoritative source wins automatically. The other value is retained as rejected evidence only.",
    };
  }

  return {
    conflict,
    klass: "decision_required",
    winningValue: null,
    rejectedValue: null,
    winningSource: conflict.authoritative_source,
    rejectedSource: conflict.extracted_source,
    explanation: authorityAuth
      ? "Two authoritative sources disagree — an admin must decide which registration identity is correct."
      : "Neither source is authoritative — this value cannot be resolved automatically.",
  };
}

export function classifyMasterConflicts(row: MasterChemicalRow): ClassifiedConflict[] {
  return masterChemicalDraft(row).conflicts.map(classifyMasterConflict);
}

/* ---------------------------------------------------------- review summary */

export interface MasterReviewSummary {
  /** Conflicts a human must resolve. */
  decisionsRequired: number;
  /** Conflicts already settled by source precedence. */
  autoResolved: number;
  /** Unresolved / missing fields (stored list plus one-sided conflicts). */
  unresolvedFields: string[];
  /** Evidence gaps that would block approval per the backend's rules. */
  blockingReasons: string[];
  /** True when the record has an APVMA identity we can re-query. */
  refreshable: boolean;
  /** Set once a refresh has run in this session and produced changes. */
  fresherAvailable: boolean | null;
  headline: string;
}

export interface MasterReviewSummaryInput {
  /** Blocking reasons from `approvalReadiness` — the backend mirror. */
  blockingReasons?: string[];
  /** null = not checked yet this session. */
  fresherAvailable?: boolean | null;
}

export function masterReviewSummary(
  row: MasterChemicalRow,
  input: MasterReviewSummaryInput = {},
): MasterReviewSummary {
  const classified = classifyMasterConflicts(row);
  const draft = masterChemicalDraft(row);

  const decisionsRequired = classified.filter((c) => c.klass === "decision_required").length;
  const autoResolved = classified.filter((c) => c.klass === "auto_resolved").length;

  const missingFromConflicts = classified
    .filter((c) => c.klass === "unresolved_missing")
    .map((c) => String(c.conflict.field));
  const unresolvedFields = Array.from(
    new Set([...draft.unresolvedFields.map(String), ...missingFromConflicts].filter(Boolean)),
  );

  const blockingReasons = input.blockingReasons ?? [];
  const refreshable = !!(
    (row.registration_number ?? "").trim() || (row.registered_product_name ?? "").trim()
  );
  const fresherAvailable = input.fresherAvailable ?? null;

  let headline: string;
  if (decisionsRequired > 0) {
    headline = `${decisionsRequired} conflict(s) need an admin decision before approval.`;
  } else if (unresolvedFields.length > 0) {
    headline = `No conflicting evidence. ${unresolvedFields.length} field(s) are still unresolved.`;
  } else if (blockingReasons.length > 0) {
    headline = "No conflicts outstanding, but the record does not yet meet the evidence rules.";
  } else {
    headline = "No outstanding decisions — evidence is complete for approval.";
  }

  return {
    decisionsRequired,
    autoResolved,
    unresolvedFields,
    blockingReasons,
    refreshable,
    fresherAvailable,
    headline,
  };
}

/* ------------------------------------------------------- before/after diff */

export interface MasterFieldDiff {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = typeof v === "string" ? v.trim() : String(v).trim();
  return s === "" ? null : s;
};

function summariseUses(row: MasterChemicalRow): string | null {
  const uses = masterChemicalDraft(row).registeredUses;
  if (!uses.length) return null;
  const rates = uses.reduce((n, u) => n + u.rates.length, 0);
  const whp = uses.map((u) => u.withholding_period_days).filter((v): v is number => v != null);
  const parts = [`${uses.length} use(s)`, `${rates} rate(s)`];
  if (whp.length) {
    const lo = Math.min(...whp);
    const hi = Math.max(...whp);
    parts.push(lo === hi ? `WHP ${lo} d` : `WHP ${lo}–${hi} d`);
  }
  return parts.join(" · ");
}

/**
 * Field-level before/after for an APVMA refresh. Presentation only — the
 * backend has already persisted whatever it decided was safe.
 */
export function diffMasterRows(
  before: MasterChemicalRow,
  after: MasterChemicalRow,
): MasterFieldDiff[] {
  const beforeDraft = masterChemicalDraft(before);
  const afterDraft = masterChemicalDraft(after);
  const actives = (d: typeof beforeDraft) =>
    d.actives.length
      ? d.actives
          .map((a) =>
            [a.name, a.concentration != null ? `${a.concentration} ${a.concentration_unit ?? ""}`.trim() : null]
              .filter(Boolean)
              .join(" "),
          )
          .join(" + ")
      : null;

  const rows: Array<[string, string, string | null, string | null]> = [
    ["registered_product_name", "Product name", text(before.registered_product_name), text(after.registered_product_name)],
    ["registrant", "Registrant", text(before.registrant), text(after.registrant)],
    ["registration_number", "Registration number", text(before.registration_number), text(after.registration_number)],
    ["verification_status", "Verification status", text(before.verification_status), text(after.verification_status)],
    ["label_reference", "Label reference", text(before.label_reference), text(after.label_reference)],
    ["label_version", "Label version", text(before.label_version), text(after.label_version)],
    ["active_ingredients", "Active ingredients", actives(beforeDraft), actives(afterDraft)],
    ["registered_uses", "Registered uses", summariseUses(before), summariseUses(after)],
    [
      "verification_conflicts",
      "Conflicts",
      String(beforeDraft.conflicts.length),
      String(afterDraft.conflicts.length),
    ],
    [
      "verification_unresolved_fields",
      "Unresolved fields",
      beforeDraft.unresolvedFields.join(", ") || null,
      afterDraft.unresolvedFields.join(", ") || null,
    ],
    [
      "catalogue_version",
      "Catalogue revision",
      masterRevision(before) != null ? String(masterRevision(before)) : null,
      masterRevision(after) != null ? String(masterRevision(after)) : null,
    ],
  ];

  return rows.map(([key, label, b, a]) => ({
    key,
    label,
    before: b,
    after: a,
    changed: (b ?? "") !== (a ?? ""),
  }));
}

export const hasMasterChanges = (diffs: MasterFieldDiff[]): boolean =>
  diffs.some((d) => d.changed);
