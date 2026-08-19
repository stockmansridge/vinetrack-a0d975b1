// Stage 2B closeout — chemical re-verification.
//
// Re-verify operates on the PRODUCT IDENTITY, not on FRAC/HRAC/IRAC
// classification alone. The activity-group reference table is used for one
// thing only: classifying an active. It can never certify registration
// identity, registered uses, rates, WHP or re-entry.
//
// Nothing here writes to the database. A re-verification produces a PROPOSED
// draft plus a human-readable diff; the operator decides whether to accept it,
// and acceptance flows through the normal reconcileEditedDraft(...) +
// encodeChemicalIntelligenceForWrite(...) pipeline.
import {
  type ChemicalIntelligenceDraft,
  type WriteActiveIngredient,
  type WriteRegisteredUse,
  type WriteLabelRate,
  type WriteDataSource,
  type RegistrationScheme,
  activityGroupReferenceSource,
  formatChemicalNumber,
  normaliseCountry,
  normaliseGroupCode,
  normaliseLabelRateBasis,
  normaliseRegistrationScheme,
  parseLegacyActiveIngredient,
  reconcileConflicts,
  resolveVerificationStatus,
  suggestActivityGroup,
  withSource,
} from "@/lib/chemicalIntelligenceWrite";

/* -------------------------------------------------------------- identity */

export type ReverifyIdentityKind =
  | "registration_number"
  | "registered_product"
  | "product_registrant"
  | "product_name";

export interface ReverifyIdentity {
  kind: ReverifyIdentityKind;
  /** The query string handed to the lookup service. */
  query: string;
  country?: string;
  registrationScheme?: RegistrationScheme;
  registrationNumber?: string;
  /** The product name alone (no registrant / number noise) for name matching. */
  productName?: string;

  /** Human sentence describing what identity is being re-verified. */
  description: string;
}

/**
 * Strongest available identity, in contract order:
 *   1. registration country + scheme + number
 *   2. registered product identity
 *   3. product + registrant + country
 *   4. product name
 */
export function resolveReverifyIdentity(
  draft: ChemicalIntelligenceDraft,
  productName: string | null | undefined,
  country?: string | null,
): ReverifyIdentity | null {
  const reg = draft.registration;
  const ctry = normaliseCountry(reg.country) ?? normaliseCountry(country) ?? undefined;
  const number = (reg.number ?? "").trim();
  const registered = (reg.registered_product_name ?? "").trim();
  const registrant = (reg.registrant ?? "").trim();
  const name = (productName ?? "").trim();

  if (number) {
    return {
      kind: "registration_number",
      query: [registered || name, number].filter(Boolean).join(" "),
      country: ctry,
      registrationScheme: reg.scheme,
      registrationNumber: number,
      productName: registered || name || undefined,
      description: `${reg.scheme ? reg.scheme.toUpperCase() : "Registration"} ${number}${ctry ? ` (${ctry})` : ""}`,
    };
  }
  if (registered) {
    return {
      kind: "registered_product",
      query: registered,
      productName: registered,
      country: ctry,
      description: `Registered product “${registered}”${ctry ? ` (${ctry})` : ""}`,
    };
  }
  if (name && registrant) {
    return {
      kind: "product_registrant",
      query: `${name} ${registrant}`,
      productName: name,
      country: ctry,
      description: `${name} — ${registrant}${ctry ? ` (${ctry})` : ""}`,
    };
  }
  if (name) {
    return {
      kind: "product_name",
      query: name,
      productName: name,
      country: ctry,
      description: `Product name “${name}”`,
    };
  }
  return null;
}

/* --------------------------------------------------------------- lookup */

/** One authoritative registered use as printed on the resolved label. */
export interface ReverifyCandidateUse {
  crop?: string | null;
  target?: string | null;
  rate_per_unit?: number | null;
  rate_min?: number | null;
  rate_max?: number | null;
  rate_unit?: string | null;
  rate_basis?: string | null;
  withholding_period_days?: number | null;
  withholding_period_text?: string | null;
  re_entry_period_hours?: number | null;
  re_entry_period_text?: string | null;
  restrictions?: string | null;
}

/** Authoritative-ish candidate returned by the lookup service. */
export interface ReverifyCandidate {
  product_name?: string | null;
  active_ingredient?: string | null;
  manufacturer?: string | null;
  registrant?: string | null;
  registration_number?: string | null;
  registration_scheme?: string | null;
  registered_product_name?: string | null;
  country?: string | null;
  label_url?: string | null;
  label_reference?: string | null;
  label_version?: string | null;
  crop?: string | null;
  target?: string | null;
  rate_per_unit?: number | null;
  rate_min?: number | null;
  rate_max?: number | null;
  rate_unit?: string | null;
  rate_basis?: string | null;
  withholding_period_days?: number | null;
  withholding_period_text?: string | null;
  re_entry_period_hours?: number | null;
  re_entry_period_text?: string | null;
  /** Per-use label rows, when the lookup resolved the actual label. */
  registered_uses?: ReverifyCandidateUse[] | null;
}

export type ReverifyLookup = (identity: ReverifyIdentity) => Promise<ReverifyCandidate[]>;


/* ----------------------------------------------------------------- diff */

export type ReverifySection = "chemistry" | "registration" | "uses";

export interface ReverifyDiffEntry {
  section: ReverifySection;
  label: string;
  before: string;
  after: string;
}

export const SECTION_LABEL: Record<ReverifySection, string> = {
  chemistry: "Chemistry",
  registration: "Registration",
  uses: "Registered uses",
};

const DASH = "—";
const txt = (v: unknown): string => {
  if (v == null || v === "") return DASH;
  if (typeof v === "number") return formatChemicalNumber(v);
  return String(v).trim() || DASH;
};

const activeConcentration = (a: WriteActiveIngredient): string =>
  a.concentration == null ? DASH : `${formatChemicalNumber(a.concentration)} ${a.concentration_unit ?? ""}`.trim();

const activeGroup = (a: WriteActiveIngredient): string =>
  a.activity_group?.code
    ? `${a.activity_group.scheme.toUpperCase()} ${a.activity_group.code}`
    : DASH;

const rateText = (r: WriteLabelRate | undefined): string => {
  if (!r) return DASH;
  const value =
    r.min_value != null || r.max_value != null
      ? `${txt(r.min_value)}–${txt(r.max_value)}`
      : txt(r.value);
  return `${value} ${r.unit ?? ""}`.trim();
};

const useKey = (u: WriteRegisteredUse) =>
  `${(u.crop ?? "").trim().toLowerCase()}|${(u.target_raw ?? "").trim().toLowerCase()}`;

/** Human-readable, prioritised structured diff. Never raw JSON. */
export function diffChemicalDrafts(
  before: ChemicalIntelligenceDraft,
  after: ChemicalIntelligenceDraft,
): ReverifyDiffEntry[] {
  const out: ReverifyDiffEntry[] = [];
  const push = (section: ReverifySection, label: string, b: string, a: string) => {
    if (b !== a) out.push({ section, label, before: b, after: a });
  };

  // --- chemistry -----------------------------------------------------------
  const beforeActives = new Map(before.actives.map((a) => [a.name.trim().toLowerCase(), a]));
  const afterActives = new Map(after.actives.map((a) => [a.name.trim().toLowerCase(), a]));
  for (const [key, a] of afterActives) {
    const prior = beforeActives.get(key);
    if (!prior) {
      out.push({ section: "chemistry", label: `Active added: ${a.name}`, before: DASH, after: `${activeConcentration(a)} · ${activeGroup(a)}` });
      continue;
    }
    push("chemistry", `${a.name} — concentration`, activeConcentration(prior), activeConcentration(a));
    push("chemistry", `${a.name} — activity group`, activeGroup(prior), activeGroup(a));
  }
  for (const [key, a] of beforeActives) {
    if (!afterActives.has(key)) {
      out.push({ section: "chemistry", label: `Active removed: ${a.name}`, before: `${activeConcentration(a)} · ${activeGroup(a)}`, after: DASH });
    }
  }

  // --- registration --------------------------------------------------------
  const rb = before.registration;
  const ra = after.registration;
  push("registration", "Country", txt(rb.country), txt(ra.country));
  push("registration", "Register", txt(rb.scheme?.toUpperCase()), txt(ra.scheme?.toUpperCase()));
  push("registration", "Registration number", txt(rb.number), txt(ra.number));
  push("registration", "Registrant", txt(rb.registrant), txt(ra.registrant));
  push("registration", "Registered product name", txt(rb.registered_product_name), txt(ra.registered_product_name));
  push("registration", "Label reference", txt(rb.label_reference), txt(ra.label_reference));
  push("registration", "Label version", txt(rb.label_version), txt(ra.label_version));

  // --- registered uses -----------------------------------------------------
  const beforeUses = new Map(before.registeredUses.map((u) => [useKey(u), u]));
  const afterUses = new Map(after.registeredUses.map((u) => [useKey(u), u]));
  for (const [key, u] of afterUses) {
    const label = `${u.crop || "Any crop"} · ${u.target_raw || "Any target"}`;
    const prior = beforeUses.get(key);
    if (!prior) {
      out.push({ section: "uses", label: `Use added: ${label}`, before: DASH, after: rateText(u.rates?.[0]) });
      continue;
    }
    push("uses", `${label} — rate`, rateText(prior.rates?.[0]), rateText(u.rates?.[0]));
    push("uses", `${label} — withholding period`, txt(prior.withholding_period_days), txt(u.withholding_period_days));
    push("uses", `${label} — re-entry period`, txt(prior.re_entry_period_hours), txt(u.re_entry_period_hours));
  }
  for (const [key, u] of beforeUses) {
    if (!afterUses.has(key)) {
      out.push({
        section: "uses",
        label: `Use removed: ${u.crop || "Any crop"} · ${u.target_raw || "Any target"}`,
        before: rateText(u.rates?.[0]),
        after: DASH,
      });
    }
  }

  return out;
}

/* --------------------------------------------------------------- results */

export type ReverifyOutcome = "current" | "updated" | "needs_review" | "failed";

export interface ReverifyResult {
  outcome: ReverifyOutcome;
  /** Headline for the operator. */
  title: string;
  detail: string;
  identity?: ReverifyIdentity;
  /** Only present for "current" (refreshed evidence) and "updated" (proposal). */
  proposed?: ChemicalIntelligenceDraft;
  diff: ReverifyDiffEntry[];
  /**
   * Relationship between the re-verified registration and the CURRENT
   * vineyard. A confirmed foreign registration is never "verified for this
   * vineyard" — see contract §9.
   */
  jurisdiction?: JurisdictionSuitability;
}

const normName = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Generic descriptors that never distinguish one registered formulation from
 * another. Everything else — "forte", "duo", "500SC", "gold" — DOES.
 */
const GENERIC_NAME_TOKENS = new Set([
  "fungicide",
  "insecticide",
  "herbicide",
  "miticide",
  "acaricide",
  "product",
  "brand",
]);

/** Distinguishing token sequence for a product name (® / ™ / case stripped). */
export function productNameTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .replace(/[®™]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !GENERIC_NAME_TOKENS.has(t));
}

/**
 * Does the retrieved candidate describe the SAME registered product?
 *
 * Substring matching is unsafe here: "Custodia" is a substring of
 * "Custodia Forte", which is a different formulation with different active
 * concentrations. Names must match token-for-token once generic descriptors
 * (®, "Fungicide", …) are removed; anything else is a review, not a match.
 */
export function candidateMatchesIdentity(
  identity: ReverifyIdentity,
  candidate: ReverifyCandidate,
): boolean {
  if (identity.registrationNumber && candidate.registration_number) {
    return (
      normName(identity.registrationNumber) === normName(candidate.registration_number)
    );
  }
  const wantRaw = identity.productName ?? identity.query;
  const want = productNameTokens(wantRaw);
  const got = productNameTokens(candidate.registered_product_name ?? candidate.product_name);
  if (!want.length || !got.length) return false;
  return want.join(" ") === got.join(" ");
}


const lookupSourceName = "VineTrack chemical lookup";

function candidateSources(
  base: WriteDataSource[],
  candidate: ReverifyCandidate,
  usedReference: boolean,
  labelEvidenced = false,
): WriteDataSource[] {
  const now = new Date().toISOString();
  const ref = candidate.label_reference ?? candidate.label_url ?? undefined;
  let sources = withSource(base, {
    // Lookup/AI extraction is assistance only — never authoritative.
    kind: "ai_interpretation",
    name: lookupSourceName,
    reference: ref,
    retrieved_at: now,
  }).map((s) =>
    s.name === lookupSourceName ? { ...s, retrieved_at: now, reference: ref ?? s.reference } : s,
  );
  if (usedReference) sources = withSource(sources, activityGroupReferenceSource());
  if (labelEvidenced && ref) {
    sources = withSource(sources, {
      kind: "manufacturer_label",
      name: "Registered product label",
      reference: ref,
      retrieved_at: now,
    });
  }
  return sources;
}

/* ------------------------------------------------- label period parsing */

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const readNumber = (token: string): number | undefined => {
  const n = Number(token);
  if (Number.isFinite(n)) return n;
  return WORD_NUMBERS[token.toLowerCase()];
};

/**
 * Parse a label withholding period into DAYS. "Four weeks" is 28 days — never
 * 14 — and anything that is not an explicit duration returns undefined so the
 * caller can flag it unresolved instead of inventing a number.
 */
export function parseWithholdingDays(text: string | null | undefined): number | undefined {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  const m = raw.match(/(\d+(?:\.\d+)?|[a-z]+)\s*(day|days|week|weeks|month|months)\b/);
  if (!m) return undefined;
  const n = readNumber(m[1]);
  if (n == null) return undefined;
  const mult = m[2].startsWith("day") ? 1 : m[2].startsWith("week") ? 7 : 30;
  return Math.round(n * mult);
}

/**
 * Parse a re-entry interval into HOURS. Instructions such as "until the spray
 * has dried" are NOT a duration and must never be fabricated into 24 hours.
 */
export function parseReEntryHours(text: string | null | undefined): number | undefined {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  const m = raw.match(/(\d+(?:\.\d+)?|[a-z]+)\s*(hour|hours|hrs|hr|day|days)\b/);
  if (!m) return undefined;
  const n = readNumber(m[1]);
  if (n == null) return undefined;
  return Math.round(m[2].startsWith("d") ? n * 24 : n);
}

/* ------------------------------------------------------- use expansion */

const TARGET_SPLIT = /\s*(?:,|;|\band\b|\/|\+|&)\s*/i;

/** Split a composite target string ("Powdery mildew, Downy mildew") into parts. */
export function splitRegisteredTargets(text: string | null | undefined): string[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  return raw
    .split(TARGET_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Turn one authoritative label row into independent structured uses. Where a
 * single row lists several targets, each target becomes its own use and the
 * shared rate is NOT copied across them — the per-target rate is unresolved
 * until the label is read properly.
 */
function expandCandidateUse(
  raw: ReverifyCandidateUse,
  unresolved: Set<string>,
): WriteRegisteredUse[] {
  const targets = splitRegisteredTargets(raw.target);
  const crop = (raw.crop ?? "Grapevines").trim();

  const hasRateValue =
    raw.rate_per_unit != null || raw.rate_min != null || raw.rate_max != null;
  const unit = (raw.rate_unit ?? "").trim();
  if (hasRateValue && !unit) unresolved.add("registered_uses.rates");

  const whp =
    raw.withholding_period_days ?? parseWithholdingDays(raw.withholding_period_text);
  if (whp == null && raw.withholding_period_text) {
    unresolved.add("registered_uses.withholding_period_days");
  }
  const rei = raw.re_entry_period_hours ?? parseReEntryHours(raw.re_entry_period_text);
  if (rei == null && raw.re_entry_period_text) {
    unresolved.add("registered_uses.re_entry_period_hours");
  }

  // One rate cannot describe several targets.
  const shareRate = targets.length <= 1;
  if (!shareRate && hasRateValue) unresolved.add("registered_uses.rates");

  const rates: WriteLabelRate[] =
    shareRate && hasRateValue && unit
      ? [
          {
            label: "",
            basis: normaliseLabelRateBasis(raw.rate_basis),
            unit,
            value: raw.rate_per_unit ?? undefined,
            min_value: raw.rate_min ?? undefined,
            max_value: raw.rate_max ?? undefined,
          },
        ]
      : [];

  const list = targets.length ? targets : [""];
  return list.map((target) => ({
    crop,
    target_raw: target,
    rates,
    withholding_period_days: whp ?? undefined,
    re_entry_period_hours: rei ?? undefined,
    restrictions: (raw.restrictions ?? "").trim() || undefined,
  }));
}


/** Build the proposed structured draft from a retrieved candidate. */
export function proposedDraftFromCandidate(
  before: ChemicalIntelligenceDraft,
  candidate: ReverifyCandidate,
  identity: ReverifyIdentity,
): ChemicalIntelligenceDraft {
  let usedReference = false;
  const parsed = parseLegacyActiveIngredient(candidate.active_ingredient ?? "", "ai_interpretation");
  const priorByName = new Map(before.actives.map((a) => [a.name.trim().toLowerCase(), a]));

  const actives: WriteActiveIngredient[] = (parsed.length ? parsed : before.actives).map((a) => {
    const prior = priorByName.get(a.name.trim().toLowerCase());
    const group = a.activity_group ?? prior?.activity_group ?? suggestActivityGroup(a.name);
    if (group && !a.activity_group && !prior?.activity_group) usedReference = true;
    return {
      ...a,
      concentration: a.concentration ?? prior?.concentration,
      concentration_unit: a.concentration_unit ?? prior?.concentration_unit,
      activity_group: group
        ? { ...group, code: normaliseGroupCode(group.code) }
        : undefined,
      group_source: group
        ? (prior?.activity_group ? prior.group_source : "authoritative_classification")
        : undefined,
    } as WriteActiveIngredient;
  });

  const registration = { ...before.registration };
  const priorCountry = normaliseCountry(before.registration.country);
  const country = normaliseCountry(candidate.country) ?? normaliseCountry(identity.country);
  // Never silently re-key a chemical to another country's product. A stored
  // registration country wins; a differing candidate country is recorded as
  // unresolved instead of overwriting the identity.
  const countryConflict = !!priorCountry && !!country && priorCountry !== country;
  if (country && !priorCountry) registration.country = country;
  const scheme = normaliseRegistrationScheme(candidate.registration_scheme);
  if (scheme) registration.scheme = scheme;
  if (candidate.registration_number?.trim()) registration.number = candidate.registration_number.trim();
  const registrant = (candidate.registrant ?? candidate.manufacturer ?? "").trim();
  if (registrant) registration.registrant = registrant;
  const registeredName = (candidate.registered_product_name ?? candidate.product_name ?? "").trim();
  if (registeredName) registration.registered_product_name = registeredName;
  const labelRef = (candidate.label_reference ?? candidate.label_url ?? "").trim();
  if (labelRef) registration.label_reference = labelRef;
  if (candidate.label_version?.trim()) registration.label_version = candidate.label_version.trim();

  // ---------------------------------------------------------------- uses
  // Label-derived facts (registered uses, rates, WHP, re-entry) may ONLY be
  // promoted when the lookup actually resolved the registered product AND its
  // label. An AI summary that merely matched a product name is a candidate for
  // review, never authoritative label data.
  const labelEvidenced = !!labelRef && !!registration.number && !countryConflict;
  const unresolved = new Set(before.unresolvedFields);
  if (countryConflict) unresolved.add("registration_country");

  const rawUses: ReverifyCandidateUse[] = candidate.registered_uses?.length
    ? candidate.registered_uses
    : candidate.target ||
        candidate.rate_per_unit != null ||
        candidate.rate_min != null ||
        candidate.rate_max != null ||
        candidate.withholding_period_days != null ||
        candidate.withholding_period_text ||
        candidate.re_entry_period_hours != null ||
        candidate.re_entry_period_text
      ? [
          {
            crop: candidate.crop,
            target: candidate.target,
            rate_per_unit: candidate.rate_per_unit,
            rate_min: candidate.rate_min,
            rate_max: candidate.rate_max,
            rate_unit: candidate.rate_unit,
            rate_basis: candidate.rate_basis,
            withholding_period_days: candidate.withholding_period_days,
            withholding_period_text: candidate.withholding_period_text,
            re_entry_period_hours: candidate.re_entry_period_hours,
            re_entry_period_text: candidate.re_entry_period_text,
          },
        ]
      : [];

  let registeredUses = before.registeredUses;
  if (rawUses.length && !labelEvidenced) {
    // No authoritative label → keep the stored uses untouched and record what
    // still needs matching. Nothing AI-derived becomes registered data.
    unresolved.add("registered_uses");
    if (!labelRef) unresolved.add("label_reference");
    if (!registration.number) unresolved.add("registration_number");
  } else if (rawUses.length) {
    for (const raw of rawUses) {
      for (const incoming of expandCandidateUse(raw, unresolved)) {
        const idx = registeredUses.findIndex((u) => useKey(u) === useKey(incoming));
        registeredUses =
          idx >= 0
            ? registeredUses.map((u, i) =>
                i === idx
                  ? {
                      ...u,
                      rates: incoming.rates.length ? incoming.rates : u.rates,
                      withholding_period_days:
                        incoming.withholding_period_days ?? u.withholding_period_days,
                      re_entry_period_hours:
                        incoming.re_entry_period_hours ?? u.re_entry_period_hours,
                    }
                  : u,
              )
            : [...registeredUses, incoming];
      }
    }
  }

  const proposed: ChemicalIntelligenceDraft = {
    ...before,
    actives,
    registration,
    registeredUses,
    unresolvedFields: Array.from(unresolved),
    sources: candidateSources(before.sources, candidate, usedReference, labelEvidenced),
  };

  proposed.conflicts = reconcileConflicts(proposed);
  return proposed;
}

/**
 * Run a re-verification. `lookup` failures NEVER downgrade the stored record:
 * the existing draft is returned untouched with outcome "failed".
 */
export async function reverifyChemical(args: {
  draft: ChemicalIntelligenceDraft;
  productName?: string | null;
  country?: string | null;
  lookup: ReverifyLookup;
}): Promise<ReverifyResult> {
  const { draft, productName, country, lookup } = args;
  const identity = resolveReverifyIdentity(draft, productName, country);
  if (!identity) {
    return {
      outcome: "failed",
      title: "Could not re-verify",
      detail: "No product identity to look up. Add a product name or registration number first.",
      diff: [],
    };
  }

  let candidates: ReverifyCandidate[] = [];
  try {
    candidates = (await lookup(identity)) ?? [];
  } catch (e: any) {
    return {
      outcome: "failed",
      title: "Could not re-verify",
      detail: `Lookup service failed: ${e?.message ?? String(e)}. The existing verification is unchanged.`,
      identity,
      diff: [],
    };
  }

  if (!candidates.length) {
    return {
      outcome: "failed",
      title: "Could not re-verify",
      detail: `No authoritative record was returned for ${identity.description}. The existing verification is unchanged.`,
      identity,
      diff: [],
    };
  }

  const match = candidates.find((c) => candidateMatchesIdentity(identity, c));
  if (!match) {
    return {
      outcome: "needs_review",
      title: "Needs review",
      detail: `The lookup returned ${candidates.length} record(s) that do not confidently match ${identity.description}. Nothing was changed.`,
      identity,
      diff: [],
    };
  }

  const proposed = proposedDraftFromCandidate(draft, match, identity);
  const diff = diffChemicalDrafts(draft, proposed);

  if (proposed.conflicts.length > 0) {
    return {
      outcome: "needs_review",
      title: "Needs review",
      detail: "The retrieved information conflicts with the stored record. Review the differences before accepting.",
      identity,
      proposed,
      diff,
    };
  }

  if (!diff.length) {
    // No-change path: refresh evidence only, then re-resolve status normally.
    const refreshed: ChemicalIntelligenceDraft = { ...proposed };
    const status = resolveVerificationStatus(refreshed);
    refreshed.verifiedAt =
      status === "verified" || status === "partially_verified"
        ? new Date().toISOString()
        : refreshed.verifiedAt ?? null;
    return {
      outcome: "current",
      title: "Chemical information is current",
      detail: `No meaningful structured differences against ${identity.description}. Evidence timestamps refreshed.`,
      identity,
      proposed: refreshed,
      diff: [],
    };
  }

  return {
    outcome: "updated",
    title: "Updated information found",
    detail: `Authoritative information for ${identity.description} differs from the stored record. Review before accepting — nothing has been changed.`,
    identity,
    proposed,
    diff,
  };
}
