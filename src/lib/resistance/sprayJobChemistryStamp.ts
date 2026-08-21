// P8 — Plan → Spray Job → completed Spray Record chemistry integrity.
//
// A Spray Job used to persist only the product NAME, rate and unit. Every
// other resistance-relevant fact (activity groups, evidence quality, the
// registration identity of the exact label chosen, the actives of a
// multi-active product) was re-derived from the CURRENT Saved Chemical every
// time the job was reopened. Two consequences, both defects:
//
//  * A Saved Chemical re-verified after the job was created silently rewrote
//    what that job was understood to apply.
//  * Plan → Job deviation comparison read `chemical_lines[].activity_groups`,
//    which nothing ever wrote — so a linked job could never be compared.
//
// This module freezes the chemistry that was actually SELECTED onto the job
// line itself (inside the existing `chemical_lines` JSON — no schema change).
// It is deliberately NOT the completion snapshot: `sprayChemicalSnapshot`
// still owns the immutable record-time evidence. This is the planned-intent
// stamp that lives on the job between plan and completion.
import type {
  WriteActivityGroup,
  WriteVerificationStatus,
} from "@/lib/chemicalIntelligenceWrite";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { registrationIdentityKey } from "@/lib/sprayChemicalSnapshot";
import { qualifiedGroupCode } from "./resistanceGroupSource";

export interface StampedActive {
  name: string;
  concentration?: number | null;
  concentration_unit?: string | null;
  activity_group?: { scheme: string; code: string } | null;
}

export interface JobChemistryStamp {
  /** Identity of the Saved Chemical this stamp describes. */
  saved_chemical_id?: string | null;
  activity_groups: WriteActivityGroup[];
  verification_status: WriteVerificationStatus;
  registration_identity_key?: string | null;
  country_code?: string | null;
  actives?: StampedActive[];
  stamped_at?: string | null;
}

const scheme = (raw: unknown): WriteActivityGroup["scheme"] => {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "frac" || s === "hrac" || s === "irac") return s;
  return "not_applicable";
};

const VERIFICATION: WriteVerificationStatus[] = [
  "verified",
  "partially_verified",
  "unverified",
  "needs_match",
  "conflict",
];

const verification = (raw: unknown): WriteVerificationStatus => {
  const s = String(raw ?? "").trim().toLowerCase() as WriteVerificationStatus;
  return VERIFICATION.includes(s) ? s : "unverified";
};

/** Groups as written by the domain layer, de-duplicated and scheme-preserving. */
function groupList(raw: unknown): WriteActivityGroup[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: WriteActivityGroup[] = [];
  for (const entry of list) {
    const code =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? String((entry as any).code ?? "")
          : "";
    if (!code.trim()) continue;
    const g: WriteActivityGroup = {
      scheme: typeof entry === "string" ? "frac" : scheme((entry as any).scheme),
      code: code.trim(),
    };
    if (!out.some((o) => o.scheme === g.scheme && o.code === g.code)) out.push(g);
  }
  return out;
}

/**
 * Build the stamp for a product line that has just been chosen/edited.
 * `null` when there is genuinely nothing to freeze — an unlinked, unverified
 * line with no groups is not made to look like recorded chemistry.
 */
export function chemistryStampFromLine(line: {
  activityGroups?: WriteActivityGroup[] | null;
  verificationStatus?: WriteVerificationStatus | null;
  intelligence?: ChemicalIntelligence | null;
  savedChemicalId?: string | null;
}): JobChemistryStamp | null {
  const groups = groupList(line.activityGroups);
  const intel = line.intelligence ?? null;
  const actives: StampedActive[] = (intel?.structured ? intel.actives : []).map((a) => ({
    name: a.name ?? "",
    ...(a.concentration != null ? { concentration: a.concentration } : {}),
    ...(a.unit ? { concentration_unit: a.unit } : {}),
    ...(a.group?.code
      ? { activity_group: { scheme: scheme(a.group.scheme), code: a.group.code } }
      : {}),
  }));
  const identity = intel
    ? registrationIdentityKey(
        intel.product.country,
        intel.product.registrationScheme,
        intel.product.registrationNumber,
      )
    : undefined;

  if (
    groups.length === 0 &&
    actives.length === 0 &&
    !identity &&
    !line.savedChemicalId
  ) {
    return null;
  }
  return {
    saved_chemical_id: line.savedChemicalId ?? null,
    activity_groups: groups,
    verification_status: verification(line.verificationStatus),
    ...(identity ? { registration_identity_key: identity } : {}),
    ...(intel?.product.country ? { country_code: intel.product.country.toUpperCase() } : {}),
    ...(actives.length ? { actives } : {}),
    stamped_at: new Date().toISOString(),
  };
}

/** Defensive read of a stamp already stored on a persisted line. Never throws. */
export function readChemistryStamp(line: unknown): JobChemistryStamp | null {
  if (!line || typeof line !== "object") return null;
  const o = line as Record<string, any>;
  const groups = groupList(o.activity_groups);
  const actives = Array.isArray(o.actives)
    ? o.actives
        .filter((a: any) => a && typeof a === "object")
        .map((a: any) => ({
          name: String(a.name ?? ""),
          ...(Number.isFinite(Number(a.concentration))
            ? { concentration: Number(a.concentration) }
            : {}),
          ...(a.concentration_unit ? { concentration_unit: String(a.concentration_unit) } : {}),
          ...(a.activity_group?.code
            ? {
                activity_group: {
                  scheme: scheme(a.activity_group.scheme),
                  code: String(a.activity_group.code),
                },
              }
            : {}),
        }))
    : [];
  const identity =
    typeof o.registration_identity_key === "string" ? o.registration_identity_key : null;
  const hasVerification = typeof o.verification_status === "string";
  if (groups.length === 0 && actives.length === 0 && !identity && !hasVerification) return null;
  return {
    saved_chemical_id:
      typeof o.saved_chemical_id === "string"
        ? o.saved_chemical_id
        : typeof o.savedChemicalId === "string"
          ? o.savedChemicalId
          : null,
    activity_groups: groups,
    verification_status: verification(o.verification_status),
    registration_identity_key: identity,
    country_code: typeof o.country_code === "string" ? o.country_code : null,
    actives,
    stamped_at: typeof o.stamped_at === "string" ? o.stamped_at : null,
  };
}

/**
 * Scheme-qualified codes for a stamp — "HRAC 9" stays distinct from FRAC 9.
 * Multi-active products keep EVERY group; nothing is collapsed to the first.
 */
export function stampGroupCodes(stamp: JobChemistryStamp | null): string[] {
  if (!stamp) return [];
  const out: string[] = [];
  const push = (s: unknown, c: unknown) => {
    const q = qualifiedGroupCode(String(s ?? ""), c == null ? null : String(c));
    if (q && !out.includes(q)) out.push(q);
  };
  for (const g of stamp.activity_groups) push(g.scheme, g.code);
  for (const a of stamp.actives ?? []) {
    if (a.activity_group?.code) push(a.activity_group.scheme, a.activity_group.code);
  }
  return out;
}

/** Every scheme-qualified group a saved job's lines carry. */
export function jobGroupCodes(job: {
  chemical_lines?: unknown[] | null;
}): string[] {
  const out: string[] = [];
  for (const line of job.chemical_lines ?? []) {
    for (const code of stampGroupCodes(readChemistryStamp(line))) {
      if (!out.includes(code)) out.push(code);
    }
  }
  return out;
}

/**
 * True when the CURRENT Saved Chemical no longer describes the chemistry that
 * was stamped onto the job. Surfaced to the operator; never auto-applied.
 */
export function stampDivergesFromCurrent(
  stamp: JobChemistryStamp | null,
  intel: ChemicalIntelligence | null | undefined,
): boolean {
  if (!stamp || !intel?.structured) return false;
  const current = intel.activityGroups
    .map((g) => qualifiedGroupCode(g.scheme, g.code))
    .filter((c): c is string => !!c)
    .sort();
  const stamped = stampGroupCodes(stamp).sort();
  if (current.join("|") !== stamped.join("|")) return true;
  return intel.verification.status !== stamp.verification_status;
}

/** A stamp only describes the product it was taken from. */
export function stampMatchesLine(
  stamp: JobChemistryStamp | null | undefined,
  savedChemicalId: string | null | undefined,
): boolean {
  if (!stamp) return false;
  return (stamp.saved_chemical_id ?? null) === (savedChemicalId ?? null);
}
