// Stage 3A — frozen chemical snapshots for spray lines.
//
// Contract: docs/chemical-intelligence-json-contract.md §8. The container key
// `chemicalSnapshot` is camelCase (it lives inside the legacy camelCase `tanks`
// payload); everything inside is snake_case.
//
// Lifecycle rule: a snapshot is captured when the application is RECORDED, not
// while it is being planned. Existing snapshots are immutable evidence — the
// portal reads them and never rewrites them.
import {
  INTELLIGENCE_SCHEMA_VERSION,
  type WriteVerificationStatus,
} from "@/lib/chemicalIntelligenceWrite";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";

/** Bumped by the FRAC/HRAC/IRAC reference table, mirrored from iOS/Android. */
export const ACTIVITY_GROUP_TABLE_VERSION = 1;

export interface ChemicalSnapshotActive {
  name: string;
  concentration?: number;
  concentration_unit?: string;
  activity_group?: { scheme: string; code: string; common_name?: string };
}

export interface ChemicalLineSnapshot {
  saved_chemical_id?: string;
  product_name?: string;
  active_ingredients: ChemicalSnapshotActive[];
  activity_groups: string[];
  verification_status: WriteVerificationStatus;
  registration_identity_key?: string;
  country_code?: string;
  schema_version: number;
  activity_group_table_version: number;
  legacy_chemical_group?: string;
  captured_at?: string;
}

export type SnapshotStage = "planning" | "proposed" | "recording" | "recorded";

/** Snapshots belong to recorded history, never to a plan or template. */
export const shouldCaptureSnapshot = (stage: SnapshotStage): boolean =>
  stage === "recording" || stage === "recorded";

const schemeOut = (scheme: string): string => {
  const s = (scheme ?? "").toLowerCase();
  return s === "na" || s === "unknown" || s === "not_applicable" ? "not_applicable" : s;
};

export function registrationIdentityKey(
  country: string | null | undefined,
  scheme: string | null | undefined,
  number: string | null | undefined,
): string | undefined {
  const num = (number ?? "").trim();
  if (!num) return undefined;
  const c = (country ?? "").trim().toUpperCase() || "UNKNOWN";
  const s = (scheme ?? "").trim().toLowerCase() || "unknown";
  return `${c}:${s}:${num.toUpperCase()}`;
}

/**
 * Build the frozen snapshot for one spray line. A chemical with nothing
 * structured yields a minimal, honest snapshot: `unverified`, schema 0 and the
 * legacy display string only.
 */
export function buildChemicalSnapshot(
  chem: ChemicalIntelligence,
  opts: { capturedAt?: string; legacyChemicalGroup?: string | null } = {},
): ChemicalLineSnapshot {
  const structured = chem.structured;
  const actives: ChemicalSnapshotActive[] = structured
    ? chem.actives.map((a) => {
        const out: ChemicalSnapshotActive = { name: a.name ?? "" };
        if (a.concentration != null) out.concentration = a.concentration;
        if (a.concentrationUnit) out.concentration_unit = a.concentrationUnit;
        if (a.activityGroup?.code) {
          out.activity_group = {
            scheme: schemeOut(a.activityGroup.scheme),
            code: a.activityGroup.code,
            ...(a.activityGroup.commonName ? { common_name: a.activityGroup.commonName } : {}),
          };
        }
        return out;
      })
    : [];

  const groups = structured
    ? chem.activityGroups.map((g) => g.code).filter((c): c is string => !!c)
    : [];

  const legacy = opts.legacyChemicalGroup ?? chem.legacy?.chemicalGroup ?? null;

  const snapshot: ChemicalLineSnapshot = {
    active_ingredients: actives,
    activity_groups: groups,
    verification_status: (structured
      ? chem.verification.status
      : "unverified") as WriteVerificationStatus,
    schema_version: structured ? INTELLIGENCE_SCHEMA_VERSION : 0,
    activity_group_table_version: ACTIVITY_GROUP_TABLE_VERSION,
  };

  if (chem.id) snapshot.saved_chemical_id = chem.id;
  if (chem.name) snapshot.product_name = chem.name;
  const key = registrationIdentityKey(
    chem.product.country,
    chem.product.registrationScheme,
    chem.product.registrationNumber,
  );
  if (key) snapshot.registration_identity_key = key;
  if (chem.product.country) snapshot.country_code = chem.product.country.toUpperCase();
  if (legacy) snapshot.legacy_chemical_group = legacy;
  snapshot.captured_at = opts.capturedAt ?? new Date().toISOString();
  return snapshot;
}

/** Defensive read of a snapshot already stored in `tanks`. Never throws. */
export function readChemicalSnapshot(raw: unknown): ChemicalLineSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  const actives = Array.isArray(o.active_ingredients) ? o.active_ingredients : [];
  return {
    saved_chemical_id: typeof o.saved_chemical_id === "string" ? o.saved_chemical_id : undefined,
    product_name: typeof o.product_name === "string" ? o.product_name : undefined,
    active_ingredients: actives
      .filter((a: any) => a && typeof a === "object")
      .map((a: any) => ({
        name: String(a.name ?? ""),
        ...(Number.isFinite(Number(a.concentration)) ? { concentration: Number(a.concentration) } : {}),
        ...(a.concentration_unit ? { concentration_unit: String(a.concentration_unit) } : {}),
        ...(a.activity_group?.code
          ? {
              activity_group: {
                scheme: schemeOut(String(a.activity_group.scheme ?? "")),
                code: String(a.activity_group.code),
                ...(a.activity_group.common_name
                  ? { common_name: String(a.activity_group.common_name) }
                  : {}),
              },
            }
          : {}),
      })),
    activity_groups: Array.isArray(o.activity_groups) ? o.activity_groups.map(String) : [],
    verification_status: (typeof o.verification_status === "string"
      ? o.verification_status
      : "unverified") as WriteVerificationStatus,
    registration_identity_key:
      typeof o.registration_identity_key === "string" ? o.registration_identity_key : undefined,
    country_code: typeof o.country_code === "string" ? o.country_code : undefined,
    schema_version: Number.isFinite(Number(o.schema_version)) ? Number(o.schema_version) : 0,
    activity_group_table_version: Number.isFinite(Number(o.activity_group_table_version))
      ? Number(o.activity_group_table_version)
      : 0,
    legacy_chemical_group:
      typeof o.legacy_chemical_group === "string" ? o.legacy_chemical_group : undefined,
    captured_at: typeof o.captured_at === "string" ? o.captured_at : undefined,
  };
}

/** Snapshots are immutable: keep whatever history already recorded. */
export function preserveExistingSnapshot(
  existing: unknown,
  candidate: ChemicalLineSnapshot | null,
): ChemicalLineSnapshot | null {
  return readChemicalSnapshot(existing) ?? candidate;
}
