// SQL 194 Chemical Intelligence — portal READ model.
//
// Source of truth: `public.saved_chemicals` on the production VineTrack
// project `tbafuqwruefgkbyxrxyb`. Columns verified live (read-only PostgREST
// probes, no rows read):
//   active_ingredients jsonb, activity_groups text[], activity_group_scheme,
//   registration_country, registration_scheme, registration_number,
//   registrant, registered_product_name, label_reference, label_version,
//   verification_status, verification_sources, verification_conflicts,
//   verification_unresolved_fields, verified_at, registered_uses jsonb,
//   label_rate_bases text[], intelligence_schema_version
// Legacy projections retained by the backend: active_ingredient,
// chemical_group, mode_of_action.
//
// The INNER JSON keys of `active_ingredients`, `registered_uses` and
// `verification_sources` are not published in a checked-in contract and RLS
// prevents reading a sample row from the portal sandbox, so the adapter below
// accepts the documented snake_case and camelCase spellings and otherwise
// leaves the field unknown. It never fabricates a value.
// See docs/vinetrack-portal-contract-audit.md — BACKEND CONTRACT
// CLARIFICATION REQUIRED for the canonical key names.
//
// Hard rule: legacy scalars are compatibility *projections* only. A legacy
// value such as "3 + 11" is never parsed into structured activity groups —
// legacy-only means "structured intelligence unavailable".

export type ActivityScheme = "FRAC" | "HRAC" | "IRAC" | "NA" | "UNKNOWN";

export interface ActivityGroup {
  scheme: ActivityScheme;
  /** Group code as published, e.g. "3", "11", "M05". Null for N/A. */
  code: string | null;
}

export interface ChemicalActiveIngredient {
  name: string | null;
  concentration: number | null;
  unit: string | null;
  group: ActivityGroup | null;
}

export type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "needs_match"
  | "conflict"
  | "unverified";

export interface VerificationSource {
  label: string | null;
  url: string | null;
  retrievedAt: string | null;
}

export interface ChemicalVerification {
  status: VerificationStatus;
  verifiedAt: string | null;
  sources: VerificationSource[];
  conflicts: string[];
  unresolvedFields: string[];
}

export interface LabelRate {
  min: number | null;
  max: number | null;
  unit: string | null;
  basis: string | null;
}

export interface RegisteredUse {
  crop: string | null;
  target: string | null;
  rate: LabelRate | null;
  rateText: string | null;
  withholdingPeriod: string | null;
  reEntryPeriod: string | null;
  notes: string | null;
}

export interface ChemicalCommercial {
  unit: string | null;
  packSize: string | null;
  costPerUnit: number | null;
  currency: string;
  supplier: string | null;
  preferredRatePerHa: number | null;
  notes: string | null;
}

export interface ChemicalIntelligence {
  id: string;
  name: string | null;
  /** True when SQL 194 structured intelligence is present on the row. */
  structured: boolean;
  product: {
    country: string | null;
    registrationScheme: string | null;
    registrationNumber: string | null;
    registeredProductName: string | null;
    registrant: string | null;
    manufacturer: string | null;
    labelReference: string | null;
    labelVersion: string | null;
    labelUrl: string | null;
    productUrl: string | null;
  };
  actives: ChemicalActiveIngredient[];
  /** Row-level `activity_groups[]` (+ `activity_group_scheme`). */
  activityGroups: ActivityGroup[];
  verification: ChemicalVerification;
  labelRateBases: string[];
  registeredUses: RegisteredUse[];
  commercial: ChemicalCommercial;
  /** Display-only fallbacks. Never promoted to structured values. */
  legacy: {
    activeIngredient: string | null;
    chemicalGroup: string | null;
    modeOfAction: string | null;
  };
  schemaVersion: number | null;
}

/* ------------------------------------------------------------------ utils */

const str = (v: unknown): string | null => {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
};

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [t];
  }
  if (value && typeof value === "object") return [value];
  return [];
}

const stringList = (value: unknown): string[] =>
  asArray(value)
    .map((v) => str(typeof v === "object" && v ? JSON.stringify(v) : v))
    .filter((v): v is string => !!v);

/* --------------------------------------------------------- activity groups */

export function normaliseScheme(value: unknown): ActivityScheme {
  const s = String(value ?? "").trim().toUpperCase();
  if (s === "FRAC") return "FRAC";
  if (s === "HRAC") return "HRAC";
  if (s === "IRAC") return "IRAC";
  if (
    s === "NA" ||
    s === "N/A" ||
    s === "NOT_APPLICABLE" ||
    s === "NOT APPLICABLE" ||
    s === "NONE"
  )
    return "NA";
  return "UNKNOWN";
}

export const SCHEME_LABEL: Record<ActivityScheme, string> = {
  FRAC: "FRAC",
  HRAC: "HRAC",
  IRAC: "IRAC",
  NA: "Not applicable",
  UNKNOWN: "Group",
};

/** Parse a structured group token, e.g. "FRAC 3", "HRAC-9", {scheme, code}. */
export function parseActivityGroup(
  value: unknown,
  fallbackScheme: ActivityScheme = "UNKNOWN",
): ActivityGroup | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const scheme = normaliseScheme(
      pick(o, ["scheme", "activity_group_scheme", "activityGroupScheme", "system", "type"]) ??
        fallbackScheme,
    );
    const code = str(pick(o, ["code", "group", "group_code", "groupCode", "value"]));
    if (scheme === "NA") return { scheme: "NA", code: null };
    if (!code) return null;
    return { scheme, code };
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (normaliseScheme(raw) === "NA") return { scheme: "NA", code: null };
  const m = raw.match(/^(FRAC|HRAC|IRAC)\s*[-:]?\s*(.+)$/i);
  if (m) return { scheme: normaliseScheme(m[1]), code: m[2].trim() };
  return { scheme: fallbackScheme, code: raw };
}

export function formatActivityGroup(group: ActivityGroup): string {
  if (group.scheme === "NA") return "Not applicable";
  if (group.scheme === "UNKNOWN") return group.code ?? "—";
  return `${group.scheme} ${group.code ?? ""}`.trim();
}

/**
 * Summary derived from the structured per-active groups (falling back to the
 * row-level `activity_groups[]`). Same-scheme codes collapse: "FRAC 3 + 11".
 * Returns null when there is no structured data — callers then show the
 * legacy value clearly marked as legacy.
 */
export function activityGroupSummary(chem: ChemicalIntelligence): string | null {
  const groups: ActivityGroup[] = [];
  for (const a of chem.actives) if (a.group) groups.push(a.group);
  if (!groups.length) groups.push(...chem.activityGroups);
  if (!groups.length) return null;

  const order: ActivityScheme[] = [];
  const bySchema = new Map<ActivityScheme, string[]>();
  for (const g of groups) {
    if (!bySchema.has(g.scheme)) {
      bySchema.set(g.scheme, []);
      order.push(g.scheme);
    }
    const codes = bySchema.get(g.scheme)!;
    const code = g.scheme === "NA" ? "Not applicable" : (g.code ?? "").trim();
    if (code && !codes.includes(code)) codes.push(code);
  }
  const parts: string[] = [];
  for (const scheme of order) {
    const codes = bySchema.get(scheme)!;
    if (scheme === "NA") parts.push("Not applicable");
    else if (scheme === "UNKNOWN") parts.push(codes.join(" + "));
    else if (codes.length) parts.push(`${scheme} ${codes.join(" + ")}`);
  }
  const summary = parts.filter(Boolean).join(" • ");
  return summary || null;
}

/* ----------------------------------------------------------- verification */

export function normaliseVerificationStatus(value: unknown): VerificationStatus {
  const s = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (s) {
    case "verified":
      return "verified";
    case "partially_verified":
    case "partial":
      return "partially_verified";
    case "needs_match":
    case "unmatched":
      return "needs_match";
    case "conflict":
    case "conflicted":
      return "conflict";
    default:
      return "unverified";
  }
}

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: "Verified",
  partially_verified: "Partially verified",
  needs_match: "Needs match",
  conflict: "Conflict",
  unverified: "Unverified",
};

export type VerificationTone = "success" | "warning" | "danger" | "neutral";

export const VERIFICATION_TONE: Record<VerificationStatus, VerificationTone> = {
  verified: "success",
  partially_verified: "warning",
  needs_match: "warning",
  conflict: "danger",
  unverified: "neutral",
};

/* -------------------------------------------------------------- sub-parse */

function parseActive(
  value: unknown,
  fallbackScheme: ActivityScheme,
): ChemicalActiveIngredient | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const name = str(value);
    return name ? { name, concentration: null, unit: null, group: null } : null;
  }
  if (typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const name = str(pick(o, ["name", "active_ingredient", "activeIngredient", "ingredient"]));
  const concentration = numOrNull(
    pick(o, ["concentration", "value", "amount", "strength", "concentration_value"]),
  );
  const unit = str(pick(o, ["unit", "concentration_unit", "concentrationUnit", "units"]));
  const group = parseActivityGroup(
    pick(o, [
      "activity_group",
      "activityGroup",
      "group",
      "group_code",
      "groupCode",
      "frac_group",
      "hrac_group",
      "irac_group",
    ]),
    normaliseScheme(
      pick(o, ["scheme", "activity_group_scheme", "activityGroupScheme"]) ?? fallbackScheme,
    ),
  );
  if (!name && concentration == null && !group) return null;
  return { name, concentration, unit, group };
}

function parseLabelRate(value: unknown): LabelRate | null {
  if (value == null) return null;
  if (typeof value === "number") return { min: value, max: value, unit: null, basis: null };
  if (typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const min = numOrNull(pick(o, ["min", "rate_min", "rateMin", "minimum", "low"]));
  const max = numOrNull(pick(o, ["max", "rate_max", "rateMax", "maximum", "high"]));
  const single = numOrNull(pick(o, ["rate", "value", "amount"]));
  const unit = str(pick(o, ["unit", "rate_unit", "rateUnit", "units"]));
  const basis = str(pick(o, ["basis", "rate_basis", "rateBasis", "label_rate_basis"]));
  const lo = min ?? single;
  const hi = max ?? single;
  if (lo == null && hi == null && !unit && !basis) return null;
  return { min: lo, max: hi, unit, basis };
}

export function formatLabelRate(rate: LabelRate | null): string | null {
  if (!rate) return null;
  const { min, max, unit, basis } = rate;
  let value: string | null = null;
  if (min != null && max != null) value = min === max ? String(min) : `${min}–${max}`;
  else if (min != null) value = `${min}`;
  else if (max != null) value = `${max}`;
  if (!value) return basis ? `Basis: ${basis}` : null;
  return [`${value}${unit ? ` ${unit}` : ""}`, basis].filter(Boolean).join(" · ");
}

function parseRegisteredUse(value: unknown): RegisteredUse | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const rateCandidate = pick(o, ["rate", "label_rate", "labelRate", "rates"]);
  const rate =
    parseLabelRate(rateCandidate) ??
    parseLabelRate({
      min: pick(o, ["rate_min", "rateMin"]),
      max: pick(o, ["rate_max", "rateMax"]),
      unit: pick(o, ["rate_unit", "rateUnit"]),
      basis: pick(o, ["rate_basis", "rateBasis", "basis"]),
    });
  const use: RegisteredUse = {
    crop: str(pick(o, ["crop", "crop_name", "cropName", "commodity"])),
    target: str(pick(o, ["target", "pest", "disease", "weed", "target_name"])),
    rate,
    rateText: typeof rateCandidate === "string" ? str(rateCandidate) : null,
    withholdingPeriod: str(
      pick(o, [
        "withholding_period",
        "withholdingPeriod",
        "whp",
        "withholding_period_days",
        "withholdingPeriodDays",
      ]),
    ),
    reEntryPeriod: str(
      pick(o, [
        "re_entry_period",
        "reEntryPeriod",
        "rei",
        "re_entry_interval",
        "reEntryInterval",
        "re_entry_hours",
      ]),
    ),
    notes: str(pick(o, ["notes", "comment", "restrictions"])),
  };
  const empty =
    !use.crop && !use.target && !use.rate && !use.rateText && !use.withholdingPeriod &&
    !use.reEntryPeriod && !use.notes;
  return empty ? null : use;
}

function parseSource(value: unknown): VerificationSource | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const s = str(value);
    if (!s) return null;
    return /^https?:\/\//i.test(s)
      ? { label: null, url: s, retrievedAt: null }
      : { label: s, url: null, retrievedAt: null };
  }
  if (typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const source: VerificationSource = {
    label: str(pick(o, ["label", "name", "source", "title", "authority"])),
    url: str(pick(o, ["url", "href", "link", "source_url"])),
    retrievedAt: str(
      pick(o, ["retrieved_at", "retrievedAt", "checked_at", "verified_at", "timestamp"]),
    ),
  };
  return source.label || source.url ? source : null;
}

/* ---------------------------------------------------------------- adapter */

const purchaseCost = (purchase: Record<string, unknown> | null | undefined): number | null =>
  numOrNull(
    pick(purchase ?? {}, [
      "costPerBaseUnit",
      "cost_per_base_unit",
      "costPerUnit",
      "cost_per_unit",
    ]),
  );

/**
 * THE single adapter from a live `saved_chemicals` row to the portal Chemical
 * Intelligence domain model. List, detail and picker all consume this — do not
 * duplicate mapping logic.
 */
export function toChemicalIntelligence(row: Record<string, any>): ChemicalIntelligence {
  const rowScheme = normaliseScheme(row.activity_group_scheme);
  const actives = asArray(row.active_ingredients)
    .map((v) => parseActive(v, rowScheme))
    .filter((a): a is ChemicalActiveIngredient => !!a);

  const activityGroups = asArray(row.activity_groups)
    .map((v) => parseActivityGroup(v, rowScheme))
    .filter((g): g is ActivityGroup => !!g);

  const registeredUses = asArray(row.registered_uses)
    .map(parseRegisteredUse)
    .filter((u): u is RegisteredUse => !!u);

  const sources = asArray(row.verification_sources)
    .map(parseSource)
    .filter((s): s is VerificationSource => !!s);

  const purchase = (row.purchase ?? null) as Record<string, unknown> | null;

  const structured =
    actives.length > 0 ||
    activityGroups.length > 0 ||
    registeredUses.length > 0 ||
    row.verification_status != null ||
    str(row.registration_number) != null;

  return {
    id: String(row.id ?? ""),
    name: str(row.name),
    structured,
    product: {
      country: str(row.registration_country),
      registrationScheme: str(row.registration_scheme),
      registrationNumber: str(row.registration_number),
      registeredProductName: str(row.registered_product_name),
      registrant: str(row.registrant),
      manufacturer: str(row.manufacturer),
      labelReference: str(row.label_reference),
      labelVersion: str(row.label_version),
      labelUrl: str(row.label_url),
      productUrl: str(row.product_url),
    },
    actives,
    activityGroups,
    verification: {
      // Absent status on a legacy row = Unverified, never "verified".
      status: normaliseVerificationStatus(row.verification_status),
      verifiedAt: str(row.verified_at),
      sources,
      conflicts: stringList(row.verification_conflicts),
      unresolvedFields: stringList(row.verification_unresolved_fields),
    },
    labelRateBases: stringList(row.label_rate_bases),
    registeredUses,
    commercial: {
      unit: str(row.unit),
      packSize: str(row.pack_size),
      costPerUnit: purchaseCost(purchase),
      currency: str(purchase?.currency) ?? "AUD",
      supplier: str(row.supplier) ?? str(row.manufacturer),
      preferredRatePerHa: numOrNull(row.rate_per_ha),
      notes: str(row.notes),
    },
    legacy: {
      activeIngredient: str(row.active_ingredient),
      chemicalGroup: str(row.chemical_group),
      modeOfAction: str(row.mode_of_action),
    },
    schemaVersion: numOrNull(row.intelligence_schema_version),
  };
}

/** True when the row carries no SQL 194 intelligence at all. */
export const isLegacyOnly = (chem: ChemicalIntelligence): boolean => !chem.structured;

/**
 * What the list/picker should show as the group cell.
 * `legacy: true` means the text is an unparsed legacy string and MUST be
 * presented as legacy (structured intelligence unavailable).
 */
export function groupDisplay(
  chem: ChemicalIntelligence,
): { text: string; legacy: boolean } | null {
  const structured = activityGroupSummary(chem);
  if (structured) return { text: structured, legacy: false };
  const legacy = chem.legacy.chemicalGroup;
  return legacy ? { text: legacy, legacy: true } : null;
}
