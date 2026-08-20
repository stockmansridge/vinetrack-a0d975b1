// Field-level evidence for a Master Catalogue record.
//
// A Master record is NEVER summarised as "APVMA Verified". Different fields on
// the same product can have very different provenance: the registration number
// and constituents may come straight off the official register while the
// registered uses were interpreted by AI from a label PDF. The admin has to be
// able to see which is which, per field.
//
// Nothing in this module writes. It reads the SQL 194 structured columns that
// the shared VineTrack backend already populates (verification_sources,
// verification_conflicts, verification_unresolved_fields, active ingredient
// identity_source/group_source) and projects them onto a display model.

import {
  DATA_SOURCE_KIND_LABEL,
  type DataSourceKind,
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";
import { masterChemicalDraft, type MasterChemicalRow } from "@/lib/masterChemicals";

/* ---------------------------------------------------------------- levels */

export type EvidenceLevel =
  | "official_register"
  | "official_label"
  | "authoritative_classification"
  | "ai_interpretation"
  | "conflict"
  | "unresolved";

export const EVIDENCE_LEVEL_LABEL: Record<EvidenceLevel, string> = {
  official_register: "Official register",
  official_label: "Official label",
  authoritative_classification: "Authoritative classification",
  ai_interpretation: "AI interpretation",
  conflict: "Conflict",
  unresolved: "Unresolved",
};

/** Register / label / classification are authoritative. AI is not. */
export const AUTHORITATIVE_EVIDENCE_LEVELS: EvidenceLevel[] = [
  "official_register",
  "official_label",
  "authoritative_classification",
];

export const isAuthoritativeEvidence = (level: EvidenceLevel): boolean =>
  AUTHORITATIVE_EVIDENCE_LEVELS.includes(level);

/** Map a stored SQL 194 source kind onto a display evidence level. */
export function evidenceLevelForSource(
  kind: DataSourceKind | string | null | undefined,
): EvidenceLevel {
  switch (String(kind ?? "").trim().toLowerCase()) {
    case "official_register":
    case "authoritative_register":
      return "official_register";
    case "manufacturer_label":
      return "official_label";
    case "authoritative_classification":
      return "authoritative_classification";
    default:
      return "ai_interpretation";
  }
}

/* ----------------------------------------------------------------- model */

export interface EvidenceField {
  key: string;
  label: string;
  /** Display value. `null` when the record carries nothing for this field. */
  value: string | null;
  level: EvidenceLevel;
  /** Short provenance sentence shown beneath the value. */
  detail?: string;
  /** Grouping for the UI. */
  group: "identity" | "chemistry" | "uses";
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/** Normalised field keys that the backend uses inside unresolved/conflicts. */
const aliases: Record<string, string[]> = {
  product_name: ["product_name", "registered_product_name", "name"],
  registrant: ["registrant", "manufacturer"],
  registration_number: ["registration_number", "apvma_number", "registration"],
  registration_status: ["registration_status", "registration_state"],
  active_ingredients: ["active_ingredients", "actives", "constituents"],
  activity_groups: ["activity_groups", "frac", "hrac", "irac", "activity_group"],
  registered_uses: ["registered_uses", "uses", "crops"],
  rates: ["rates", "rate", "label_rates", "rate_basis"],
  withholding_period_days: ["withholding_period_days", "whp", "withholding_period"],
  re_entry_period_hours: ["re_entry_period_hours", "rei", "re_entry", "reentry"],
  label_reference: ["label_reference", "label", "label_url"],
};

const matches = (raw: string, key: string) => {
  const n = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return (aliases[key] ?? [key]).some((a) => n === a || n.startsWith(`${a}.`));
};

function unresolvedFor(draft: ChemicalIntelligenceDraft, key: string): boolean {
  return draft.unresolvedFields.some((f) => matches(String(f), key));
}

function conflictFor(draft: ChemicalIntelligenceDraft, key: string) {
  return draft.conflicts.find((c) => matches(String(c.field), key)) ?? null;
}

/** Best available evidence level across the record's declared sources. */
function bestSourceLevel(
  draft: ChemicalIntelligenceDraft,
  prefer: EvidenceLevel[],
): EvidenceLevel {
  const present = new Set(draft.sources.map((s) => evidenceLevelForSource(s.kind)));
  for (const level of prefer) if (present.has(level)) return level;
  return "ai_interpretation";
}

function resolve(
  draft: ChemicalIntelligenceDraft,
  key: string,
  value: string | null,
  base: EvidenceLevel,
  detail?: string,
): EvidenceField {
  const conflict = conflictFor(draft, key);
  if (conflict) {
    return {
      key,
      label: "",
      value,
      level: "conflict",
      group: "identity",
      detail: `Register says "${conflict.authoritative_value || "—"}", extracted value was "${conflict.extracted_value || "—"}".`,
    };
  }
  if (value == null || unresolvedFor(draft, key)) {
    return { key, label: "", value, level: "unresolved", group: "identity", detail };
  }
  return { key, label: "", value, level: base, group: "identity", detail };
}

/**
 * Per-field evidence for a Master record. Order is stable so the UI and the
 * tests agree on what an admin sees.
 */
export function masterEvidenceFields(row: MasterChemicalRow): EvidenceField[] {
  const draft = masterChemicalDraft(row);
  const registerLevel = bestSourceLevel(draft, ["official_register", "official_label"]);
  const labelLevel = bestSourceLevel(draft, ["official_label", "official_register"]);
  const sourceNames = (level: EvidenceLevel) =>
    draft.sources
      .filter((s) => evidenceLevelForSource(s.kind) === level)
      .map((s) => s.name)
      .filter(Boolean);

  const out: EvidenceField[] = [];
  const push = (
    key: string,
    label: string,
    group: EvidenceField["group"],
    value: string | null,
    base: EvidenceLevel,
    detail?: string,
  ) => {
    const f = resolve(draft, key, value, base, detail);
    out.push({ ...f, label, group });
  };

  /* identity — from the official register when one is cited */
  push(
    "product_name",
    "Product name",
    "identity",
    str(row.registered_product_name),
    registerLevel,
    sourceNames(registerLevel)[0],
  );
  push("registrant", "Registrant", "identity", str(row.registrant), registerLevel);
  push(
    "registration_number",
    "APVMA number",
    "identity",
    str(row.registration_number),
    registerLevel,
  );
  push(
    "registration_status",
    "Registration status",
    "identity",
    str((row as unknown as Record<string, unknown>).registration_status) ??
      str(row.verification_status)?.replace(/_/g, " ") ??
      null,
    registerLevel,
  );
  push(
    "label_reference",
    "Label reference",
    "identity",
    str(row.label_reference),
    labelLevel,
    str(row.label_version) ? `Label version ${row.label_version}` : undefined,
  );

  /* chemistry — actives carry their own identity/group provenance */
  if (draft.actives.length === 0) {
    push("active_ingredients", "Active ingredients", "chemistry", null, "unresolved");
    push("activity_groups", "Activity groups", "chemistry", null, "unresolved");
  } else {
    draft.actives.forEach((a, i) => {
      const conc =
        a.concentration != null
          ? `${a.concentration} ${a.concentration_unit ?? ""}`.trim()
          : null;
      push(
        `active_ingredients.${i}`,
        `Active — ${a.name}`,
        "chemistry",
        conc ? `${a.name} ${conc}` : a.name,
        evidenceLevelForSource(a.identity_source ?? undefined),
        conc ? undefined : "No concentration recorded.",
      );
      push(
        `activity_groups.${i}`,
        `Group — ${a.name}`,
        "chemistry",
        a.activity_group?.code
          ? `${(a.activity_group.scheme ?? "").toUpperCase()} ${a.activity_group.code}`.trim()
          : null,
        evidenceLevelForSource(a.group_source ?? undefined),
      );
    });
  }

  /* registered uses — usually interpreted from the label */
  const uses = draft.registeredUses;
  push(
    "registered_uses",
    "Registered uses",
    "uses",
    uses.length ? `${uses.length} registered use(s)` : null,
    labelLevel === "official_label" ? "official_label" : "ai_interpretation",
  );
  const rateCount = uses.reduce((n, u) => n + u.rates.length, 0);
  push(
    "rates",
    "Rates and bases",
    "uses",
    rateCount ? `${rateCount} rate(s)` : null,
    labelLevel === "official_label" ? "official_label" : "ai_interpretation",
    uses
      .flatMap((u) => u.rates.map((r) => r.basis))
      .filter((b, i, arr) => b && arr.indexOf(b) === i)
      .join(", ") || undefined,
  );
  const whp = uses.map((u) => u.withholding_period_days).filter((v) => v != null);
  push(
    "withholding_period_days",
    "Withholding period",
    "uses",
    whp.length ? `${Math.min(...(whp as number[]))}–${Math.max(...(whp as number[]))} days` : null,
    labelLevel === "official_label" ? "official_label" : "ai_interpretation",
  );
  const rei = uses.map((u) => u.re_entry_period_hours).filter((v) => v != null);
  push(
    "re_entry_period_hours",
    "Re-entry period",
    "uses",
    rei.length ? `${Math.min(...(rei as number[]))}–${Math.max(...(rei as number[]))} hours` : null,
    labelLevel === "official_label" ? "official_label" : "ai_interpretation",
  );

  return out;
}

/* --------------------------------------------------------------- summary */

export interface MasterEvidenceSummary {
  /** Registration identity is backed by the official register. */
  authoritativeIdentity: boolean;
  /** Actives + groups are authoritative. */
  authoritativeChemistry: boolean;
  /** Registered uses / rates / WHP / REI are AI-interpreted, not label-sourced. */
  interpretedUses: boolean;
  conflictCount: number;
  unresolvedCount: number;
  /** The sentence the UI must show instead of a blanket "APVMA Verified". */
  headline: string;
}

/**
 * Record-level summary. Deliberately never returns "APVMA Verified" — a record
 * with an authoritative registration but interpreted label uses says so.
 */
export function masterEvidenceSummary(row: MasterChemicalRow): MasterEvidenceSummary {
  const fields = masterEvidenceFields(row);
  const draft = masterChemicalDraft(row);
  const of = (group: EvidenceField["group"]) => fields.filter((f) => f.group === group);

  const identity = of("identity").filter((f) =>
    ["product_name", "registrant", "registration_number"].includes(f.key),
  );
  const chemistry = of("chemistry");
  const uses = of("uses").filter((f) => f.value != null);

  const authoritativeIdentity =
    identity.length > 0 && identity.every((f) => isAuthoritativeEvidence(f.level));
  const authoritativeChemistry =
    chemistry.length > 0 && chemistry.every((f) => isAuthoritativeEvidence(f.level));
  const interpretedUses = uses.some((f) => f.level === "ai_interpretation");

  const conflictCount = draft.conflicts.length;
  const unresolvedCount =
    draft.unresolvedFields.length + fields.filter((f) => f.level === "unresolved").length;

  let headline: string;
  if (conflictCount > 0) {
    headline = "Conflicting evidence — review each field before approving.";
  } else if (authoritativeIdentity && authoritativeChemistry && interpretedUses) {
    headline =
      "Authoritative APVMA registration and constituents. Registered uses, rates, withholding and re-entry are AI-interpreted and not yet label-verified.";
  } else if (authoritativeIdentity && authoritativeChemistry) {
    headline = "Registration, constituents and label information are authoritatively sourced.";
  } else if (authoritativeIdentity) {
    headline =
      "Authoritative APVMA registration. Chemistry and label detail are not fully authoritative.";
  } else {
    headline = "No authoritative registration evidence — this record is unresolved.";
  }

  return {
    authoritativeIdentity,
    authoritativeChemistry,
    interpretedUses,
    conflictCount,
    unresolvedCount,
    headline,
  };
}

/** Evidence sources cited by the record, for the "evidence sources" list. */
export function masterEvidenceSources(row: MasterChemicalRow) {
  return masterChemicalDraft(row).sources.map((s) => ({
    ...s,
    level: evidenceLevelForSource(s.kind),
    kindLabel: DATA_SOURCE_KIND_LABEL[s.kind] ?? String(s.kind),
  }));
}
