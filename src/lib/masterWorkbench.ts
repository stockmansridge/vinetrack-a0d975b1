// Master Chemical Catalogue — data-quality workbench.
//
// One place that decides, for a Master row, what is incomplete for a VINEYARD
// user and what the admin can do about it. Presentation only: every answer is
// derived from what the backend already stored. Nothing here writes.
//
// Rules:
//   * resistance comes from `resistance_classification_state` + structured
//     groups only. An empty group array is NEVER read as "not applicable".
//   * a vineyard rate is only required when the register shows a grape /
//     vineyard use. Unrelated crop gaps (e.g. `rates:POTATO`) never put a record
//     into the primary attention queue.
//   * completeness (data quality) is separate from review status (governance).

import { masterChemicalDraft, type MasterChemicalRow } from "@/lib/masterChemicals";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import { masterLabelTargets, masterRateCoverage } from "@/lib/masterCuration";
import { qualifyMasterActives } from "@/lib/chemicalSearchV2";

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/* ------------------------------------------------------------- vineyard */

const VINEYARD_CROP = /grape|vine|viticult/i;

export const isVineyardCrop = (crop: unknown): boolean => VINEYARD_CROP.test(String(crop ?? ""));

/** Registered uses that apply to grapevines only. */
export function masterVineyardUses(row: MasterChemicalRow): WriteRegisteredUse[] {
  return masterChemicalDraft(row).registeredUses.filter((u) => isVineyardCrop(u.crop));
}

export const hasVineyardRegistration = (row: MasterChemicalRow): boolean =>
  masterVineyardUses(row).length > 0;

/**
 * Is a raw backend unresolved field relevant to a vineyard user? Crop-scoped
 * fields (`rates:POTATO`, `whp:WHEAT`) only count when the crop is a vine.
 */
export function isVineyardRelevantField(field: string): boolean {
  const i = field.indexOf(":");
  if (i < 0) return true;
  return isVineyardCrop(field.slice(i + 1));
}

export const vineyardRelevantUnresolved = (row: MasterChemicalRow): string[] =>
  masterChemicalDraft(row).unresolvedFields.filter(isVineyardRelevantField);

/* ------------------------------------------------------------ resistance */

export type MasterResistanceState = "classified" | "not_applicable" | "unresolved";

export interface MasterResistanceActive {
  name: string;
  concentration: string | null;
  group: string | null;
}

export interface MasterResistanceStatus {
  state: MasterResistanceState;
  /** Compact list text: "FRAC 3 + 11", "No resistance group applies", … */
  text: string;
  actives: MasterResistanceActive[];
  /** Structured group codes are present somewhere on the record. */
  hasGroups: boolean;
  /** Classified overall, but at least one active has no group. */
  incomplete: boolean;
}

export const RESISTANCE_TEXT = {
  not_applicable: "No resistance group applies",
  unresolved: "Resistance unresolved",
  incomplete: "Resistance classification incomplete",
} as const;

export function normaliseResistanceState(v: unknown): MasterResistanceState {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "classified") return "classified";
  if (s === "not_applicable") return "not_applicable";
  return "unresolved";
}

function groupText(groups: Array<{ scheme: string; code: string }>): string {
  const byScheme = new Map<string, string[]>();
  for (const g of groups) {
    const list = byScheme.get(g.scheme) ?? [];
    if (!list.includes(g.code)) list.push(g.code);
    byScheme.set(g.scheme, list);
  }
  return [...byScheme.entries()].map(([s, codes]) => `${s} ${codes.join(" + ")}`).join(" + ");
}

export function masterResistanceStatus(row: MasterChemicalRow): MasterResistanceStatus {
  // Master actives may carry a bare code with the scheme at row level — qualify
  // them with the same reader Chemical Search uses; never pair mixtures by guess.
  const rowGroups = Array.isArray(row.activity_groups) ? row.activity_groups.map(String) : [];
  const draft = masterChemicalDraft({
    ...row,
    active_ingredients: Array.isArray(row.active_ingredients)
      ? qualifyMasterActives(row.active_ingredients, rowGroups, str(row.activity_group_scheme))
      : row.active_ingredients,
  });
  const state = normaliseResistanceState((row as any).resistance_classification_state);
  const actives: MasterResistanceActive[] = draft.actives
    .filter((a) => str(a.name))
    .map((a) => ({
      name: a.name,
      concentration:
        a.concentration != null ? `${a.concentration} ${a.concentration_unit ?? ""}`.trim() : null,
      group: a.activity_group?.code ? `${String(a.activity_group.scheme).toUpperCase()} ${a.activity_group.code}` : null,
    }));

  const groups: Array<{ scheme: string; code: string }> = draft.actives
    .filter((a) => a.activity_group?.code)
    .map((a) => ({ scheme: String(a.activity_group!.scheme).toUpperCase(), code: a.activity_group!.code }));
  if (!groups.length && Array.isArray(row.activity_groups) && str(row.activity_group_scheme)) {
    for (const c of row.activity_groups) {
      const code = str(c);
      if (code) groups.push({ scheme: String(row.activity_group_scheme).toUpperCase(), code });
    }
  }
  const hasGroups = groups.length > 0;

  if (state === "not_applicable") {
    return { state, text: RESISTANCE_TEXT.not_applicable, actives, hasGroups, incomplete: false };
  }
  if (state === "unresolved" || !hasGroups) {
    return { state: "unresolved", text: RESISTANCE_TEXT.unresolved, actives, hasGroups, incomplete: false };
  }
  // Classified: every active must carry its own group before a clean summary.
  const incomplete = actives.length > 1 && actives.some((a) => !a.group);
  return {
    state,
    text: incomplete ? RESISTANCE_TEXT.incomplete : groupText(groups),
    actives,
    hasGroups,
    incomplete,
  };
}

const CROP_PROTECTION =
  /fungicide|insecticide|herbicide|miticide|acaricide|nematicide|bactericide|molluscicide/i;

export const isCropProtection = (row: MasterChemicalRow): boolean =>
  CROP_PROTECTION.test(String(row.product_category ?? ""));

/* -------------------------------------------------------------- evidence */

export function masterHasConflict(row: MasterChemicalRow): boolean {
  if (masterChemicalDraft(row).conflicts.length > 0) return true;
  const raw = row.verification_conflicts;
  return Array.isArray(raw) ? raw.length > 0 : false;
}

export const masterManufacturerLabel = (row: MasterChemicalRow) =>
  masterLabelTargets(row).find((t) => t.kind === "manufacturer_label") ?? null;
export const masterRegulatorReference = (row: MasterChemicalRow) =>
  masterLabelTargets(row).find((t) => t.kind === "regulator_label" || t.kind === "label_reference") ??
  null;
export const masterProductPage = (row: MasterChemicalRow) =>
  masterLabelTargets(row).find((t) => t.kind === "product_page") ?? null;

/* ---------------------------------------------------------------- issues */

export type MasterIssueKey =
  | "conflict"
  | "resistance_unresolved"
  | "missing_group"
  | "vineyard_rates_missing"
  | "manufacturer_label_missing"
  | "product_name_missing"
  | "registration_missing"
  | "category_missing"
  | "active_missing"
  | "active_concentration_missing"
  | "unresolved_field";

export type MasterIssueAction = "find_missing_data" | "correct_or_find" | "review_conflict";

export const MASTER_ISSUE_ACTION_LABEL: Record<MasterIssueAction, string> = {
  find_missing_data: "Find missing data",
  correct_or_find: "Correct manually or Find missing data",
  review_conflict: "Review conflict",
};

export interface MasterIssue {
  key: MasterIssueKey;
  label: string;
  action: MasterIssueAction;
  /** 1 = most urgent. Drives the Needs-attention sort. */
  priority: number;
  field?: string;
}

const FIELD_LABEL: Record<string, string> = {
  whp: "WHP unresolved",
  withholding_period: "WHP unresolved",
  withholding_periods: "WHP unresolved",
  re_entry: "REI unresolved",
  re_entry_period: "REI unresolved",
  rei: "REI unresolved",
};

function unresolvedLabel(field: string): string {
  const base = field.split(":")[0].toLowerCase();
  return FIELD_LABEL[base] ?? `${field.replace(/_/g, " ")} unresolved`;
}

// Covered by a dedicated issue already — do not list twice.
const COVERED_FIELDS = new Set([
  "product_name",
  "registered_product_name",
  "registration_number",
  "product_category",
  "active_ingredients",
  "activity_groups",
]);

/** Vineyard-relevant problems on one record, in priority order. */
export function masterIssues(row: MasterChemicalRow): MasterIssue[] {
  const out: MasterIssue[] = [];
  const draft = masterChemicalDraft(row);
  const resistance = masterResistanceStatus(row);
  const cropProtection = isCropProtection(row);

  if (masterHasConflict(row))
    out.push({ key: "conflict", label: "Evidence conflict", action: "review_conflict", priority: 1 });

  if (resistance.state === "unresolved" || resistance.incomplete) {
    if (cropProtection && !resistance.hasGroups) {
      out.push({ key: "missing_group", label: "Resistance group missing", action: "find_missing_data", priority: 2 });
    }
    out.push({
      key: "resistance_unresolved",
      label: resistance.incomplete ? RESISTANCE_TEXT.incomplete : "Resistance group unresolved",
      action: "find_missing_data",
      priority: 2,
    });
  }

  if (hasVineyardRegistration(row) && !masterRateCoverage(row).any)
    out.push({ key: "vineyard_rates_missing", label: "Vineyard rates missing", action: "find_missing_data", priority: 3 });

  if (!masterManufacturerLabel(row))
    out.push({ key: "manufacturer_label_missing", label: "Manufacturer label missing", action: "find_missing_data", priority: 4 });

  if (!str(row.registered_product_name))
    out.push({ key: "product_name_missing", label: "Product name missing", action: "correct_or_find", priority: 5 });
  if (!str(row.registration_number))
    out.push({ key: "registration_missing", label: "APVMA number missing", action: "find_missing_data", priority: 5 });
  if (!str(row.product_category))
    out.push({ key: "category_missing", label: "Category missing", action: "correct_or_find", priority: 5 });

  const actives = draft.actives.filter((a) => str(a.name));
  if (!actives.length)
    out.push({ key: "active_missing", label: "Active ingredient missing", action: "find_missing_data", priority: 5 });
  else if (actives.some((a) => a.concentration == null))
    out.push({ key: "active_concentration_missing", label: "Active concentration missing", action: "find_missing_data", priority: 6 });

  const seen = new Set<string>();
  for (const f of vineyardRelevantUnresolved(row)) {
    if (COVERED_FIELDS.has(f.split(":")[0])) continue;
    const label = unresolvedLabel(f);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ key: "unresolved_field", label, action: "find_missing_data", priority: 6, field: f });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export const masterIsComplete = (row: MasterChemicalRow): boolean => masterIssues(row).length === 0;

/* ------------------------------------------------------ release eligibility */

/**
 * Release policy, kept SEPARATE from the completeness checklist.
 *
 * Blocking: evidence conflict; resistance unresolved / missing group; a
 * vineyard registration with no vineyard rates; no trusted manufacturer label;
 * missing identity or chemistry (product name, APVMA number, category, active,
 * concentration). These are never bypassed.
 *
 * Not blocking (retained as warnings, always shown): individual unresolved
 * label fields such as an REI the label does not state, or an application
 * basis the calculator cannot use. They describe what the label does NOT
 * establish; nothing is cleared or filled in.
 */
export const RELEASE_WARNING_KEYS: ReadonlySet<MasterIssueKey> = new Set(["unresolved_field"]);

export const masterReleaseBlockers = (row: MasterChemicalRow): MasterIssue[] =>
  masterIssues(row).filter((i) => !RELEASE_WARNING_KEYS.has(i.key));

export const masterReleaseWarnings = (row: MasterChemicalRow): MasterIssue[] =>
  masterIssues(row).filter((i) => RELEASE_WARNING_KEYS.has(i.key));

/** Rows needing attention sorted by most urgent issue, then product name. */
export function sortByAttention(rows: MasterChemicalRow[]): MasterChemicalRow[] {
  const rank = (r: MasterChemicalRow) => masterIssues(r)[0]?.priority ?? 99;
  const name = (r: MasterChemicalRow) => (r.registered_product_name ?? "").toLowerCase();
  return [...rows].sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)));
}

/* ------------------------------------------------------- vineyard rates */

export type VineyardRateStatus = "ha" | "100l" | "both" | "none" | "vineyard_missing";

export function vineyardRateStatus(row: MasterChemicalRow): VineyardRateStatus {
  const c = masterRateCoverage(row);
  if (c.perHectare && c.per100Litres) return "both";
  if (c.perHectare) return "ha";
  if (c.per100Litres) return "100l";
  return hasVineyardRegistration(row) ? "vineyard_missing" : "none";
}

export const VINEYARD_RATE_STATUS_LABEL: Record<VineyardRateStatus, string> = {
  ha: "/ha",
  "100l": "/100 L",
  both: "/ha + /100 L",
  none: "No vineyard rates",
  vineyard_missing: "Vineyard use — rates missing",
};

/* ----------------------------------------------------------- health cards */

export interface MasterHealthCounts {
  total: number;
  needsAttention: number;
  resistanceUnresolved: number;
  missingGroup: number;
  missingRates: number;
  vineyardMissingRates: number;
  missingLabel: number;
  conflicts: number;
  missingCategory: number;
  complete: number;
}

export function masterHealthCounts(rows: MasterChemicalRow[]): MasterHealthCounts {
  const c: MasterHealthCounts = {
    total: rows.length, needsAttention: 0, resistanceUnresolved: 0, missingGroup: 0, missingRates: 0,
    vineyardMissingRates: 0, missingLabel: 0, conflicts: 0, missingCategory: 0, complete: 0,
  };
  for (const r of rows) {
    const keys = new Set(masterIssues(r).map((i) => i.key));
    if (keys.size) c.needsAttention += 1;
    else c.complete += 1;
    if (keys.has("resistance_unresolved")) c.resistanceUnresolved += 1;
    if (keys.has("missing_group")) c.missingGroup += 1;
    if (!masterRateCoverage(r).any) c.missingRates += 1;
    if (keys.has("vineyard_rates_missing")) c.vineyardMissingRates += 1;
    if (keys.has("manufacturer_label_missing")) c.missingLabel += 1;
    if (keys.has("conflict")) c.conflicts += 1;
    if (keys.has("category_missing")) c.missingCategory += 1;
  }
  return c;
}
