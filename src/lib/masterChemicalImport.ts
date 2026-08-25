// Master Catalogue — APVMA import / refresh (admin only).
//
// The ingestion pipeline lives in the shared VineTrack backend edge function
// `chemical-info-lookup`. The portal never scrapes APVMA itself, never invents
// chemistry, and never writes `master_chemicals` rows directly from an import:
// it asks the backend to ingest, then re-reads the row the backend produced.
//
// Non-negotiable guards implemented here:
//   * Identity is exact. A request for APVMA 66541 (Custodia) can never come
//     back as 91636 (Custodia Forte) — number equality, then token-for-token
//     product name equality. Anything else is reported as unresolved.
//   * Import and refresh NEVER approve. Whatever `review_status` the backend
//     assigns stands; the portal only ever asks for a candidate.
//   * Saved Chemicals and historical spray records are untouched.

import { supabase } from "@/integrations/ios-supabase/client";
import {
  registrationIdentityKey,
  normaliseCountry,
} from "@/lib/chemicalIntelligenceWrite";
import { productNameTokens } from "@/lib/chemicalReverify";
import {
  fetchMasterChemical,
  masterIdentityKey,
  parseMasterLookupEnvelope,
  type MasterChemicalRow,
  type MasterLookupEnvelope,
} from "@/lib/masterChemicals";

export const APVMA_COUNTRY = "AU";
export const APVMA_SCHEME = "apvma";

import { withClientDiagnostics } from "@/lib/chemicalLookupRequest";

const LOOKUP_FUNCTION = "chemical-info-lookup";

/* ------------------------------------------------------------- query kind */

export type ApvmaQueryKind = "registration_number" | "product_name";

export interface ApvmaQuery {
  kind: ApvmaQueryKind;
  /** Raw text the admin typed. */
  raw: string;
  registrationNumber?: string;
  productName?: string;
  /** `AU:apvma:66541` when a number was supplied. */
  identityKey?: string;
  description: string;
}

const trim = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Classify what the admin typed. "66541", "APVMA 66541" and "No. 66541/1234"
 * are registration numbers; anything containing letters beyond the APVMA
 * prefix is treated as a product name.
 */
export function parseApvmaQuery(raw: string | null | undefined): ApvmaQuery | null {
  const value = trim(raw);
  if (!value) return null;

  const stripped = value
    .replace(/^\s*(apvma|acn|reg(?:istration)?(?:\s*(?:no|number|#))?)\b[\s.:#]*/i, "")
    .trim();

  if (/^\d{3,8}(\/\d{1,6})?$/.test(stripped)) {
    const number = stripped;
    return {
      kind: "registration_number",
      raw: value,
      registrationNumber: number,
      identityKey:
        registrationIdentityKey({
          country: APVMA_COUNTRY,
          scheme: APVMA_SCHEME,
          number,
        }) ?? undefined,
      description: `APVMA registration number ${number} (Australia)`,
    };
  }

  return {
    kind: "product_name",
    raw: value,
    productName: value,
    description: `Registered product name "${value}" (Australia)`,
  };
}

/* ----------------------------------------------------------- request body */

export type ApvmaRequestMode = "import" | "refresh";

export interface ApvmaLookupBody {
  /** Required by the deployed resolver; without it it returns "Unknown action". */
  action: "structured";
  productName?: string;
  mode: "master_import" | "master_refresh";
  country: string;
  country_code: string;
  registration_scheme: string;
  registration_number?: string;
  product_name?: string;
  master_chemical_id?: string;
  /** The portal never asks the backend to approve anything. */
  target_review_status: "candidate";
  structured: true;
}

export function buildApvmaLookupBody(
  query: ApvmaQuery,
  opts: { mode?: ApvmaRequestMode; masterChemicalId?: string } = {},
): ApvmaLookupBody {
  return {
    action: "structured",
    productName: query.productName ?? query.registrationNumber,
    mode: opts.mode === "refresh" ? "master_refresh" : "master_import",
    country: APVMA_COUNTRY,
    country_code: APVMA_COUNTRY,
    registration_scheme: APVMA_SCHEME,
    registration_number: query.registrationNumber,
    product_name: query.productName ?? query.registrationNumber,
    master_chemical_id: opts.masterChemicalId,
    target_review_status: "candidate",
    structured: true,
  };
}

/* --------------------------------------------------------- identity guard */

const normNumber = (v: string | null | undefined) =>
  trim(v).toUpperCase().replace(/\s+/g, "");

/**
 * Does the row the backend produced actually describe the product that was
 * requested? Substring matching is forbidden — "Custodia" is a substring of
 * "Custodia Forte".
 */
export function importedRowMatchesQuery(
  query: ApvmaQuery,
  row: MasterChemicalRow | null | undefined,
): boolean {
  if (!row) return false;
  if (normaliseCountry(row.registration_country) !== APVMA_COUNTRY) return false;

  if (query.kind === "registration_number") {
    const want = normNumber(query.registrationNumber);
    const got = normNumber(row.registration_number);
    if (got) return got === want;
    // No number on the row — fall back to the identity key, never to the name.
    const key = masterIdentityKey(row);
    return !!query.identityKey && !!key && key.toUpperCase() === query.identityKey.toUpperCase();
  }

  const want = productNameTokens(query.productName).join(" ");
  if (!want) return false;
  return productNameTokens(row.registered_product_name).join(" ") === want;
}

/* ------------------------------------------------------------- outcomes */

export type ApvmaImportOutcome =
  | "imported"
  | "updated"
  | "already_present"
  | "identity_mismatch"
  | "unresolved";

export interface ApvmaImportResult {
  outcome: ApvmaImportOutcome;
  query: ApvmaQuery;
  row: MasterChemicalRow | null;
  envelope: MasterLookupEnvelope | null;
  message: string;
  /** What the backend returned when nothing usable could be resolved. */
  rejectedName?: string;
}

export function importResultMessage(
  outcome: ApvmaImportOutcome,
  query: ApvmaQuery,
  row?: MasterChemicalRow | null,
  rejectedName?: string,
): string {
  const name = row?.registered_product_name ?? query.productName ?? query.registrationNumber ?? "";
  switch (outcome) {
    case "imported":
      return `${name} imported as a Candidate. Review the evidence before approving.`;
    case "updated":
      return `${name} refreshed from APVMA. The record remains a Candidate until approved.`;
    case "already_present":
      return `${name} is already in the Master Catalogue. Opened for review.`;
    case "identity_mismatch":
      return `APVMA returned "${rejectedName ?? "a different product"}" for ${query.description}. That is a different registered product, so nothing was imported.`;
    default:
      return `No APVMA record could be resolved for ${query.description}.`;
  }
}

/* --------------------------------------------------------------- queries */

/** Existing Master row for this identity, in ANY review status. */
export async function findExistingMaster(
  query: ApvmaQuery,
): Promise<MasterChemicalRow | null> {
  let sel = (supabase as any)
    .from("master_chemicals")
    .select("*")
    .eq("registration_country", APVMA_COUNTRY)
    .limit(50);
  if (query.registrationNumber) {
    sel = sel.eq("registration_number", query.registrationNumber);
  } else {
    sel = sel.ilike("registered_product_name", `%${trim(query.productName)}%`);
  }
  const { data, error } = await sel;
  if (error) throw error;
  const rows = (data ?? []) as MasterChemicalRow[];
  const exact = rows.filter((r) => importedRowMatchesQuery(query, r));
  return exact.length === 1 ? exact[0] : null;
}

async function resolveEnvelopeRow(
  envelope: MasterLookupEnvelope,
): Promise<MasterChemicalRow | null> {
  if (envelope.master?.id) return envelope.master;
  if (envelope.masterChemicalId) return await fetchMasterChemical(envelope.masterChemicalId);
  return null;
}

async function invokeLookup(body: ApvmaLookupBody) {
  const { data, error } = await supabase.functions.invoke(LOOKUP_FUNCTION, {
    body: withClientDiagnostics(body as unknown as Record<string, unknown>),
  });
  if (error) {
    const serverMsg = (data as any)?.error;
    throw new Error(
      typeof serverMsg === "string" && serverMsg
        ? serverMsg
        : "APVMA lookup failed. Please try again in a moment.",
    );
  }
  return data;
}

/**
 * Import (or re-open) an APVMA product into the Master Catalogue.
 * Never approves; never edits Saved Chemicals.
 */
export async function importFromApvma(rawQuery: string): Promise<ApvmaImportResult> {
  const query = parseApvmaQuery(rawQuery);
  if (!query) {
    throw new Error("Enter an APVMA registration number or a registered product name.");
  }

  const existing = await findExistingMaster(query);

  const data = await invokeLookup(buildApvmaLookupBody(query, { mode: "import" }));
  const envelope = parseMasterLookupEnvelope(data);
  const row = (await resolveEnvelopeRow(envelope)) ?? existing;

  if (!row) {
    return {
      outcome: "unresolved",
      query,
      row: null,
      envelope,
      message: importResultMessage("unresolved", query),
    };
  }

  if (!importedRowMatchesQuery(query, row)) {
    const rejectedName = row.registered_product_name ?? undefined;
    return {
      outcome: "identity_mismatch",
      query,
      // Deliberately not surfaced as the imported record.
      row: null,
      envelope,
      message: importResultMessage("identity_mismatch", query, null, rejectedName),
      rejectedName,
    };
  }

  const outcome: ApvmaImportOutcome =
    existing && existing.id === row.id ? "already_present" : "imported";
  return {
    outcome,
    query,
    row,
    envelope,
    message: importResultMessage(outcome, query, row),
  };
}

/** Re-run the APVMA pipeline for an existing Master record. */
export async function refreshFromApvma(
  master: MasterChemicalRow,
): Promise<ApvmaImportResult> {
  const query =
    parseApvmaQuery(master.registration_number ?? "") ??
    parseApvmaQuery(master.registered_product_name ?? "");
  if (!query) {
    throw new Error("This record has no APVMA registration number or product name to refresh.");
  }

  const data = await invokeLookup(
    buildApvmaLookupBody(query, { mode: "refresh", masterChemicalId: master.id }),
  );
  const envelope = parseMasterLookupEnvelope(data);
  const refreshed = (await fetchMasterChemical(master.id)) ?? (await resolveEnvelopeRow(envelope));

  if (!refreshed) {
    return {
      outcome: "unresolved",
      query,
      row: master,
      envelope,
      message: importResultMessage("unresolved", query),
    };
  }
  if (!importedRowMatchesQuery(query, refreshed)) {
    const rejectedName = refreshed.registered_product_name ?? undefined;
    return {
      outcome: "identity_mismatch",
      query,
      row: master,
      envelope,
      message: importResultMessage("identity_mismatch", query, null, rejectedName),
      rejectedName,
    };
  }
  return {
    outcome: "updated",
    query,
    row: refreshed,
    envelope,
    message: importResultMessage("updated", query, refreshed),
  };
}
