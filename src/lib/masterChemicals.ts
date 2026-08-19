// VineTrack Master Chemical Catalogue — portal integration (Stage 2).
//
// The Master Catalogue is owned by the shared VineTrack (iOS/Rork) backend
// (SQL 199). The portal is a CONSUMER only: it never creates its own
// catalogue, never writes Master chemistry from vineyard screens, and never
// reads a Saved Chemical's chemistry live from Master. A Saved Chemical keeps
// its own SQL 194 structured copy plus a link:
//
//   saved_chemicals.master_chemical_id     → which Master product it came from
//   saved_chemicals.master_source_revision → which Master revision supplied it
//
// so a later Master change can be *offered* to the grower, never silently
// applied.
//
// Backend contract (already live — DO NOT create SQL for this):
//   public.master_chemicals(
//     id, registration_country, registration_scheme, registration_number,
//     registration_identity_key, registered_product_name, registrant,
//     review_status, verification_status, active_ingredients, activity_groups,
//     activity_group_scheme, registered_uses, label_reference, label_version,
//     catalogue_version, verification_sources, verification_conflicts,
//     verification_unresolved_fields, verified_at, retrieved_at,
//     intelligence_schema_version, reviewed_at, reviewed_by, review_notes,
//     created_at, updated_at)
//   public.master_chemical_versions(
//     id, master_chemical_id, catalogue_version, snapshot, changed_at,
//     changed_by, change_reason)
//
// RLS on that project is authoritative for who may read candidates or
// approve/retire. Client-side gating here is presentation only.

import { supabase } from "@/integrations/ios-supabase/client";
import {
  draftFromRow,
  registrationIdentityKey,
  type ChemicalIntelligenceDraft,
} from "@/lib/chemicalIntelligenceWrite";
import { productNameTokens } from "@/lib/chemicalReverify";

/* ------------------------------------------------------------------ types */

/** Master catalogue lifecycle, as stored in `master_chemicals.review_status`. */
export type MasterReviewStatus = "candidate" | "approved" | "retired";

export const MASTER_REVIEW_STATUSES: MasterReviewStatus[] = [
  "candidate",
  "approved",
  "retired",
];

export const MASTER_REVIEW_STATUS_LABEL: Record<MasterReviewStatus, string> = {
  candidate: "Candidate",
  approved: "Approved",
  retired: "Retired",
};

/** Where a lookup result came from, per the Rork response envelope. */
export type MasterMatchSource = "master" | "ai_candidate" | "unresolved";

export interface MasterChemicalRow {
  id: string;
  registration_country?: string | null;
  registration_scheme?: string | null;
  registration_number?: string | null;
  registration_identity_key?: string | null;
  registered_product_name?: string | null;
  registrant?: string | null;
  review_status?: string | null;
  verification_status?: string | null;
  active_ingredients?: unknown;
  activity_groups?: string[] | null;
  activity_group_scheme?: string | null;
  registered_uses?: unknown;
  label_reference?: string | null;
  label_version?: string | null;
  catalogue_version?: number | string | null;
  verification_sources?: unknown;
  verification_conflicts?: unknown;
  verification_unresolved_fields?: unknown;
  verified_at?: string | null;
  retrieved_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_notes?: string | null;
  intelligence_schema_version?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MasterChemicalVersionRow {
  id: string;
  master_chemical_id: string;
  catalogue_version?: number | string | null;
  snapshot?: Record<string, any> | null;
  changed_at?: string | null;
  changed_by?: string | null;
  change_reason?: string | null;
}

/** Normalised Master envelope returned by `chemical-info-lookup`. */
export interface MasterLookupEnvelope {
  matchSource: MasterMatchSource;
  masterChemicalId?: string;
  masterRevision?: number;
  catalogueStatus?: MasterReviewStatus;
  registrationIdentityKey?: string;
  /** Full Master record when the backend inlined it. */
  master?: MasterChemicalRow;
}

/* ------------------------------------------------------------- normalisers */

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? undefined : s;
};

export function normaliseReviewStatus(value: unknown): MasterReviewStatus | undefined {
  const s = String(value ?? "").trim().toLowerCase();
  return (MASTER_REVIEW_STATUSES as string[]).includes(s)
    ? (s as MasterReviewStatus)
    : undefined;
}

export function normaliseMatchSource(value: unknown): MasterMatchSource {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "master") return "master";
  if (s === "ai_candidate" || s === "ai" || s === "candidate") return "ai_candidate";
  return "unresolved";
}

/** The Master revision of a record. `catalogue_version` is the Rork field. */
export function masterRevision(
  row: MasterChemicalRow | null | undefined,
): number | undefined {
  const raw = row?.catalogue_version;
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Only approved Master products are trusted by normal lookup. */
export const isApprovedMaster = (row: MasterChemicalRow | null | undefined): boolean =>
  normaliseReviewStatus(row?.review_status) === "approved";

/**
 * Parse whatever `chemical-info-lookup` returned into the Master envelope.
 * Tolerates the payload being at the top level or nested under `master`.
 */
export function parseMasterLookupEnvelope(payload: unknown): MasterLookupEnvelope {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const inline = (root.master ?? root.master_chemical ?? root.masterChemical) as
    | Record<string, any>
    | undefined;
  const src = inline && typeof inline === "object" ? { ...root, ...inline } : root;

  const matchSource = normaliseMatchSource(root.match_source ?? root.matchSource);
  const catalogueStatus =
    normaliseReviewStatus(src.catalogue_status ?? src.catalogueStatus ?? src.review_status);

  const revisionRaw = src.master_revision ?? src.masterRevision ?? src.catalogue_version;
  const revision = revisionRaw == null || revisionRaw === "" ? undefined : Number(revisionRaw);

  const master: MasterChemicalRow | undefined =
    inline && typeof inline === "object" && str(inline.id)
      ? ({ ...(inline as MasterChemicalRow) })
      : undefined;

  return {
    matchSource,
    masterChemicalId: str(src.master_chemical_id ?? src.masterChemicalId ?? inline?.id),
    masterRevision: Number.isFinite(revision as number) ? (revision as number) : undefined,
    catalogueStatus,
    registrationIdentityKey: str(
      src.registration_identity_key ?? src.registrationIdentityKey,
    ),
    master,
  };
}

/**
 * Is this envelope a trusted Master hit? Only `match_source = "master"` with
 * an approved catalogue status counts — a seeded candidate must never be
 * presented to a normal user as a verified VineTrack chemical.
 */
export function isTrustedMasterEnvelope(env: MasterLookupEnvelope): boolean {
  return env.matchSource === "master" && env.catalogueStatus === "approved";
}

/* ------------------------------------------------------------- identity */

const normKey = (s: string | null | undefined) =>
  (s ?? "").trim().toUpperCase().replace(/\s+/g, "");

/**
 * Exact identity matching only — never substring. "Custodia Forte" must never
 * resolve to "Custodia 320 SC", and vice-versa.
 *
 * Order per contract §12: registration identity first, then exact unique
 * product identity (token-for-token name equality).
 */
export function matchMasterByIdentity(
  rows: MasterChemicalRow[],
  opts: { identityKey?: string | null; productName?: string | null },
): MasterChemicalRow | null {
  const approved = rows.filter(isApprovedMaster);
  const key = normKey(opts.identityKey);
  if (key) {
    const byKey = approved.filter((r) => normKey(r.registration_identity_key) === key);
    if (byKey.length === 1) return byKey[0];
    if (byKey.length > 1) return null;
  }
  const want = productNameTokens(opts.productName).join(" ");
  if (!want) return null;
  const byName = approved.filter(
    (r) => productNameTokens(r.registered_product_name).join(" ") === want,
  );
  return byName.length === 1 ? byName[0] : null;
}

/** Registration identity key of a Master row, derived when not stored. */
export function masterIdentityKey(row: MasterChemicalRow): string | null {
  const stored = str(row.registration_identity_key);
  if (stored) return stored;
  return registrationIdentityKey({
    country: row.registration_country ?? undefined,
    scheme: (row.registration_scheme as any) ?? undefined,
    number: row.registration_number ?? undefined,
  });
}

/* ---------------------------------------------------- master → sql/194 copy */

/**
 * Structured Chemical Intelligence copy of a Master record. Master rows carry
 * the same SQL 194 column names, so the canonical rehydrator is reused — the
 * portal never re-derives chemistry from free text.
 */
export function masterChemicalDraft(row: MasterChemicalRow): ChemicalIntelligenceDraft {
  return draftFromRow(row as Record<string, any>);
}

/** Fields a vineyard owns locally; a Master update must never touch them. */
export const LOCAL_COMMERCIAL_FIELDS = [
  "manufacturer",
  "notes",
  "purchase",
  "pack_size",
  "rate_per_ha",
  "unit",
  "product_url",
] as const;

/* --------------------------------------------------------- update detection */

export interface MasterLinkedSaved {
  master_chemical_id?: string | null;
  master_source_revision?: number | string | null;
}

/** True when the linked Master has moved on from the saved revision. */
export function masterUpdateAvailable(
  saved: MasterLinkedSaved | null | undefined,
  master: MasterChemicalRow | null | undefined,
): boolean {
  if (!saved?.master_chemical_id || !master) return false;
  if (!isApprovedMaster(master)) return false;
  const current = masterRevision(master);
  if (current == null) return false;
  const savedRev = saved.master_source_revision;
  const savedNum = savedRev == null || savedRev === "" ? null : Number(savedRev);
  if (savedNum == null || !Number.isFinite(savedNum)) return true;
  return current > savedNum;
}

export const MASTER_UPDATE_MESSAGE = "Updated verified information available";
export const MASTER_CURRENT_MESSAGE = "Chemical information is current";

/* --------------------------------------------------------------- queries */

const TABLE = "master_chemicals";
const VERSIONS = "master_chemical_versions";

/**
 * Trusted (approved-only) Master search used by the normal lookup path.
 *
 * Jurisdiction first: the vineyard's country is a REQUIRED filter applied in
 * the query itself. Without a vineyard country the search fails closed and
 * returns nothing — the portal never searches all Master products and then
 * checks the country afterwards.
 */
export async function searchApprovedMasterChemicals(
  query: string,
  country?: string | null,
): Promise<MasterChemicalRow[]> {
  const q = (query ?? "").trim();
  const c = vineyardCountryCode(country);
  if (q.length < 2 || !c) return [];
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select("*")
    .eq("review_status", "approved")
    .eq("registration_country", c)
    .ilike("registered_product_name", `%${q}%`)
    .limit(25);
  if (error) throw error;
  // Defensive: never serve a row the backend did not scope to this country.
  return ((data ?? []) as MasterChemicalRow[]).filter((r) =>
    masterEligibleForVineyard(r.registration_country, c),
  );
}


export async function fetchMasterChemical(id: string): Promise<MasterChemicalRow | null> {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as MasterChemicalRow) ?? null;
}

export interface MasterAdminFilters {
  status?: MasterReviewStatus | "all";
  country?: string | "all";
  verification?: string | "all";
  search?: string;
}

/** Admin list. Candidate visibility is enforced by RLS, not by this filter. */
export async function listMasterChemicals(
  filters: MasterAdminFilters = {},
): Promise<MasterChemicalRow[]> {
  let sel = (supabase as any)
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (filters.status && filters.status !== "all") sel = sel.eq("review_status", filters.status);
  if (filters.country && filters.country !== "all")
    sel = sel.eq("registration_country", filters.country);
  if (filters.verification && filters.verification !== "all")
    sel = sel.eq("verification_status", filters.verification);
  const q = str(filters.search);
  if (q) sel = sel.ilike("registered_product_name", `%${q}%`);
  const { data, error } = await sel;
  if (error) throw error;
  return (data ?? []) as MasterChemicalRow[];
}

export async function fetchMasterVersions(
  masterChemicalId: string,
): Promise<MasterChemicalVersionRow[]> {
  const { data, error } = await (supabase as any)
    .from(VERSIONS)
    .select("*")
    .eq("master_chemical_id", masterChemicalId)
    .order("changed_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as MasterChemicalVersionRow[];
}

/**
 * Approve / retire. The backend (RLS + evidence rules) is authoritative: the
 * portal never bypasses it, it only surfaces the refusal reason.
 */
export async function setMasterReviewStatus(
  id: string,
  status: MasterReviewStatus,
  notes?: string | null,
): Promise<MasterChemicalRow> {
  const patch: Record<string, any> = { review_status: status };
  const n = str(notes);
  if (n) patch.review_notes = n;
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(masterWriteMessage(error, status));
  if (!data) throw new Error(masterWriteMessage({ message: "no row returned" }, status));
  return data as MasterChemicalRow;
}

/** Human explanation for a blocked approval/retirement. */
export function masterWriteMessage(error: any, status: MasterReviewStatus): string {
  const raw = String(error?.message ?? error ?? "").trim();
  const verb = status === "approved" ? "Approval" : status === "retired" ? "Retirement" : "Update";
  if (/row-level security|permission denied|no row returned/i.test(raw)) {
    return `${verb} was refused by the VineTrack backend. You may not have System Admin rights, or the record does not meet the evidence requirements for approval.`;
  }
  return raw ? `${verb} blocked: ${raw}` : `${verb} blocked by the VineTrack backend.`;
}

/* ------------------------------------------------- approval readiness (UI) */

export interface ApprovalReadiness {
  ready: boolean;
  reasons: string[];
}

/**
 * Mirror of the backend's evidence expectations, for UI messaging only. The
 * backend remains the authority — this never unlocks anything the backend
 * would refuse, it just explains a likely refusal up front.
 */
export function approvalReadiness(row: MasterChemicalRow): ApprovalReadiness {
  const reasons: string[] = [];
  const draft = masterChemicalDraft(row);
  if (!draft.actives.length) reasons.push("No structured active ingredients recorded.");
  if (draft.actives.some((a) => !a.activity_group?.code))
    reasons.push("One or more actives have no FRAC/HRAC/IRAC group.");
  if (!masterIdentityKey(row)) reasons.push("No registration identity (country, scheme, number).");
  if (!str(row.label_reference)) reasons.push("No authoritative label reference.");
  if (!str(row.registrant)) reasons.push("No registrant recorded.");
  const unresolved = Array.isArray(row.verification_unresolved_fields)
    ? (row.verification_unresolved_fields as unknown[]).filter(Boolean)
    : [];
  if (unresolved.length) reasons.push(`Unresolved fields: ${unresolved.join(", ")}.`);
  const conflicts = Array.isArray(row.verification_conflicts)
    ? (row.verification_conflicts as unknown[]).length
    : 0;
  if (conflicts) reasons.push(`${conflicts} unresolved verification conflict(s).`);
  return { ready: reasons.length === 0, reasons };
}
