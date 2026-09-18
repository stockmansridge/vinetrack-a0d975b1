// Master Chemical curation (System Admin review queue) — V2.
//
// ONE central place that answers, for a Master Catalogue row:
//   * what core information is missing            → masterMissingFields()
//   * does it need attention                      → masterNeedsAttention()
//   * does it have a usable vineyard rate         → masterRateCoverage()
//   * which label can I open right now            → masterLabelTargets()
//   * what does the operator's rate editing mean  → parse/encode/mutate helpers
//
// Rules this module enforces:
//   * `viticulture_rates` is the Master vineyard-rate source. `registered_uses`
//     is kept for evidence/back-compat and is NEVER required by this workflow.
//   * a /ha rate is never converted into /100 L (or the reverse), and two
//     separate label options are never merged into one artificial min/max.
//   * nothing is invented to pass approval — a gap stays a gap, visibly.
//   * these are registered Master rates, not vineyard operational defaults:
//     nothing here writes `saved_chemicals.default_rates`.

import { MANUAL_RATE_UNITS, type ManualRateUnit } from "@/lib/chemicalManualRate";
import {
  masterChemicalDraft,
  normaliseReviewStatus,
  type MasterChemicalRow,
  type MasterReviewStatus,
} from "@/lib/masterChemicals";
import { resolveChemicalLabelLinks } from "@/lib/chemicalLabelLinks";

/* ------------------------------------------------------------------ utils */

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const httpUrl = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

/** An SDS is never a product label. */
export const looksLikeSds = (v: unknown): boolean =>
  /\bsds\b|safety[\s_-]?data[\s_-]?sheet|msds/i.test(String(v ?? ""));

/* ------------------------------------------------------ viticulture rates */

export type MasterRateBasis = "per_hectare" | "per_100_litres";
export type MasterRateKind = "single" | "range";

export const MASTER_RATE_BASIS_LABEL: Record<MasterRateBasis, string> = {
  per_hectare: "Per hectare",
  per_100_litres: "Per 100 litres",
};

export const MASTER_RATE_BASIS_SUFFIX: Record<MasterRateBasis, string> = {
  per_hectare: "/ha",
  per_100_litres: "/100 L",
};

export const MASTER_RATE_UNITS = MANUAL_RATE_UNITS;

export interface MasterViticultureRate {
  /** Local stable identity for list editing only — never persisted. */
  id: string;
  basis: MasterRateBasis;
  kind: MasterRateKind;
  /** Single-rate amount. */
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  unit: ManualRateUnit | "";
  /** Optional label / condition text as printed. */
  label: string | null;
}

export function normaliseMasterRateBasis(value: unknown): MasterRateBasis | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("100")) return "per_100_litres";
  if (s.includes("hectare") || /(^|[^a-z])ha([^a-z]|$)/.test(s)) return "per_hectare";
  return null;
}

export function normaliseMasterRateUnit(value: unknown): ManualRateUnit | "" {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const hit = MASTER_RATE_UNITS.find((u) => u.toLowerCase() === s.toLowerCase());
  return hit ?? "";
}

let rateSeq = 0;
const rateId = () => `mvr_${(rateSeq += 1)}`;

/**
 * Tolerant read of whatever `master_chemicals.viticulture_rates` holds. Only
 * entries with a recognised basis survive — an unreadable entry is reported as
 * no coverage rather than guessed at.
 */
export function parseMasterViticultureRates(raw: unknown): MasterViticultureRate[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).rates)
      ? (raw as any).rates
      : [];
  const out: MasterViticultureRate[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const basis = normaliseMasterRateBasis(o.basis ?? o.rate_basis ?? o.basis_code);
    if (!basis) continue;
    const min = num(o.min_value ?? o.min ?? o.rate_min);
    const max = num(o.max_value ?? o.max ?? o.rate_max);
    const value = num(o.value ?? o.rate ?? o.rate_value ?? o.amount);
    const declaredRange =
      String(o.kind ?? o.basis ?? "").toLowerCase().includes("range") || (min != null && max != null);
    const kind: MasterRateKind = declaredRange ? "range" : "single";
    out.push({
      id: rateId(),
      basis,
      kind,
      value: kind === "single" ? value : null,
      min_value: kind === "range" ? min : null,
      max_value: kind === "range" ? max : null,
      unit: normaliseMasterRateUnit(o.unit),
      label: str(o.label ?? o.condition ?? o.notes ?? o.comment),
    });
  }
  return out;
}

export interface MasterRateProblem {
  id: string;
  message: string;
}

/** Validate one edited rate. Empty message list = persistable. */
export function masterRateProblems(rate: MasterViticultureRate): string[] {
  const problems: string[] = [];
  if (!rate.unit) problems.push("Choose a unit (L, mL, kg or g).");
  if (rate.kind === "single") {
    if (rate.value == null || !(rate.value > 0)) problems.push("Enter a rate amount greater than zero.");
  } else {
    if (rate.min_value == null || !(rate.min_value > 0)) problems.push("Enter a minimum greater than zero.");
    if (rate.max_value == null || !(rate.max_value > 0)) problems.push("Enter a maximum greater than zero.");
    if (rate.min_value != null && rate.max_value != null && rate.max_value < rate.min_value)
      problems.push("The maximum must be the same as or greater than the minimum.");
  }
  return problems;
}

export const isPersistableMasterRate = (rate: MasterViticultureRate): boolean =>
  masterRateProblems(rate).length === 0;

export function masterRateSummary(rate: MasterViticultureRate): string {
  const suffix = MASTER_RATE_BASIS_SUFFIX[rate.basis];
  const unit = rate.unit || "?";
  const body =
    rate.kind === "range"
      ? `${rate.min_value ?? "?"}–${rate.max_value ?? "?"}`
      : `${rate.value ?? "?"}`;
  return `${body} ${unit}${suffix}`;
}

export const newMasterRate = (basis: MasterRateBasis): MasterViticultureRate => ({
  id: rateId(),
  basis,
  kind: "single",
  value: null,
  min_value: null,
  max_value: null,
  unit: "",
  label: null,
});

/** Switching single↔range never reuses the other shape's numbers. */
export function setMasterRateKind(
  rate: MasterViticultureRate,
  kind: MasterRateKind,
): MasterViticultureRate {
  if (rate.kind === kind) return rate;
  return kind === "range"
    ? { ...rate, kind, value: null, min_value: null, max_value: null }
    : { ...rate, kind, value: null, min_value: null, max_value: null };
}

export const upsertMasterRate = (
  rates: MasterViticultureRate[],
  next: MasterViticultureRate,
): MasterViticultureRate[] => rates.map((r) => (r.id === next.id ? next : r));

export const removeMasterRate = (
  rates: MasterViticultureRate[],
  id: string,
): MasterViticultureRate[] => rates.filter((r) => r.id !== id);

export const masterRatesForBasis = (
  rates: MasterViticultureRate[],
  basis: MasterRateBasis,
): MasterViticultureRate[] => rates.filter((r) => r.basis === basis);

/**
 * Persistable payload for `master_chemicals.viticulture_rates`. The basis is
 * written explicitly per entry — no conversion between /ha and /100 L, and
 * separate label options stay separate entries.
 */
export function encodeMasterViticultureRates(
  rates: MasterViticultureRate[],
): Array<Record<string, unknown>> {
  return rates.filter(isPersistableMasterRate).map((r) => ({
    basis: r.basis,
    kind: r.kind,
    unit: r.unit,
    value: r.kind === "single" ? r.value : null,
    min_value: r.kind === "range" ? r.min_value : null,
    max_value: r.kind === "range" ? r.max_value : null,
    label: r.label,
  }));
}

export interface MasterRateCoverage {
  perHectare: boolean;
  per100Litres: boolean;
  any: boolean;
}

export function masterRateCoverage(
  row: MasterChemicalRow | MasterViticultureRate[] | null | undefined,
): MasterRateCoverage {
  const rates = Array.isArray(row)
    ? row
    : parseMasterViticultureRates((row as MasterChemicalRow | null)?.viticulture_rates);
  const usable = rates.filter(isPersistableMasterRate);
  const perHectare = usable.some((r) => r.basis === "per_hectare");
  const per100Litres = usable.some((r) => r.basis === "per_100_litres");
  return { perHectare, per100Litres, any: perHectare || per100Litres };
}

/* --------------------------------------------------------- label targets */

export interface MasterLabelTarget {
  kind: "manufacturer_label" | "regulator_label" | "label_reference" | "product_page";
  label: string;
  url: string;
}

const LABEL_TARGET_LABEL: Record<MasterLabelTarget["kind"], string> = {
  manufacturer_label: "Manufacturer Label",
  regulator_label: "APVMA Label",
  label_reference: "Label reference",
  product_page: "Product Page",
};

/**
 * Openable links derived from the EXISTING master evidence structure, in review
 * priority order: manufacturer label → regulator/APVMA label → label_reference
 * → a usable URL held in the verification sources. SDS references are excluded.
 */
export function masterLabelTargets(row: MasterChemicalRow): MasterLabelTarget[] {
  const draft = masterChemicalDraft(row);
  const sources = (draft.sources ?? []).filter((s) => !looksLikeSds(s.reference) && !looksLikeSds(s.kind));
  const links = resolveChemicalLabelLinks({
    sources,
    labelReference: row.label_reference ?? null,
  });

  const out: MasterLabelTarget[] = [];
  const push = (kind: MasterLabelTarget["kind"], url: string | null | undefined) => {
    const u = httpUrl(url);
    if (!u || out.some((t) => t.url === u)) return;
    out.push({ kind, label: LABEL_TARGET_LABEL[kind], url: u });
  };

  push("manufacturer_label", links.manufacturerLabelUrl);
  push("regulator_label", links.regulatorLabelUrl);
  push("label_reference", httpUrl(row.label_reference));
  // Any remaining non-SDS source URL, e.g. an official register citation.
  for (const s of sources) push("label_reference", httpUrl(s.reference));
  push("product_page", links.productUrl);
  return out;
}

/** The single link the prominent "Open Label" button should use. */
export const primaryMasterLabelTarget = (row: MasterChemicalRow): MasterLabelTarget | null =>
  masterLabelTargets(row)[0] ?? null;

/* --------------------------------------------------------- missing fields */

export type MasterCoreField =
  | "registered_product_name"
  | "registration_number"
  | "product_category"
  | "active_ingredients"
  | "label"
  | "viticulture_rates";

export const MASTER_CORE_FIELD_LABEL: Record<MasterCoreField, string> = {
  registered_product_name: "Product name",
  registration_number: "APVMA number",
  product_category: "Category",
  active_ingredients: "Active ingredient",
  label: "Label link",
  viticulture_rates: "Vineyard rate",
};

/**
 * The single definition of "missing" for this workflow. `registered_uses` is
 * deliberately NOT reviewed here — it is evidence, not a required field.
 */
export function masterMissingFields(row: MasterChemicalRow): MasterCoreField[] {
  const missing: MasterCoreField[] = [];
  if (!str(row.registered_product_name)) missing.push("registered_product_name");
  if (!str(row.registration_number)) missing.push("registration_number");
  if (!str(row.product_category)) missing.push("product_category");
  const actives = masterChemicalDraft(row).actives.filter((a) => str(a.name));
  if (!actives.length) missing.push("active_ingredients");
  if (!primaryMasterLabelTarget(row)) missing.push("label");
  if (!masterRateCoverage(row).any) missing.push("viticulture_rates");
  return missing;
}

export const masterNeedsAttention = (row: MasterChemicalRow): boolean =>
  masterMissingFields(row).length > 0;

export const masterMissingLabels = (row: MasterChemicalRow): string[] =>
  masterMissingFields(row).map((f) => MASTER_CORE_FIELD_LABEL[f]);

/* ------------------------------------------------------------- filtering */

export type MasterQueueFilter =
  | "needs_attention"
  | "all"
  | "candidate"
  | "approved"
  | "missing_rate"
  | "missing_label"
  | "missing_active"
  | "missing_category";

export const MASTER_QUEUE_FILTERS: Array<{ key: MasterQueueFilter; label: string }> = [
  { key: "needs_attention", label: "Needs attention" },
  { key: "all", label: "All" },
  { key: "candidate", label: "Candidate" },
  { key: "approved", label: "Approved" },
  { key: "missing_rate", label: "Missing vineyard rate" },
  { key: "missing_label", label: "Missing label" },
  { key: "missing_active", label: "Missing active ingredient" },
  { key: "missing_category", label: "Missing category" },
];

export function matchesMasterQueueFilter(
  row: MasterChemicalRow,
  filter: MasterQueueFilter,
): boolean {
  const status: MasterReviewStatus | undefined = normaliseReviewStatus(row.review_status);
  const missing = masterMissingFields(row);
  switch (filter) {
    case "all":
      return true;
    case "needs_attention":
      return missing.length > 0;
    case "candidate":
      return status === "candidate";
    case "approved":
      return status === "approved";
    case "missing_rate":
      return missing.includes("viticulture_rates");
    case "missing_label":
      return missing.includes("label");
    case "missing_active":
      return missing.includes("active_ingredients");
    case "missing_category":
      return missing.includes("product_category");
    default:
      return true;
  }
}

/** Product-name / APVMA-number search, unchanged from the previous screen. */
export function matchesMasterSearch(row: MasterChemicalRow, search: string): boolean {
  const needle = (search ?? "").trim().toLowerCase();
  if (!needle) return true;
  return [row.registered_product_name, row.registrant, row.registration_number]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle));
}

export function filterMasterQueue(
  rows: MasterChemicalRow[],
  filter: MasterQueueFilter,
  search = "",
): MasterChemicalRow[] {
  return rows.filter((r) => matchesMasterQueueFilter(r, filter) && matchesMasterSearch(r, search));
}

/* ------------------------------------------------------ queue navigation */

/** Id of the row after `currentId` in the filtered queue, or null at the end. */
export function nextQueueId(
  queue: Array<{ id: string }>,
  currentId: string | null | undefined,
): string | null {
  if (!currentId) return queue[0]?.id ?? null;
  const i = queue.findIndex((r) => r.id === currentId);
  if (i < 0) return queue[0]?.id ?? null;
  return queue[i + 1]?.id ?? null;
}

export function previousQueueId(
  queue: Array<{ id: string }>,
  currentId: string | null | undefined,
): string | null {
  const i = queue.findIndex((r) => r.id === currentId);
  return i > 0 ? queue[i - 1].id : null;
}

/**
 * Next record still needing attention after approving `currentId`. Used by
 * "Approve & Next" so the admin lands on work, not on a finished record.
 */
export function nextAttentionId(
  queue: MasterChemicalRow[],
  currentId: string | null | undefined,
): string | null {
  const i = queue.findIndex((r) => r.id === currentId);
  const after = queue.slice(i + 1).find((r) => masterNeedsAttention(r));
  if (after) return after.id;
  const anywhere = queue.find((r) => r.id !== currentId && masterNeedsAttention(r));
  return anywhere?.id ?? nextQueueId(queue, currentId);
}

/* --------------------------------------------------------------- saving */

import {
  MASTER_REVIEW_CORRECT_RPC,
  callReviewRpc,
  type MasterActionResult,
} from "@/lib/masterReviewActions";
import { masterRevision } from "@/lib/masterChemicals";

/** Editable identity fields in the curation drawer (all existing columns). */
export interface MasterCurationIdentity {
  registered_product_name?: string | null;
  registration_number?: string | null;
  registrant?: string | null;
  product_category?: string | null;
  form_type?: string | null;
  label_reference?: string | null;
}

export interface MasterCurationSaveInput {
  row: MasterChemicalRow;
  identity: MasterCurationIdentity;
  /** Full replacement list of Master vineyard rates. */
  rates?: MasterViticultureRate[] | null;
  reason: string;
}

const IDENTITY_KEYS: Array<keyof MasterCurationIdentity> = [
  "registered_product_name",
  "registration_number",
  "registrant",
  "product_category",
  "form_type",
  "label_reference",
];

/**
 * The patch this workflow sends to the existing `master_review_correct` RPC.
 * Only changed fields are included; blank clears to null. Rates travel in the
 * SAME patch so one save is one revision — never two chained writes with a
 * stale expected revision between them.
 */
export function buildMasterCurationPatch(
  input: MasterCurationSaveInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of IDENTITY_KEYS) {
    if (!(key in input.identity)) continue;
    const next = str(input.identity[key]);
    const current = str((input.row as unknown as Record<string, unknown>)[key]);
    if (next === current) continue;
    patch[key] = next;
  }
  if (input.rates) {
    const encoded = encodeMasterViticultureRates(input.rates);
    const before = JSON.stringify(
      encodeMasterViticultureRates(parseMasterViticultureRates(input.row.viticulture_rates)),
    );
    if (JSON.stringify(encoded) !== before) patch.viticulture_rates = encoded;
  }
  return patch;
}

export const MASTER_CURATION_NOTHING_CHANGED = "Nothing has changed on this record.";

/**
 * Persist the curation edits through the EXISTING Master review mechanism, so
 * the change is recorded as a manual admin correction with its own revision and
 * review-action history. The backend stays the authority: a refusal (including
 * "no typed handler for this field") is surfaced verbatim, never worked around.
 */
export async function saveMasterCuration(
  input: MasterCurationSaveInput,
): Promise<MasterActionResult> {
  const reason = (input.reason ?? "").trim() || "Admin curation review";
  const patch = buildMasterCurationPatch(input);
  if (!Object.keys(patch).length) {
    return {
      outcome: "ok",
      message: MASTER_CURATION_NOTHING_CHANGED,
      row: input.row,
      raw: null,
    };
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
